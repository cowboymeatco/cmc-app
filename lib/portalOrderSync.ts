// Edits on /orders carried back to the customer's portal order.
//
// A portal order arrives as two copies: the customer's (orders / order_items,
// priced, what they see on the portal) and the shop's working copy
// (retail_orders / retail_order_items, what /orders and the scanner fill).
// Until now only status flowed back, through the sync_portal_order_status
// trigger, so changing a quantity or a due date here left the customer looking
// at the old order and the old estimate (Charlie, 2026-11-16: "make edits sync
// to the portal too").
//
// What carries over:
//   due date     → orders.requested_pickup
//   fulfillment  → orders.fulfillment_type
//   line qty     → order_items.quantity, est_weight_lbs, est_total
//   line added   → a new priced order_items row, when the catalog has the item
//   line removed → its order_items row
// and orders.est_total is re-added from its lines after any line change.
//
// What doesn't: customer name and phone belong to the customer's account, not
// the order; notes stay apart (the customer's own words are customer_notes);
// fresh/frozen has no place on the portal side; qty_filled is the shop's.
//
// There is no key between a retail line and a portal line. The retail copy is
// made with the portal line's product_name as its item_name, so that is the
// join, first match within the one order.
//
// Every function here swallows its own failure and returns a warning string
// instead: the retail edit has already been saved, and the shop must not lose
// it because the portal side refused.

import { supabaseAdmin } from '@/lib/supabaseAdmin'

const LOCKED = new Set(['completed', 'cancelled'])
const r2 = (n: number) => Math.round(n * 100) / 100

type PortalOrder = { id: string; status: string; is_wholesale: boolean | null; wholesale_discount_pct: number | null }

async function portalOrderFor(retailOrderId: string): Promise<PortalOrder | null> {
  const { data: ro } = await supabaseAdmin
    .from('retail_orders').select('portal_order_id').eq('id', retailOrderId).maybeSingle()
  const pid = ro?.portal_order_id as string | null | undefined
  if (!pid) return null
  const { data: o } = await supabaseAdmin
    .from('orders').select('id, status, is_wholesale, wholesale_discount_pct').eq('id', pid).maybeSingle()
  if (!o || LOCKED.has(o.status)) return null
  return o as PortalOrder
}

/** The portal counts packages; a line here can be in pounds. A pound line
 *  becomes the nearest whole number of packages (at least one) at the
 *  catalog's package weight, and its estimated weight is the pounds asked for. */
function portalCount(unit: string, qty: number, perPkg: number | null) {
  if (unit === 'LB') {
    const quantity = perPkg && perPkg > 0 ? Math.max(1, Math.round(qty / perPkg)) : 1
    return { quantity, weight: r2(qty) }
  }
  return { quantity: qty, weight: perPkg == null ? null : r2(perPkg * qty) }
}

async function retotal(portalId: string) {
  const { data: lines } = await supabaseAdmin.from('order_items').select('est_total').eq('order_id', portalId)
  const est = r2((lines ?? []).reduce((s, l) => s + (Number(l.est_total) || 0), 0))
  await supabaseAdmin.from('orders').update({ est_total: est, updated_at: new Date().toISOString() }).eq('id', portalId)
}

async function portalLine(portalId: string, itemName: string) {
  const { data } = await supabaseAdmin
    .from('order_items')
    .select('id, pricing_mode, unit_price, quantity, est_weight_lbs')
    .eq('order_id', portalId)
    .eq('product_name', itemName)
    .order('created_at', { ascending: true })
    .limit(1)
  return data?.[0] ?? null
}

/** Header fields. `updates` is what /api/orders PATCH just wrote. */
export async function syncPortalHeader(retailOrderId: string, updates: Record<string, unknown>): Promise<string | null> {
  try {
    const patch: Record<string, unknown> = {}
    if ('due_date' in updates)         patch.requested_pickup = updates.due_date || null
    if ('fulfillment_type' in updates) patch.fulfillment_type = updates.fulfillment_type
    if (!Object.keys(patch).length) return null
    const po = await portalOrderFor(retailOrderId)
    if (!po) return null
    const { error } = await supabaseAdmin.from('orders')
      .update({ ...patch, updated_at: new Date().toISOString() }).eq('id', po.id)
    return error ? `Saved here, but the portal order was not updated: ${error.message}` : null
  } catch (e) {
    return `Saved here, but the portal order was not updated: ${(e as Error).message}`
  }
}

