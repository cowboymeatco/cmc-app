export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// Rolls of seals as received. Registering the printed range is what teaches the
// scanner that "0036013" is a cure tag and not a fat-fingered PLU.

export async function GET() {
  const { data, error } = await supabase
    .from('cure_tag_rolls').select('*').order('created_at', { ascending: false })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/cure-tags/rolls — start/end come as the printed strings so the
// leading-zero length rides along ("0036001" → digits 7).
export async function POST(req: NextRequest) {
  const body = await req.json()
  const start = String(body.start ?? '').trim()
  const end   = String(body.end   ?? '').trim()
  const note  = String(body.note  ?? '').trim() || null
  if (!/^\d{5,12}$/.test(start) || !/^\d{5,12}$/.test(end)) {
    return NextResponse.json({ error: 'Start and end must be the seal numbers as printed (5–12 digits)' }, { status: 400 })
  }
  if (start.length !== end.length) {
    return NextResponse.json({ error: 'Start and end must be the same length as printed on the seals' }, { status: 400 })
  }
  const startN = parseInt(start, 10)
  const endN   = parseInt(end, 10)
  if (endN < startN) return NextResponse.json({ error: 'End number is before the start number' }, { status: 400 })

  const { data, error } = await supabase
    .from('cure_tag_rolls')
    .insert([{ start_number: startN, end_number: endN, digits: start.length, note }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('cure_tag_rolls').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
