export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getOpenInvoices, getInvoice } from '@/lib/qboInvoices'
import { createRingUpOrder, findRingUpOrdersFor, getRingUpOrders, parseRingUpDocNumber } from '@/lib/cloverOrders'

// Send a QuickBooks invoice to the Clover register as a pre-labelled open order,
// so paying a processing bill at the counter is one click and always reads the
// same on the receipt and in the books.
//
// GET  -> { invoices }  open QBO invoices, each flagged if it's already waiting
// POST { invoiceId } -> creates the open Clover order for that invoice
// POST { invoiceId, force } -> creates it even though one is already waiting

export async function GET() {
  try {
    // Clover orders is the scope-gated call — if the token lacks it, say so
    // plainly instead of failing the whole page.
    const [invoices, orders] = await Promise.all([
      getOpenInvoices(),
      getRingUpOrders().catch(e => (e instanceof Error ? e.message : String(e))),
    ])

    const ordersFailed = typeof orders === 'string'
    // Match on the invoice number parsed out of the title, not on the whole
    // title: a cashier can rename an order on the device, and the customer
    // name is the part they'd change. The invoice number is what identifies it.
    const docsOnRegister = new Set(
      ordersFailed ? [] : orders.map(o => parseRingUpDocNumber(o.title)).filter(Boolean)
    )

    return NextResponse.json({
      invoices: invoices.map(inv => ({
        ...inv,
        // Flag rather than filter: the cashier may legitimately need to
        // re-ring one, but the UI should warn before making a duplicate.
        onRegister: docsOnRegister.has(inv.docNumber),
      })),
      ordersError: ordersFailed ? orders : undefined,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { invoiceId, force } = await req.json()
    if (!invoiceId) {
      return NextResponse.json({ error: 'invoiceId is required' }, { status: 400 })
    }

    // Re-read from QBO: the balance may have changed (partial payment, credit)
    // since the list was rendered, and the register must ring the real number.
    const invoice = await getInvoice(String(invoiceId))
    if (!invoice) {
      return NextResponse.json({ error: `Invoice ${invoiceId} not found in QuickBooks` }, { status: 404 })
    }
    if (invoice.balance <= 0) {
      return NextResponse.json(
        { error: `Invoice ${invoice.docNumber} has no balance due — nothing to ring up` },
        { status: 400 }
      )
    }

    // Ask the register itself, every time. The page's "● on register" flag is a
    // snapshot, and when the Clover read is slow or fails it renders as "not
    // sent" — so four presses of the button made four orders for INV 2603C
    // rather than three no-ops (Charlie, 2026-08-07). Refusing here means a
    // duplicate can only ever be deliberate.
    if (!force) {
      const existing = await findRingUpOrdersFor(invoice.docNumber)
      if (existing.length > 0) {
        return NextResponse.json({
          error:
            `${invoice.customerName} — INV ${invoice.docNumber} is already on the register` +
            `${existing.length > 1 ? ` (${existing.length} times)` : ''}.`,
          alreadyOnRegister: existing.map(o => ({ id: o.id, title: o.title })),
        }, { status: 409 })
      }
    }

    const order = await createRingUpOrder({
      customerName: invoice.customerName,
      docNumber: invoice.docNumber,
      amountCents: invoice.balanceCents,
    })

    return NextResponse.json({
      ok: true,
      orderId: order.id,
      title: order.title,
      amount: invoice.balance,
      invoice: { id: invoice.id, docNumber: invoice.docNumber, customerName: invoice.customerName },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
