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

  // box
  const { data, error } = await supabase
    .from('box_receiving_log')
    .select('*')
    .order('received_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/receiving — create a new receiving record
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { type, ...fields } = body

  if (type === 'animal') {
    const { data, error } = await supabase
      .from('animal_receiving_log')
      .insert([{
        appointment_id:  fields.appointment_id ?? null,
        received_at:     fields.received_at ?? new Date().toISOString(),
        live_weight_lbs: fields.live_weight_lbs ?? null,
        received_by:     fields.received_by ?? '',
        health_cert_no:  fields.health_cert_no ?? '',
        notes:           fields.notes ?? '',
        status:          'received',
      }])
      .select()
      .single()

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Flip appointment status to AnimalIn
    if (fields.appointment_id) {
      await supabase
        .from('harvest_appointments')
        .update({ status: 'AnimalIn' })
        .eq('id', fields.appointment_id)
    }

    return NextResponse.json(data)
  }

  // box product
  const { data, error } = await supabase
    .from('box_receiving_log')
    .insert([{
      received_at:  fields.received_at ?? new Date().toISOString().slice(0, 10),
      vendor:       fields.vendor ?? '',
      product:      fields.product ?? '',
      quantity:     fields.quantity ?? 1,
      weight_lbs:   fields.weight_lbs ?? null,
      invoice_no:   fields.invoice_no ?? '',
      lot_no:       fields.lot_no ?? '',
      temp_f:       fields.temp_f ?? null,
      received_by:  fields.received_by ?? '',
      notes:        fields.notes ?? '',
      status:       'received',
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/receiving — update status
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { type, id, ...updates } = body

  const table = type === 'animal' ? 'animal_receiving_log' : 'box_receiving_log'

  const { data, error } = await supabase
    .from(table)
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
