import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/orders/items — add a line item to an existing order
export async function POST(req: NextRequest) {
  const body = await req.json()

  const { data, error } = await supabase
    .from('retail_order_items')
    .insert([{
      order_id:    body.order_id,
      plu_number:  body.plu_number  ?? null,
      item_name:   body.item_name,
      unit:        body.unit        ?? 'LB',
      qty_ordered: body.qty_ordered ?? 0,
      qty_filled:  body.qty_filled  ?? 0,
      notes:       body.notes       ?? '',
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/orders/items — update qty_filled (or other fields) on a line item
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  const { data, error } = await supabase
    .from('retail_order_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/orders/items?id=... — remove a line item
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('retail_order_items')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
