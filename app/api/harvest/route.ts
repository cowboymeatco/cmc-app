export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/harvest?type=log|chill
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'log'

  if (type === 'chill') {
    const { data, error } = await supabase
      .from('chill_log')
      .select('*')
      .order('checked_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // harvest log
  const status = searchParams.get('status')
  const date   = searchParams.get('date')
  let query = supabase
    .from('harvest_log')
    .select('*')
    .order('harvest_date', { ascending: true })
    .order('carcass_tag',  { ascending: true })
  if (status) query = query.eq('status', status)
  if (date)   query = query.eq('harvest_date', date)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/harvest â€” create record(s)
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { type, ...fields } = body

  if (type === 'chill') {
    const { data, error } = await supabase
      .from('chill_log')
      .insert([{
        harvest_log_id: fields.harvest_log_id,
        carcass_tag:    fields.carcass_tag ?? '',
        checked_at:     fields.checked_at ?? new Date().toISOString(),
        carcass_temp_f: fields.carcass_temp_f ?? null,
        cooler_temp_f:  fields.cooler_temp_f ?? null,
        checked_by:     fields.checked_by ?? '',
        notes:          fields.notes ?? '',
      }])
      .select()
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // harvest log â€” may be array of carcasses
  const rows: object[] = (fields.carcasses ?? [fields]).map((c: Record<string, unknown>) => ({
    appointment_id:         fields.appointment_id,
    harvest_date:           fields.harvest_date,
    species:                fields.species ?? '',
    carcass_tag:            c.carcass_tag ?? '',
    sex:                    c.sex ?? '',
    live_weight_lbs:        c.live_weight_lbs ?? null,
    half_1_weight_lbs:      c.half_1_weight_lbs ?? null,
    half_2_weight_lbs:      c.half_2_weight_lbs ?? null,
    hot_carcass_weight_lbs: c.hot_carcass_weight_lbs ?? null,
    yield_pct:              (c.live_weight_lbs && c.hot_carcass_weight_lbs)
                              ? Math.round(((c.hot_carcass_weight_lbs as number) / (c.live_weight_lbs as number)) * 1000) / 10
                              : null,
    inspector_initials:     fields.inspector_initials ?? '',
    intervention_applied:   c.intervention_applied ?? true,
    intervention_type:      c.intervention_type ?? fields.intervention_type ?? 'Hot Water',
    intervention_temp_f:    c.intervention_temp_f ?? null,
    final_carcass_temp_f:   c.final_carcass_temp_f ?? null,
    ccp_pass:               c.ccp_pass ?? true,
    performed_by:           fields.performed_by ?? '',
    notes:                  c.notes ?? '',
    status:                 'chilling',
    is_verification:        c.is_verification ?? false,
    direct_observation:     c.direct_observation ?? false,
    over_30_months:         c.over_30_months ?? false,
    producer:               fields.producer ?? '',
    ear_tag:                c.ear_tag ?? '',
    breed:                  c.breed ?? '',
  }))

  const { data, error } = await supabase
    .from('harvest_log')
    .insert(rows)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Update appointment to Processing
  if (fields.appointment_id) {
    await supabase
      .from('harvest_appointments')
      .update({ status: 'Processing' })
      .eq('id', fields.appointment_id)
  }

  return NextResponse.json(data)
}

// PATCH /api/harvest â€” update status
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { type, id, ...updates } = body

  const table = type === 'chill' ? 'chill_log' : 'harvest_log'

  const { data, error } = await supabase
    .from(table)
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
