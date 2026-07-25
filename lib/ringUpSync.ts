// ──────────────────────────────────────────────────────────────────────────────
// Register sync: keep the Clover register holding a current order for every
// open QuickBooks invoice, so a customer who walks in unannounced is already
// rung up and nobody has to go to the app first.
//
// Pairs with ringUpSweep.ts, which handles removal. Together, one scheduled run
// reconciles three ways:
//
//   create  — open invoice with no order on the register yet
//   update  — order exists but the balance has moved
//   remove  — invoice settled in QuickBooks            (the sweep)
//
// UPDATE MATTERS MORE THAN IT LOOKS. Billing accumulates dated service lines
// onto open invoices as work happens, so an invoice pushed Monday at $180 can
// genuinely be $340 by Thursday. The Send to Register button re-reads the
// balance when it's pressed; a preloaded order has no such protection, so
// something has to keep it honest.
//
// An update is done as delete-then-recreate rather than by mutating the line
// item in place: it reuses the two paths already proven against the live
// register, and is only ever applied to an order that is unpaid and untouched.
//
// Same gates as the sweep — never modify an order carrying payments or a
// cashier's added items. Those get logged for a person instead, because
// correcting an amount underneath someone mid-transaction is worse than a
// stale number.
// ──────────────────────────────────────────────────────────────────────────────

import {
  getRingUpOrders,
  getOrderPayments,
  lineItemsOf,
  deleteOrder,
  createRingUpOrder,
  parseRingUpDocNumber,
  type CloverOrder,
} from '@/lib/cloverOrders'
import { getOpenInvoices, type OpenInvoice } from '@/lib/qboInvoices'
import { supabase } from '@/lib/supabase'

// Each create costs 2 Clover calls and each update 3, all sequential to stay
// under Clover's rate limit. Cap the work per run so a first sync of a large
// backlog can't run past the function timeout and leave the register in a
// half-built state. Anything skipped is reported, never silently dropped.
const MAX_WRITES_PER_RUN = 25

export interface SyncDecision {
  docNumber: string
  customerName: string
  title: string
  amountCents: number
  action: 'create' | 'update' | 'skip'
  reason: string
  orderId?: string
}

async function classify(inv: OpenInvoice, order: CloverOrder | undefined): Promise<SyncDecision> {
  const base = {
    docNumber: inv.docNumber,
    customerName: inv.customerName,
    title: `${inv.customerName.toUpperCase()} — INV ${inv.docNumber}`,
    amountCents: inv.balanceCents,
  }

  if (!order) {
    return { ...base, action: 'create', reason: `not on the register yet` }
  }

  const skip = (reason: string): SyncDecision =>
    ({ ...base, action: 'skip', reason, orderId: order.id })

  try {
    // Line items came back with the order list, so the common case — order
    // exists and the amount already matches — costs no API calls at all.
    const lineItems = lineItemsOf(order)
    const extras = lineItems.filter(li => li.name !== order.title)
    if (extras.length > 0) {
      return skip(`cashier added ${extras.map(li => li.name ?? 'unnamed').join(', ')} — needs a person`)
    }
    if (lineItems.length !== 1) {
      return skip(`expected 1 line item, found ${lineItems.length} — needs a person`)
    }

    const onRegister = lineItems[0].price ?? 0
    if (onRegister === inv.balanceCents) return skip('already on the register, amount current')

    // Only now, with a real amount discrepancy to act on, is the payment check
    // worth a call. A paid order is a sales record and must not be replaced.
    const payments = await getOrderPayments(order.id)
    if (payments.length > 0) {
      const total = payments.reduce((s, p) => s + (p.amount ?? 0), 0)
      return skip(`paid on the register ($${(total / 100).toFixed(2)})`)
    }

    return {
      ...base,
      action: 'update',
      orderId: order.id,
      reason: `register has $${(onRegister / 100).toFixed(2)}, QuickBooks says $${inv.balance.toFixed(2)}`,
    }
  } catch (e) {
    return skip(`could not verify (${e instanceof Error ? e.message : String(e)})`)
  }
}

