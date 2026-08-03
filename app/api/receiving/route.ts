export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'

// GET /api/receiving?type=animal|box
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'animal'

  if (type === 'animal') {
    const apptId = searchParams.get('appointment_id')
    // An animal taken off the day is kept as a 'removed' row so it holds its
    // animal_index (see DELETE below). Callers that only care about live
    // animals get them filtered out; the worksheet asks for them with
    // include_removed=1 because it needs the reserved slot.
    const includeRemoved = searchParams.get('include_removed') === '1'
    let query = supabase
      .from('animal_receiving_log')
      .select('*')
      .order('animal_index', { ascending: true })
    if (apptId) query = query.eq('appointment_id', apptId)
    if (!includeRemoved) query = query.neq('status', 'removed')
    const { data, error } = await query
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
    // Batch insert â€” animals array contains per-head data
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
      status:          (a.status as string) === 'no_show' ? 'no_show' : 'received',
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

    // If every animal is a no-show, mark appointment NoShow (keeps out of harvest queue).
    // Otherwise flip to AnimalIn so it appears in the harvest queue.
    if (fields.appointment_id) {
      const allNoShow = animals.every((a) => (a.status as string) === 'no_show')
      await supabase
        .from('harvest_appointments')
        .update({ status: allNoShow ? 'NoShow' : 'AnimalIn' })
        .eq('id', fields.appointment_id)
    }

    return NextResponse.json(data)
  }

  // Box product â€” auto-generate CMC-YYYYMMDD-NNN identifier
  const today    = isoDate().replace(/-/g, '')  // e.g. "20260503"
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
      received_at:    fields.received_at ?? isoDate(),
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

// PATCH /api/receiving â€” update status or fields
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { type, id, ...updates } = body
  const table = type === 'animal' ? 'animal_receiving_log' : 'box_receiving_log'
  const { data, error } = await supabase.from(table).update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/receiving?type=animal|box&id=xxx — remove a single record
//
// An ANIMAL is never really deleted: the row is marked 'removed' so it keeps
// its animal_index, and the carcass number it was holding stays reserved. A
// hard delete let the animals behind it slide up onto numbers that were
// already printed and hanging on the rail (Jill, 2026-08-03 — Cindy Wright's
// second lamb). Boxes carry no such numbering, so those still delete.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id   = searchParams.get('id')
  const type = searchParams.get('type') ?? 'animal'
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  if (type === 'animal') {
    const { error } = await supabase
      .from('animal_receiving_log')
      .update({ status: 'removed' })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  const { error } = await supabase.from('box_receiving_log').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
