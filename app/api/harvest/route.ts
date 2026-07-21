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
  const apptId = searchParams.get('appointment_id')
  let query = supabase
    .from('harvest_log')
    .select('*')
    .order('harvest_date', { ascending: true })
    .order('carcass_tag',  { ascending: true })
  if (status) query = query.eq('status', status)
  if (date)   query = query.eq('harvest_date', date)
  if (apptId) query = query.eq('appointment_id', apptId)

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
    performed_by:              fields.performed_by ?? '',
    notes:                     c.notes ?? '',
    status:                    'chilling',
    is_verification:           c.is_verification ?? false,
    direct_observation:        c.direct_observation ?? false,
    over_30_months:            c.over_30_months ?? false,
    producer:                  fields.producer ?? '',
    ear_tag:                   c.ear_tag ?? '',
    breed:                     c.breed ?? '',
    knock_time:                c.knock_time ?? null,
    harvest_order:             c.harvest_order ?? null,
    part_a_complete:           c.part_a_complete ?? false,
    part_b_complete:           false,
    zero_tolerance_pass:       null,
    zero_tolerance_direct_obs: false,
    initial_cooler_temp_f:     null,
    kill_type:                 c.kill_type ?? fields.kill_type ?? null,
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

// PATCH /api/harvest — update single record by id, or bulk-update harvest_logs by appointment_id
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { type, id, appointment_id, ...updates } = body

  const table = type === 'chill' ? 'chill_log' : 'harvest_log'

  // Bulk update all harvest_logs for an appointment (e.g. producer name overwrite from check-in)
  if (appointment_id && !id) {
    const { data, error } = await supabase
      .from('harvest_log')
      .update(updates)
      .eq('appointment_id', appointment_id)
      .select()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  // Yield needs the live weight (Part A) and the hot carcass weight (Part B).
  // Those are entered on different screens, in either order, so computing it
  // only at weigh-in left yield blank whenever the live weight came second.
  // Derive it here from the merged row so entry order can't matter.
  const touchesYield = table === 'harvest_log' && (
    'live_weight_lbs' in updates || 'hot_carcass_weight_lbs' in updates ||
    'half_1_weight_lbs' in updates || 'half_2_weight_lbs' in updates
  )
  if (touchesYield && id) {
    const { data: cur } = await supabase
      .from('harvest_log')
      .select('live_weight_lbs, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
      .eq('id', id)
      .single()
    const num = (v: unknown) => (v === null || v === undefined || v === '' ? null : Number(v))
    const merged = { ...(cur ?? {}), ...updates }
    const lw  = num(merged.live_weight_lbs)
    const h1  = num(merged.half_1_weight_lbs)
    const h2  = num(merged.half_2_weight_lbs)
    const hcw = num(merged.hot_carcass_weight_lbs) ?? (h1 != null && h2 != null ? h1 + h2 : h1 ?? h2)
    updates.yield_pct = lw && hcw ? Math.round((hcw / lw) * 1000) / 10 : null
  }

  const { data, error } = await supabase
    .from(table)
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/harvest?id=xxx&type=log|chill — remove a single record
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id   = searchParams.get('id')
  const type = searchParams.get('type') ?? 'log'
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const table = type === 'chill' ? 'chill_log' : 'harvest_log'
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
