export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'
import { createBox } from '@/lib/boxes'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date     = searchParams.get('date')
  const customer = searchParams.get('customer_name')
  const recent   = searchParams.get('recent')   // 'sessions' â†’ distinct customer+date pairs

  let query = supabase
    .from('boxes')
    .select('*')
    .order('created_at', { ascending: false })

  if (date)     query = query.eq('pack_date', date)
  if (customer) query = query.eq('customer_name', customer)
  if (recent)   query = query.limit(200)   // grab enough to find recent sessions

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const res = await createBox({
    // Trim: a stray trailing space would key this box to a phantom session
    customer_name: (body.customer_name ?? '').trim(),
    pack_date:     body.pack_date ?? isoDate(),
    box_number:    body.box_number ?? 1,
    is_final:      body.is_final ?? false,
    serial_number: body.serial_number ?? null,
  })
  if (!res.box) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json(res.box)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body
  const { data, error } = await supabase
    .from('boxes')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  // Also delete scans
  await supabase.from('box_scans').delete().eq('box_id', id)
  const { error } = await supabase.from('boxes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
