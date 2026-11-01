// The PTO statement: one employee's PTO ledger, printed for them to keep.
//
// Charlie, 2026-11-01 (/timekeeping: "Add a PTO Report"): the PTO tab shows a
// manager the balance, but an employee asking "where did my hours go?" needs
// the running account behind it. This is that account, week by week, written
// for the employee rather than the office — a pay stub for PTO.
//
// The ledger is built from the same inputs as ptoSummary and must land on the
// same balance: the opening balance at go-live, then every pay week (Monday
// to Sunday) since with the hours worked and the PTO they earned at the rate
// in effect that day, less the approved PTO days already taken. Weeks with
// nothing on them are skipped. Approved days still ahead and requests waiting
// on a decision are listed under the ledger, since they come off what the
// employee can still ask for, not off the balance.

import { addDaysISO, dateLabel, mondayOfISO } from '@/lib/dates'
import { PTO_RULES, Shift, accrualPerHour, annualPtoRate, calcShift, fmt12, nextAnniversary, yearsOfService } from '@/lib/timekeeping'
import { TimeOffRequest, TkEmployee, ptoSummary } from '@/lib/timeclock'
import { printBackButton } from './shared'

export interface TakenDay { date: string; hours: number; note: string }

export interface LedgerWeek {
  weekStart:  string
  weekEnd:    string
  worked:     number   // hours worked in the week
  earned:     number   // PTO earned on them
  taken:      TakenDay[]
  takenHours: number
  balance:    number   // after this week
  rateFrom:   number   // annual rate (h per 2080) on Monday …
  rateTo:     number   // … and on Sunday; differ in the week of a work anniversary
  inProgress: boolean  // the current week — still changing
}

export interface PtoStatement {
  emp:      TkEmployee
  weeks:    LedgerWeek[]
  summary:  ReturnType<typeof ptoSummary>
  upcoming: TakenDay[]   // approved, still ahead
  pending:  TakenDay[]   // asked for, waiting on a decision
  years:    number
  nextBump: string
}

const sortDays = (a: TakenDay, b: TakenDay) => a.date.localeCompare(b.date)

export function buildPtoStatement(e: TkEmployee, shifts: Shift[], requests: TimeOffRequest[], today: string, nowHHMM: string): PtoStatement {
  const from = e.ptoOpeningAsOf
  const byWeek = new Map<string, LedgerWeek>()
  const week = (date: string): LedgerWeek => {
    const weekStart = mondayOfISO(date)
    let w = byWeek.get(weekStart)
    if (!w) {
      const weekEnd = addDaysISO(weekStart, 6)
      w = {
        weekStart, weekEnd, worked: 0, earned: 0, taken: [], takenHours: 0, balance: 0,
        rateFrom: annualPtoRate(yearsOfService(e.hireDate, weekStart)),
        rateTo:   annualPtoRate(yearsOfService(e.hireDate, weekEnd)),
        inProgress: weekEnd >= today,
      }
      byWeek.set(weekStart, w)
    }
    return w
  }

  // Same filters as ptoSummary: shifts from go-live, each at that day's rate.
  for (const s of shifts) {
    if (s.empId !== e.id || s.date < from) continue
    const hours = calcShift(s, nowHHMM).workedHours
    const w = week(s.date)
    w.worked += hours
    w.earned += hours * accrualPerHour(yearsOfService(e.hireDate, s.date))
  }

  // Same split as ptoHolds: approved days before today were taken, approved
  // days from today on are booked, pending days are held either way.
  const upcoming: TakenDay[] = [], pending: TakenDay[] = []
  for (const r of requests) {
    if (r.empId !== e.id || r.type !== 'PTO' || r.status === 'denied') continue
    for (const d of r.days) {
      if (d.date < from) continue
      const day: TakenDay = { date: d.date, hours: d.hours, note: r.note }
      if (r.status === 'pending') pending.push(day)
      else if (d.date < today) { const w = week(d.date); w.taken.push(day); w.takenHours += d.hours }
      else upcoming.push(day)
    }
  }

  const weeks = [...byWeek.values()].sort((a, b) => a.weekStart.localeCompare(b.weekStart))
  let balance = e.ptoOpeningHours
  for (const w of weeks) {
    w.taken.sort(sortDays)
    balance += w.earned - w.takenHours
    w.balance = balance
  }

  return {
    emp: e, weeks, summary: ptoSummary(e, shifts, requests, today, nowHHMM),
    upcoming: upcoming.sort(sortDays), pending: pending.sort(sortDays),
    years: yearsOfService(e.hireDate, today), nextBump: nextAnniversary(e.hireDate, today),
  }
}

// ── Printing ────────────────────────────────────────────────────────────────

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
const h2 = (h: number) => h.toFixed(2)
const md = (iso: string) => dateLabel(iso, { month: 'numeric', day: 'numeric' })
const mdy = (iso: string) => dateLabel(iso, { month: 'short', day: 'numeric', year: 'numeric' })
const wdmd = (iso: string) => dateLabel(iso, { weekday: 'short', month: 'numeric', day: 'numeric' })

