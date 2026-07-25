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
  paymentState?: string // OPEN until tendered — this is the "still owes" signal
  total?: number
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
export async function getUnpaidRingUpOrders(limit = 200): Promise<CloverOrder[]> {
  const { mid } = creds()
  const data = await cloverFetch(
    `/merchants/${mid}/orders?limit=${limit}&orderBy=createdTime%20DESC`
  )
  const ours = ((data.elements ?? []) as CloverOrder[])
    .filter(o => o.state !== 'deleted' && parseRingUpDocNumber(o.title))

  const checked = await Promise.all(ours.map(async o => {
    // A payments read failure must not masquerade as "unpaid" — that would
    // re-flag a settled invoice as still waiting. Treat it as paid (hide it)
    // and let the explicit duplicate confirm catch a genuine re-send.
    try {
      const p = await cloverFetch(`/merchants/${mid}/orders/${o.id}/payments`)
      return (p.elements ?? []).length === 0 ? o : null
    } catch {
      return null
    }
  }))
  return checked.filter((o): o is CloverOrder => o !== null)
}
