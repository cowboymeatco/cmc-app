export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { selectIn } from '@/lib/selectIn'
import { detectCharges, type EventRow } from '@/lib/billingDetect'

// Billing detector — finds every charge and writes it as a pending row in
// billable_events. The rules live in lib/billingDetect.ts; rates come from the
// price list (lib/priceBook.ts, /price-book).
//
// POST { since?, ordersSince?, dryRun? }
//   since        carcasses killed on/after this date
//   ordersSince  orders (value-add, curing, smokehouse, Baker) packed on/after
//                this date.
//   Both default to BILLING_START, 2026-11-13 (Charlie): everything before it
//   was invoiced by hand and must never come back as a new charge. An earlier
//   date passed in is raised to it.
//   dryRun       compute and return, write nothing.
//
// Pending rows are re-priced in place when their rate, item, quantity or
// description changes. Skipped, superseded and pushed rows are never touched.

const BILLING_START = '2026-11-13'

const keyOf = (e: { rule_key: string; source_table: string; source_id: string; customer_name: string }) =>
  `${e.rule_key}|${e.source_table}|${e.source_id}|${e.customer_name}`

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const floor = (v: unknown) => (typeof v === 'string' && v > BILLING_START ? v : BILLING_START)
    const since = floor(body.since)
    const ordersSince = floor(body.ordersSince)
    const dryRun = body.dryRun === true

    const found = await detectCharges({ since, ordersSince })
    const events = found.events
    const total = events.reduce((s, e) => s + e.amount, 0)
    if (dryRun) {
      return NextResponse.json({ ok: true, dryRun: true, ...found.scanned, excluded: found.excluded,
        candidates: events.length, total: Math.round(total * 100) / 100, events, unbillable: found.unbillable })
    }

    // Lambs that reached full processing: retire their pending kill-only fee.
    let superseded = 0
    if (found.supersededLambIds.length) {
      const sup = await selectIn<{ id: string }>(found.supersededLambIds, b => supabaseAdmin.from('billable_events')
        .update({ status: 'superseded' }).eq('rule_key', 'kill_fee').eq('status', 'pending').in('source_id', b).select('id'))
      superseded = sup.length
    }

    // New charges.
    let created = 0
    for (let i = 0; i < events.length; i += 200) {
      const { data, error } = await supabaseAdmin.from('billable_events')
        .upsert(events.slice(i, i + 200), { onConflict: 'rule_key,source_table,source_id,customer_name', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(error.message)
      created += data?.length ?? 0
    }

    // Re-price pending charges that already existed.
    const wanted = new Map<string, EventRow>(events.map(e => [keyOf(e), e]))
    type Existing = { id: string; rule_key: string; source_table: string; source_id: string; customer_name: string; qbo_item_id: string; qbo_customer_id: string; price_key: string | null; description: string; qty: number | string; rate: number | string; amount: number | string }
    const existing = await selectIn<Existing>([...new Set(events.map(e => e.source_id))], b => supabaseAdmin.from('billable_events')
      .select('id, rule_key, source_table, source_id, customer_name, qbo_item_id, qbo_customer_id, price_key, description, qty, rate, amount')
      .eq('status', 'pending').in('source_id', b))
    const differs = (a: number | string, b: number, places: number) => Math.round(Number(a) * 10 ** places) !== Math.round(b * 10 ** places)
    let repriced = 0
    for (const row of existing) {
      const e = wanted.get(keyOf(row))
      if (!e) continue
      if (row.qbo_item_id === e.qbo_item_id && row.description === e.description && row.price_key === e.price_key
        && !differs(row.qty, e.qty, 2) && !differs(row.rate, e.rate, 4) && !differs(row.amount, e.amount, 2)
        && !(!row.qbo_customer_id && e.qbo_customer_id)) continue
      const { error } = await supabaseAdmin.from('billable_events').update({
        qbo_item_id: e.qbo_item_id, price_key: e.price_key, description: e.description, qty: e.qty, rate: e.rate, amount: e.amount,
        // Fill a missing QuickBooks customer; never swap one a person already set.
        ...(row.qbo_customer_id ? {} : { qbo_customer_id: e.qbo_customer_id }),
      }).eq('id', row.id).eq('status', 'pending')
      if (error) throw new Error(error.message)
      repriced++
    }

    return NextResponse.json({
      ok: true,
      ...found.scanned,
      excluded: found.excluded,            // our own animals with no buyer
      supersededLambKillFees: superseded,
      candidates: events.length,
      created,
      alreadyDetected: events.length - created,
      repriced,
      unbillable: found.unbillable,
      since, ordersSince,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
