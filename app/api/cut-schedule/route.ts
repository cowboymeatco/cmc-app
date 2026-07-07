export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/cut-schedule?date=YYYY-MM-DD
// GET /api/cut-schedule?latest=1 — the most recently saved plan, whatever date
// it was saved under. Both the planner and the crew view load latest and apply
// lib/cutSchedule's planIsLive() so a plan with day breaks laid out ahead
// survives the date rollover, but a plan past its last day is ignored.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  let date = searchParams.get('date')

  if (searchParams.get('latest')) {
    const { data: newest, error: newestError } = await supabase
      .from('cut_schedule_items')
      .select('schedule_date')
      .order('schedule_date', { ascending: false })
      .limit(1)
    if (newestError || !newest?.length) return NextResponse.json([])
    date = newest[0].schedule_date
  }

  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cut_schedule_items')
    .select('*')
    .eq('schedule_date', date)
    .order('manual_rank', { ascending: true })

  if (error) return NextResponse.json([], { status: 200 }) // table may not exist yet
  return NextResponse.json(data ?? [])
}

// POST /api/cut-schedule — upsert full ordered list for a date
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { schedule_date, items } = body as {
    schedule_date: string
    items: Array<{
      kind?: 'carcass' | 'break'
      appointment_id: string | null
      appointment_customer_id: string | null
      manual_rank: number
      locked: boolean
      notes: string
      break_date?: string | null
    }>
  }

  if (!schedule_date || !Array.isArray(items)) {
    return NextResponse.json({ error: 'schedule_date and items required' }, { status: 400 })
  }

  // Delete existing entries for this date then re-insert (cleanest upsert for ordered lists)
  const { error: delError } = await supabase
    .from('cut_schedule_items')
    .delete()
    .eq('schedule_date', schedule_date)

  if (delError) return NextResponse.json({ error: delError.message }, { status: 500 })

  if (items.length === 0) return NextResponse.json({ ok: true })

  const rows = items.map(item => ({
    schedule_date,
    kind: item.kind ?? 'carcass',
    appointment_id: item.appointment_id ?? null,
    appointment_customer_id: item.appointment_customer_id ?? null,
    manual_rank: item.manual_rank,
    locked: item.locked,
    notes: item.notes ?? '',
    break_date: item.break_date ?? null,
  }))

  const { error: insError } = await supabase
    .from('cut_schedule_items')
    .insert(rows)

  if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