// Everything both halves of the reconcile need, fetched once: two API calls
// total, regardless of how many orders are on the register.
export interface ReconcileContext {
  invoices: OpenInvoice[]
  orders: CloverOrder[]
  openDocNumbers: Set<string>
}

export async function loadContext(): Promise<ReconcileContext> {
  const [invoices, orders] = await Promise.all([getOpenInvoices(), getRingUpOrders()])
  return { invoices, orders, openDocNumbers: new Set(invoices.map(i => i.docNumber)) }
}

export async function planSync(ctx?: ReconcileContext): Promise<SyncDecision[]> {
  const { invoices, orders } = ctx ?? (await loadContext())

  // Last write wins if a document number somehow has two orders; the duplicate
  // surfaces through the sweep rather than being silently reconciled here.
  const byDoc = new Map<string, CloverOrder>()
  for (const o of orders) {
    const doc = parseRingUpDocNumber(o.title)
    if (doc) byDoc.set(doc, o)
  }

  const decisions: SyncDecision[] = []
  for (const inv of invoices) {
    decisions.push(await classify(inv, byDoc.get(inv.docNumber)))
  }
  return decisions
}

export interface SyncResult {
  created: SyncDecision[]
  updated: SyncDecision[]
  skipped: SyncDecision[]
  errors: { decision: SyncDecision; error: string }[]
  deferred: number // work left for the next run because of the per-run cap
}

export async function runSync(triggeredBy: 'cron' | 'manual', ctx?: ReconcileContext): Promise<SyncResult> {
  const decisions = await planSync(ctx)
  const result: SyncResult = { created: [], updated: [], skipped: [], errors: [], deferred: 0 }
  const rows: Record<string, unknown>[] = []
  let writes = 0

  for (const d of decisions) {
    if (d.action === 'skip') {
      result.skipped.push(d)
      continue // skips are the steady state — logging them every run would bury the real events
    }
    if (writes >= MAX_WRITES_PER_RUN) {
      result.deferred++
      continue
    }
    writes++

    try {
      // An update is a replace: bin the stale order, then ring the current
      // amount. Safe only because the gates above proved it unpaid and
      // untouched.
      if (d.action === 'update' && d.orderId) await deleteOrder(d.orderId)
      const order = await createRingUpOrder({
        customerName: d.customerName,
        docNumber: d.docNumber,
        amountCents: d.amountCents,
      })
      const done = { ...d, orderId: order.id }
      ;(d.action === 'create' ? result.created : result.updated).push(done)
      rows.push(logRow(done, triggeredBy, d.action === 'create' ? 'created' : 'updated', 'ok', ''))
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      result.errors.push({ decision: d, error })
      rows.push(logRow(d, triggeredBy, d.action === 'create' ? 'created' : 'updated', 'error', error))
    }
  }

  if (result.deferred > 0) {
    rows.push({
      clover_order_id: '', doc_number: '', title: `${result.deferred} invoice(s) deferred`,
      amount_cents: null, action: 'deferred', status: 'ok', error: '',
      reason: `per-run cap of ${MAX_WRITES_PER_RUN} reached — the next run picks these up`,
      triggered_by: triggeredBy,
    })
  }

  if (rows.length > 0) {
    const { error } = await supabase.from('clover_ringup_sweep_log').insert(rows)
    if (error) console.error(`register sync log write failed: ${error.message}`)
  }

  return result
}

function logRow(d: SyncDecision, triggeredBy: string, action: string, status: string, error: string) {
  return {
    clover_order_id: d.orderId ?? '',
    doc_number: d.docNumber,
    title: d.title,
    amount_cents: d.amountCents,
    action,
    reason: d.reason,
    status,
    error,
    triggered_by: triggeredBy,
  }
}
