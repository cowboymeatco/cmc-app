import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { qboStatus } from '@/lib/qbo'
import { fetchPayslipsSince, type Payslip } from '@/lib/qboPayroll'

// Weekly labor feed for /exec: payroll from QuickBooks Payroll, pounds from
// the pack floor, one labor_reports row per pay week.
//
// The denominator is what the plant PACKED that week (boxes.total_weight_lbs
// by pack_date), not what it invoiced. Invoicing happens at pickup, weeks
// after the work, which is why the two hand-entered rows from before this
// feed read 44% and 82% off near-identical payrolls. Pack-out lands in the
// same week the labor was spent, so payroll ÷ pounds packed moves with
// effort rather than with when Jill sent the bill. The sales columns are
// left null on feed-written rows for the same reason.

export const LABOR_WEEKS = 13
const MOUNTAIN = 'America/Denver'

export interface LaborWeekRow {
  week_start: string
  week_end: string
  labor_dollars: number
  labor_hours: number
  headcount: number
  avg_hours: number
  over40: number
  throughput_lbs: number
  dollars_per_lb: number | null
}

export interface LaborSyncResult {
  written: number
  error: string | null
}

const round = (n: number, places: number) => {
  const f = 10 ** places
  return Math.round(n * f) / f
}

/** Today's date in the plant's time zone, as YYYY-MM-DD. */
export function mountainToday(now = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: MOUNTAIN })
}

/** The Monday `weeksBack` weeks before the week containing `dateISO`. */
export function mondayWeeksBack(dateISO: string, weeksBack: number): string {
  const t = Date.UTC(+dateISO.slice(0, 4), +dateISO.slice(5, 7) - 1, +dateISO.slice(8, 10))
  const dow = (new Date(t).getUTCDay() + 6) % 7 // Monday = 0
  return new Date(t - (dow + 7 * weeksBack) * 86_400_000).toISOString().slice(0, 10)
}

export interface PayWeek {
  week_start: string
  week_end: string
  labor_dollars: number
  labor_hours: number
  headcount: number
  avg_hours: number
  over40: number
}

/**
 * Roll payslips up into pay weeks, keyed by pay-period start.
 *
 * Hours are every compensation line's hours, salary included — QuickBooks
 * stamps a salaried week at its standard hours, and that is the same figure
 * the old Thursday report summed. The over-40 count looks only at hours that
 * came off a time sheet, because the crew logs anything past 40 as regular
 * pay rather than overtime and a salaried "50" is a contract, not a long week.
 */
export function aggregatePayslips(slips: Payslip[]): Map<string, PayWeek> {
  interface Acc {
    end: string
    dollars: number
    hours: number
    byEmployee: Map<string, { gross: number; hours: number; timesheetHours: number }>
  }
  const weeks = new Map<string, Acc>()
  for (const s of slips) {
    if (!s.periodStart || !s.periodEnd) continue
    let acc = weeks.get(s.periodStart)
    if (!acc) {
      acc = { end: s.periodEnd, dollars: 0, hours: 0, byEmployee: new Map() }
      weeks.set(s.periodStart, acc)
    }
    if (s.periodEnd > acc.end) acc.end = s.periodEnd
    const key = s.employeeId ?? `payslip:${s.id}`
    const emp = acc.byEmployee.get(key) ?? { gross: 0, hours: 0, timesheetHours: 0 }
    emp.gross += s.grossPay
    for (const c of s.compensations) {
      emp.hours += c.hours
      if (c.source === 'TIME_SHEET') emp.timesheetHours += c.hours
    }
    acc.byEmployee.set(key, emp)
    acc.dollars += s.grossPay
  }

  const out = new Map<string, PayWeek>()
  for (const [start, acc] of weeks) {
    const paid = [...acc.byEmployee.values()].filter(e => e.gross > 0)
    const hours = paid.reduce((t, e) => t + e.hours, 0)
    out.set(start, {
      week_start: start,
      week_end: acc.end,
      labor_dollars: round(acc.dollars, 2),
      labor_hours: round(hours, 2),
      headcount: paid.length,
      avg_hours: paid.length ? round(hours / paid.length, 1) : 0,
      over40: paid.filter(e => e.timesheetHours > 40).length,
    })
  }
  return out
}

/** Pounds packed between two dates inclusive, off the box records. */
export async function packedLbs(startISO: string, endISO: string): Promise<number> {
  let total = 0
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await supabaseAdmin
      .from('boxes')
      .select('total_weight_lbs')
      .gte('pack_date', startISO)
      .lte('pack_date', endISO)
      .range(from, from + page - 1)
    if (error) throw new Error(`boxes read failed: ${error.message}`)
    for (const b of data ?? []) total += Number(b.total_weight_lbs) || 0
    if (!data || data.length < page) break
  }
  return total
}

export function buildRow(week: PayWeek, lbs: number): LaborWeekRow {
  const throughput = Math.round(lbs)
  return {
    ...week,
    throughput_lbs: throughput,
    dollars_per_lb: throughput > 0 ? round(week.labor_dollars / throughput, 2) : null,
  }
}

/**
 * Write any pay week from the last LABOR_WEEKS weeks that labor_reports does
 * not have yet. Weeks already on file are left alone — including the two
 * hand-entered ones — so a re-run never rewrites history.
 */
export async function syncLaborWeeks(now = new Date()): Promise<LaborSyncResult> {
  const payroll = await qboStatus('payroll')
  if (!payroll.connected) return { written: 0, error: null }

  const since = mondayWeeksBack(mountainToday(now), LABOR_WEEKS)
  try {
    const { data: existing, error: readErr } = await supabaseAdmin
      .from('labor_reports')
      .select('week_start')
      .gte('week_start', since)
    if (readErr) throw new Error(`labor_reports read failed: ${readErr.message}`)
    const have = new Set((existing ?? []).map(r => r.week_start as string))

    const slips = await fetchPayslipsSince(since)
    const weeks = [...aggregatePayslips(slips).values()]
      .filter(w => w.week_start >= since && !have.has(w.week_start))
      .sort((a, b) => a.week_start.localeCompare(b.week_start))

    let written = 0
    for (const week of weeks) {
      const row = buildRow(week, await packedLbs(week.week_start, week.week_end))
      const { error } = await supabaseAdmin.from('labor_reports').upsert(row, { onConflict: 'week_start' })
      if (error) throw new Error(`labor_reports write failed for ${week.week_start}: ${error.message}`)
      written++
    }
    return { written, error: null }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    console.error('labor sync failed:', message)
    return { written: 0, error: message }
  }
}