function dayList(days: TakenDay[]): string {
  return days.map(d => `<tr><td>${esc(wdmd(d.date))}</td><td class="r">${h2(d.hours)}</td><td class="note">${esc(d.note || '')}</td></tr>`).join('')
}

/** The body of one statement — a page on its own, so several can share a printout. */
function statementBody(st: PtoStatement, today: string, nowHHMM: string): string {
  const { emp, weeks, summary: s } = st
  const rows = weeks.map(w => {
    const rate = w.rateFrom === w.rateTo ? `${w.rateFrom}` : `${w.rateFrom} → ${w.rateTo}`
    const bump = w.rateFrom !== w.rateTo
      ? `<tr class="bump"><td colspan="6">Work anniversary ${esc(md(nextAnniversary(emp.hireDate, w.weekStart)))} — rate went from ${w.rateFrom} to ${w.rateTo} h per 2,080 hours worked</td></tr>`
      : ''
    const takenLines = w.taken.map(d =>
      `<tr class="sub"><td></td><td colspan="3">PTO day ${esc(wdmd(d.date))}${d.note ? ` · ${esc(d.note)}` : ''}</td><td class="r">−${h2(d.hours)}</td><td></td></tr>`).join('')
    return `${bump}<tr${w.inProgress ? ' class="open"' : ''}>
      <td class="n">${esc(md(w.weekStart))} – ${esc(md(w.weekEnd))}${w.inProgress ? ' <span class="tag">in progress</span>' : ''}</td>
      <td class="r">${w.worked ? h2(w.worked) : ''}</td>
      <td class="r">${rate}</td>
      <td class="r">${w.earned ? `+${h2(w.earned)}` : ''}</td>
      <td class="r">${w.takenHours ? `−${h2(w.takenHours)}` : ''}</td>
      <td class="r bal">${h2(w.balance)}</td>
    </tr>${takenLines}`
  }).join('')

  const totals = weeks.reduce((t, w) => ({ worked: t.worked + w.worked, earned: t.earned + w.earned, taken: t.taken + w.takenHours }), { worked: 0, earned: 0, taken: 0 })
  const free = s.onBooks - s.booked - s.pending
  const rateNow = annualPtoRate(st.years)

  return `<section class="stmt">
    <div class="head">
      <div>
        <div class="co">COWBOY MEAT CO</div>
        <div class="kind">PTO statement</div>
        <div class="name">${esc(emp.name)}</div>
        <div class="meta">${emp.role ? esc(emp.role) + ' · ' : ''}Hired ${esc(mdy(emp.hireDate))} · ${st.years} yr${st.years === 1 ? '' : 's'} of service</div>
      </div>
      <div class="box">
        <div class="bal-big">${h2(s.onBooks)}</div>
        <div class="bal-l">PTO hours on the books</div>
        <table>
          ${s.booked ? `<tr><td>Approved, coming up</td><td class="r">−${h2(s.booked)}</td></tr>` : ''}
          ${s.pending ? `<tr><td>Asked for, waiting</td><td class="r">−${h2(s.pending)}</td></tr>` : ''}
          ${s.booked || s.pending ? `<tr class="big"><td>Free to ask for</td><td class="r">${h2(free)}</td></tr>` : ''}
          <tr><td>Used this year</td><td class="r">${h2(s.takenThisYear)}</td></tr>
          <tr><td>Your rate now</td><td class="r">${rateNow} h / 2,080</td></tr>
          <tr><td>Goes up ${esc(md(st.nextBump))}</td><td class="r">${annualPtoRate(st.years + 1)} h / 2,080</td></tr>
        </table>
      </div>
    </div>

    <table class="ledger">
      <thead><tr>
        <th class="n">Pay week (Mon – Sun)</th><th>Hours worked</th><th>Rate</th><th>PTO earned</th><th>PTO taken</th><th>Balance</th>
      </tr></thead>
      <tbody>
        <tr class="opening"><td class="n">Opening balance, as of ${esc(mdy(emp.ptoOpeningAsOf))}</td><td></td><td></td><td></td><td></td><td class="r bal">${h2(emp.ptoOpeningHours)}</td></tr>
        ${rows || '<tr><td colspan="6" class="n">No hours on the clock since then.</td></tr>'}
      </tbody>
      <tfoot><tr>
        <td class="n">Since ${esc(md(emp.ptoOpeningAsOf))}</td><td class="r">${h2(totals.worked)}</td><td></td><td class="r">+${h2(totals.earned)}</td><td class="r">${totals.taken ? `−${h2(totals.taken)}` : ''}</td><td class="r bal">${h2(s.onBooks)}</td>
      </tr></tfoot>
    </table>

    ${st.upcoming.length || st.pending.length ? `<div class="cols">
      ${st.upcoming.length ? `<div class="col"><h3>Approved time off coming up</h3><table class="days">${dayList(st.upcoming)}</table></div>` : ''}
      ${st.pending.length ? `<div class="col"><h3>Asked for, waiting on a decision</h3><table class="days">${dayList(st.pending)}</table></div>` : ''}
    </div>` : ''}

    <div class="how">
      <b>How PTO adds up.</b> You earn PTO on every hour you work. In your first year that's ${PTO_RULES.baseAnnual} hours of PTO for ${PTO_RULES.fullTimeHours.toLocaleString()} hours worked
      (${accrualPerHour(0).toFixed(4)} h per hour), and the rate goes up ${PTO_RULES.stepPerYear} hours on each work anniversary. Rate is shown as hours of PTO per ${PTO_RULES.fullTimeHours.toLocaleString()} hours worked.
      Approved PTO comes off the balance on the day it's taken. Hours are in decimals: 7.75 = 7 h 45 min. The week marked “in progress” is still adding up.
    </div>
    <div class="foot">Printed ${esc(mdy(today))} ${fmt12(nowHHMM)} MT · Questions about your balance? Ask at the office.</div>
  </section>`
}

