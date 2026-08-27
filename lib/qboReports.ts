import { qboFetch } from '@/lib/qbo'

// Thin parser over the QBO Reports API (reports/ProfitAndLoss, reports/
// BalanceSheet). Reports come back as a tree of Section rows; each section
// carries a `group` name ("Income", "COGS", "Expenses", "BankAccounts", "AR")
// and a Summary row whose ColData holds the numbers, one per column.

interface ColData { value: string }
interface ReportRow {
  type?: string
  group?: string
  ColData?: ColData[]
  Summary?: { ColData: ColData[] }
  Rows?: { Row: ReportRow[] }
}
export interface QboReport {
  Header?: { StartPeriod?: string; EndPeriod?: string }
  Columns?: { Column: { ColTitle?: string; MetaData?: { Name: string; Value: string }[] }[] }
  Rows?: { Row: ReportRow[] }
}

function num(v: string | undefined): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Depth-first search for a section by its `group` name. */
export function findSection(report: QboReport, group: string): ReportRow | null {
  const walk = (rows: ReportRow[] | undefined): ReportRow | null => {
    for (const r of rows ?? []) {
      if (r.group === group) return r
      const hit = walk(r.Rows?.Row)
      if (hit) return hit
    }
    return null
  }
  return walk(report.Rows?.Row)
}

/**
 * A section's summary numbers, one per money column (the leading label column
 * is dropped). For a single-column report this is a one-element array.
 */
export function sectionValues(report: QboReport, group: string): number[] {
  const section = findSection(report, group)
  const cols = section?.Summary?.ColData ?? []
  return cols.slice(1).map(c => num(c.value))
}

export interface AccountLine {
  name: string
  total: number    // the report's Total column (or the only money column)
}

/**
 * Leaf account rows under a section, with their period totals. Data rows put
 * the account name in ColData[0] and the Total in the last money column.
 */
export function leafAccounts(report: QboReport, group: string): AccountLine[] {
  const out: AccountLine[] = []
  const walk = (rows: ReportRow[] | undefined) => {
    for (const r of rows ?? []) {
      const cols = r.ColData
      if (cols && cols.length >= 2 && cols[0].value) {
        out.push({ name: cols[0].value, total: num(cols[cols.length - 1].value) })
      }
      walk(r.Rows?.Row)
    }
  }
  walk(findSection(report, group)?.Rows?.Row)
  return out
}

export interface AccountSeries {
  name: string
  values: number[]   // one per money column, aligned with dayColumns()/monthColumns()
}

/**
 * Leaf account rows under a section with their per-column values, rather than
 * just the period total. Used to put an account's money on the right DAY.
 *
 * Alignment: ColData[0] is the account name and the trailing Total column has
 * no StartDate, so the money columns are the `columnCount` cells after the
 * label. Sub-total rows carry ColData too, so a caller that sums these will
 * overshoot the section summary — map the names you want and treat the
 * remainder as unattributed rather than assuming these add up.
 */
export function leafAccountSeries(report: QboReport, group: string, columnCount: number): AccountSeries[] {
  const out: AccountSeries[] = []
  const walk = (rows: ReportRow[] | undefined) => {
    for (const r of rows ?? []) {
      const cols = r.ColData
      if (cols && cols.length >= 2 && cols[0].value) {
        out.push({ name: cols[0].value, values: cols.slice(1, 1 + columnCount).map(c => num(c.value)) })
      }
      walk(r.Rows?.Row)
    }
  }
  walk(findSection(report, group)?.Rows?.Row)
  return out
}

/** The YYYY-MM-DD of each column, in report order (Total column excluded). */
export function dayColumns(report: QboReport): string[] {
  const out: string[] = []
  for (const col of report.Columns?.Column ?? []) {
    const start = col.MetaData?.find(m => m.Name === 'StartDate')?.Value
    if (start) out.push(start)
  }
  return out
}

/** The YYYY-MM of each month column, in report order (Total column excluded). */
export function monthColumns(report: QboReport): string[] {
  const out: string[] = []
  for (const col of report.Columns?.Column ?? []) {
    const start = col.MetaData?.find(m => m.Name === 'StartDate')?.Value
    if (start) out.push(start.slice(0, 7))
  }
  return out
}

export async function fetchProfitAndLossByMonth(startDate: string, endDate: string): Promise<QboReport> {
  return qboFetch<QboReport>(
    `reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&summarize_column_by=Month&accounting_method=Accrual`,
  )
}

/**
 * P&L one column per day. Retail and the smokehouse don't run off the harvest
 * schedule, so the books are the only day-by-day record of what they earned;
 * see lib/revenueRecognition. Cheap enough to ask for — a quarter of days comes
 * back in about two seconds.
 */
export async function fetchProfitAndLossByDay(startDate: string, endDate: string): Promise<QboReport> {
  return qboFetch<QboReport>(
    `reports/ProfitAndLoss?start_date=${startDate}&end_date=${endDate}&summarize_column_by=Days&accounting_method=Accrual`,
  )
}

export async function fetchBalanceSheetAsOf(date: string): Promise<QboReport> {
  return qboFetch<QboReport>(`reports/BalanceSheet?start_date=${date}&end_date=${date}`)
}
