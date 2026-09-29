'use client'
// /timekeeping — payroll timekeeping MOCKUP. Nothing here touches the
// database: employees, punches and hours history are made up and live in
// React state, so a refresh resets everything. The rules themselves live in
// lib/timekeeping.ts so a real build can reuse them as-is.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { isoDate, isoDateTime, addDaysISO, mondayOfISO, dateLabel } from '@/lib/dates'
import {
  BREAK_RULES, PTO_RULES, Shift, WeekHours,
  calcShift, splitOvertime, fmtHours, toMin,
  yearsOfService, annualPtoRate, accrualPerHour, nextAnniversary, ptoEarned,
} from '@/lib/timekeeping'

const C = {
  dark: '#1A0A04', darkBrown: '#351E0E', medBrown: '#75471B', lightBrown: '#A6785A',
  tan: '#C9A882', cream: '#F2E8D9', green: '#4CAF50', amber: '#F59E0B', red: '#EF4444', blue: '#60A5FA',
}

// ── Mock data ───────────────────────────────────────────────────────────────

interface Employee {
  id: string; name: string; role: string; hireDate: string; wage: number
  weeklyHours: number   // typical week, drives the made-up history
  ptoUsed: number       // PTO hours used this year
}

const EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Sample Employee A', role: 'Cutter',          hireDate: '2025-03-10', wage: 19,   weeklyHours: 40,   ptoUsed: 16 },
  { id: 'e2', name: 'Sample Employee B', role: 'Lead Cutter',     hireDate: '2019-06-03', wage: 24,   weeklyHours: 46.2, ptoUsed: 40 },
  { id: 'e3', name: 'Sample Employee C', role: 'Wrap & Pack',     hireDate: '2023-11-15', wage: 17,   weeklyHours: 30.8, ptoUsed: 8 },
  { id: 'e4', name: 'Sample Employee D', role: 'Harvest Floor',   hireDate: '2011-04-18', wage: 26,   weeklyHours: 40,   ptoUsed: 64 },
  { id: 'e5', name: 'Sample Employee E', role: 'Cleaning (PT)',   hireDate: '2026-05-01', wage: 16.5, weeklyHours: 20,   ptoUsed: 0 },
]

// Deterministic wobble so the history looks like real weeks without Math.random
// (which would also break hydration).
function wobble(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return (x - Math.floor(x)) - 0.5
}

/** 52 weeks of made-up hours ending last week, skipping weeks before hire. */
function mockHistory(e: Employee, thisMonday: string): WeekHours[] {
  const weeks: WeekHours[] = []
  for (let i = 52; i >= 1; i--) {
    const weekStart = addDaysISO(thisMonday, -7 * i)
    if (weekStart < e.hireDate) continue
    const hours = Math.max(0, Math.round((e.weeklyHours + wobble(i * 7 + e.id.charCodeAt(1)) * 6) * 4) / 4)
    weeks.push({ weekStart, hours })
  }
  return weeks
}

/** A week of punches per employee. A few are deliberately off-policy so the flags show. */
function mockShifts(thisMonday: string, today: string): Shift[] {
  const shifts: Shift[] = []
  const days = [0, 1, 2, 3, 4].map(d => addDaysISO(addDaysISO(thisMonday, -7), d)) // last week Mon–Fri
  let n = 0
  const add = (empId: string, date: string, clockIn: string, clockOut: string | null, lunch: [string, string] | null, breaksTaken: number) =>
    shifts.push({ id: `s${n++}`, empId, date, clockIn, clockOut, lunchStart: lunch?.[0] ?? null, lunchEnd: lunch?.[1] ?? null, breaksTaken })

  days.forEach((d, i) => {
    add('e1', d, '07:00', '15:30', ['11:30', '12:00'], 2)
    add('e2', d, '06:00', i === 4 ? '13:00' : '16:00', ['11:00', '11:30'], i === 2 ? 1 : 2)
    if (i < 4) add('e3', d, '08:00', i === 1 ? '14:30' : '15:00', i === 1 ? null : ['12:00', '12:20'], 1)
    add('e4', d, '06:30', '15:00', ['11:30', '12:00'], 2)
    if (i % 2 === 0) add('e5', d, '16:00', '20:15', null, i === 0 ? 0 : 1)
  })
  // Today, in progress, for the clock tab.
  add('e1', today, '07:00', null, null, 0)
  add('e2', today, '06:00', null, null, 0)
  return shifts
}

// ── Page ────────────────────────────────────────────────────────────────────

