export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// A kiosk that hasn't reported in this long is treated as switched off: its scale
// drops out of the response and the page hides the widget, rather than showing
// "kiosk offline" forever on a machine that was only ever a test.
const KIOSK_ACTIVE_WINDOW_MS = 10 * 60 * 1000

// GET /api/scale-readings — the latest reading from every scale the harvest kiosk
// agent is pushing (one row per scale, upserted ~1/s). The page polls this and
// offers a Capture button next to each weight field. Read-only: only the kiosk's
// service-role agent writes the table.
export async function GET() {
  const { data, error } = await supabase
    .from('scale_readings')
    .select('scale_id, kiosk, kg, lb, stable, stale, below_zero, read_at, updated_at')
    .gte('updated_at', new Date(Date.now() - KIOSK_ACTIVE_WINDOW_MS).toISOString())
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [], { headers: { 'Cache-Control': 'no-store' } })
}
