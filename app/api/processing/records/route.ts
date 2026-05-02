import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/processing/records?date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')

  let query = supabase
    .from('processing_records')
    .select('*')
    .order('processed_at', { ascending: false })

  if (date) {
    query = query
      .gte('processed_at', `${date}T00:00:00`)
      .lte('processed_at', `${date}T23:59:59`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/processing/records — save a batch of records
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { records } = body as { records: Record<string, unknown>[] }

  if (!records?.length) return NextResponse.json({ error: 'No records' }, { status: 400 })

  const { data, error } = await supabase
    .from('processing_records')
    .insert(records)
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: data.length })
}

// DELETE /api/processing/records?id=
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('processing_records').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
