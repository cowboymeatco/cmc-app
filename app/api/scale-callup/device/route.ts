export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { CALLUP_TTL_SECONDS, SCALE_NUMBER_RE } from '@/lib/scaleCallup'

// POST /api/scale-callup/device — the Pico wedge's one call.
//
// Each wedge polls this every second or so with its scale number. In one
// round trip it reports how the last job went (if it had one) and is handed
// the next one, so the board's code stays as small as a board's code should.
//
//   → { scale: "2", done?: { id, ok, error? } }
//   ← { job: { id, keys, plu, item_name } | null }
//
// Guarded by SCALE_WEDGE_TOKEN (set it in the app's env and in each Pico's
// settings.toml) and fails CLOSED. The devices never hold a Supabase key.

interface Done { id?: unknown; ok?: unknown; error?: unknown }

export async function POST(req: NextRequest) {
  const token = process.env.SCALE_WEDGE_TOKEN
  if (!token) return NextResponse.json({ error: 'SCALE_WEDGE_TOKEN is not configured — refusing' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${token}`) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => ({})) as { scale?: unknown; done?: Done }
  const scale = String(body.scale ?? '').trim()
  if (!SCALE_NUMBER_RE.test(scale)) return NextResponse.json({ error: 'scale must be the scale number, e.g. 2' }, { status: 400 })
  const now = new Date()

  // 1. How the last one went. Only a row this wedge claimed can be closed.
  const done = body.done
  if (done && typeof done.id === 'string') {
    await supabaseAdmin
      .from('scale_callup_requests')
      .update({
        status: done.ok === true ? 'done' : 'error',
        completed_at: now.toISOString(),
        error: done.ok === true ? null : String(done.error ?? 'wedge reported failure').slice(0, 200),
      })
      .eq('id', done.id)
      .eq('scale', scale)
      .eq('status', 'claimed')
  }

  // 2. Anything that sat unclaimed past its time is stale, not a job: the
  //    packer has moved on and the scale may have a different cut on it.
  const stale = new Date(now.getTime() - CALLUP_TTL_SECONDS * 1000).toISOString()
  await supabaseAdmin
    .from('scale_callup_requests')
    .update({ status: 'expired', completed_at: now.toISOString(), error: `nothing typed it within ${CALLUP_TTL_SECONDS}s` })
    .eq('scale', scale)
    .eq('status', 'pending')
    .lt('created_at', stale)

  // 3. The oldest one still waiting for this scale, claimed only if it is
  //    still pending at the moment we take it (one wedge per scale, but no
  //    harm being careful).
  const { data: next, error } = await supabaseAdmin
    .from('scale_callup_requests')
    .select('id, plu, keys, item_name')
    .eq('scale', scale)
    .eq('status', 'pending')
    .order('created_at', { ascending: true })
    .limit(1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!next?.length) return NextResponse.json({ job: null })

  const { data: claimed } = await supabaseAdmin
    .from('scale_callup_requests')
    .update({ status: 'claimed', claimed_at: now.toISOString() })
    .eq('id', next[0].id)
    .eq('status', 'pending')
    .select('id, plu, keys, item_name')
  if (!claimed?.length) return NextResponse.json({ job: null })
  return NextResponse.json({ job: claimed[0] })
}
