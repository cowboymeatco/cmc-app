export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/orders â€” list all orders with their items
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const id     = searchParams.get('id')

  if (id) {
    const { data, error } = await supabase
      .from('retail_orders')
      .select('*, retail_order_items(*)')
      .eq('id', id)
      .single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  let query = supabase
    .from('retail_orders')
    .select('*, retail_order_items(*)')
    .order('due_date', { ascending: true })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/orders â€” create a new retail order with line items
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { items, ...orderFields } = body

  const { data: order, error: orderErr } = await supabase
    .from('retail_orders')
    .insert([{
      customer_name:    orderFields.customer_name,
      customer_phone:   orderFields.customer_phone  ?? '',
      taken_by:         orderFields.taken_by         ?? '',
      order_date:       orderFields.order_date       ?? new Date().toISOString().slice(0, 10),
      due_date:         orderFields.due_date,
      fresh_or_frozen:  orderFields.fresh_or_frozen  ?? 'frozen',
      fulfillment_type: orderFields.fulfillment_type ?? 'pickup',
      pickup_datetime:  orderFields.pickup_datetime  ?? null,
      delivery_datetime: orderFields.delivery_datetime ?? null,
      delivery_address: orderFields.delivery_address ?? null,
      shipping_address: orderFields.shipping_address ?? null,
      status:           'pending',
      notes:            orderFields.notes            ?? '',
    }])
    .select()
    .single()

  if (orderErr) return NextResponse.json({ error: orderErr.message }, { status: 500 })

  if (Array.isArray(items) && items.length > 0) {
    const rows = items.map((it: {
      plu_number?: string; item_name: string; unit?: string
      qty_ordered?: number; notes?: string
    }) => ({
      order_id:    order.id,
      plu_number:  it.plu_number  ?? null,
      item_name:   it.item_name,
      unit:        it.unit        ?? 'LB',
      qty_ordered: it.qty_ordered ?? 0,
      qty_filled:  0,
      notes:       it.notes       ?? '',
    }))

    const { error: itemErr } = await supabase
      .from('retail_order_items')
      .insert(rows)

    if (itemErr) return NextResponse.json({ error: itemErr.message }, { status: 500 })
  }

  // Return the full order with items
  const { data: full } = await supabase
    .from('retail_orders')
    .select('*, retail_order_items(*)')
    .eq('id', order.id)
    .single()

  return NextResponse.json(full)
}

// PATCH /api/orders â€” update order fields or status
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  const { data, error } = await supabase
    .from('retail_orders')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select('*, retail_order_items(*)')
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
