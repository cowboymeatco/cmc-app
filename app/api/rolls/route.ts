export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/rolls?date=YYYY-MM-DD — appointments that were moved OFF this date
// after their animals were already checked in. The worksheet needs them so the
// carcass numbers they spent stay spent (see harvest_rolls).
//
// DELETE /api/rolls?id=xxx — undo a roll line, for a move made by mistake.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  if (!date) return NextResponse.json([])

  const { data, error } = await supabase
    .from('harvest_rolls')
    .select('*')
    .eq('from_date', date)
    .order('first_in', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('harvest_rolls').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
