export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { fetchProfitAndLossByMonth, monthColumns, sectionValues } from '@/lib/qboReports'

// GET /api/exec/pnl — trailing-12-month P&L by month plus break-even math.
// Overheads = operating expenses (fixed), variable rate = COGS / revenue,
// break-even revenue = fixed / (1 - variable rate).

export interface PnlMonth {
  month: string      // YYYY-MM
  income: number
  cogs: number
  expenses: number
  net: number
}

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    // Plant-local date so the window doesn't roll a month early on UTC evenings.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const [y, m] = today.split('-').map(Number)
    const start = new Date(Date.UTC(y, m - 1 - 11, 1)).toISOString().slice(0, 10)
    const report = await fetchProfitAndLossByMonth(start, today)

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

    const t = months.reduce(
      (a, m) => ({ income: a.income + m.income, cogs: a.cogs + m.cogs, expenses: a.expenses + m.expenses }),
      { income: 0, cogs: 0, expenses: 0 },
    )
    const variableRate = t.income > 0 ? t.cogs / t.income : 0
    const fixedMonthly = months.length ? t.expenses / months.length : 0
    const breakEvenMonthly = variableRate < 1 ? fixedMonthly / (1 - variableRate) : null

    return NextResponse.json({
      months,
      totals: { ...t, net: t.income - t.cogs - t.expenses },
      variableRate,
      fixedMonthly,
      breakEvenMonthly,
      avgMonthlyIncome: months.length ? t.income / months.length : 0,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
