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

export interface BreakPunch { start: string; end: string | null } // HH:MM

export interface Shift {
  id:          string
  empId:       string
  date:        string        // YYYY-MM-DD, shop clock
  clockIn:     string        // HH:MM
  clockOut:    string | null // null while still on the clock
  lunchStart:  string | null
  lunchEnd:    string | null
  breaks:      BreakPunch[]  // paid 15s, punched out and back in
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
  spanHours:          number  // clock-in to clock-out
  lunchMinutes:       number  // lunch taken
  lunchUnpaid:        boolean // false when a short lunch had to be paid
  breakMinutes:       number  // all break time punched
  paidBreakMinutes:   number  // up to 15 per break earned
  unpaidBreakMinutes: number  // break time past the paid allowance
  unpaidMinutes:      number  // everything taken off the day: lunch + break overage
  workedHours:        number  // paid hours
  owed:               Entitlement
  flags:              string[]
}

/**
 * Breaks are punched. Paid break time is pooled across the day: someone who
 * has earned two 15s gets up to 30 paid break minutes, however they split
 * them. Anything past that is unpaid — a 45-minute total pays 30.
 *
 * FLSA allows not paying an over-long break only if the employee was told,
 * clearly and in advance, how long breaks are and that extensions are unpaid
 * and against the rules. That notice belongs in the handbook and the kiosk.
 *
 * `nowHHMM` stands in for any punch still open (clock-out, lunch, break).
 */
export function calcShift(s: Shift, nowHHMM?: string): ShiftCalc {
  const now = nowHHMM ?? s.clockIn
  const out = s.clockOut ?? now
  const spanMin = Math.max(0, toMin(out) - toMin(s.clockIn))
  const flags: string[] = []

  let lunchMin = 0
  let lunchUnpaid = false
  if (s.lunchStart) {
    const end = s.lunchEnd ?? (s.clockOut ? null : now)
    if (end == null) flags.push('Lunch started but never ended.')
    else {
      lunchMin = Math.max(0, toMin(end) - toMin(s.lunchStart))
      // A lunch still in progress is off the clock; the 30-min test applies once it ends.
      lunchUnpaid = !s.lunchEnd || lunchMin >= BREAK_RULES.lunchMinutes
      if (!lunchUnpaid) flags.push(`Lunch was only ${lunchMin} min — under 30 min it can't be unpaid, so it's counted as paid time.`)
    }
  }

  const breakMin = s.breaks.reduce((t, b) => {
    const end = b.end ?? (s.clockOut ? b.start : now)
    return t + Math.max(0, toMin(end) - toMin(b.start))
  }, 0)
  if (s.clockOut && s.breaks.some(b => !b.end)) flags.push('A break was started but never ended.')

  // Working time, not counting any break or unpaid lunch.
  const working = spanMin - breakMin - (lunchUnpaid ? lunchMin : 0)
  // Earned breaks depend on paid hours, which depend on paid break time.
  // Start from "all break time paid" and step down if that overstates it.
  let owed = breakEntitlement((working + breakMin) / 60)
  let paidBreak = Math.min(breakMin, owed.paidBreaks * BREAK_RULES.paidBreakMinutes)
  const settled = breakEntitlement((working + paidBreak) / 60)
  if (settled.paidBreaks < owed.paidBreaks) {
    owed = settled
    paidBreak = Math.min(breakMin, owed.paidBreaks * BREAK_RULES.paidBreakMinutes)
  }
  owed = { ...owed, lunch: breakEntitlement((working + paidBreak) / 60).lunch }
  // Mid-shift, a break taken before the 4-hour mark hasn't been "earned" yet
  // but will be by the end of a normal day. Until clock-out, count each break
  // taken (up to two) as earned so the live numbers don't show it as unpaid.
  if (!s.clockOut) {
    const provisional = Math.max(owed.paidBreaks, Math.min(s.breaks.length, 2))
    paidBreak = Math.min(breakMin, provisional * BREAK_RULES.paidBreakMinutes)
  }

  const unpaidBreak = breakMin - paidBreak
  const worked = (working + paidBreak) / 60

  if (unpaidBreak > 0 && s.clockOut) flags.push(`Breaks ran ${unpaidBreak} min past the ${paidBreak} paid — unpaid.`)
  if (s.clockOut) {
    if (owed.lunch && !(lunchUnpaid && lunchMin > 0)) flags.push('Worked 6+ hours with no 30-min lunch.')
    const allowance = owed.paidBreaks * BREAK_RULES.paidBreakMinutes
    if (breakMin < allowance) flags.push(`Took ${breakMin} of ${allowance} paid break minutes.`)
  }

  return {
    spanHours: spanMin / 60,
    lunchMinutes: lunchMin,
    lunchUnpaid,
    breakMinutes: breakMin,
    paidBreakMinutes: paidBreak,
    unpaidBreakMinutes: unpaidBreak,
    unpaidMinutes: (lunchUnpaid ? lunchMin : 0) + unpaidBreak,
    workedHours: worked,
    owed,
    flags,
  }
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
