export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getOpenInvoices, getInvoice } from '@/lib/qboInvoices'
import { createRingUpOrder, getOpenOrders, ringUpTitle } from '@/lib/cloverOrders'

// Send a QuickBooks invoice to the Clover register as a pre-labelled open order,
// so paying a processing bill at the counter is one click and always reads the
// same on the receipt and in the books.
//
// GET  -> { invoices, openOrders }  open QBO invoices + what's already waiting
// POST { invoiceId } -> creates the open Clover order for that invoice

export async function GET() {
  try {
    // Clover orders is the scope-gated call — if the token lacks it, say so
    // plainly instead of failing the whole page.
    const [invoices, orders] = await Promise.all([
      getOpenInvoices(),
      getOpenOrders().catch(e => (e instanceof Error ? e.message : String(e))),
    ])

    const ordersFailed = typeof orders === 'string'
    const alreadyOnRegister = ordersFailed
      ? []
      : orders.map(o => o.title ?? '').filter(Boolean)

    return NextResponse.json({
      invoices: invoices.map(inv => ({
        ...inv,
        // Flag rather than filter: the cashier may legitimately need to
        // re-ring one, but the UI should warn before making a duplicate.
        onRegister: alreadyOnRegister.includes(ringUpTitle(inv.customerName, inv.docNumber)),
      })),
      openOrders: ordersFailed ? [] : orders,
      ordersError: ordersFailed ? orders : undefined,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { invoiceId } = await req.json()
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
