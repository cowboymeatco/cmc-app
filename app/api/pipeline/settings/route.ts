export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// POST /api/pipeline/settings { office_minutes } — the office time In the
// Building adds to every account (invoice, pickup call, collecting). A guess
// Charlie tunes by hand until real office time is collected.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const minutes = Number(body.office_minutes)
  if (!Number.isFinite(minutes) || minutes < 0 || minutes > 240) {
    return NextResponse.json({ error: 'office_minutes must be 0–240' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('capacity_settings').update({ pipeline_office_minutes: minutes }).eq('id', 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ office_minutes: minutes })
}