const CSS = `
  @page { size: letter portrait; margin: 0.55in; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: 9.5pt; }
  .stmt { page-break-after: always; }
  .stmt:last-child { page-break-after: auto; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 0.3in; margin-bottom: 10px; }
  .co { font-weight: 900; font-size: 13pt; letter-spacing: 0.04em; }
  .kind { font-weight: 700; font-size: 9pt; letter-spacing: 0.15em; text-transform: uppercase; margin: 2px 0 8px; }
  .name { font-weight: 900; font-size: 16pt; line-height: 1.1; }
  .meta { margin-top: 3px; font-size: 9pt; }
  .box { border: 2px solid #000; padding: 6px 9px; min-width: 2.6in; }
  .box table { width: 100%; border-collapse: collapse; }
  .box td { padding: 1px 0; font-size: 8.5pt; }
  .box tr.big td { font-weight: 900; font-size: 10pt; border-top: 1px solid #000; padding-top: 3px; }
  .bal-big { font-size: 22pt; font-weight: 900; text-align: center; line-height: 1.1; }
  .bal-l { font-size: 7.5pt; text-align: center; margin-bottom: 5px; text-transform: uppercase; letter-spacing: 0.08em; }
  table.ledger { width: 100%; border-collapse: collapse; }
  .ledger th, .ledger td { border: 1px solid #000; padding: 4px 6px; text-align: right; font-variant-numeric: tabular-nums; white-space: nowrap; }
  .ledger th { background: #eee; font-size: 8pt; text-transform: uppercase; letter-spacing: 0.04em; }
  .ledger td.n, .ledger th.n { text-align: left; white-space: normal; }
  .ledger td.bal { font-weight: 700; }
  .ledger tr.opening td { background: #f6f6f6; font-style: italic; }
  .ledger tr.sub td { border-top: none; font-size: 8pt; color: #333; padding-top: 1px; padding-bottom: 3px; text-align: left; }
  .ledger tr.sub td.r { text-align: right; }
  .ledger tr.bump td { background: #eee; font-size: 8pt; font-weight: 700; text-align: left; white-space: normal; }
  .ledger tr.open td { background: #fbfbfb; }
  .ledger tfoot td { font-weight: 700; background: #eee; }
  .tag { font-size: 7pt; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; border: 1px solid #000; padding: 0 3px; margin-left: 4px; }
  .cols { display: flex; gap: 0.3in; margin-top: 10px; }
  .col { flex: 1 1 0; }
  .col h3 { margin: 0 0 3px; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1px solid #000; padding-bottom: 2px; }
  table.days { width: 100%; border-collapse: collapse; }
  .days td { padding: 2px 4px 2px 0; font-size: 8.5pt; vertical-align: top; }
  .days td.r { text-align: right; font-weight: 700; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .days td.note { color: #333; font-style: italic; }
  .r { text-align: right; }
  .how { margin-top: 12px; font-size: 8pt; line-height: 1.45; border-top: 1px solid #000; padding-top: 6px; }
  .foot { margin-top: 6px; font-size: 7.5pt; text-align: center; }
`

/** A full printout: one statement per employee, each on its own page. */
export function ptoStatementHTML(statements: PtoStatement[], today: string, nowHHMM: string, backUrl = '/timekeeping'): string {
  const title = statements.length === 1 ? `PTO statement — ${statements[0].emp.name}` : `PTO statements — ${statements.length} employees`
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${CSS}</style></head><body>
    ${statements.map(st => statementBody(st, today, nowHHMM)).join('')}
    ${printBackButton(backUrl, 'Back to timekeeping')}
    <script>window.onload = () => window.print()</script>
  </body></html>`
}

/** Opens the printout in its own tab, the way the Payroll sheet does. */
export function printPtoStatements(employees: TkEmployee[], shifts: Shift[], requests: TimeOffRequest[], today: string, nowHHMM: string) {
  const statements = employees.map(e => buildPtoStatement(e, shifts, requests, today, nowHHMM))
  const w = window.open('', '_blank')
  if (w) { w.document.write(ptoStatementHTML(statements, today, nowHHMM)); w.document.close() }
}
