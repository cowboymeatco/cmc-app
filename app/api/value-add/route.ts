import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/value-add — list all jobs (optionally filtered by status or order)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status   = searchParams.get('status')
  const order_id = searchParams.get('order_id')

  let query = supabase
    .from('value_add_jobs')
    .select('*')
    .order('requested_date', { ascending: false })

  if (status)   query = query.eq('status', status)
  if (order_id) query = query.eq('linked_order_id', order_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/value-add — create a new value-add job
export async function POST(req: NextRequest) {
  const body = await req.json()

  const { data, error } = await supabase
    .from('value_add_jobs')
    .insert([{
      job_type:                      body.job_type                      ?? 'other',
      description:                   body.description                   ?? '',
      source_type:                   body.source_type                   ?? 'general',
      linked_order_id:               body.linked_order_id               ?? null,
      linked_cutting_instruction_id: body.linked_cutting_instruction_id ?? null,
      output_plu:                    body.output_plu                    ?? null,
      output_item_name:              body.output_item_name              ?? '',
      weight_in_lbs:                 body.weight_in_lbs                 ?? null,
      weight_out_lbs:                body.weight_out_lbs                ?? null,
      assigned_to:                   body.assigned_to                   ?? '',
      requested_date:                body.requested_date                ?? new Date().toISOString().slice(0, 10),
      completed_date:                body.completed_date                ?? null,
      status:                        'pending',
      notes:                         body.notes                         ?? '',
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/value-add — update a job (weight in/out, status, etc.)
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  // Auto-set completed_date when status flips to complete
  if (updates.status === 'complete' && !updates.completed_date) {
    updates.completed_date = new Date().toISOString().slice(0, 10)
  }

  const { data, error } = await supabase
    .from('value_add_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
