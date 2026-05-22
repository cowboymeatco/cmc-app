export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/corrective-actions?date=2026-05-21
// GET /api/corrective-actions?harvest_log_id=xxx
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date          = searchParams.get('date')
  const harvestLogId  = searchParams.get('harvest_log_id')

  let query = supabase
    .from('corrective_actions')
    .select('*')
    .order('created_at', { ascending: true })

  if (date)         query = query.eq('harvest_date', date)
  if (harvestLogId) query = query.eq('harvest_log_id', harvestLogId)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/corrective-actions — auto-generates car_number
export async function POST(req: NextRequest) {
  const body = await req.json()

  const year = (body.harvest_date as string | undefined)?.slice(0, 4)
    ?? new Date().getFullYear().toString()

  // Find the highest sequential number for this year
  const { data: existing } = await supabase
    .from('corrective_actions')
    .select('car_number')
    .like('car_number', `${year}-%`)
    .order('car_number', { ascending: false })
    .limit(1)

  let nextSeq = 1
  if (existing && existing.length > 0) {
    const parts = (existing[0].car_number as string).split('-')
    nextSeq = parseInt(parts[1] ?? '0', 10) + 1
  }
  const carNumber = `${year}-${String(nextSeq).padStart(3, '0')}`

  const { data, error } = await supabase
    .from('corrective_actions')
    .insert([{
      car_number:       carNumber,
      harvest_log_id:   body.harvest_log_id   ?? null,
      harvest_date:     body.harvest_date,
      type:             body.type,
      monitor_initials: body.monitor_initials  ?? null,
      action_1:         body.action_1          ?? null,
      action_2:         body.action_2          ?? null,
      action_3:         body.action_3          ?? null,
      action_4:         body.action_4          ?? null,
      root_cause:       body.root_cause        ?? null,
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/corrective-actions — update root_cause, completion_date, etc.
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  const { data, error } = await supabase
    .from('corrective_actions')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
