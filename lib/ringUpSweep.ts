// ──────────────────────────────────────────────────────────────────────────────
// Register sweep: pull a ring-up order off Clover once its invoice is settled
// in QuickBooks.
//
// The problem it solves: an invoice sent to the register that the customer then
// pays some OTHER way — a check in the mail, online, ACH. Jill clears it in
// QuickBooks, but the unpaid order keeps sitting on the register where a
// cashier can ring it a second time and double-charge someone.
//
// It never writes to QuickBooks. Jill marks invoices paid exactly as she does
// today; this only reacts to what she's already done.
//
// EVERY removal must clear all four gates. Anything that fails one is kept and
// logged with the reason — the sweep deletes, so ambiguity always means keep:
//
//   1. It's ours          — title parses to "… — INV <doc>". A cashier's own
//                           ticket carries no title and is never in scope.
//   2. No payments        — a paid order is a sales record. Deleting one would
//                           erase the sale, including any retail items rung
//                           onto it.
//   3. Invoice settled    — QuickBooks balance is exactly zero. A lookup that
//                           fails, misses or comes back ambiguous is "unknown",
//                           never "paid".
//   4. Nothing added      — exactly one line item, matching the invoice line.
//                           The ring-up order is a BASE the counter builds on,
//                           so anything a cashier added is their work, not
//                           clutter to bin.
// ──────────────────────────────────────────────────────────────────────────────

import {
  getRingUpOrders,
  getOrderPayments,
  getOrderLineItems,
  deleteOrder,
  parseRingUpDocNumber,
} from '@/lib/cloverOrders'
import { getInvoiceByDocNumber } from '@/lib/qboInvoices'
import { supabase } from '@/lib/supabase'

export interface SweepDecision {
  orderId: string
  docNumber: string
  title: string
  amountCents: number | null
  action: 'remove' | 'keep'
  reason: string
}

// Decide the fate of every ring-up order in the recent window. Read-only —
// runSweep() is what actually deletes.
// Deliberately sequential. Each order costs 2-3 Clover calls, and fanning them
// out in parallel trips Clover's rate limit — which surfaces as "could not
// verify" and stalls the sweep instead of failing loudly. Ring-up orders number
// in the handful, so the wall-clock cost is irrelevant.
export async function planSweep(): Promise<SweepDecision[]> {
  const orders = await getRingUpOrders()
  const decisions: SweepDecision[] = []

  for (const o of orders) {
    decisions.push(await decide(o))
  }
  return decisions
}

async function decide(o: Awaited<ReturnType<typeof getRingUpOrders>>[number]): Promise<SweepDecision> {
    const docNumber = parseRingUpDocNumber(o.title) ?? ''
    const base = {
      orderId: o.id,
      docNumber,
      title: o.title ?? '',
      amountCents: o.total ?? null,
    }
    const keep = (reason: string): SweepDecision => ({ ...base, action: 'keep', reason })

    try {
      // Gate 2 — paid on the register, so it's a sales record.
      const payments = await getOrderPayments(o.id)
      if (payments.length > 0) {
        const total = payments.reduce((s, p) => s + (p.amount ?? 0), 0)
        return keep(`paid on the register ($${(total / 100).toFixed(2)})`)
      }

      // Gate 3 — QuickBooks must positively say the invoice is settled.
      const invoice = await getInvoiceByDocNumber(docNumber)
      if (!invoice) return keep(`invoice ${docNumber} not found in QuickBooks — left alone`)
      if (invoice.balance > 0) return keep(`still owing $${invoice.balance.toFixed(2)} in QuickBooks`)

      // Gate 4 — anything the counter added stays.
      const lineItems = await getOrderLineItems(o.id)
      const extras = lineItems.filter(li => li.name !== o.title)
      if (extras.length > 0) {
        const names = extras.map(li => li.name ?? 'unnamed').join(', ')
        return keep(`cashier added items (${names}) — needs a person`)
      }
      if (lineItems.length !== 1) {
        return keep(`expected 1 line item, found ${lineItems.length} — needs a person`)
      }

      return { ...base, action: 'remove', reason: `invoice ${docNumber} paid in QuickBooks` }
    } catch (e) {
      // A failed check is never permission to delete.
      return keep(`could not verify (${e instanceof Error ? e.message : String(e)})`)
    }
}

export interface SweepResult {
  removed: SweepDecision[]
  kept: SweepDecision[]
  errors: { decision: SweepDecision; error: string }[]
}

export async function runSweep(triggeredBy: 'cron' | 'manual'): Promise<SweepResult> {
  const decisions = await planSweep()
  const result: SweepResult = { removed: [], kept: [], errors: [] }
  const rows: Record<string, unknown>[] = []

  for (const d of decisions) {
    if (d.action === 'keep') {
      result.kept.push(d)
      rows.push({ ...logRow(d, triggeredBy), action: 'kept', status: 'ok' })
      continue
    }
    try {
      await deleteOrder(d.orderId)
      result.removed.push(d)
      rows.push({ ...logRow(d, triggeredBy), action: 'removed', status: 'ok' })
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      result.errors.push({ decision: d, error })
      rows.push({ ...logRow(d, triggeredBy), action: 'kept', status: 'error', error })
    }
  }

  // The audit trail is the whole reason an automatic delete is acceptable —
  // surface a logging failure rather than swallowing it.
  if (rows.length > 0) {
    const { error } = await supabase.from('clover_ringup_sweep_log').insert(rows)
    if (error) console.error(`ring-up sweep log write failed: ${error.message}`)
  }

  return result
}

function logRow(d: SweepDecision, triggeredBy: string) {
  return {
    clover_order_id: d.orderId,
    doc_number: d.docNumber,
    title: d.title,
    amount_cents: d.amountCents,
    reason: d.reason,
    triggered_by: triggeredBy,
  }
}
