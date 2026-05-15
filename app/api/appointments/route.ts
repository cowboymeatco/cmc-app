export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/appointments â€” list all appointments
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  let query = supabase
    .from('harvest_appointments')
    .select('*')
    .order('harvest_date', { ascending: true })

  if (date) {
    query = query.eq('harvest_date', date)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/appointments â€” create a new appointment
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase
    .from('harvest_appointments')
    .insert([{
      harvest_date:      body.harvest_date,
      species:           body.species,
      head_count:        body.head_count ?? 1,
      source:            body.source ?? '',
      notes:             body.notes ?? '',
      status:            body.status ?? 'Booked',
      linked_carcass_id: body.linked_carcass_id ?? '',
      customers:         body.customers ?? [],
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/appointments â€” update an appointment
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  const { data, error } = await supabase
    .from('harvest_appointments')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/appointments â€” delete an appointment
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('harvest_appointments')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
