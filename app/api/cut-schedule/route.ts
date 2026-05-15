export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/cut-schedule?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
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
      appointment_id: string
      appointment_customer_id: string
      manual_rank: number
      locked: boolean
      notes: string
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
    appointment_id: item.appointment_id,
    appointment_customer_id: item.appointment_customer_id,
    manual_rank: item.manual_rank,
    locked: item.locked,
    notes: item.notes ?? '',
  }))

  const { error: insError } = await supabase
    .from('cut_schedule_items')
    .insert(rows)

  if (insError) return NextResponse.json({ error: insError.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
