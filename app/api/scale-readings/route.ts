export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { readingIsStale, type ScaleReading } from '@/lib/scaleReading'

// GET /api/scale-readings?scale_id=live_animal → the latest reading off that
// scale, with `stale` already worked out against the clock, so a page can
// poll it once a second and show the number only while it is current.

export async function GET(req: NextRequest) {
  const scale_id = req.nextUrl.searchParams.get('scale_id') ?? 'live_animal'
  const { data, error } = await supabaseAdmin.from('scale_readings').select('*').eq('scale_id', scale_id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const now = Date.now()
  const r = data as ScaleReading | null
  return NextResponse.json({
    reading: r ? { ...r, stale: readingIsStale(r, now), age_s: Math.round((now - new Date(r.read_at).getTime()) / 1000) } : null,
    now: new Date(now).toISOString(),
  })
}
