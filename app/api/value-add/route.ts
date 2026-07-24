export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

// GET /api/value-add â€” list all jobs (optionally filtered by status or order)
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

// WIP tag code: WIP<julian><seq>, e.g. WIP26205003 for the third job of the
// day. Code 39 only carries A-Z/0-9, so no punctuation. Sequence comes from
// what's already tagged that day — at a handful of jobs a day the read-then-
// write gap is not worth a sequence table, and the unique index catches a tie.
async function nextTagCode(requestedDate: string): Promise<string> {
  const d     = new Date(requestedDate + 'T12:00:00')
  const start = new Date(d.getFullYear(), 0, 0)
  const day   = Math.floor((d.getTime() - start.getTime()) / 86_400_000)
  const prefix = `WIP${String(d.getFullYear()).slice(2)}${String(day).padStart(3, '0')}`

  const { data } = await supabase
    .from('value_add_jobs')
    .select('tag_code')
    .like('tag_code', `${prefix}%`)

  const seq = (data ?? []).reduce((max, r) => {
    const n = parseInt(String(r.tag_code ?? '').slice(prefix.length), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0) + 1

  return `${prefix}${String(seq).padStart(3, '0')}`
}

// POST /api/value-add â€” create a new value-add job
export async function POST(req: NextRequest) {
  const body = await req.json()
  const requestedDate = body.requested_date ?? isoDate()

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
      requested_date:                requestedDate,
      completed_date:                body.completed_date                ?? null,
      status:                        'pending',
      notes:                         body.notes                         ?? '',
      customer_name:                 body.customer_name                 ?? null,
      source_description:            body.source_description            ?? null,
      tag_code:                      await nextTagCode(requestedDate),
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/value-add â€” update a job (weight in/out, status, etc.)
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  // Auto-set completed_date when status flips to complete
  if (updates.status === 'complete' && !updates.completed_date) {
    updates.completed_date = isoDate()
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
