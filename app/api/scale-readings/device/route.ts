export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { parseRiceLakeFrame, SCALE_IDS } from '@/lib/scaleReading'

// POST /api/scale-readings/device — the Pico on a floor scale reports in.
//
//   → { scale_id: "live_animal", kiosk?: "pico-scale-1",
//       frame?: "   1245.LG ",        the raw Rice Lake frame, parsed here
//       lb?, kg?, stable?, below_zero?,  or already-parsed numbers
//       error?: "no frames for 5s" }  nothing on the wire: the row goes stale
//   ← { ok: true, lb, stable }
//
// One row per scale (scale_readings, keyed on scale_id), overwritten on every
// report, so the table never grows and the harvest page reads a single row.
// Same bearer token as the scale wedges (SCALE_WEDGE_TOKEN); fails closed.

export async function POST(req: NextRequest) {
  const token = process.env.SCALE_WEDGE_TOKEN
  if (!token) return NextResponse.json({ error: 'SCALE_WEDGE_TOKEN is not configured — refusing' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${token}`) return new NextResponse('Unauthorized', { status: 401 })

  const body = await req.json().catch(() => ({})) as {
    scale_id?: unknown; kiosk?: unknown; frame?: unknown
    lb?: unknown; kg?: unknown; stable?: unknown; below_zero?: unknown; error?: unknown
  }
  const scale_id = String(body.scale_id ?? '').trim()
  if (!(SCALE_IDS as readonly string[]).includes(scale_id)) {
    return NextResponse.json({ error: `scale_id must be one of ${SCALE_IDS.join(', ')}` }, { status: 400 })
  }
  const now = new Date().toISOString()
  const kiosk = body.kiosk == null ? null : String(body.kiosk).slice(0, 60)

  let row: Record<string, unknown>
  if (typeof body.error === 'string' && body.error) {
    row = { scale_id, kiosk, lb: null, kg: null, stable: false, stale: true, below_zero: false, read_at: now, updated_at: now, raw: { error: body.error.slice(0, 200) } }
  } else {
    const parsed = typeof body.frame === 'string' ? parseRiceLakeFrame(body.frame) : null
    const lb = parsed ? parsed.lb : body.lb == null ? null : Number(body.lb)
    const kg = parsed ? parsed.kg : body.kg == null ? (lb == null ? null : Math.round(lb / 2.20462 * 1000) / 1000) : Number(body.kg)
    if (lb == null || !Number.isFinite(lb)) return NextResponse.json({ error: 'no weight: send a frame or lb' }, { status: 400 })
    row = {
      scale_id, kiosk, lb, kg,
      stable: parsed ? parsed.stable : body.stable === true,
      below_zero: parsed ? parsed.below_zero : body.below_zero === true || lb < 0,
      stale: false, read_at: now, updated_at: now,
      raw: parsed ? { frame: String(body.frame).replace(/[\x00-\x1f]/g, '·'), unit: parsed.unit, gross: parsed.gross, status: parsed.status } : null,
    }
  }
  const { error } = await supabaseAdmin.from('scale_readings').upsert(row, { onConflict: 'scale_id' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, lb: row.lb, stable: row.stable })
}