type Tab = 'clock' | 'timesheet' | 'pto' | 'policy'

export default function TimekeepingPage() {
  const today = isoDate()
  const thisMonday = mondayOfISO(today)
  const [tab, setTab] = useState<Tab>('clock')
  const [shifts, setShifts] = useState<Shift[]>(() => mockShifts(thisMonday, today))

  // Shop-clock HH:MM, ticking. Starts null so server and browser render alike.
  const [now, setNow] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => setNow(isoDateTime().slice(11))
    tick()
    const t = setInterval(tick, 20_000)
    return () => clearInterval(t)
  }, [])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'clock', label: '⏱ Time Clock' },
    { key: 'timesheet', label: '📋 Timesheets' },
    { key: 'pto', label: '🌴 PTO' },
    { key: 'policy', label: '📖 Policy' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.25rem', minHeight: 72, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Timekeeping</h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>Mockup · sample data · resets on refresh</p>
        </div>
      </header>

      <nav style={{ display: 'flex', gap: 4, padding: '0.75rem 1.25rem 0', flexWrap: 'wrap', maxWidth: 1100, margin: '0 auto' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: tab === t.key ? C.medBrown : 'transparent', color: tab === t.key ? C.cream : C.tan,
            border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.5rem 0.9rem', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600,
          }}>{t.label}</button>
        ))}
      </nav>

      <main style={{ padding: '1rem 1.25rem 3rem', maxWidth: 1100, margin: '0 auto' }}>
        {tab === 'clock'     && <ClockTab shifts={shifts} setShifts={setShifts} today={today} now={now} />}
        {tab === 'timesheet' && <TimesheetTab shifts={shifts} thisMonday={thisMonday} />}
        {tab === 'pto'       && <PtoTab today={today} thisMonday={thisMonday} />}
        {tab === 'policy'    && <PolicyTab />}
      </main>
    </div>
  )
}

// ── Shared bits ─────────────────────────────────────────────────────────────

const card: React.CSSProperties = { background: C.dark, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, padding: '1rem 1.1rem', marginBottom: '1rem' }
const h2: React.CSSProperties = { fontFamily: 'Georgia, serif', fontSize: '0.95rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.6rem' }
const th: React.CSSProperties = { textAlign: 'left', padding: '0.4rem 0.5rem', color: C.lightBrown, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid rgba(166,120,90,0.3)', whiteSpace: 'nowrap' }
const td: React.CSSProperties = { padding: '0.45rem 0.5rem', color: C.cream, fontSize: '0.85rem', borderBottom: '1px solid rgba(166,120,90,0.12)', verticalAlign: 'top' }
const btn = (color: string): React.CSSProperties => ({ background: color, color: '#fff', border: 'none', borderRadius: 4, padding: '0.55rem 0.9rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' })

function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ display: 'inline-block', background: `${color}22`, color, border: `1px solid ${color}66`, borderRadius: 999, padding: '0.05rem 0.5rem', fontSize: '0.72rem', fontWeight: 700, marginRight: 4, whiteSpace: 'nowrap' }}>{children}</span>
}

function Stat({ label, value, sub, color = C.cream }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ flex: '1 1 140px', background: C.darkBrown, borderRadius: 4, padding: '0.6rem 0.8rem' }}>
      <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: C.tan }}>{sub}</div>}
    </div>
  )
}

function EntitlementPills({ owed, taken, lunchTaken }: { owed: { paidBreaks: number; lunch: boolean }; taken: number; lunchTaken: boolean }) {
  if (owed.paidBreaks === 0 && !owed.lunch) return <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>none yet</span>
  return (
    <>
      {owed.paidBreaks > 0 && <Pill color={taken >= owed.paidBreaks ? C.green : C.amber}>Paid 15s: {taken}/{owed.paidBreaks}</Pill>}
      {owed.lunch && <Pill color={lunchTaken ? C.green : C.amber}>Lunch {lunchTaken ? '✓' : 'owed'}</Pill>}
    </>
  )
}

// ── Time clock ──────────────────────────────────────────────────────────────