/** A line's ordered quantity changed. Weight scales with the count, so the
 *  estimate keeps the per-package weight the customer was quoted. */
export async function syncPortalQty(retailOrderId: string, itemName: string, unit: string, newQty: number): Promise<string | null> {
  try {
    const po = await portalOrderFor(retailOrderId)
    if (!po) return null
    const line = await portalLine(po.id, itemName)
    if (!line) return `Saved here, but “${itemName}” isn’t on the portal order, so the customer’s copy didn’t change.`

    const price  = Number(line.unit_price) || 0
    const pQty   = Number(line.quantity) || 0
    const perPkg = line.est_weight_lbs != null && pQty > 0 ? Number(line.est_weight_lbs) / pQty : null
    const { quantity, weight } = portalCount(unit, newQty, perPkg)
    const total  = line.pricing_mode === 'per_lb' ? r2(price * (weight ?? 0)) : r2(price * quantity)

    const { error } = await supabaseAdmin.from('order_items')
      .update({ quantity, est_weight_lbs: weight, est_total: total }).eq('id', line.id)
    if (error) return `Saved here, but the portal line was not updated: ${error.message}`
    await retotal(po.id)
    return null
  } catch (e) {
    return `Saved here, but the portal line was not updated: ${(e as Error).message}`
  }
}

/** A line was removed here. */
export async function syncPortalRemove(retailOrderId: string, itemName: string): Promise<string | null> {
  try {
    const po = await portalOrderFor(retailOrderId)
    if (!po) return null
    const line = await portalLine(po.id, itemName)
    if (!line) return null
    const { error } = await supabaseAdmin.from('order_items').delete().eq('id', line.id)
    if (error) return `Removed here, but not from the portal order: ${error.message}`
    await retotal(po.id)
    return null
  } catch (e) {
    return `Removed here, but not from the portal order: ${(e as Error).message}`
  }
}

/** A line was added here. It goes on the portal order only if the catalog has
 *  the item, found through its PLU, because the portal needs a price. The
 *  price follows the portal's own rule: wholesale price if the product has
 *  one, otherwise list less the customer's wholesale discount. */
export async function syncPortalAdd(retailOrderId: string, pluNumber: string | null, itemName: string, unit: string, qty: number): Promise<string | null> {
  try {
    const po = await portalOrderFor(retailOrderId)
    if (!po) return null
    const miss = `Added here, but not to the portal order: “${itemName}” isn’t in the online catalog.`
    if (!pluNumber) return miss

    const { data: plu } = await supabaseAdmin.from('plu_items').select('id').eq('plu_number', pluNumber).limit(1)
    const pluId = plu?.[0]?.id
    if (!pluId) return miss
    const { data: prods } = await supabaseAdmin
      .from('products')
      .select('id, name, species, pricing_mode, price, wholesale_price, est_weight_lbs, unit_label, qbo_item_name')
      .eq('plu_item_id', pluId)
      .eq('active', true)
      .limit(1)
    const p = prods?.[0]
    if (!p) return miss

    const list  = Number(p.price) || 0
    const price = po.is_wholesale
      ? (p.wholesale_price != null ? Number(p.wholesale_price) : r2(list * (1 - (Number(po.wholesale_discount_pct) || 0) / 100)))
      : list
    const perPkg = p.est_weight_lbs == null ? null : Number(p.est_weight_lbs)
    const { quantity, weight } = portalCount(unit, qty, perPkg)
    const total  = p.pricing_mode === 'per_lb' ? r2(price * (weight ?? 0)) : r2(price * quantity)

    const { error } = await supabaseAdmin.from('order_items').insert([{
      order_id:       po.id,
      product_id:     p.id,
      // The retail line's name, not the catalog's, so later edits find it.
      product_name:   itemName,
      species:        p.species,
      pricing_mode:   p.pricing_mode,
      unit_label:     p.unit_label,
      unit_price:     price,
      quantity,
      est_weight_lbs: weight,
      est_total:      total,
      qbo_item_name:  p.qbo_item_name,
    }])
    if (error) return `Added here, but not to the portal order: ${error.message}`
    await retotal(po.id)
    return null
  } catch (e) {
    return `Added here, but not to the portal order: ${(e as Error).message}`
  }
}
