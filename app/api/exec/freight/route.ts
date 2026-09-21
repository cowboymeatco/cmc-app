export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { detailLines, fetchAccountDetail, fetchProfitAndLossByMonth, leafAccounts } from '@/lib/qboReports'
import { qboFetch } from '@/lib/qbo'
import {
  FREIGHT_ACCOUNTS, FREIGHT_INCOME_ACCOUNT, SHIPPING_INCOME_ACCOUNT_ID, runMiles,
  type FreightBilling, type RunMiles,
} from '@/lib/freight'

// GET /api/exec/freight?months=12 — the truck's own P&L.
//
// What delivery costs (fuel, vehicle repairs, the truck loan) against what it
// billed, plus whatever the logged runs can say about miles. Cost per mile is
// only reported when the odometer has been written down, and even then it is
// the pool over LOGGED miles, which is high while runs go unlogged — the
// payload carries the coverage so the page can say so.

const RUNS_NEEDED = 10
const MILES_NEEDED = 2000

/**
 * How much of what goes out the door is charged freight at all.
 *
 * Charlie's question, 2026-09-20: "how many invoices have freight applied, so
 * we can see the gross dollars we are shipping." Every posting to Shipping
 * Income comes back from one filtered report, the invoices behind the paying
 * lines are fetched by document number, and their totals are the gross that
 * moved on a truck somebody billed for.
 *
 * Lines worth nothing are skipped on purpose: the 40# Meat Box item is mapped
 * to Shipping Income and given away at $0, so it posts hundreds of empty rows
 * that would otherwise read as invoices carrying freight.
 */
async function billing(start: string, end: string): Promise<FreightBilling> {
  const lines = detailLines(await fetchAccountDetail(SHIPPING_INCOME_ACCOUNT_ID, start, end))
  const byDoc = new Map<string, number>()
  for (const l of lines) {
    if (l.amount <= 0 || !l.docNumber) continue
    byDoc.set(l.docNumber, (byDoc.get(l.docNumber) ?? 0) + l.amount)
  }
  const freightBilled = [...byDoc.values()].reduce((a, b) => a + b, 0)

  // Invoice totals for the documents that charged freight, in chunks a query
  // string can hold.
  const docs = [...byDoc.keys()]
  let chargedGross = 0
  const byCustomer = new Map<string, number>()
  for (let i = 0; i < docs.length; i += 60) {
    const inList = docs.slice(i, i + 60).map(d => `'${d.replace(/'/g, "")}'`).join(',')
    const r = await qboFetch<{ QueryResponse?: { Invoice?: { DocNumber?: string; TotalAmt?: number; CustomerRef?: { name?: string } }[] } }>(
      `query?query=${encodeURIComponent(`select DocNumber, TotalAmt, CustomerRef from Invoice where DocNumber in (${inList})`)}`,
    )
    for (const inv of r.QueryResponse?.Invoice ?? []) {
      chargedGross += inv.TotalAmt ?? 0
      const name = inv.CustomerRef?.name ?? '(no customer)'
      const amt = byDoc.get(inv.DocNumber ?? '') ?? 0
      byCustomer.set(name, (byCustomer.get(name) ?? 0) + amt)
    }
  }

  const count = await qboFetch<{ QueryResponse?: { totalCount?: number } }>(
    `query?query=${encodeURIComponent(`select count(*) from Invoice where TxnDate >= '${start}' and TxnDate <= '${end}'`)}`,
  )

  return {
    invoiceCount: count.QueryResponse?.totalCount ?? 0,
    chargedCount: byDoc.size,
    chargedGross,
    freightBilled,
    freightPctOfGross: chargedGross > 0 ? freightBilled / chargedGross * 100 : null,
    topCustomers: [...byCustomer].map(([name, amount]) => ({ name, amount }))
      .sort((a, b) => b.amount - a.amount).slice(0, 8),
  }
}

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    const months = Math.min(36, Math.max(1, Number(req.nextUrl.searchParams.get('months')) || 12))
    // Both sides on the SAME dates, ending today rather than at the last
    // closed month: a run logged this morning has to count against this
    // morning's fuel, or logging one shows nothing and nobody keeps it up.
    const endISO = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const start = new Date(`${endISO}T12:00:00`)
    start.setMonth(start.getMonth() - months)
    start.setDate(start.getDate() + 1)
    const startISO = start.toLocaleDateString('en-CA')

    const [pnl, runsRes, bills] = await Promise.all([
      fetchProfitAndLossByMonth(startISO, endISO),
      supabaseAdmin.from('delivery_runs')
        .select('id, run_date, route, driver, odometer_out, odometer_in')
        .gte('run_date', startISO).lte('run_date', endISO)
        .order('run_date', { ascending: false }),
      billing(startISO, endISO),
    ])
    if (runsRes.error) throw new Error(runsRes.error.message)

    const byGroup = new Map<string, Map<string, number>>()
    for (const g of ['COGS', 'Expenses', 'Income']) {
      byGroup.set(g, new Map(leafAccounts(pnl, g).map(a => [a.name, a.total])))
    }
    const costs = FREIGHT_ACCOUNTS.map(a => ({
      name: a.name, label: a.label, amount: byGroup.get(a.group)?.get(a.name) ?? null,
    }))
    const pool = costs.reduce((a, c) => a + (c.amount ?? 0), 0)
    const income = byGroup.get('Income')?.get(FREIGHT_INCOME_ACCOUNT) ?? null

    const runs = (runsRes.data ?? []) as RunMiles[]
    const withMiles = runs.map(r => ({ ...r, miles: runMiles(r) }))
    const miles = withMiles.reduce((a, r) => a + (r.miles ?? 0), 0)
    const runsWithOdo = withMiles.filter(r => r.miles != null).length

    return NextResponse.json({
      start: startISO, end: endISO, months,
      costs, pool, income, billing: bills,
      gap: income == null ? null : income - pool,
      recoveryPct: income == null || pool <= 0 ? null : income / pool * 100,
      runs: withMiles,
      runCount: runs.length,
      runsWithOdometer: runsWithOdo,
      miles,
      // The pool is a whole year of fuel; the miles are only the runs somebody
      // wrote down. Dividing one by the other before the logging habit exists
      // gives a number like $186/mile, which is worse than no number at all.
      // So it stays hidden until the logged runs could plausibly carry a year:
      // ten runs and two thousand miles, stated on the page rather than buried.
      costPerMile: miles >= MILES_NEEDED && runsWithOdo >= RUNS_NEEDED ? pool / miles : null,
      milesNeeded: MILES_NEEDED,
      runsNeeded: RUNS_NEEDED,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
