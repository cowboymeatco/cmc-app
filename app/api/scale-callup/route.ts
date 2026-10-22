export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { CALLUP_FORMATS, CALLUP_TTL_SECONDS, PLU_RE, SCALE_NUMBER_RE, callupKeys, type CallupFormat } from '@/lib/scaleCallup'

// GET  /api/scale-callup → the last few call-ups, which wedges are alive, and
//                          the PLUs that can be called up (the /scale-callup
//                          bench page). ?wedges=1 → just the wedges and the
//                          last 20 rows, which is all the scanner polls for.
// POST /api/scale-callup → queue one: "scale 2, call up PLU 118". The Pico
//                          wedge on that scale picks it up through
//                          /api/scale-callup/device and types it.
//
// See scripts/2026-10-13_scale_callups.sql and scripts/pico-wedge/README.md.

export async function GET(req: NextRequest) {
  const light = req.nextUrl.searchParams.get('wedges') === '1'
  const [requests, wedges, items] = await Promise.all([
    supabaseAdmin.from('scale_callup_requests').select('*').order('created_at', { ascending: false }).limit(20),
    supabaseAdmin.from('scale_wedges').select('*').order('scale'),
    light ? null : supabaseAdmin.from('plu_items').select('plu_number, item_name, price').eq('active', true).order('plu_number'),
  ])
  if (requests.error) return NextResponse.json({ error: requests.error.message }, { status: 500 })
  // Only what the price push sends is on the scales (see lib/scaleReads).
  const plus = (items?.data ?? [])
    .filter(p => p.price != null && Number(p.price) > 0.01)
    .map(p => ({ plu: String(p.plu_number), name: p.item_name ?? '' }))
  return NextResponse.json({
    requests: requests.data ?? [], wedges: wedges.data ?? [], plus,
    now: new Date().toISOString(), ttl: CALLUP_TTL_SECONDS,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    scale?: unknown; plu?: unknown; item_name?: unknown; format?: unknown; requested_by?: unknown
  }
  const scale = String(body.scale ?? '').trim()
  const plu = String(body.plu ?? '').trim()
  const format = (CALLUP_FORMATS as string[]).includes(String(body.format)) ? body.format as CallupFormat : 'plu'
  if (!SCALE_NUMBER_RE.test(scale)) return NextResponse.json({ error: 'scale must be the scale number, e.g. 2' }, { status: 400 })
  if (!PLU_RE.test(plu) || parseInt(plu, 10) === 0) return NextResponse.json({ error: 'plu must be 1 to 5 digits' }, { status: 400 })

  // A scale shows one product at a time, so a newer tap for the same scale
  // replaces any call-up still waiting there. Only pending ones: a claimed
  // row is already being typed.
  await supabaseAdmin
    .from('scale_callup_requests')
    .update({ status: 'expired', completed_at: new Date().toISOString(), error: 'replaced by a newer call-up' })
    .eq('scale', scale)
    .eq('status', 'pending')

  const { data, error } = await supabaseAdmin
    .from('scale_callup_requests')
    .insert({
      scale, plu: String(parseInt(plu, 10)), format,
      keys: callupKeys(plu, format),
      item_name: body.item_name == null ? null : String(body.item_name).slice(0, 80),
      requested_by: String(body.requested_by ?? 'app').slice(0, 60),
    })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, request: data })
}
