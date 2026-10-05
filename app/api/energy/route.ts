export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ENERGY_METHODS, type EnergyMethod } from '@/lib/energy'

// Equipment energy log — see lib/energy and scripts/2026-10-03_asset_energy.sql.
//
//   GET    /api/energy          → active assets, every reading, every rate
//   POST   /api/energy          → file a meter reading (optionally against a
//                                 machine that isn't in the register yet)
//   PATCH  /api/energy          → set an asset's nameplate watts
//   DELETE /api/energy?id=      → remove a reading (a typo'd kWh is worse
//                                 than no reading)
//
// The page does the arithmetic from these rows; nothing derived is stored.

const ASSET_COLS = 'id, name, make, model, category, status, active, rated_watts, cleaning_areas(id, name)'

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}

export async function GET() {
  const [assets, readings, rates] = await Promise.all([
    supabaseAdmin.from('assets').select(ASSET_COLS).eq('active', true).order('name'),
    supabaseAdmin.from('asset_energy_readings').select('*').order('ended_at', { ascending: false }),
    supabaseAdmin.from('energy_rates').select('*').order('effective_on', { ascending: false }),
  ])
  const err = assets.error ?? readings.error ?? rates.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  return NextResponse.json({
    assets:   assets.data ?? [],
    readings: readings.data ?? [],
    rates:    rates.data ?? [],
  })
}

export async function POST(req: NextRequest) {
  const b = await req.json() as Record<string, unknown>

  const kwh = num(b.kwh)
  if (kwh == null || kwh < 0) return NextResponse.json({ error: 'Enter the kWh the meter shows.' }, { status: 400 })

  const started = Date.parse(String(b.started_at ?? ''))
  const ended   = Date.parse(String(b.ended_at ?? ''))
  if (!Number.isFinite(started) || !Number.isFinite(ended)) {
    return NextResponse.json({ error: 'Give the start and end of the metering window.' }, { status: 400 })
  }
  if (ended <= started) return NextResponse.json({ error: 'The window has to end after it starts.' }, { status: 400 })

  const method = ENERGY_METHODS.includes(b.method as EnergyMethod) ? (b.method as EnergyMethod) : 'plug_meter'
  const peak   = num(b.peak_kw)
  const rated  = num(b.rated_watts)

  // A walk-in cooler isn't in the register yet because the plant walk hasn't
  // reached it. Metering it shouldn't wait on that, so a name is enough to
  // create the asset here; the walk claims it later.
  let assetId = typeof b.asset_id === 'string' && b.asset_id ? b.asset_id : null
  const newName = typeof b.new_asset_name === 'string' ? b.new_asset_name.trim() : ''
  if (!assetId && newName) {
    const { data, error } = await supabaseAdmin
      .from('assets')
      .insert([{ name: newName, category: 'equipment', rated_watts: rated }])
      .select('id').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    assetId = data.id
  } else if (assetId && rated != null) {
    const { error } = await supabaseAdmin
      .from('assets').update({ rated_watts: rated, updated_at: new Date().toISOString() }).eq('id', assetId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (!assetId) return NextResponse.json({ error: 'Pick the machine, or name a new one.' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('asset_energy_readings')
    .insert([{
      asset_id:    assetId,
      started_at:  new Date(started).toISOString(),
      ended_at:    new Date(ended).toISOString(),
      kwh,
      method,
      peak_kw:     peak,
      recorded_by: typeof b.recorded_by === 'string' && b.recorded_by.trim() ? b.recorded_by.trim() : null,
      notes:       typeof b.notes === 'string' && b.notes.trim() ? b.notes.trim() : null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const b = await req.json() as Record<string, unknown>
  const assetId = typeof b.asset_id === 'string' ? b.asset_id : ''
  if (!assetId) return NextResponse.json({ error: 'asset_id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('assets')
    .update({ rated_watts: num(b.rated_watts), updated_at: new Date().toISOString() })
    .eq('id', assetId)
    .select(ASSET_COLS).single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabaseAdmin.from('asset_energy_readings').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
