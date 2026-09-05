export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate } from '@/lib/dates'

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
      order_date:       orderFields.order_date       ?? isoDate(),
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

// DELETE /api/orders?id= â€” permanently delete an order.
// retail_order_items cascade-delete; any scanned boxes get order_id set NULL
// (their scans are preserved). If the order is already linked to a value-add
// job or processing input (FK = NO ACTION) the delete is blocked â€” we surface a
// friendly message so an in-production order can't be silently destroyed.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // An order that came in through the portal lives on there after its retail
  // copy is gone — the customer can still open it. The status trigger only
  // mirrors UPDATEs, so a plain delete left the portal saying "filling" for
  // good (Charlie, 2026-09-04: "Jennifer Kamstra's order was a dud. How do I
  // get rid of it."). Read the link first; cancel the portal side only once
  // the delete has actually gone through.
  const { data: existing } = await supabase
    .from('retail_orders')
    .select('portal_order_id')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase
    .from('retail_orders')
    .delete()
    .eq('id', id)

  if (error) {
    const blocked = /foreign key|violates|constraint/i.test(error.message)
    const msg = blocked
      ? 'This order is already linked to processing or value-add work, so it can’t be deleted. Remove it from there first.'
      : error.message
    return NextResponse.json({ error: msg }, { status: blocked ? 409 : 500 })
  }

  const portalId = (existing?.portal_order_id as string | null | undefined) ?? null
  if (portalId) {
    // `orders` is under RLS, so this goes through the service role;
    // trg_log_order_event writes the cancellation onto the customer's timeline.
    const { error: portalErr } = await supabaseAdmin
      .from('orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', portalId)
    if (portalErr) {
      return NextResponse.json({ ok: true, warning: `Deleted here, but the portal order could not be cancelled: ${portalErr.message}` })
    }
  }
  return NextResponse.json({ ok: true, portal_cancelled: Boolean(portalId) })
}
