'use client'
// Weekly payroll export for /timekeeping.
//
// One row per employee for a QuickBooks pay week, in the pay types the
// QuickBooks Payroll run already uses: Regular Pay, Overtime Pay, Paid time
// off, Unpaid time off. Until timesheets push straight into QuickBooks, this
// is what gets typed into the Wednesday payroll run (or checked against it).
//
// Pay weeks match the "Every Wednesday" schedule in QuickBooks: Monday through
// Sunday, paid the Wednesday after.

import { useState } from 'react'
import { addDaysISO, dateLabel } from '@/lib/dates'
import { Shift, calcShift, splitOvertime } from '@/lib/timekeeping'
import { TimeOffRequest, TkEmployee } from '@/lib/timeclock'
import { C, card, h2, th, td, btn, Pill } from './shared'

interface PayRow {
  empId:   string
  name:    string
  regular: number
  overtime: number
  pto:     number
  unpaid:  number   // approved unpaid time off
  upto:    number   // minutes of break time past the allowance — already not paid; informational
  issues:  string[] // must be fixed before this goes into payroll
  notes:   string[] // worth a look, doesn't block
}

const h2dec = (h: number) => h.toFixed(2)

function buildRows(employees: TkEmployee[], shifts: Shift[], requests: TimeOffRequest[], from: string, to: string, nowHHMM: string): PayRow[] {
  // Everyone active, plus anyone deactivated who still has hours in this week.
  const who = employees.filter(e => e.active || shifts.some(s => s.empId === e.id && s.date >= from && s.date <= to))
  return who.map(e => {
    const mine = shifts.filter(s => s.empId === e.id && s.date >= from && s.date <= to)
    const issues: string[] = [], notes: string[] = []
    let worked = 0, upto = 0
    for (const s of mine) {
      const c = calcShift(s, nowHHMM)
      worked += c.workedHours
      upto += c.uptoMinutes
      const day = dateLabel(s.date, { weekday: 'short', month: 'numeric', day: 'numeric' })
      if (!s.clockOut) issues.push(`${day}: still clocked in`)
      else for (const f of c.flags) notes.push(`${day}: ${f}`)
    }
    // Time off whose days fall in this week. Only approved counts; a request
    // still waiting on a decision blocks the row, since it could go either way.
    let pto = 0, unpaid = 0
    for (const r of requests) {
      if (r.empId !== e.id || r.status === 'denied') continue
      const inWeek = r.days.filter(d => d.date >= from && d.date <= to)
      if (!inWeek.length) continue
      const hrs = inWeek.reduce((t, d) => t + d.hours, 0)
      if (r.status === 'pending') { issues.push(`${r.type} request for ${hrs.toFixed(2)} h still waiting on approval`); continue }
      if (r.type === 'PTO') pto += hrs
      else unpaid += hrs
    }
    // PTO and unpaid time aren't hours worked, so overtime is on worked hours only.
    const { regular, overtime } = splitOvertime(worked)
    return { empId: e.id, name: e.name, regular, overtime, pto, unpaid, upto, issues, notes }
  })
}