function ClockTab({ shifts, setShifts, today, now }: {
  shifts: Shift[]; setShifts: React.Dispatch<React.SetStateAction<Shift[]>>; today: string; now: string | null
}) {
  const [empId, setEmpId] = useState(EMPLOYEES[0].id)
  const open = shifts.find(s => s.empId === empId && s.date === today && !s.clockOut)
  const onLunch = !!open?.lunchStart && !open.lunchEnd
  const nowHHMM = now ?? '00:00'

  const update = (patch: Partial<Shift>) => setShifts(ss => ss.map(s => s.id === open!.id ? { ...s, ...patch } : s))
  const clockIn = () => setShifts(ss => [...ss, { id: `s${Date.now()}`, empId, date: today, clockIn: nowHHMM, clockOut: null, lunchStart: null, lunchEnd: null, breaksTaken: 0 }])

  const calc = open ? calcShift(open, onLunch ? open.lunchStart! : nowHHMM) : null

  // What's the next thing this person has coming, in worked-hours terms.
  let nextUp: string | null = null
  if (calc && !onLunch) {
    const w = calc.workedHours
    const milestones: [number, string][] = [
      [BREAK_RULES.firstPaidBreakAt, '15-min paid break'],
      [BREAK_RULES.lunchAt, '30-min unpaid lunch'],
      [BREAK_RULES.secondPaidBreakAt, 'second 15-min paid break'],
    ]
    const next = milestones.find(([h]) => w < h)
    if (next) {
      const atMin = toMin(nowHHMM) + Math.round((next[0] - w) * 60)
      nextUp = `${next[1]} earned at ${next[0]}h worked (~${String(Math.floor(atMin / 60) % 24).padStart(2, '0')}:${String(atMin % 60).padStart(2, '0')})`
    }
  }

  const todays = shifts.filter(s => s.date === today)

  return (
    <>
      <div style={card}>
        <h2 style={h2}>Punch Clock</h2>
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
          <select value={empId} onChange={e => setEmpId(e.target.value)} style={{ background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.5rem', fontSize: '0.9rem' }}>
            {EMPLOYEES.map(e => <option key={e.id} value={e.id}>{e.name} — {e.role}</option>)}
          </select>
          <span style={{ color: C.tan, fontSize: '0.9rem', fontVariantNumeric: 'tabular-nums' }}>{dateLabel(today)} · {now ?? '--:--'} MT</span>
        </div>

        {!open && <button style={btn(C.green)} onClick={clockIn} disabled={!now}>Clock In</button>}

        {open && calc && (
          <>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
              <Stat label="Status" value={onLunch ? 'At lunch' : 'Working'} color={onLunch ? C.amber : C.green} sub={`In at ${open.clockIn}`} />
              <Stat label="Paid hours so far" value={fmtHours(calc.workedHours)} />
              <Stat label="Breaks earned" value={`${calc.owed.paidBreaks} × 15 min`} sub={calc.owed.lunch ? '+ 30-min lunch' : 'no lunch yet'} />
            </div>
            <div style={{ marginBottom: '0.8rem' }}>
              <EntitlementPills owed={calc.owed} taken={open.breaksTaken} lunchTaken={!!open.lunchEnd} />
              {nextUp && <div style={{ color: C.tan, fontSize: '0.82rem', marginTop: 6 }}>Next: {nextUp}</div>}
            </div>
            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              {!onLunch && <button style={btn(C.blue)} onClick={() => update({ breaksTaken: open.breaksTaken + 1 })}>Log 15-min Break (paid)</button>}
              {!open.lunchStart && <button style={btn(C.amber)} onClick={() => update({ lunchStart: nowHHMM })}>Start Lunch</button>}
              {onLunch && <button style={btn(C.amber)} onClick={() => update({ lunchEnd: nowHHMM })}>End Lunch</button>}
              {!onLunch && <button style={btn(C.red)} onClick={() => update({ clockOut: nowHHMM })}>Clock Out</button>}
            </div>
          </>
        )}
      </div>

      <div style={card}>
        <h2 style={h2}>On the clock today</h2>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Employee</th><th style={th}>In</th><th style={th}>Lunch</th><th style={th}>Out</th><th style={th}>Paid hrs</th><th style={th}>Breaks</th></tr></thead>
            <tbody>
              {todays.length === 0 && <tr><td style={td} colSpan={6}>Nobody yet.</td></tr>}
              {todays.map(s => {
                const c = calcShift(s, nowHHMM)
                return (
                  <tr key={s.id}>
                    <td style={td}>{EMPLOYEES.find(e => e.id === s.empId)?.name}</td>
                    <td style={td}>{s.clockIn}</td>
                    <td style={td}>{s.lunchStart ? `${s.lunchStart}–${s.lunchEnd ?? '…'}` : '—'}</td>
                    <td style={td}>{s.clockOut ?? <Pill color={C.green}>on clock</Pill>}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtHours(c.workedHours)}</td>
                    <td style={td}><EntitlementPills owed={c.owed} taken={s.breaksTaken} lunchTaken={!!s.lunchEnd} /></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

// ── Timesheets ──────────────────────────────────────────────────────────────

function TimesheetTab({ shifts, thisMonday }: { shifts: Shift[]; thisMonday: string }) {
  const weekStart = addDaysISO(thisMonday, -7)
  const weekEnd = addDaysISO(weekStart, 6)
  const [empId, setEmpId] = useState<string>('all')
  const week = shifts.filter(s => s.date >= weekStart && s.date <= weekEnd && s.clockOut)
  const shown = EMPLOYEES.filter(e => empId === 'all' || e.id === empId)

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
        <span style={{ color: C.tan, fontSize: '0.9rem' }}>
          Pay week {dateLabel(weekStart, { month: 'short', day: 'numeric' })} – {dateLabel(weekEnd, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <select value={empId} onChange={e => setEmpId(e.target.value)} style={{ background: C.dark, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.4rem', fontSize: '0.85rem' }}>
          <option value="all">All employees</option>
          {EMPLOYEES.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      {shown.map(e => {
        const rows = week.filter(s => s.empId === e.id).sort((a, b) => a.date.localeCompare(b.date))
        if (rows.length === 0) return null
        const calcs = rows.map(s => calcShift(s))
        const total = calcs.reduce((t, c) => t + c.workedHours, 0)
        const { regular, overtime } = splitOvertime(total)
        const gross = regular * e.wage + overtime * e.wage * 1.5
        const paidBreakHrs = rows.reduce((t, s) => t + s.breaksTaken * BREAK_RULES.paidBreakMinutes / 60, 0)
        const years = yearsOfService(e.hireDate, weekEnd)
        const ptoThisWeek = total * accrualPerHour(years)
        const flagCount = calcs.reduce((t, c) => t + c.flags.length, 0)

        return (
          <div key={e.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={h2}>{e.name} <span style={{ color: C.lightBrown, fontSize: '0.75rem', textTransform: 'none' }}>· {e.role} · ${e.wage.toFixed(2)}/hr</span></h2>
              {flagCount > 0 ? <Pill color={C.amber}>{flagCount} to review</Pill> : <Pill color={C.green}>Clean</Pill>}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead><tr><th style={th}>Day</th><th style={th}>In</th><th style={th}>Lunch</th><th style={th}>Out</th><th style={th}>Paid hrs</th><th style={th}>Breaks</th><th style={th}>Notes</th></tr></thead>
                <tbody>
                  {rows.map((s, i) => {
                    const c = calcs[i]
                    return (
                      <tr key={s.id}>
                        <td style={td}>{dateLabel(s.date, { weekday: 'short', month: 'numeric', day: 'numeric' })}</td>
                        <td style={td}>{s.clockIn}</td>
                        <td style={td}>{s.lunchStart ? `${s.lunchStart}–${s.lunchEnd}` : '—'}</td>
                        <td style={td}>{s.clockOut}</td>
                        <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtHours(c.workedHours)}</td>
                        <td style={td}><EntitlementPills owed={c.owed} taken={s.breaksTaken} lunchTaken={c.lunchHours > 0} /></td>
                        <td style={{ ...td, color: C.amber, fontSize: '0.78rem', maxWidth: 280 }}>{c.flags.join(' ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
              <Stat label="Paid hours" value={fmtHours(total)} sub={`incl. ${fmtHours(paidBreakHrs)} paid breaks`} />
              <Stat label="Regular" value={fmtHours(regular)} />
              <Stat label="Overtime 1.5×" value={fmtHours(overtime)} color={overtime > 0 ? C.amber : C.cream} />
              <Stat label="Est. gross" value={`$${gross.toFixed(2)}`} />
              <Stat label="PTO earned" value={`${ptoThisWeek.toFixed(2)} h`} sub={`at ${annualPtoRate(years)} h / 2080`} color={C.green} />
            </div>
          </div>
        )
      })}
    </>
  )
}

// ── PTO ─────────────────────────────────────────────────────────────────────

function PtoTab({ today, thisMonday }: { today: string; thisMonday: string }) {
  const rows = useMemo(() => EMPLOYEES.map(e => {
    const history = mockHistory(e, thisMonday)
    const hours = history.reduce((t, w) => t + w.hours, 0)
    const earned = ptoEarned(e.hireDate, history)
    const years = yearsOfService(e.hireDate, today)
    const nextAnniv = nextAnniversary(e.hireDate, today)
    return { e, hours, earned, years, nextAnniv, balance: earned - e.ptoUsed }
  }), [today, thisMonday])

  const [calcHours, setCalcHours] = useState(2080)
  const serviceYears = [0, 1, 2, 3, 4, 5, 10, 15, 20]
  const hourCols = [1040, 1600, 2080, 2400]

  return (
    <>
      <div style={card}>
        <h2 style={h2}>Balances · last 52 weeks</h2>
        <p style={{ color: C.tan, fontSize: '0.8rem', margin: '0 0 0.6rem' }}>
          Every hour worked earns PTO at the employee&apos;s current rate. The rate goes up 8 h/yr on each work anniversary, so it&apos;s +40 every 5 years.
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr>
              <th style={th}>Employee</th><th style={th}>Hired</th><th style={th}>Service</th><th style={th}>Rate now</th>
              <th style={th}>Hrs worked</th><th style={th}>Earned</th><th style={th}>Used</th><th style={th}>Balance</th><th style={th}>Next bump</th>
            </tr></thead>
            <tbody>
              {rows.map(({ e, hours, earned, years, nextAnniv, balance }) => (
                <tr key={e.id}>
                  <td style={td}>{e.name}<div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>{e.role}</div></td>
                  <td style={td}>{dateLabel(e.hireDate, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={td}>{years} yr</td>
                  <td style={td}>{annualPtoRate(years)} h / 2080</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{earned.toFixed(1)}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{e.ptoUsed.toFixed(1)}</td>
                  <td style={{ ...td, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>{balance.toFixed(1)} h</td>
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

// ── Policy ──────────────────────────────────────────────────────────────────

function PolicyTab() {
  const p: React.CSSProperties = { color: C.tan, fontSize: '0.85rem', lineHeight: 1.6, margin: '0 0 0.5rem' }
  return (
    <>
      <div style={card}>
        <h2 style={h2}>Breaks</h2>
        <table style={{ borderCollapse: 'collapse', marginBottom: '0.8rem' }}>
          <thead><tr><th style={th}>Paid hours worked</th><th style={th}>Break</th><th style={th}>Paid?</th></tr></thead>
          <tbody>
            <tr><td style={td}>{BREAK_RULES.firstPaidBreakAt}+</td><td style={td}>15-min rest break</td><td style={td}>Paid</td></tr>
            <tr><td style={td}>{BREAK_RULES.lunchAt}+</td><td style={td}>30-min lunch</td><td style={td}>Unpaid (must be fully off duty)</td></tr>
            <tr><td style={td}>{BREAK_RULES.secondPaidBreakAt}+</td><td style={td}>Second 15-min rest break</td><td style={td}>Paid</td></tr>
          </tbody>
        </table>
        <p style={p}><b style={{ color: C.cream }}>Montana law:</b> Montana doesn&apos;t require meal or rest breaks for adult employees. It follows the federal rule, so this schedule is company policy, not a legal requirement. It&apos;s a good policy, and similar to Washington&apos;s and Oregon&apos;s.</p>
        <p style={p}><b style={{ color: C.cream }}>The rules that are law</b> (federal FLSA): a break of 5–20 minutes must be paid. A lunch can be unpaid only if it&apos;s at least 30 minutes and the employee is fully relieved of duty. A lunch that runs short or gets interrupted is paid time, and the timesheet treats it that way.</p>
        <p style={p}>Paid 15s don&apos;t need a punch because they&apos;re on the clock. Lunch is punched, because it comes off the paid hours.</p>
      </div>
      <div style={card}>
        <h2 style={h2}>PTO</h2>
        <p style={p}>Every paid hour worked, overtime included, earns PTO. Year 1 is {PTO_RULES.baseAnnual} h per {PTO_RULES.fullTimeHours} worked ({(PTO_RULES.baseAnnual / PTO_RULES.fullTimeHours).toFixed(4)} per hour). Each work anniversary adds {PTO_RULES.stepPerYear} h to that rate, so it&apos;s 80 at 5 years, 120 at 10 and 160 at 15.</p>
        <p style={p}><b style={{ color: C.cream }}>Montana law:</b> earned vacation counts as wages. Use-it-or-lose-it isn&apos;t allowed, and any unused balance has to be paid out when someone leaves. A cap on how much a balance can build up <i>is</i> allowed. That&apos;s what keeps long-tenured balances from growing without limit.</p>
      </div>
    </>
  )
}
