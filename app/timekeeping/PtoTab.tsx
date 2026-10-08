'use client'
// PTO balances for /timekeeping. A balance is the opening balance carried in
// at go-live, plus PTO earned on every shift since (at the rate in effect that
// day), minus approved PTO days already taken.

import { useState } from 'react'
import { dateLabel } from '@/lib/dates'
import { Shift, accrualPerHour, annualPtoRate, calcShift, nextAnniversary, yearsOfService } from '@/lib/timekeeping'
import { TimeOffRequest, TkEmployee, ptoSummary } from '@/lib/timeclock'
import { C, card, h2, td, th } from './shared'

export function PtoTab({ employees, shifts, requests, today, now }: {
  employees: TkEmployee[]; shifts: Shift[]; requests: TimeOffRequest[]; today: string; now: string | null
}) {
  const nowHHMM = now ?? '00:00'
  const rows = employees.filter(e => e.active).map(e => {
    const s = ptoSummary(e, shifts, requests, today, nowHHMM)
    const hours = shifts.filter(x => x.empId === e.id && x.date >= e.ptoOpeningAsOf).reduce((t, x) => t + calcShift(x, nowHHMM).workedHours, 0)
    return { e, s, hours, years: yearsOfService(e.hireDate, today), nextAnniv: nextAnniversary(e.hireDate, today) }
  })

  const [calcHours, setCalcHours] = useState(2080)
  const serviceYears = [0, 1, 2, 3, 4, 5, 10, 15, 20]
  const hourCols = [1040, 1600, 2080, 2400]

  return (
    <>
      <div style={card}>
        <h2 style={h2}>Balances</h2>
        <p style={{ color: C.tan, fontSize: '0.8rem', margin: '0 0 0.6rem' }}>
          Opening balance at go-live, plus every hour worked since at the employee&apos;s current rate, minus PTO taken. The rate goes up 8 h/yr on each work anniversary, so it&apos;s +40 every 5 years.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Employee</th><th style={th}>Hired</th><th style={th}>Service</th><th style={th}>Rate now</th>
              <th style={th}>Opening</th><th style={th}>Hrs worked</th><th style={th}>Earned</th><th style={th}>Taken</th><th style={th}>Balance</th><th style={th}>Approved / asked</th><th style={th}>Next bump</th>
            </tr></thead>
            <tbody>
              {rows.length === 0 && <tr><td style={td} colSpan={11}>No one yet — add people on the Employees tab.</td></tr>}
              {rows.map(({ e, s, hours, years, nextAnniv }) => (
                <tr key={e.id}>
                  <td style={td}>{e.name}<div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>{e.role}</div></td>
                  <td style={td}>{dateLabel(e.hireDate, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={td}>{years} yr</td>
                  <td style={td}>{annualPtoRate(years)} h / 2080</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{s.opening.toFixed(1)}<div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>as of {dateLabel(e.ptoOpeningAsOf, { month: 'numeric', day: 'numeric', year: '2-digit' })}</div></td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{hours.toLocaleString(undefined, { maximumFractionDigits: 1 })}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{s.earned.toFixed(1)}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{s.taken.toFixed(1)}</td>
                  <td style={{ ...td, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>{s.onBooks.toFixed(1)} h</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: C.tan }}>{s.booked || s.pending ? `${s.booked.toFixed(1)} / ${s.pending.toFixed(1)}` : '—'}</td>
                  <td style={td}>{dateLabel(nextAnniv, { month: 'short', day: 'numeric', year: 'numeric' })}<div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>→ {annualPtoRate(years + 1)} h / 2080</div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>PTO earned per year</h2>
        <p style={{ color: C.tan, fontSize: '0.8rem', margin: '0 0 0.6rem' }}>Hours of PTO for a full year, by hours worked and years of service.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Service</th>
              {hourCols.map(h => <th key={h} style={th}>{h.toLocaleString()} hrs worked</th>)}
              <th style={th}>Per hour</th>
            </tr></thead>
            <tbody>
              {serviceYears.map(y => (
                <tr key={y} style={y % 5 === 0 ? { background: 'rgba(76,175,80,0.07)' } : undefined}>
                  <td style={td}>{y === 0 ? 'Year 1' : `After ${y} yr`}</td>
                  {hourCols.map(h => <td key={h} style={{ ...td, fontVariantNumeric: 'tabular-nums', fontWeight: h === 2080 ? 700 : 400 }}>{(h * accrualPerHour(y)).toFixed(1)}</td>)}
                  <td style={{ ...td, color: C.tan, fontVariantNumeric: 'tabular-nums' }}>{accrualPerHour(y).toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop: '1rem', display: 'flex', alignItems: 'center', gap: '0.8rem', flexWrap: 'wrap' }}>
          <label style={{ color: C.tan, fontSize: '0.85rem' }}>Try it — hours worked in a year:</label>
          <input type="number" value={calcHours} min={0} step={40} onChange={e => setCalcHours(Number(e.target.value) || 0)}
            style={{ width: 100, background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.4rem' }} />
          <span style={{ color: C.cream, fontSize: '0.85rem' }}>
            → {(calcHours * accrualPerHour(0)).toFixed(1)} h (yr 1) · {(calcHours * accrualPerHour(5)).toFixed(1)} h (5 yr) · {(calcHours * accrualPerHour(10)).toFixed(1)} h (10 yr)
          </span>
        </div>
      </div>
    </>
  )
}

