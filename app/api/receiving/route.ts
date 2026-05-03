import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/receiving?type=animal|box
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'animal'

  if (type === 'animal') {
    const { data, error } = await supabase
      .from('animal_receiving_log')
      .select('*')
      .order('received_at', { ascending: false })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const { data, error } = await supabase
    .from('box_receiving_log')
    .select('*')
    .order('received_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/receiving
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { type, ...fields } = body

  if (type === 'animal') {
    // Batch insert — animals array contains per-head data
    const animals: Record<string, unknown>[] = fields.animals ?? [{
      animal_index:   1,
      ear_tag:        fields.ear_tag        ?? '',
      sex:            fields.sex            ?? '',
      breed:          fields.breed          ?? '',
      over_30_months: fields.over_30_months ?? false,
      photo_url:      fields.photo_url      ?? '',
    }]

    const rows = animals.map((a) => ({
      appointment_id:  fields.appointment_id ?? null,
      received_at:     fields.received_at    ?? new Date().toISOString(),
      received_by:     fields.received_by    ?? '',
      health_cert_no:  fields.health_cert_no ?? '',
      brand_insp_no:   fields.brand_insp_no  ?? '',
      notes:           fields.notes          ?? '',
      status:          'received',
      animal_index:    a.animal_index   ?? 1,
      ear_tag:         a.ear_tag        ?? '',
      sex:             a.sex            ?? '',
      breed:           a.breed          ?? '',
      over_30_months:  a.over_30_months ?? false,
      photo_url:       a.photo_url      ?? '',
    }))

    const { data, error } = await supabase
      .from('animal_receiving_log')
      .insert(rows)
      .select()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Flip appointment to AnimalIn
    if (fields.appointment_id) {
      await supabase
        .from('harvest_appointments')
        .update({ status: 'AnimalIn' })
        .eq('id', fields.appointment_id)
    }

    return NextResponse.json(data)
  }

  // Box product — auto-generate CMC-YYYYMMDD-NNN identifier
  const today    = new Date().toISOString().slice(0, 10).replace(/-/g, '')  // e.g. "20260503"
  const prefix   = `CMC-${today}-`
  const { count } = await supabase
    .from('box_receiving_log')
    .select('*', { count: 'exact', head: true })
    .like('box_identifier', `${prefix}%`)
  const seq          = String((count ?? 0) + 1).padStart(3, '0')
  const box_identifier = `${prefix}${seq}`

  const { data, error } = await supabase
    .from('box_receiving_log')
    .insert([{
      received_at:    fields.received_at ?? new Date().toISOString().slice(0, 10),
      vendor:         fields.vendor      ?? '',
      product:        fields.product     ?? '',
      quantity:       fields.quantity    ?? 1,
      weight_lbs:     fields.weight_lbs  ?? null,
      invoice_no:     fields.invoice_no  ?? '',
      lot_no:         fields.lot_no      ?? '',
      temp_f:         fields.temp_f      ?? null,
      received_by:    fields.received_by ?? '',
      notes:          fields.notes       ?? '',
      status:         'received',
      box_identifier,
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/receiving — update status or fields
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { type, id, ...updates } = body
  const table = type === 'animal' ? 'animal_receiving_log' : 'box_receiving_log'
  const { data, error } = await supabase.from(table).update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
