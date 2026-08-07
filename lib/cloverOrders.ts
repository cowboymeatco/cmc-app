// ──────────────────────────────────────────────────────────────────────────────
// Clover ORDERS — the "ring up an invoice" path. SERVER-ONLY (reads the API
// token via lib/clover creds), so never import into a 'use client' file.
//
// Purpose: a customer walks in to pay a processing bill that already exists as
// an invoice in QuickBooks. Instead of the cashier keying a name, an invoice
// number and an amount by hand, we pre-build an OPEN order on the register so
// the transaction is one click and always labelled the same way.
//
// Two gotchas that dictate the shape of this file:
//   1. state MUST be 'open'. An order with a null state does not appear in the
//      Orders app on the device at all — it only shows on the web dashboard.
//   2. A line item does NOT need a Clover catalog item. Posting a bare
//      { name, price } creates a custom line item, so we never have to mirror
//      QBO service items (kill fee, cut & wrap) into the Clover inventory.
//
// Scope note: this needs an API token with ORDERS read+write. The inventory-only
// token used by the item sync returns 401 here.
// ──────────────────────────────────────────────────────────────────────────────

import { creds, cloverFetch } from '@/lib/clover'

export interface CloverOrder {
  id: string
  title?: string
  note?: string
  state?: string        // open | locked (cashier has it open) | deleted
  paymentState?: string // unreliable here — see getUnpaidRingUpOrders
  total?: number        // null until a device first opens the order
  lineItems?: { elements?: { id: string; name?: string; price?: number }[] }
}

// Label every ring-up order identically so the Clover order list, the printed
// receipt and the QBO invoice all read the same. Name first (that's what the
// cashier hears at the counter), invoice number second (that's what closes the
// books). Clover truncates long titles on the device, so keep the name short.
export function ringUpTitle(customerName: string, docNumber: string): string {
  return `${customerName.toUpperCase()} — INV ${docNumber}`
}

// Create an open order on the register carrying a single custom line item for
// the invoice balance.
//
// Deliberately two calls rather than the atomic_order endpoint: atomic orders
// are reported to come back with a null state, which would leave the order
// invisible on the device — the exact failure this feature can't tolerate. The
// tradeoff is that a failure on the line-item call leaves an empty open order
// behind, so that error names the order id for manual cleanup.
export async function createRingUpOrder(opts: {
  customerName: string
  docNumber: string
  amountCents: number
}): Promise<CloverOrder> {
  const { mid } = creds()
  const { customerName, docNumber, amountCents } = opts

  if (!Number.isInteger(amountCents) || amountCents <= 0) {
    throw new Error(`Refusing to ring up invoice ${docNumber}: invalid amount (${amountCents} cents)`)
  }

  const title = ringUpTitle(customerName, docNumber)

  const order: CloverOrder = await cloverFetch(`/merchants/${mid}/orders`, {
    method: 'POST',
    body: JSON.stringify({ state: 'open', title, note: title }),
  })
  if (!order?.id) throw new Error(`Clover returned no order id for invoice ${docNumber}`)

  try {
    await cloverFetch(`/merchants/${mid}/orders/${order.id}/line_items`, {
      method: 'POST',
      body: JSON.stringify({ name: title, price: amountCents }),
    })
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(
      `Order ${order.id} was created on the register but the amount failed to attach ` +
      `— void that empty order in Clover before retrying. Cause: ${msg}`
    )
  }

  return { ...order, title, total: amountCents }
}

// Pull the invoice number back out of a ring-up title. Accepts an em-dash or a
// plain hyphen so a title retyped on the device still parses.
const RING_UP_TITLE = /\s[—-]\s*INV\s+(\S+)\s*$/i

export function parseRingUpDocNumber(title?: string | null): string | null {
  const m = title?.match(RING_UP_TITLE)
  return m ? m[1] : null
}

// Ring-up orders still waiting to be paid, newest first — what the UI needs to
// avoid ringing the same invoice up twice.
//
// Neither `state` nor `paymentState` can answer "is this paid" on our merchant:
// every one of the last 200 orders reports state=locked / paymentState=OPEN,
// including ones carrying a settled cash payment. `state` is worse than
// useless — an order flips open -> locked the moment a cashier opens it on the
// device, so filtering on it dropped exactly the orders being worked on.
//
// The only trustworthy signal is whether the order has payments against it.
// That's a per-order call, so we first narrow to orders titled like ours
// (2 of the last 200 — a cashier's own tickets carry no title at all) and
// only check payments for those.
// Every ring-up order in the recent window, paid or not, WITH its line items.
//
// The expand is what makes this scale. Fetching line items per order cost 1
// call each, so planning a sync against a populated register ran to ~100 Clover
// calls and blew the function timeout. `expand=lineItems` on the list endpoint
// returns them all in a single request, so planning is now O(1) calls no matter
// how many orders are waiting.
//
// Payments deliberately are NOT expanded — the token lacks that permission and
// the request 400s. Callers check payments per order, but only for the handful
// they actually intend to touch.
export async function getRingUpOrders(limit = 200): Promise<CloverOrder[]> {
  const { mid } = creds()
  const data = await cloverFetch(
    `/merchants/${mid}/orders?limit=${limit}&orderBy=createdTime%20DESC&expand=lineItems`
  )
  return ((data.elements ?? []) as CloverOrder[])
    .filter(o => o.state !== 'deleted' && parseRingUpDocNumber(o.title))
}

export interface CloverLineItem {
  id: string
  name?: string
  price?: number
}

// Line items off an already-expanded order, so callers don't re-fetch.
export function lineItemsOf(order: CloverOrder): CloverLineItem[] {
  return order.lineItems?.elements ?? []
}

// Payments settled against an order. Non-empty means real money changed hands
// and the order is a sales record, not clutter.
export async function getOrderPayments(orderId: string): Promise<{ id: string; amount: number }[]> {
  const { mid } = creds()
  const data = await cloverFetch(`/merchants/${mid}/orders/${orderId}/payments`)
  return (data.elements ?? []) as { id: string; amount: number }[]
}

// Void an order off the register. Only ever called on an order the sweep has
// already proven is ours, unpaid, settled in QuickBooks and carrying nothing
// but its own invoice line.
export async function deleteOrder(orderId: string): Promise<void> {
  const { mid } = creds()
  await cloverFetch(`/merchants/${mid}/orders/${orderId}`, { method: 'DELETE' })
}

// Every ring-up order on the register for one invoice, newest first.
//
// This is the duplicate guard, and it deliberately does NOT check payments.
// Asking Clover "has this been paid" costs a call per order; doing that for all
// 82 orders on the register just to render the billing page took minutes and
// then failed, which left every invoice looking un-sent and let one press of
// Send to Register become four (INV 2603C, 2026-08-07). Presence on the
// register is the whole question here — payment state belongs to the sweep,
// which only pays for it on the handful of orders it intends to touch.
export async function findRingUpOrdersFor(docNumber: string): Promise<CloverOrder[]> {
  const ours = await getRingUpOrders()
  return ours.filter(o => parseRingUpDocNumber(o.title) === docNumber)
}
