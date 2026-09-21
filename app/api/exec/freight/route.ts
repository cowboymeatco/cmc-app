export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { fetchProfitAndLossByMonth, leafAccounts } from '@/lib/qboReports'
import { FREIGHT_ACCOUNTS, FREIGHT_INCOME_ACCOUNT, runMiles, type RunMiles } from '@/lib/freight'

// GET /api/exec/freight?months=12 — the truck's own P&L.
//
// What delivery costs (fuel, vehicle repairs, the truck loan) against what it
// billed, plus whatever the logged runs can say about miles. Cost per mile is
// only reported when the odometer has been written down, and even then it is
// the pool over LOGGED miles, which is high while runs go unlogged — the
// payload carries the coverage so the page can say so.

const RUNS_NEEDED = 10
const MILES_NEEDED = 2000

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

    const [pnl, runsRes] = await Promise.all([
      fetchProfitAndLossByMonth(startISO, endISO),
      supabaseAdmin.from('delivery_runs')
        .select('id, run_date, route, driver, odometer_out, odometer_in')
        .gte('run_date', startISO).lte('run_date', endISO)
        .order('run_date', { ascending: false }),
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
      costs, pool, income,
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
