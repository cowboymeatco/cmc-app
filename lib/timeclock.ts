// Time clock data shapes and the rules that both the kiosk and the server
// apply to them: scheduled hours, time-off holds and the PTO balance. Safe to
// import from client components — no database access here (see
// lib/timeclockServer.ts for that).

import { dateLabel } from '@/lib/dates'
import { BREAK_RULES, Shift, accrualPerHour, calcShift, toMin, yearsOfService } from '@/lib/timekeeping'

export interface TkEmployee {
  id:               string
  name:             string
  role:             string | null
  hireDate:         string   // YYYY-MM-DD
  active:           boolean
  hasPin:           boolean  // false = not set up; signs in with the shared setup PIN and picks their own
  pinSetAt:         string | null  // when they picked their own (null = set by a manager)
  qboEmployeeId:    string | null
  ptoOpeningHours:  number   // balance carried in at go-live
  ptoOpeningAsOf:   string   // accrual counts shifts from this date
}

export interface SchedShift { start: string; end: string } // HH:MM
/** `${employeeId}|${YYYY-MM-DD}` → that day's shift. No entry = off. */
export type Schedule = Record<string, SchedShift>

export interface TimeOffRequest {
  id:         string
  empId:      string
  type:       'PTO' | 'Unpaid'
  days:       { date: string; hours: number }[] // fixed when submitted
  note:       string
  status:     'pending' | 'approved' | 'denied'
  submitted:  string // YYYY-MM-DD
}

export const schedKey = (empId: string, date: string) => `${empId}|${date}`

/** Paid hours for a scheduled shift: the 30-min unpaid lunch comes off a 6+ hour day. */
export function scheduledHours(sh: SchedShift): number {
  const span = (toMin(sh.end) - toMin(sh.start)) / 60
  return span - BREAK_RULES.lunchMinutes / 60 >= BREAK_RULES.lunchAt ? span - BREAK_RULES.lunchMinutes / 60 : span
}

export function requestHours(r: TimeOffRequest): number {
  return r.days.reduce((t, d) => t + d.hours, 0)
}

/**
 * Approved PTO splits at today: days already past were taken (they come off
 * the balance), days ahead are booked. Pending requests are held either way,
 * so nobody can ask for the same hours twice. Days before `fromDate` (the
 * go-live date) are already inside the opening balance and don't count.
 */
export function ptoHolds(empId: string, requests: TimeOffRequest[], today: string, fromDate = '0000-00-00') {
  let taken = 0, booked = 0, pending = 0, takenThisYear = 0
  const yearStart = `${today.slice(0, 4)}-01-01`
  for (const r of requests) {
    if (r.empId !== empId || r.type !== 'PTO' || r.status === 'denied') continue
    for (const d of r.days) {
      if (d.date < fromDate) continue
      if (r.status === 'pending') pending += d.hours
      else if (d.date < today) { taken += d.hours; if (d.date >= yearStart) takenThisYear += d.hours }
      else booked += d.hours
    }
  }
  return { taken, booked, pending, takenThisYear }
}

/** The request (if any, not denied) covering this person on this day. */
export function offOn(empId: string, date: string, requests: TimeOffRequest[]) {
  for (const r of requests) {
    if (r.empId !== empId || r.status === 'denied') continue
    const d = r.days.find(x => x.date === date)
    if (d) return { r, hours: d.hours }
  }
  return null
}

export function rangeLabel(r: TimeOffRequest): string {
  const first = r.days[0]?.date, last = r.days[r.days.length - 1]?.date
  if (!first) return '—'
  const f = (iso: string) => dateLabel(iso, { weekday: 'short', month: 'numeric', day: 'numeric' })
  return first === last ? f(first) : `${f(first)} – ${f(last)}`
}

export interface PtoSummary {
  opening:       number  // carried in at go-live
  earned:        number  // accrued on shifts since go-live
  taken:         number  // approved PTO days already past
  takenThisYear: number
  onBooks:       number  // opening + earned − taken
  booked:        number  // approved, still ahead
  pending:       number  // asked for, waiting on a decision
  free:          number  // what they can still ask for
}

/**
 * The PTO balance, from the opening balance at go-live plus every shift
 * since, each at the rate in effect that day. `shifts` must include every
 * shift since the employee's go-live date; `nowHHMM` stands in for any punch
 * still open.
 */
export function ptoSummary(e: TkEmployee, shifts: Shift[], requests: TimeOffRequest[], today: string, nowHHMM: string): PtoSummary {
  const earned = shifts
    .filter(s => s.empId === e.id && s.date >= e.ptoOpeningAsOf)
    .reduce((t, s) => t + calcShift(s, nowHHMM).workedHours * accrualPerHour(yearsOfService(e.hireDate, s.date)), 0)
  const h = ptoHolds(e.id, requests, today, e.ptoOpeningAsOf)
  const onBooks = e.ptoOpeningHours + earned - h.taken
  return {
    opening: e.ptoOpeningHours, earned, taken: h.taken, takenThisYear: h.takenThisYear,
    onBooks, booked: h.booked, pending: h.pending, free: onBooks - h.booked - h.pending,
  }
}

/** Every scheduled day in [from, to] as a request line: full shift, or `partial` hours if given. */
export function requestDaysFromSchedule(empId: string, schedule: Schedule, from: string, to: string, partial: number | null, addDays: (iso: string, n: number) => string) {
  const days: { date: string; hours: number }[] = []
  let unscheduled = 0
  for (let d = from, n = 0; d <= to && n < 62; d = addDays(d, 1), n++) {
    const sh = schedule[schedKey(empId, d)]
    if (!sh) { unscheduled++; continue }
    const full = scheduledHours(sh)
    days.push({ date: d, hours: partial && partial > 0 ? Math.min(partial, full) : full })
  }
  return { days, unscheduled }
}
