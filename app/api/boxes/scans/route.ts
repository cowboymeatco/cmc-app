export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const box_id = searchParams.get('box_id')

  // Whole session at once, for the scanner's still-to-pack list — it has to
  // count what went into boxes that were closed hours ago, not just the one
  // open on the bench.
  const customer_name = searchParams.get('customer_name')
  const date          = searchParams.get('date')
  if (!box_id && customer_name && date) {
    const boxes = await supabase
      .from('boxes')
      .select('id, box_number')
      .eq('customer_name', customer_name)
      .eq('pack_date', date)
    const ids = (boxes.data ?? []).map(b => b.id)
    if (!ids.length) return NextResponse.json([])
    const { data, error } = await supabase
      .from('box_scans')
      .select('*')
      .in('box_id', ids)
      .order('created_at', { ascending: true })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (!box_id) return NextResponse.json({ error: 'box_id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('box_scans')
    .select('*')
    .eq('box_id', box_id)
    .order('created_at', { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase
    .from('box_scans')
    .insert([{
      box_id:     body.box_id,
      plu_number: body.plu_number ?? '',
      item_name:  body.item_name ?? '',
      weight_lbs: body.weight_lbs ?? null,
      quantity:   body.quantity ?? 1,
      // Kept so a weight that looks wrong can be traced back to what the scale
      // actually printed. Null for hand-keyed weights.
      barcode:    body.barcode ?? null,
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('box_scans').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