function csvCell(v: string | number): string {
  const s = String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function PayrollTab({ employees, shifts, requests, thisMonday, today, now, earliest }: {
  employees: TkEmployee[]; shifts: Shift[]; requests: TimeOffRequest[]; thisMonday: string; today: string; now: string | null
  earliest: string  // oldest shift date loaded; weeks before it can't be shown
}) {
  // Default to the last full pay week — the one being paid this Wednesday.
  const [weekStart, setWeekStart] = useState(addDaysISO(thisMonday, -7))
  const weekEnd = addDaysISO(weekStart, 6)
  const payDate = addDaysISO(weekEnd, 3)
  const inProgress = weekEnd >= today
  const rows = buildRows(employees, shifts, requests, weekStart, weekEnd, now ?? '00:00')
  const withHours = rows.filter(r => r.regular + r.overtime + r.pto + r.unpaid > 0)
  const blocked = rows.filter(r => r.issues.length)
  const totals = withHours.reduce((t, r) => ({
    regular: t.regular + r.regular, overtime: t.overtime + r.overtime, pto: t.pto + r.pto, unpaid: t.unpaid + r.unpaid,
  }), { regular: 0, overtime: 0, pto: 0, unpaid: 0 })

  const fmtD = (iso: string) => dateLabel(iso, { month: 'numeric', day: 'numeric', year: 'numeric' })

  const downloadCsv = () => {
    const header = ['Employee', 'Pay period start', 'Pay period end', 'Pay date', 'Regular Pay', 'Overtime Pay', 'Paid time off', 'Unpaid time off', 'UPTO minutes (not paid)', 'Notes']
    const lines = [header, ...withHours.map(r => [
      r.name, weekStart, weekEnd, payDate,
      h2dec(r.regular), h2dec(r.overtime), h2dec(r.pto), h2dec(r.unpaid), r.upto,
      [...r.issues, ...r.notes].join('; '),
    ])]
    const csv = lines.map(l => l.map(csvCell).join(',')).join('\r\n') + '\r\n'
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }))
    const a = document.createElement('a')
    a.href = url
    a.download = `payroll-${weekStart}-to-${weekEnd}.csv`
    document.body.appendChild(a); a.click(); a.remove()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  const printSheet = () => {
    const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    const body = withHours.map(r => `<tr><td class="n">${esc(r.name)}</td><td>${h2dec(r.regular)}</td><td>${h2dec(r.overtime)}</td><td>${h2dec(r.pto)}</td><td>${h2dec(r.unpaid)}</td><td class="chk"></td></tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Payroll ${weekStart}</title><style>
      @page { size: letter portrait; margin: 0.6in; }
      body { font-family: Arial, sans-serif; color: #000; }
      h1 { font-size: 16pt; margin: 0; } .sub { margin: 2px 0 12px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #000; padding: 7px 6px; text-align: right; font-size: 11.5pt; font-variant-numeric: tabular-nums; }
      th { background: #eee; font-size: 10pt; } td.n, th.n { text-align: left; } td.chk { width: 0.5in; }
      tfoot td { font-weight: 700; } .foot { margin-top: 10px; font-size: 9pt; }
    </style></head><body>
      <h1>Cowboy Meat Co — Payroll hours</h1>
      <div class="sub">Pay period ${fmtD(weekStart)} – ${fmtD(weekEnd)} · Pay date ${fmtD(payDate)} (Every Wednesday)</div>
      <table><thead><tr><th class="n">Employee</th><th>Regular Pay</th><th>Overtime Pay</th><th>Paid time off</th><th>Unpaid time off</th><th>✓</th></tr></thead>
      <tbody>${body}</tbody>
      <tfoot><tr><td class="n">Total</td><td>${h2dec(totals.regular)}</td><td>${h2dec(totals.overtime)}</td><td>${h2dec(totals.pto)}</td><td>${h2dec(totals.unpaid)}</td><td></td></tr></tfoot></table>
      <div class="foot">Hours in decimals, as QuickBooks takes them (7.75 = 7 h 45 min). Overtime is hours worked over 40 in the week; PTO and unpaid time off don't count toward it. Check off each row as it's entered.</div>
      <script>window.onload = () => window.print()</script></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  const num = (v: number, color?: string) => (
    <td style={{ ...td, textAlign: 'right', fontVariantNumeric: 'tabular-nums', color: v ? (color ?? C.cream) : C.lightBrown }}>{h2dec(v)}</td>
  )

  return (
    <div style={card}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
        <h2 style={{ ...h2, margin: 0 }}>Payroll export</h2>
        <button style={btn(C.medBrown)} onClick={() => setWeekStart(w => addDaysISO(w, -7))} disabled={weekStart <= earliest}>←</button>
        <span style={{ color: C.cream, fontWeight: 700, textAlign: 'center' }}>
          {dateLabel(weekStart, { month: 'short', day: 'numeric' })} – {dateLabel(weekEnd, { month: 'short', day: 'numeric' })}
        </span>
        <button style={btn(C.medBrown)} onClick={() => setWeekStart(w => addDaysISO(w, 7))} disabled={weekStart >= thisMonday}>→</button>
        <span style={{ color: C.tan, fontSize: '0.85rem' }}>Pay date {dateLabel(payDate, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
        <span style={{ flex: 1 }} />
        <button style={btn(C.green)} onClick={downloadCsv}>⬇ Download CSV</button>
        <button style={btn(C.medBrown)} onClick={printSheet}>🖨 Print sheet</button>
      </div>
      <p style={{ color: C.tan, fontSize: '0.8rem', margin: '0 0 0.8rem' }}>
        Hours for the QuickBooks <b>Every Wednesday</b> pay run, in its pay types. Decimal hours, the way QuickBooks takes them.
      </p>

      {inProgress && <div style={{ background: 'rgba(245,158,11,0.12)', border: `1px solid ${C.amber}66`, color: C.cream, borderRadius: 4, padding: '0.5rem 0.7rem', marginBottom: '0.8rem', fontSize: '0.85rem' }}>
        This week isn&apos;t over yet — hours will keep changing until Sunday night.
      </div>}
      {blocked.length > 0 && <div style={{ background: 'rgba(239,68,68,0.12)', border: `1px solid ${C.red}66`, color: C.cream, borderRadius: 4, padding: '0.5rem 0.7rem', marginBottom: '0.8rem', fontSize: '0.85rem' }}>
        {blocked.length} employee{blocked.length > 1 ? 's need' : ' needs'} attention before this goes into payroll — see the red notes below.
      </div>}

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={th}>Employee</th>
            <th style={{ ...th, textAlign: 'right' }}>Regular Pay</th>
            <th style={{ ...th, textAlign: 'right' }}>Overtime Pay</th>
            <th style={{ ...th, textAlign: 'right' }}>Paid time off</th>
            <th style={{ ...th, textAlign: 'right' }}>Unpaid time off</th>
            <th style={{ ...th, textAlign: 'right' }}>UPTO</th>
            <th style={th}>Check</th>
          </tr></thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.empId}>
                <td style={td}>{r.name}</td>
                {num(r.regular)}
                {num(r.overtime, C.amber)}
                {num(r.pto, C.green)}
                {num(r.unpaid, C.blue)}
                <td style={{ ...td, textAlign: 'right', color: r.upto ? C.red : C.lightBrown }}>{r.upto ? `${r.upto} min` : '—'}</td>
                <td style={{ ...td, fontSize: '0.75rem', maxWidth: 340 }}>
                  {r.issues.map((x, i) => <div key={`i${i}`} style={{ color: C.red }}>⚠ {x}</div>)}
                  {r.notes.map((x, i) => <div key={`n${i}`} style={{ color: C.amber }}>{x}</div>)}
                  {!r.issues.length && !r.notes.length && <Pill color={C.green}>Ready</Pill>}
                </td>
              </tr>
            ))}
            <tr>
              <td style={{ ...td, fontWeight: 700 }}>Total</td>
              {num(totals.regular)}{num(totals.overtime, C.amber)}{num(totals.pto, C.green)}{num(totals.unpaid, C.blue)}
              <td style={td} /><td style={td} />
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ color: C.lightBrown, fontSize: '0.75rem', marginTop: 8, lineHeight: 1.5 }}>
        Overtime is hours worked over 40 in the week; PTO and unpaid time off aren&apos;t hours worked, so they don&apos;t count toward it.
        UPTO is break time past the paid allowance — it&apos;s already left out of Regular Pay, so it isn&apos;t entered anywhere; it&apos;s shown so you can see it.
        Amber notes are worth a look but don&apos;t block payroll; red ones do.
      </div>
    </div>
  )
}
