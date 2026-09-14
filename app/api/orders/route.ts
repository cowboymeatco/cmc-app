export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

type OrderRow = { id: string; retail_order_items?: { plu_number: string | null; unit: string }[] }

// What was actually packed for each line, read off the scanner.
//
// Packing an order on the scanner links the box to it (boxes.order_id), and
// every package scanned in carries its real weight — but nothing ever copied
// that onto the order, so qty_filled sat at 0 and the printed ticket had no
// weight on it (Charlie, 2026-09-14: Sheena Schiffer's 15.1 lb brisket).
// This is a keyed join, not a guess: only boxes linked to THIS order count,
// matched to a line by PLU. LB lines sum pounds, anything else sums packages.
async function attachScans<T extends OrderRow>(orders: T[]): Promise<T[]> {
  const ids = orders.map(o => o.id)
  if (ids.length === 0) return orders
  const { data: boxes } = await supabase.from('boxes').select('id, order_id').in('order_id', ids)
  if (!boxes?.length) return orders
  const orderOfBox = new Map(boxes.map(b => [b.id as string, b.order_id as string]))
  const { data: scans } = await supabase
    .from('box_scans')
    .select('box_id, plu_number, weight_lbs, quantity')
    .in('box_id', [...orderOfBox.keys()])

  const lbs = new Map<string, number>(), pkgs = new Map<string, number>()
  for (const s of scans ?? []) {
    const key = `${orderOfBox.get(s.box_id)}|${s.plu_number ?? ''}`
    lbs.set(key, (lbs.get(key) ?? 0) + (Number(s.weight_lbs) || 0))
    pkgs.set(key, (pkgs.get(key) ?? 0) + (Number(s.quantity) || 1))
  }

  return orders.map(o => ({
    ...o,
    retail_order_items: (o.retail_order_items ?? []).map(i => {
      const key = `${o.id}|${i.plu_number ?? ''}`
      if (!i.plu_number || !pkgs.has(key)) return i
      const qty = i.unit === 'LB' ? Math.round((lbs.get(key) ?? 0) * 100) / 100 : pkgs.get(key)
      return { ...i, scanned_qty: qty }
    }),
  }))
}

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
    return NextResponse.json((await attachScans([data]))[0])
  }

  let query = supabase
    .from('retail_orders')
    .select('*, retail_order_items(*)')
    .order('due_date', { ascending: true })

  if (status) query = query.eq('status', status)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(await attachScans(data ?? []))
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
  return NextResponse.json((await attachScans([data]))[0])
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
