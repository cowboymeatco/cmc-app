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

  // Closing a box: the weight and cut count come from the scans in the database,
  // never from the browser's copy of them. The scanner used to post its own
  // in-memory totals, so a tab that was missing a scan — a save whose response
  // never came back, another device packing the same box — wrote a short total
  // onto the box while the label, which always sums the database, printed the
  // real one. The box then read 3 lb lighter than its own label (Chris,
  // 2026-08-07). One source of truth ends that whole class of complaint.
  if (updates.is_closed === true) {
    const { data: scans, error: scanErr } = await supabase
      .from('box_scans')
      .select('weight_lbs, quantity')
      .eq('box_id', id)
    if (scanErr) return NextResponse.json({ error: scanErr.message }, { status: 500 })
    const rows = scans ?? []
    updates.total_weight_lbs = rows.reduce((s, r) => s + (Number(r.weight_lbs) || 0), 0)
    // Counted the way the label counts them, so the footer and the box record
    // can't drift apart either.
    updates.total_cuts = rows.reduce((s, r) => s + (Number(r.quantity) || 1), 0)
  }

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
