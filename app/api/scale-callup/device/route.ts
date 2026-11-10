export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { CALLUP_TTL_SECONDS, SCALE_NUMBER_RE, WEDGE_POLL_BUSY_SECONDS, wedgePollSeconds } from '@/lib/scaleCallup'

// POST /api/scale-callup/device — the Pico wedge's one call.
//
// Each wedge polls this with its scale number. In one round trip it reports
// how the last job went (if it had one), is handed the next one, and is told
// how long to wait before asking again, so the board's code stays as small
// as a board's code should.
//
//   → { scale: "2", done?: { id, ok, error? } }
//   ← { job: { id, keys, plu, item_name } | null, next_in: seconds }
//
// Everything on the database side is one function call
// (scripts/2026-11-10_wedge_check_in.sql): heartbeat, close the last job,
// expire stale call-ups, claim the next. It used to be four requests per
// poll, which across three boards was ~630,000 Supabase requests a day and
// what blew the egress quota on 2026-11-08.
//
// next_in is 1 s while someone is working the station (a scanner page has
// that scale on screen, or it is shop hours) and longer otherwise; see
// lib/scaleCallup.ts wedgePollSeconds. Older firmware ignores it and keeps
// polling every second, which still works.
//
// Guarded by SCALE_WEDGE_TOKEN (set it in the app's env and in each Pico's
// settings.toml) and fails CLOSED. The devices never hold a Supabase key.

interface Done { id?: unknown; ok?: unknown; error?: unknown }
interface Job { id: string; plu: string; keys: string; item_name: string | null }
interface CheckIn { job?: Job | null; scanner_seen_at?: string | null }

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(req: NextRequest) {
  const token = process.env.SCALE_WEDGE_TOKEN
  if (!token) return NextResponse.json({ error: 'SCALE_WEDGE_TOKEN is not configured — refusing' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${token}`) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => ({})) as { scale?: unknown; done?: Done }
  const scale = String(body.scale ?? '').trim()
  if (!SCALE_NUMBER_RE.test(scale)) return NextResponse.json({ error: 'scale must be the scale number, e.g. 2' }, { status: 400 })

  // A done report names the row this wedge claimed. Anything that is not a
  // row id is not a report.
  const done = body.done
  const doneId = done && typeof done.id === 'string' && UUID_RE.test(done.id) ? done.id : null
  const doneOk = doneId ? done!.ok === true : null

  const { data, error } = await supabaseAdmin.rpc('wedge_check_in', {
    p_scale: scale,
    p_done_id: doneId,
    p_done_ok: doneOk,
    p_done_error: doneId && !doneOk ? String(done!.error ?? 'wedge reported failure').slice(0, 200) : null,
    p_ttl_seconds: CALLUP_TTL_SECONDS,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const r = (data ?? {}) as CheckIn
  const job = r.job ?? null
  // A board that just typed something is at a busy station whatever the clock says.
  const nextIn = job ? WEDGE_POLL_BUSY_SECONDS : wedgePollSeconds(new Date(), r.scanner_seen_at)
  return NextResponse.json({ job, next_in: nextIn })
}
