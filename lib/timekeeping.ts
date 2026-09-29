// Timekeeping rules for the payroll mockup (/timekeeping).
//
// Breaks — company policy, not Montana law. Montana follows the federal
// standard: no meal or rest breaks are required for adult employees. What the
// law DOES say is how breaks we choose to give must be paid (FLSA, 29 CFR
// 785.18–.19):
//   • Short rest breaks (5–20 min) are hours worked — always paid.
//   • A meal period is unpaid only if it's 30+ min and the employee is fully
//     relieved of duty. A shorter or interrupted lunch is paid time.
//
// PTO — Montana treats earned vacation as wages: no use-it-or-lose-it, and the
// balance is paid out at separation. A cap on how much can build up is legal.

// ── Breaks ──────────────────────────────────────────────────────────────────

export const BREAK_RULES = {
  firstPaidBreakAt:  4,   // hours worked → 15-min paid break
  lunchAt:           6,   // hours worked → 30-min unpaid lunch
  secondPaidBreakAt: 8,   // hours worked → another 15-min paid break
  paidBreakMinutes:  15,
  lunchMinutes:      30,
}

export interface Entitlement { paidBreaks: number; lunch: boolean }

/** Breaks owed for a shift of `workedHours` (paid time; unpaid lunch excluded). */
export function breakEntitlement(workedHours: number): Entitlement {
  return {
    paidBreaks: (workedHours >= BREAK_RULES.firstPaidBreakAt ? 1 : 0)
              + (workedHours >= BREAK_RULES.secondPaidBreakAt ? 1 : 0),
    lunch: workedHours >= BREAK_RULES.lunchAt,
  }
}

export interface Shift {
  id:          string
  empId:       string
  date:        string        // YYYY-MM-DD, shop clock
  clockIn:     string        // HH:MM
  clockOut:    string | null // null while still on the clock
  lunchStart:  string | null
  lunchEnd:    string | null
  breaksTaken: number        // paid 15s actually taken (no punch needed — they're paid)
}

export function toMin(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

export function fmtHours(h: number): string {
  const sign = h < 0 ? '-' : ''
  const m = Math.round(Math.abs(h) * 60)
  return `${sign}${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`
}

export interface ShiftCalc {
  spanHours:   number
  lunchHours:  number   // unpaid lunch actually deducted
  workedHours: number   // paid hours
  owed:        Entitlement
  flags:       string[]
}

/** `nowHHMM` stands in for the clock-out on a shift that's still open. */
export function calcShift(s: Shift, nowHHMM?: string): ShiftCalc {
  const out = s.clockOut ?? nowHHMM ?? s.clockIn
  const spanMin = Math.max(0, toMin(out) - toMin(s.clockIn))
  const flags: string[] = []

  let lunchMin = 0
  if (s.lunchStart && s.lunchEnd) {
    const taken = Math.max(0, toMin(s.lunchEnd) - toMin(s.lunchStart))
    if (taken >= BREAK_RULES.lunchMinutes) lunchMin = taken
    else flags.push(`Lunch was only ${taken} min — under 30 min it can't be unpaid, so it's counted as paid time.`)
  } else if (s.lunchStart && !s.lunchEnd && s.clockOut) {
    flags.push('Lunch started but never ended.')
  }

  const worked = (spanMin - lunchMin) / 60
  const owed = breakEntitlement(worked)

  if (s.clockOut) {
    if (owed.lunch && lunchMin === 0) flags.push('Worked 6+ hours with no 30-min lunch.')
    if (s.breaksTaken < owed.paidBreaks) {
      const missing = owed.paidBreaks - s.breaksTaken
      flags.push(`${missing} paid 15-min break${missing > 1 ? 's' : ''} not taken.`)
    }
  }

  return { spanHours: spanMin / 60, lunchHours: lunchMin / 60, workedHours: worked, owed, flags }
}

/** Montana and federal: over 40 hours in the workweek is time-and-a-half. */
export function splitOvertime(weekHours: number) {
  return { regular: Math.min(40, weekHours), overtime: Math.max(0, weekHours - 40) }
}

// ── PTO ─────────────────────────────────────────────────────────────────────

export const PTO_RULES = {
  fullTimeHours:  2080, // the yardstick: 2080 hours worked = one year's rate
  baseAnnual:     40,   // hours of PTO per 2080 worked, first year
  stepPerYear:    8,    // added at every work anniversary → +40 every 5 years
  maxAnnual:      null as number | null, // optional ceiling on the annual rate
  maxBalance:     null as number | null, // optional accrual cap (legal in MT)
}

/** Whole years of service completed on `onISO`. */
export function yearsOfService(hireISO: string, onISO: string): number {
  const [hy, hm, hd] = hireISO.split('-').map(Number)
  const [y, m, d] = onISO.split('-').map(Number)
  let years = y - hy
  if (m < hm || (m === hm && d < hd)) years--
  return Math.max(0, years)
}

/** PTO hours earned per 2080 worked, at a given service length. */
export function annualPtoRate(years: number): number {
  const rate = PTO_RULES.baseAnnual + PTO_RULES.stepPerYear * years
  return PTO_RULES.maxAnnual == null ? rate : Math.min(rate, PTO_RULES.maxAnnual)
}

/** PTO earned per hour worked, at a given service length. */
export function accrualPerHour(years: number): number {
  return annualPtoRate(years) / PTO_RULES.fullTimeHours
}

/** Next anniversary on or after `onISO`, as YYYY-MM-DD. */
export function nextAnniversary(hireISO: string, onISO: string): string {
  const [, hm, hd] = hireISO.split('-')
  const year = Number(onISO.slice(0, 4))
  const thisYear = `${year}-${hm}-${hd}`
  return thisYear > onISO ? thisYear : `${year + 1}-${hm}-${hd}`
}

export interface WeekHours { weekStart: string; hours: number }

/** PTO earned over a run of weeks, each at the rate in effect that week. */
export function ptoEarned(hireISO: string, weeks: WeekHours[]): number {
  return weeks.reduce((sum, w) => sum + w.hours * accrualPerHour(yearsOfService(hireISO, w.weekStart)), 0)
}
