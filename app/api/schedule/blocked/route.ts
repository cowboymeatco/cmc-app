export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

export async function GET() {
  const { data, error } = await supabase
    .from('schedule_blocked_dates')
    .select('*')
    .order('date')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const reason = body.reason ?? ''
  // Accept a single { date } or a batch { dates: [...] }.
  const dates: string[] = Array.isArray(body.dates)
    ? body.dates
    : body.date ? [body.date] : []
  if (dates.length === 0) return NextResponse.json({ error: 'date(s) required' }, { status: 400 })
  const rows = dates.map((date: string) => ({ date, reason }))
  const { data, error } = await supabase
    .from('schedule_blocked_dates')
    .upsert(rows, { onConflict: 'date' })
    .select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  // Accept a single ?date= or a batch ?dates=a,b,c
  const datesParam = searchParams.get('dates')
  const single = searchParams.get('date')
  const dates = datesParam ? datesParam.split(',').filter(Boolean) : single ? [single] : []
  if (dates.length === 0) return NextResponse.json({ error: 'date(s) required' }, { status: 400 })
  const { error } = await supabase
    .from('schedule_blocked_dates')
    .delete()
    .in('date', dates)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
