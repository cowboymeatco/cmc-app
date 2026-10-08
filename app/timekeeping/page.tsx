'use client'
// /timekeeping — the time clock, schedule, time off, PTO and payroll export.
//
// Two ways in:
//   /timekeeping?kiosk=1 — the iPad at the employee entrance. The punch clock
//     and nothing else; each person signs in with their own PIN.
//   /timekeeping — the manager side, behind the /exec passphrase.
//
// The rules live in lib/timekeeping.ts (breaks, UPTO, PTO accrual) and
// lib/timeclock.ts (schedule, time off, balances); the data in the tk_* tables.
// Not on the dashboard yet — Charlie is testing it first.

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { isoDate, isoDateTime, mondayOfISO } from '@/lib/dates'
import { Shift } from '@/lib/timekeeping'
import { Schedule, TimeOffRequest, TkEmployee, ptoSummary } from '@/lib/timeclock'
import { C, api, btn, card, h2 } from './shared'
import { KioskClock } from './Clock'
import { TimesheetTab } from './TimesheetTab'
import { ScheduleTab } from './ScheduleTab'
import { PayrollTab } from './PayrollTab'
import { PtoTab } from './PtoTab'
import { EmployeesTab } from './EmployeesTab'
import { PolicyTab } from './PolicyTab'

type Tab = 'clock' | 'timesheet' | 'schedule' | 'payroll' | 'pto' | 'employees' | 'policy'

interface Data {
  employees: TkEmployee[]
  shifts: (Shift & { editedAt: string | null; editNote: string | null })[]
  schedule: Schedule
  requests: TimeOffRequest[]
  photos: Record<string, string>
  shiftsFrom: string
  setupPinSet: boolean
}

export default function TimekeepingPage() {
  // ?kiosk=1 is what the iPad at the employee entrance opens.
  const [mode, setMode] = useState<'loading' | 'kiosk' | 'manager'>('loading')
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL after mount; reading it during render would mismatch the server HTML
    setMode(new URLSearchParams(window.location.search).get('kiosk') === '1' ? 'kiosk' : 'manager')
  }, [])

  if (mode === 'loading') return <div style={{ minHeight: '100vh', background: C.darkBrown }} />
  if (mode === 'kiosk') {
    return (
      <div style={{ minHeight: '100vh', background: C.darkBrown, padding: '1.5rem 1rem' }}>
        <div style={{ textAlign: 'center', fontFamily: 'Georgia, serif', fontSize: '1.6rem', fontWeight: 700, color: C.cream, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '1.2rem' }}>
          Cowboy Meat Co · Time Clock
        </div>
        <KioskClock />
      </div>
    )
  }
  return <Manager />
}

