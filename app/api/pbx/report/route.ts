export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { CALL_TYPES, pbxUnauthorized, phoneDigits, type CallType } from '@/lib/pbx'

// POST /api/pbx/report — 3CX's "ReportCall": one call just ended.
//
// The body is whatever the ReportCall scenario in scripts/3cx/cmc-app.xml
// puts in its PostValues; the field names below are ours, not 3CX's, so the
// template is the one place to look when something arrives under a different
// name. Times come as milliseconds since epoch (UTC) because 3CX's
// DateTime.ToString() formatting is culture-dependent and integers are not.
//
// One row per call goes into phone_calls (scripts/2026-11-10_phone_calls.sql).
// 3CX may report the same call twice (a restart, a retry after a timeout), so
// the insert ignores a duplicate on (started_at, number, agent_ext) rather
// than double-counting it.
//
// Guarded by PBX_API_KEY and fails CLOSED (lib/pbx.ts).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// A DateTime 3CX never set shows up as DateTime.MinValue in millis (year 1)
// or as 0. Anything before this is "no such moment", not a timestamp.
const MIN_PLAUSIBLE_MS = Date.UTC(2000, 0, 1)

function str(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null
  const s = String(v).trim().slice(0, max)
  return s || null
}

function whenMs(v: unknown): string | null {
  const n = typeof v === 'number' ? v : Number(String(v ?? '').trim())
  if (!Number.isFinite(n) || n < MIN_PLAUSIBLE_MS) return null
  return new Date(n).toISOString()
}

function callType(v: unknown): CallType | null {
  const s = String(v ?? '').trim().toLowerCase()
  return (CALL_TYPES as readonly string[]).includes(s) ? (s as CallType) : null
}

export async function POST(req: NextRequest) {
  const denied = pbxUnauthorized(req)
  if (denied) return denied

  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'bad JSON' }, { status: 400 })

  const call_type = callType(body.call_type)
  if (!call_type) return NextResponse.json({ error: `call_type must be one of ${CALL_TYPES.join(', ')}` }, { status: 400 })
  const direction = String(body.direction ?? '').trim().toLowerCase()
  if (direction !== 'inbound' && direction !== 'outbound') return NextResponse.json({ error: 'direction must be inbound or outbound' }, { status: 400 })

  const number = str(body.number, 40)
  const started_at = whenMs(body.started_ms)
  if (!number || !started_at) return NextResponse.json({ error: 'number and started_ms are required' }, { status: 400 })

  // The lookup handed 3CX either a customer uuid or an "unknown:<digits>"
  // placeholder; only the former links the call to an account.
  const entity = str(body.entity_id, 80) ?? ''
  const customer_id = UUID_RE.test(entity) ? entity : null

  const durationRaw = Number(String(body.duration_seconds ?? '').trim())
  const duration_seconds = Number.isFinite(durationRaw) && durationRaw >= 0 ? Math.round(durationRaw) : null

  const agent_name = [str(body.agent_first, 80), str(body.agent_last, 80)].filter(Boolean).join(' ') || null

  const row = {
    call_type,
    direction,
    number,
    number_digits:    phoneDigits(number),
    customer_id,
    contact_name:     str(body.contact_name, 200),
    agent_ext:        str(body.agent_ext, 20) ?? '',
    agent_name,
    agent_email:      str(body.agent_email, 200),
    queue_ext:        str(body.queue_ext, 20),
    started_at,
    answered_at:      whenMs(body.answered_ms),
    ended_at:         whenMs(body.ended_ms),
    duration_seconds,
    transcription:    str(body.transcription, 20000),
    summary:          str(body.summary, 4000),
    recording_url:    str(body.recording_url, 1000),
    raw:              body,
  }

  const { data, error } = await supabaseAdmin
    .from('phone_calls')
    .upsert([row], { onConflict: 'started_at,number,agent_ext', ignoreDuplicates: true })
    .select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Empty data means the duplicate was ignored — still a 200, 3CX has no
  // business retrying.
  return NextResponse.json({ ok: true, id: data?.[0]?.id ?? null, duplicate: !data?.length })
}
