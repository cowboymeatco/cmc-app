export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { fetchProfitAndLossByMonth, leafAccounts, monthColumns, sectionValues } from '@/lib/qboReports'

// GET /api/exec/pnl?start=YYYY-MM-DD&end=YYYY-MM-DD — P&L by month for the
// window (default trailing 12 months) plus break-even math.
//
// Break-even uses two buckets: fixed (overheads — the flat line) and variable
// (scales with revenue — the slope). Default bucket comes from the P&L
// section (Expenses -> fixed, COGS -> variable); rows in exec_cost_buckets
// are Charlie's manual re-filing and win over the default.

export interface PnlMonth {
  month: string      // YYYY-MM
  income: number
  cogs: number
  expenses: number
  net: number
}

export interface CostAccount {
  name: string
  section: 'cogs' | 'expenses'
  bucket: 'fixed' | 'variable'
  overridden: boolean
  total: number
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    // Plant-local date so the window doesn't roll a month early on UTC evenings.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const [y, m] = today.split('-').map(Number)
    const defaultStart = new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 10)

    const q = req.nextUrl.searchParams
    const start = DATE_RE.test(q.get('start') ?? '') ? q.get('start')! : defaultStart
    const end = DATE_RE.test(q.get('end') ?? '') ? q.get('end')! : today

    const [report, overridesRes] = await Promise.all([
      fetchProfitAndLossByMonth(start, end),
      supabaseAdmin.from('exec_cost_buckets').select('account, bucket'),
    ])
    const overrides = new Map<string, 'fixed' | 'variable'>(
      (overridesRes.data ?? []).map(r => [r.account as string, r.bucket as 'fixed' | 'variable']),
    )

    const monthKeys = monthColumns(report)
    const pick = (group: string) => {
      const vals = sectionValues(report, group)
      return (i: number) => vals[i] ?? 0
    }
    const income = pick('Income'), cogs = pick('COGS'), expenses = pick('Expenses')

    const months: PnlMonth[] = monthKeys.map((month, i) => ({
      month,
      income: income(i),
      cogs: cogs(i),
      expenses: expenses(i),
      net: income(i) - cogs(i) - expenses(i),
    }))
    const n = Math.max(months.length, 1)

    const t = months.reduce(
      (a, mo) => ({ income: a.income + mo.income, cogs: a.cogs + mo.cogs, expenses: a.expenses + mo.expenses }),
      { income: 0, cogs: 0, expenses: 0 },
    )

    const collect = (group: string, section: CostAccount['section'], def: CostAccount['bucket']): CostAccount[] =>
      leafAccounts(report, group)
        .filter(a => a.total !== 0)
        .map(a => ({
          name: a.name,
          section,
          bucket: overrides.get(a.name) ?? def,
          overridden: overrides.has(a.name),
          total: a.total,
        }))
    const accounts = [...collect('COGS', 'cogs', 'variable'), ...collect('Expenses', 'expenses', 'fixed')]
      .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

    // Per-section residuals keep the buckets reconciled to the section totals
    // even if the report nests something the account walk misses; a residual
    // stays in its section's default bucket.
    const sum = (f: (a: CostAccount) => boolean) => accounts.filter(f).reduce((s, a) => s + a.total, 0)
    const cogsResidual = t.cogs - sum(a => a.section === 'cogs')
    const expResidual = t.expenses - sum(a => a.section === 'expenses')
    const fixedTotal = sum(a => a.bucket === 'fixed') + expResidual
    const variableTotal = sum(a => a.bucket === 'variable') + cogsResidual

    const variableRate = t.income > 0 ? Math.max(0, Math.min(variableTotal / t.income, 0.99)) : 0
    const fixedMonthly = fixedTotal / n
    const breakEvenMonthly = fixedMonthly / (1 - variableRate)

    return NextResponse.json({
      start, end,
      months,
      monthCount: months.length,
      totals: { ...t, net: t.income - t.cogs - t.expenses },
      accounts,
      variableRate,
      fixedMonthly,
      breakEvenMonthly,
      avgMonthlyIncome: t.income / n,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