function Manager() {
  const [today, setToday] = useState(() => isoDate())
  const [now, setNow] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => { setNow(isoDateTime().slice(11)); setToday(isoDate()) }
    tick()
    const t = setInterval(tick, 20_000)
    return () => clearInterval(t)
  }, [])
  const thisMonday = mondayOfISO(today)

  const [tab, setTab] = useState<Tab>('timesheet')
  const [data, setData] = useState<Data | null>(null)
  const [needLogin, setNeedLogin] = useState(false)
  const [error, setError] = useState('')

  const reload = useCallback(async () => {
    try {
      setData(await api<Data>('/api/timekeeping/data'))
      setNeedLogin(false); setError('')
    } catch (e) {
      if ((e as { status?: number }).status === 401) setNeedLogin(true)
      else setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading on mount; state is only set once the request resolves
    reload()
  }, [reload])

  const header = (
    <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.25rem', minHeight: 72, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
      <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
      <div>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Timekeeping</h1>
        <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>Time clock · schedule · PTO · payroll</p>
      </div>
    </header>
  )

  if (needLogin) return <div style={{ minHeight: '100vh', background: C.darkBrown }}>{header}<Login onDone={reload} /></div>
  if (!data) {
    return (
      <div style={{ minHeight: '100vh', background: C.darkBrown }}>
        {header}
        <div style={{ padding: '2rem', color: error ? C.red : C.tan, textAlign: 'center' }}>{error || 'Loading…'}</div>
      </div>
    )
  }

  const waiting = data.requests.filter(r => r.status === 'pending').length
  const freePto = (e: TkEmployee) => ptoSummary(e, data.shifts, data.requests, today, now ?? '00:00').free
  const tabs: { key: Tab; label: string }[] = [
    { key: 'clock', label: '⏱ Time Clock' },
    { key: 'timesheet', label: '📋 Timesheets' },
    { key: 'schedule', label: `📅 Schedule${waiting ? ` (${waiting})` : ''}` },
    { key: 'payroll', label: '💵 Payroll' },
    { key: 'pto', label: '🌴 PTO' },
    { key: 'employees', label: '👤 Employees' },
    { key: 'policy', label: '📖 Policy' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      {header}
      <nav style={{ display: 'flex', gap: 4, padding: '0.75rem 1.25rem 0', flexWrap: 'wrap', maxWidth: 1100, margin: '0 auto' }}>
        {tabs.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)} style={{
            background: tab === t.key ? C.medBrown : 'transparent', color: tab === t.key ? C.cream : C.tan,
            border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.5rem 0.9rem', fontSize: '0.85rem', cursor: 'pointer', fontWeight: 600,
          }}>{t.label}</button>
        ))}
        <a href="/timekeeping?kiosk=1" style={{ marginLeft: 'auto', alignSelf: 'center', color: C.tan, fontSize: '0.8rem' }}>Open iPad kiosk view ↗</a>
      </nav>

      <main style={{ padding: '1rem 1.25rem 3rem', maxWidth: 1100, margin: '0 auto' }}>
        {error && <div style={{ color: C.red, marginBottom: '0.6rem' }}>{error}</div>}
        {tab === 'clock'     && <KioskClock onChange={reload} />}
        {tab === 'timesheet' && <TimesheetTab employees={data.employees} shifts={data.shifts} photos={data.photos} thisMonday={thisMonday} today={today} now={now} earliest={data.shiftsFrom} reload={reload} />}
        {tab === 'schedule'  && <ScheduleTab employees={data.employees} schedule={data.schedule} requests={data.requests} thisMonday={thisMonday} today={today} freePto={freePto} reload={reload} />}
        {tab === 'payroll'   && <PayrollTab employees={data.employees} shifts={data.shifts} requests={data.requests} thisMonday={thisMonday} today={today} now={now} earliest={data.shiftsFrom} />}
        {tab === 'pto'       && <PtoTab employees={data.employees} shifts={data.shifts} requests={data.requests} today={today} now={now} />}
        {tab === 'employees' && <EmployeesTab employees={data.employees} today={today} setupPinSet={data.setupPinSet} reload={reload} />}
        {tab === 'policy'    && <PolicyTab />}
      </main>
    </div>
  )
}

/** The /exec passphrase — same gate, same 30-day session. */
function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await api('/api/exec/login', { method: 'POST', body: JSON.stringify({ pass }) }); await onDone() }
    catch (x) { setErr((x as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} style={{ ...card, maxWidth: 380, margin: '3rem auto', textAlign: 'center' }}>
      <h2 style={h2}>Manager sign-in</h2>
      <p style={{ color: C.tan, fontSize: '0.85rem', margin: '0 0 0.8rem' }}>Same passphrase as the executive suite. Employees punch at the iPad instead.</p>
      <input type="password" value={pass} onChange={e => setPass(e.target.value)} autoFocus placeholder="Passphrase"
        style={{ width: '100%', background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.6rem', fontSize: '1rem', marginBottom: '0.6rem' }} />
      {err && <div style={{ color: C.red, fontSize: '0.85rem', marginBottom: '0.6rem' }}>{err}</div>}
      <button type="submit" style={btn(C.green)} disabled={busy || !pass}>{busy ? 'Checking…' : 'Sign in'}</button>
    </form>
  )
}
