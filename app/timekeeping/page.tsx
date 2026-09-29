'use client'
// /timekeeping — payroll timekeeping MOCKUP. Nothing here touches the
// database: employees, punches and hours history are made up and live in
// React state, so a refresh resets everything. The rules themselves live in
// lib/timekeeping.ts so a real build can reuse them as-is.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { isoDate, isoDateTime, addDaysISO, mondayOfISO, dateLabel } from '@/lib/dates'
import { LabelRoll, parseRoll, rollFrameCSS, rollPrintScript } from '@/lib/label'
import {
  BREAK_RULES, MAX_PAID_BREAK_MINUTES, PTO_RULES, Shift, ShiftCalc,
  calcShift, splitOvertime, fmtHours, toMin, shiftSegments, fmt12, Segment,
  yearsOfService, annualPtoRate, accrualPerHour, nextAnniversary, ptoEarned,
} from '@/lib/timekeeping'
import { C, Employee, EMPLOYEES, mockHistory, ptoBalance, card, h2, th, td, bigBtn, Pill, Stat } from './shared'
import { PayrollTab } from './PayrollTab'
import { Schedule, TimeOffRequest, mockSchedule, mockRequests, ptoHolds, ScheduleTab, MySchedule } from './ScheduleTab'

/** A week of punches per employee. A few are deliberately off-policy so the flags show. */
function mockShifts(thisMonday: string, today: string): Shift[] {
  const shifts: Shift[] = []
  // Last week Mon–Fri, plus any weekdays of this week before today.
  const days = [0, 1, 2, 3, 4].map(d => addDaysISO(thisMonday, d - 7))
    .concat([0, 1, 2, 3, 4].map(d => addDaysISO(thisMonday, d)).filter(d => d < today))
  let n = 0
  const add = (empId: string, date: string, clockIn: string, clockOut: string | null, lunch: [string, string] | null, breaks: [string, string][]) =>
    shifts.push({ id: `s${n++}`, empId, date, clockIn, clockOut, lunchStart: lunch?.[0] ?? null, lunchEnd: lunch?.[1] ?? null,
      breaks: breaks.map(([start, end]) => ({ start, end })) })

  days.forEach((d, j) => {
    const i = j % 5
    add('e1', d, '07:00', '15:30', ['11:30', '12:00'], [['09:30', '09:45'], ['14:00', '14:15']])
    // Wednesday: one 37-min break on a 10-hour shift → 30 paid, 7 min UPTO.
    add('e2', d, '06:00', i === 4 ? '13:00' : '16:00', ['11:00', '11:30'],
      i === 2 ? [['09:00', '09:37']] : i === 4 ? [['08:30', '08:45']] : [['08:30', '08:45'], ['13:30', '13:45']])
    // Last Thursday C was out on PTO, and last Wednesday E took an unpaid day (see mockRequests).
    if (i < 4 && j !== 3) add('e3', d, '08:00', i === 1 ? '14:30' : '15:00', i === 1 ? null : ['12:00', '12:20'], [['10:00', '10:15']])
    add('e4', d, '06:30', '15:00', ['11:30', '12:00'], [['09:00', '09:15'], ['13:30', '13:45']])
    if (i % 2 === 0 && j !== 2) add('e5', d, '16:00', '20:15', null, i === 0 ? [] : [['18:00', '18:15']])
  })
  // Today, in progress, for the clock tab.
  add('e1', today, '07:00', null, null, [])
  add('e2', today, '06:00', null, null, [])
  return shifts
}

// ── Page ────────────────────────────────────────────────────────────────────

type Tab = 'clock' | 'timesheet' | 'schedule' | 'payroll' | 'pto' | 'policy'

/**
 * PTO on the books right now: through last week, plus what this week's
 * punches have earned so far, minus PTO days taken through the app.
 */
function ptoNow(e: Employee, shifts: Shift[], requests: TimeOffRequest[], thisMonday: string, today: string, nowHHMM: string): number {
  const thisWeek = shifts
    .filter(s => s.empId === e.id && s.date >= thisMonday && s.date <= today)
    .reduce((t, s) => t + calcShift(s, nowHHMM).workedHours * accrualPerHour(yearsOfService(e.hireDate, s.date)), 0)
  return ptoBalance(e, thisMonday) + thisWeek - ptoHolds(e.id, requests, today).taken
}

export default function TimekeepingPage() {
  const today = isoDate()
  const thisMonday = mondayOfISO(today)
  const [tab, setTab] = useState<Tab>('clock')
  const [shifts, setShifts] = useState<Shift[]>(() => mockShifts(thisMonday, today))
  // Punch photos from the kiosk's front camera, keyed `${shiftId}:${punch}`.
  const [photos, setPhotos] = useState<Record<string, string>>({})
  const [schedule, setSchedule] = useState<Schedule>(() => mockSchedule(thisMonday))
  const [requests, setRequests] = useState<TimeOffRequest[]>(() => mockRequests(thisMonday, today))

  // ?kiosk=1 is what the iPad at the employee entrance opens: the punch clock
  // and nothing else — no tabs, no one else's hours, no way back to the app.
  const [kiosk, setKiosk] = useState(false)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- reading the URL after mount; reading it during render would mismatch the server HTML
    setKiosk(new URLSearchParams(window.location.search).get('kiosk') === '1')
  }, [])

  // Shop-clock HH:MM, ticking. Starts null so server and browser render alike.
  const [now, setNow] = useState<string | null>(null)
  useEffect(() => {
    const tick = () => setNow(isoDateTime().slice(11))
    tick()
    const t = setInterval(tick, 20_000)
    return () => clearInterval(t)
  }, [])

  const waiting = requests.filter(r => r.status === 'pending').length
  const freePto = (e: Employee) => {
    const h = ptoHolds(e.id, requests, today)
    return ptoNow(e, shifts, requests, thisMonday, today, now ?? '00:00') - h.booked - h.pending
  }
  const tabs: { key: Tab; label: string }[] = [
    { key: 'clock', label: '⏱ Time Clock' },
    { key: 'timesheet', label: '📋 Timesheets' },
    { key: 'schedule', label: `📅 Schedule${waiting ? ` (${waiting})` : ''}` },
    { key: 'payroll', label: '💵 Payroll' },
    { key: 'pto', label: '🌴 PTO' },
    { key: 'policy', label: '📖 Policy' },
  ]

  if (kiosk) {
    return (
      <div style={{ minHeight: '100vh', background: C.darkBrown, padding: '1.5rem 1rem' }}>
        <div style={{ textAlign: 'center', fontFamily: 'Georgia, serif', fontSize: '1.6rem', fontWeight: 700, color: C.cream, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '1.2rem' }}>
          Cowboy Meat Co · Time Clock
        </div>
        <ClockTab shifts={shifts} setShifts={setShifts} setPhotos={setPhotos} today={today} thisMonday={thisMonday} now={now} schedule={schedule} requests={requests} setRequests={setRequests} />
      </div>
    )
  }

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
        <a href="/timekeeping?kiosk=1" style={{ marginLeft: 'auto', alignSelf: 'center', color: C.tan, fontSize: '0.8rem' }}>Open iPad kiosk view ↗</a>
      </nav>

      <main style={{ padding: '1rem 1.25rem 3rem', maxWidth: 1100, margin: '0 auto' }}>
        {tab === 'clock'     && <ClockTab shifts={shifts} setShifts={setShifts} setPhotos={setPhotos} today={today} thisMonday={thisMonday} now={now} schedule={schedule} requests={requests} setRequests={setRequests} />}
        {tab === 'timesheet' && <TimesheetTab shifts={shifts} photos={photos} thisMonday={thisMonday} today={today} now={now} />}
        {tab === 'schedule'  && <ScheduleTab schedule={schedule} setSchedule={setSchedule} requests={requests} setRequests={setRequests} thisMonday={thisMonday} today={today} freePto={freePto} />}
        {tab === 'payroll'   && <PayrollTab shifts={shifts} requests={requests} thisMonday={thisMonday} today={today} now={now} />}
        {tab === 'pto'       && <PtoTab today={today} thisMonday={thisMonday} requests={requests} />}
        {tab === 'policy'    && <PolicyTab />}
      </main>
    </div>
  )
}

function BreakPills({ c }: { c: ShiftCalc }) {
  const allowance = c.owed.paidBreaks * BREAK_RULES.paidBreakMinutes
  if (allowance === 0 && !c.owed.lunch && c.breakMinutes === 0) return <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>none yet</span>
  const tookLunch = c.lunchUnpaid && c.lunchMinutes > 0
  return (
    <>
      {(allowance > 0 || c.breakMinutes > 0) && (
        <Pill color={c.uptoMinutes > 0 ? C.red : c.breakMinutes === allowance ? C.green : C.amber}>
          Breaks {c.breakMinutes}/{allowance} min
        </Pill>
      )}
      {c.uptoMinutes > 0 && <Pill color={C.red}>{c.uptoMinutes} min UPTO</Pill>}
      {c.owed.lunch && <Pill color={tookLunch ? C.green : C.amber}>Lunch {tookLunch ? '✓' : 'owed'}</Pill>}
    </>
  )
}

/** "09:30–09:45, 14:00–14:15" */
function breakTimes(s: Shift): string {
  return s.breaks.length ? s.breaks.map(b => `${b.start}–${b.end ?? '…'}`).join(', ') : '—'
}

// ── Time clock ──────────────────────────────────────────────────────────────
//
// A shared kiosk: nobody picks a name. You punch in with your own PIN, the
// clock acts only on YOUR shift, and it signs you back out after a few idle
// seconds so the next person can't punch on your session.

const IDLE_SIGN_OUT_MS = 20_000
const IDLE_SCHEDULE_MS = 90_000
const MAX_PIN_TRIES = 3
const LOCKOUT_MS = 30_000
const ROLL_KEY = 'timeclockLabelRoll' // per device, like the scanner's printer pick

function ClockTab({ shifts, setShifts, setPhotos, today, thisMonday, now, schedule, requests, setRequests }: {
  shifts: Shift[]; setShifts: React.Dispatch<React.SetStateAction<Shift[]>>
  setPhotos: React.Dispatch<React.SetStateAction<Record<string, string>>>
  today: string; thisMonday: string; now: string | null
  schedule: Schedule; requests: TimeOffRequest[]; setRequests: React.Dispatch<React.SetStateAction<TimeOffRequest[]>>
}) {
  const [empId, setEmpId] = useState<string | null>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [tries, setTries] = useState(0)
  const [locked, setLocked] = useState(false)
  const [notice, setNotice] = useState('')
  const [activity, setActivity] = useState(0)   // bumps on every tap, restarts the idle timer
  const [roll, setRoll] = useState<LabelRoll>('4in')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring this device's printer after mount; reading it during render would mismatch the server HTML
    try { setRoll(parseRoll(localStorage.getItem(ROLL_KEY))) } catch { /* private browsing */ }
  }, [])
  const pickRoll = (r: LabelRoll) => {
    setRoll(r)
    try { localStorage.setItem(ROLL_KEY, r) } catch { /* private browsing */ }
  }

  const [showSched, setShowSched] = useState(false)
  const signOut = () => { setEmpId(null); setPin(''); setNotice(''); setShowSched(false) }

  // Front camera snaps a small photo at every punch. A PIN can be shared; a
  // face on the timesheet can't. If the camera is off or denied the punch
  // still goes through — it just shows "no photo" to the manager.
  const videoRef = useRef<HTMLVideoElement>(null)
  const [camOk, setCamOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (!empId) return
    let stream: MediaStream | null = null
    let cancelled = false
    const media = navigator.mediaDevices
      ? navigator.mediaDevices.getUserMedia({ video: { facingMode: 'user', width: 320, height: 240 }, audio: false })
      : Promise.reject(new Error('no camera API'))
    media
      .then(s => {
        if (cancelled) { s.getTracks().forEach(t => t.stop()); return }
        stream = s
        if (videoRef.current) { videoRef.current.srcObject = s; videoRef.current.play().catch(() => {}) }
        setCamOk(true)
      })
      .catch(() => setCamOk(false))
    return () => { cancelled = true; stream?.getTracks().forEach(t => t.stop()) }
  }, [empId])

  const snap = (shiftId: string, punch: string) => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return
    const c = document.createElement('canvas')
    c.width = 160; c.height = Math.round(160 * v.videoHeight / v.videoWidth)
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
    const url = c.toDataURL('image/jpeg', 0.6)
    setPhotos(p => ({ ...p, [`${shiftId}:${punch}`]: url }))
  }

  // Walk away and it signs you out.
  useEffect(() => {
    if (!empId) return
    // Filling in a time-off request takes longer than a punch.
    const t = setTimeout(signOut, showSched ? IDLE_SCHEDULE_MS : IDLE_SIGN_OUT_MS)
    return () => clearTimeout(t)
  }, [empId, activity, showSched])


  const submitPin = (entered: string) => {
    const match = EMPLOYEES.find(e => e.pin === entered)
    setPin('')
    if (match) { setEmpId(match.id); setTries(0); setPinError(''); setNotice(''); setActivity(a => a + 1); return }
    const n = tries + 1
    setTries(n)
    if (n >= MAX_PIN_TRIES) {
      setLocked(true); setTries(0)
      setTimeout(() => { setLocked(false); setPinError('') }, LOCKOUT_MS)
      setPinError(`Too many wrong PINs. Keypad locked for ${LOCKOUT_MS / 1000} seconds.`)
    } else setPinError('PIN not recognized.')
  }

  const press = (k: string) => {
    if (locked) return
    if (k === 'clear') { setPin(''); return }
    const next = (pin + k).slice(0, 4)
    setPin(next)
    if (next.length === 4) submitPin(next)
  }

  // ── Keypad (nobody signed in) ──
  if (!empId) {
    return (
      <div style={{ ...card, maxWidth: 440, margin: '0 auto', textAlign: 'center', padding: '1.5rem' }}>
        <h2 style={h2}>Punch Clock</h2>
        <div style={{ color: C.tan, fontSize: '0.9rem', marginBottom: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>{dateLabel(today)} · {now ?? '--:--'} MT</div>
        <div style={{ color: C.cream, marginBottom: 6 }}>Enter your PIN</div>
        <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: '0.8rem' }}>
          {[0, 1, 2, 3].map(i => (
            <span key={i} style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${C.tan}`, background: i < pin.length ? C.tan : 'transparent' }} />
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, maxWidth: 340, margin: '0 auto' }}>
          {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0'].map(k => (
            <button key={k} onClick={() => press(k)} disabled={locked} style={{
              gridColumn: k === '0' ? 'span 2' : undefined, background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`,
              borderRadius: 10, padding: '1.2rem 0', fontSize: k === 'clear' ? '1rem' : '1.8rem', touchAction: 'manipulation', fontWeight: 700, cursor: locked ? 'not-allowed' : 'pointer', opacity: locked ? 0.4 : 1,
            }}>{k === 'clear' ? 'Clear' : k}</button>
          ))}
        </div>
        {pinError && <div style={{ color: C.red, fontSize: '0.85rem', marginTop: '0.7rem' }}>{pinError}</div>}
        <div style={{ color: C.lightBrown, fontSize: '0.72rem', marginTop: '1rem' }}>
          Mockup PINs: A 1111 · B 2222 · C 3333 · D 4444 · E 5555
        </div>
      </div>
    )
  }

  // ── Signed in: only your own shift ──
  const emp = EMPLOYEES.find(e => e.id === empId)!
  const open = shifts.find(s => s.empId === empId && s.date === today && !s.clockOut)
  const onLunch = !!open?.lunchStart && !open.lunchEnd
  const openBreak = open?.breaks.find(b => !b.end)
  const onBreak = !!openBreak
  const nowHHMM = now ?? '00:00'
  const rate = accrualPerHour(yearsOfService(emp.hireDate, today))

  const todays = shifts.filter(s => s.empId === empId && s.date === today)
  const todayCalcs = todays.map(s => calcShift(s, nowHHMM))
  const todayHours = todayCalcs.reduce((t, c) => t + c.workedHours, 0)
  const todayUpto = todayCalcs.reduce((t, c) => t + c.uptoMinutes, 0)
  const todayLunch = todayCalcs.reduce((t, c) => t + (c.lunchUnpaid ? c.lunchMinutes : 0), 0)
  const todayBreakMin = todayCalcs.reduce((t, c) => t + c.breakMinutes, 0)

  const touch = (msg: string) => { setNotice(msg); setActivity(a => a + 1) }
  const update = (patch: Partial<Shift>, msg: string, punch?: string) => {
    if (punch) snap(open!.id, punch)
    setShifts(ss => ss.map(s => s.id === open!.id ? { ...s, ...patch } : s))
    touch(msg)
  }
  const clockIn = () => {
    const id = `s-${empId}-${today}-${nowHHMM}`
    snap(id, 'in')
    setShifts(ss => [...ss, { id, empId, date: today, clockIn: nowHHMM, clockOut: null, lunchStart: null, lunchEnd: null, breaks: [] }])
    touch(`Clocked in at ${nowHHMM}.`)
  }
  const clockOut = () => {
    const c = calcShift({ ...open!, clockOut: nowHHMM })
    const parts = [
      `Paid today: ${fmtHours(todayHours)}.`,
      c.lunchUnpaid && c.lunchMinutes > 0 ? `Lunch ${c.lunchMinutes} min (unpaid).` : '',
      c.breakMinutes > 0 ? `Breaks ${c.breakMinutes} min: ${c.paidBreakMinutes} paid${c.uptoMinutes ? `, ${c.uptoMinutes} min UPTO` : ''}.` : '',
      `You earned ${(todayHours * rate).toFixed(2)} h of PTO.`,
    ].filter(Boolean)
    update({ clockOut: nowHHMM }, `Clocked out at ${nowHHMM}. ${parts.join(' ')}`, 'out')
  }

  // Break time is a daily total, settled at clock-out: 15 paid min per break
  // earned (30 on an 8+ hour day), split however they like. The kiosk says
  // so at every break — that notice is what lets UPTO go unpaid.
  const startBreak = () => {
    const i = open!.breaks.length
    update({ breaks: [...open!.breaks, { start: nowHHMM, end: null }] },
      `Break started at ${nowHHMM}. You've used ${todayBreakMin} break min today. Paid break time is 15 min per break earned — 30 min on an 8+ hour day — taken however you like. Anything over is UPTO (unpaid), figured when you clock out.`,
      `break-out-${i}`)
  }
  const endBreak = () => {
    const i = open!.breaks.length - 1
    const mins = toMin(nowHHMM) - toMin(openBreak!.start)
    const total = todayBreakMin
    const breaks = open!.breaks.map(b => b === openBreak ? { ...b, end: nowHHMM } : b)
    update({ breaks },
      `Back from break at ${nowHHMM}: ${mins} min. ${total} break min used today${total > MAX_PAID_BREAK_MINUTES ? ` — ${total - MAX_PAID_BREAK_MINUTES} min over 30 will be UPTO` : ''}.`,
      `break-in-${i}`)
  }

  const calc = open ? calcShift(open, nowHHMM) : null
  const breakSoFar = openBreak ? toMin(nowHHMM) - toMin(openBreak.start) : 0

  let nextUp: string | null = null
  if (calc && !onLunch && !onBreak) {
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

  const ptoOnBooks = ptoNow(emp, shifts, requests, thisMonday, today, nowHHMM)
  const holds = ptoHolds(emp.id, requests, today)
  const freePto = ptoOnBooks - holds.booked - holds.pending

  const print = (range: 'day' | 'week' | 'lastweek') => {
    touch('Printing…')
    const [from, to] = range === 'day' ? [today, today]
      : range === 'week' ? [thisMonday, today]
      : [addDaysISO(thisMonday, -7), addDaysISO(thisMonday, -1)]
    const years = yearsOfService(emp.hireDate, today)
    const accrual: Accrual = {
      balance: ptoOnBooks,
      booked: holds.booked,
      pending: holds.pending,
      usedYtd: emp.ptoUsed + holds.taken,
      years,
      annual: annualPtoRate(years),
      perHour: accrualPerHour(years),
      nextBump: nextAnniversary(emp.hireDate, today),
      nextAnnual: annualPtoRate(years + 1),
    }
    const html = buildSummaryHTML(emp, shifts.filter(s => s.empId === emp.id && s.date >= from && s.date <= to),
      from, to, range === 'day' ? 'Day' : 'Week', nowHHMM, accrual, roll)
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  return (
    <div style={{ ...card, maxWidth: 720, margin: '0 auto', padding: '1.4rem' }} onClick={() => setActivity(a => a + 1)} onInput={() => setActivity(a => a + 1)}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8, flexWrap: 'wrap', marginBottom: '0.8rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <video ref={videoRef} muted playsInline autoPlay style={{ width: 72, height: 54, objectFit: 'cover', borderRadius: 6, background: '#000', display: camOk === false ? 'none' : 'block', transform: 'scaleX(-1)' }} />
          <div>
            <h2 style={{ ...h2, margin: 0, fontSize: '1.2rem' }}>Hi, {emp.name}</h2>
            <div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>{camOk === false ? 'Camera off — punches will have no photo' : '📷 Photo taken with each punch'}</div>
          </div>
        </div>
        <span style={{ color: C.tan, fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>{dateLabel(today)} · {now ?? '--:--'} MT</span>
      </div>

      {notice && <div style={{ background: 'rgba(76,175,80,0.12)', border: `1px solid ${C.green}66`, color: C.cream, borderRadius: 4, padding: '0.6rem 0.8rem', marginBottom: '0.8rem', fontSize: '0.9rem' }}>{notice}</div>}

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
        <Stat label="Status" value={!open ? 'Off the clock' : onLunch ? 'At lunch' : onBreak ? 'On break' : 'Working'}
          color={!open ? C.tan : onLunch || onBreak ? C.amber : C.green}
          sub={onBreak ? `${breakSoFar} min so far` : open ? `In at ${open.clockIn}` : undefined} />
        <Stat label="Paid today" value={fmtHours(todayHours)} sub={todayLunch ? `lunch ${todayLunch} min unpaid` : undefined} />
        <Stat label="Breaks today" value={`${todayBreakMin} min`} sub={todayUpto > 0 ? `${todayUpto} min UPTO` : 'up to 30 paid (8+ hr day)'} color={todayUpto > 0 ? C.red : C.cream} />
        <Stat label="PTO earned today" value={`${(todayHours * rate).toFixed(2)} h`} sub={`${rate.toFixed(4)} h per hour worked`} color={C.green} />
      </div>

      {open && calc && (
        <div style={{ marginBottom: '0.8rem' }}>
          <BreakPills c={calc} />
          {nextUp && <div style={{ color: C.tan, fontSize: '0.82rem', marginTop: 6 }}>Next: {nextUp}</div>}
        </div>
      )}

      {todays.length > 0 && (
        <div style={{ background: C.darkBrown, borderRadius: 4, padding: '0.6rem 0.8rem', marginBottom: '0.8rem' }}>
          <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>Your day</div>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <tbody>
              {todays.flatMap(s => shiftSegments(s, nowHHMM)).map((g, i) => (
                <tr key={i} style={{ color: g.pay === 'Pd' ? C.cream : g.pay === 'UPTO' ? C.red : C.tan, fontSize: '0.95rem', fontVariantNumeric: 'tabular-nums' }}>
                  <td style={{ padding: '2px 0', whiteSpace: 'nowrap' }}>{fmt12(g.start)} – {g.open ? 'now' : fmt12(g.end)}</td>
                  <td style={{ padding: '2px 8px' }}>{KIND_LABEL[g.kind]}</td>
                  <td style={{ padding: '2px 8px', fontWeight: 700 }}>{g.pay === 'Pd' ? 'Paid' : g.pay === 'Upd' ? 'Unpaid' : 'UPTO'}</td>
                  <td style={{ padding: '2px 0', textAlign: 'right' }}>{fmtHours(g.minutes / 60)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
        {!open && <button style={bigBtn(C.green)} onClick={clockIn} disabled={!now}>Clock In</button>}
        {open && !onLunch && !onBreak && <button style={bigBtn(C.blue)} onClick={startBreak}>Start Break</button>}
        {onBreak && <button style={bigBtn(C.blue)} onClick={endBreak}>End Break</button>}
        {open && !open.lunchStart && !onBreak && <button style={bigBtn(C.amber)} onClick={() => update({ lunchStart: nowHHMM }, `Lunch started at ${nowHHMM}. Take at least 30 min, back ${fmtClock(toMin(nowHHMM) + 30)} or later.`, 'lunch-out')}>Start Lunch</button>}
        {onLunch && <button style={bigBtn(C.amber)} onClick={() => update({ lunchEnd: nowHHMM }, `Back from lunch at ${nowHHMM}.`, 'lunch-in')}>End Lunch</button>}
        {open && !onLunch && !onBreak && <button style={bigBtn(C.red)} onClick={clockOut}>Clock Out</button>}
      </div>

      <div style={{ borderTop: '1px solid rgba(166,120,90,0.3)', paddingTop: '0.8rem', marginBottom: '0.8rem' }}>
        <button style={{ ...bigBtn(showSched ? C.medBrown : 'transparent'), border: `1px solid ${C.medBrown}`, color: showSched ? '#fff' : C.cream }}
          onClick={() => setShowSched(v => !v)}>
          📅 My schedule &amp; time off {showSched ? '▴' : '▾'}
        </button>
        {showSched && (
          <div style={{ marginTop: '0.8rem' }}>
            <MySchedule emp={emp} schedule={schedule} requests={requests} setRequests={setRequests}
              thisMonday={thisMonday} today={today} freePto={freePto} balance={ptoOnBooks} onDone={touch} />
          </div>
        )}
      </div>

      <div style={{ borderTop: '1px solid rgba(166,120,90,0.3)', paddingTop: '0.8rem', display: 'flex', gap: '0.5rem', flexWrap: 'wrap', alignItems: 'center' }}>
        <span style={{ color: C.tan, fontSize: '0.85rem', marginRight: 4 }}>🖨 Print my summary:</span>
        <button style={bigBtn(C.medBrown)} onClick={() => print('day')}>Today</button>
        <button style={bigBtn(C.medBrown)} onClick={() => print('week')}>This week</button>
        <button style={bigBtn(C.medBrown)} onClick={() => print('lastweek')}>Last week</button>
      </div>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', marginTop: '1rem' }}>
        <button style={{ ...bigBtn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={signOut}>Done — sign out</button>
        <span style={{ color: C.lightBrown, fontSize: '0.72rem' }}>
          Signs out on its own after {IDLE_SIGN_OUT_MS / 1000}s idle · Printer:{' '}
          {(['4in', '62mm'] as LabelRoll[]).map(r => (
            <button key={r} onClick={() => pickRoll(r)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '0 3px', fontSize: '0.72rem', color: roll === r ? C.cream : C.lightBrown, fontWeight: roll === r ? 700 : 400, textDecoration: roll === r ? 'underline' : 'none' }}>
              {r === '4in' ? '4in thermal' : 'Brother 2.4in'}
            </button>
          ))}
        </span>
      </div>
    </div>
  )
}

function fmtClock(min: number): string {
  return `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`
}

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

// ── Printed summary (box label printer) ─────────────────────────────────────
//
// Same roll stock as the box labels: the 4in thermal at the packing bench or a
// Brother on 62mm continuous. Black on white. Totals on the left, PTO accrual
// boxed on the right, then one block per day. The 62mm roll is too narrow for
// two columns, so there the accrual box drops under the totals.

interface Accrual {
  balance: number     // PTO hours available right now
  usedYtd: number
  booked: number      // approved PTO not yet taken
  pending: number     // PTO asked for, waiting on a decision
  years: number       // completed years of service
  annual: number      // PTO hours per 2080 worked, current rate
  perHour: number
  nextBump: string    // next work anniversary
  nextAnnual: number  // rate after it
}

const KIND_LABEL: Record<Segment['kind'], string> = { work: 'Work', break: 'Break', lunch: 'Lunch' }

function buildSummaryHTML(
  emp: Employee, shifts: Shift[], from: string, to: string, kind: 'Day' | 'Week',
  nowHHMM: string, acc: Accrual, roll: LabelRoll,
): string {
  const rows = [...shifts].sort((a, b) => a.date.localeCompare(b.date) || a.clockIn.localeCompare(b.clockIn))
  let total = 0, pto = 0, breakMin = 0, upto = 0, lunchMin = 0
  const days = rows.map(s => {
    const c = calcShift(s, nowHHMM)
    const earned = c.workedHours * accrualPerHour(yearsOfService(emp.hireDate, s.date))
    total += c.workedHours; pto += earned; breakMin += c.paidBreakMinutes; upto += c.uptoMinutes; lunchMin += c.lunchUnpaid ? c.lunchMinutes : 0
    const lines = shiftSegments(s, nowHHMM).map(g => `<tr class="seg${g.pay === 'Pd' ? '' : ' off'}">
        <td class="t">${fmt12(g.start)}–${g.open ? 'now' : fmt12(g.end)}</td>
        <td>${KIND_LABEL[g.kind]}</td>
        <td class="pay"><span class="${g.pay === 'UPTO' ? 'upto' : ''}">${g.pay === 'Upd' ? 'Upd' : g.pay}</span></td>
        <td class="r">${fmtHours(g.minutes / 60)}</td></tr>`).join('')
    const missed = c.owed.lunch && !s.lunchStart && s.clockOut ? '<tr class="note"><td colspan="4">No lunch taken</td></tr>' : ''
    return `<tr class="day"><td colspan="2">${esc(dateLabel(s.date, { weekday: 'short', month: 'numeric', day: 'numeric' }))}${s.clockOut ? '' : ' · ON CLOCK'}</td>
        <td colspan="2" class="r">${fmtHours(c.workedHours)} pd</td></tr>
      ${lines}${missed}
      <tr class="note"><td colspan="4">PTO +${earned.toFixed(2)} h${c.uptoMinutes ? ` · UPTO ${c.uptoMinutes} min` : ''}</td></tr>`
  }).join('')
  const { regular, overtime } = splitOvertime(total)
  const range = from === to
    ? dateLabel(from, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    : `${dateLabel(from, { month: 'short', day: 'numeric' })} – ${dateLabel(to, { month: 'short', day: 'numeric', year: 'numeric' })}`
  const narrow = roll === '62mm'
  const md = (iso: string) => dateLabel(iso, { month: 'numeric', day: 'numeric', year: '2-digit' })

  return `<!doctype html><html><head><meta charset="utf-8"><title>Time clock summary — ${esc(emp.name)}</title><style>
  ${rollFrameCSS(roll)}
  * { box-sizing: border-box; }
  body { margin: 0; font-family: Arial, Helvetica, sans-serif; color: #000; background: #fff; font-size: ${narrow ? '8pt' : '8.5pt'}; }
  .co { font-weight: 900; font-size: ${narrow ? '11pt' : '13pt'}; letter-spacing: 0.04em; text-align: center; }
  .kind { text-align: center; font-weight: 700; font-size: ${narrow ? '8pt' : '9pt'}; letter-spacing: 0.15em; text-transform: uppercase; border-bottom: 2px solid #000; padding-bottom: 3px; margin-bottom: 3px; }
  .name { font-weight: 900; font-size: ${narrow ? '12pt' : '14pt'}; line-height: 1.1; }
  .range { margin-bottom: 4px; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .r { text-align: right; font-weight: 700; white-space: nowrap; }
  .cols { display: ${narrow ? 'flex' : 'flex'}; flex-direction: ${narrow ? 'column-reverse' : 'row'}; gap: 0.08in; align-items: ${narrow ? 'stretch' : 'flex-start'}; }
  .left { flex: 1 1 auto; min-width: 0; }
  .right { flex: 0 0 1.4in; }
  tr.day td { border-top: 1.5px solid #000; padding-top: 3px; font-weight: 900; font-size: ${narrow ? '9pt' : '9.5pt'}; }
  tr.seg td { font-size: ${narrow ? '7.5pt' : '8pt'}; padding: 0.5px 0; }
  tr.seg td.t { white-space: nowrap; padding-right: 4px; }
  tr.seg td.pay { font-weight: 700; padding: 0.5px 3px; }
  tr.seg.off td { font-style: italic; }
  .upto { background: #000; color: #fff; padding: 0 2px; }
  tr.note td { font-size: 7pt; padding-bottom: 3px; }
  .box { border: 2px solid #000; padding: 3px 4px; margin-bottom: 4px; }
  .box h3 { margin: 0 0 2px; font-size: 7.5pt; letter-spacing: 0.12em; text-align: center; border-bottom: 1px solid #000; padding-bottom: 2px; }
  .box td { font-size: 7.5pt; }
  .box .bal { font-size: ${narrow ? '16pt' : '18pt'}; font-weight: 900; text-align: center; line-height: 1.1; }
  .box .bal-l { font-size: 7pt; text-align: center; margin-bottom: 2px; }
  .box tr.big td { font-size: 10pt; font-weight: 900; }
  .key { font-size: 6.5pt; margin-top: 2px; line-height: 1.3; }
  .foot { border-top: 1px solid #000; margin-top: 4px; padding-top: 3px; font-size: 7pt; text-align: center; }
  </style></head><body>
  <div class="co">COWBOY MEAT CO</div>
  <div class="kind">Time clock summary · ${kind}</div>
  <div class="name">${esc(emp.name)}</div>
  <div class="range">${esc(range)}</div>
  <div class="cols">
    <div class="left">
      ${rows.length ? `<table>${days}</table>` : '<div style="border-top:1px solid #000;padding:6px 0">No punches.</div>'}
      <div class="key">Pd = paid · Upd = unpaid · UPTO = break time past the paid allowance (unpaid)</div>
    </div>
    <div class="right">
      <div class="box">
        <h3>HOURS</h3>
        <table>
          <tr class="big"><td>Paid</td><td class="r">${fmtHours(total)}</td></tr>
          ${kind === 'Week' ? `<tr><td>Regular</td><td class="r">${fmtHours(regular)}</td></tr><tr><td>Overtime</td><td class="r">${fmtHours(overtime)}</td></tr>` : ''}
          <tr><td>Paid breaks</td><td class="r">${fmtHours(breakMin / 60)}</td></tr>
          <tr><td>Unpaid lunch</td><td class="r">${fmtHours(lunchMin / 60)}</td></tr>
          <tr><td>UPTO</td><td class="r">${fmtHours(upto / 60)}</td></tr>
        </table>
      </div>
      <div class="box">
        <h3>PTO ACCRUAL</h3>
        <div class="bal">${acc.balance.toFixed(2)}</div>
        <div class="bal-l">hours available</div>
        <table>
          <tr><td>Earned ${kind === 'Day' ? 'today' : 'this wk'}</td><td class="r">+${pto.toFixed(2)}</td></tr>
          <tr><td>Used this yr</td><td class="r">${acc.usedYtd.toFixed(2)}</td></tr>
          ${acc.booked ? `<tr><td>Approved, upcoming</td><td class="r">−${acc.booked.toFixed(2)}</td></tr>` : ''}
          ${acc.pending ? `<tr><td>Asked, waiting</td><td class="r">−${acc.pending.toFixed(2)}</td></tr>` : ''}
          ${acc.booked || acc.pending ? `<tr><td><b>Free to ask</b></td><td class="r">${(acc.balance - acc.booked - acc.pending).toFixed(2)}</td></tr>` : ''}
          <tr><td>Rate / hr</td><td class="r">${acc.perHour.toFixed(4)}</td></tr>
          <tr><td>Per 2080 hrs</td><td class="r">${acc.annual} h</td></tr>
          <tr><td>Service</td><td class="r">${acc.years} yr</td></tr>
          <tr><td>Goes up ${md(acc.nextBump)}</td><td class="r">${acc.nextAnnual} h</td></tr>
        </table>
      </div>
    </div>
  </div>
  <div class="foot">Printed ${esc(md(isoDate()))} ${fmt12(nowHHMM)} MT · Questions? See the office.</div>
  ${rollPrintScript(roll)}
  </body></html>`
}

// ── Timesheets ──────────────────────────────────────────────────────────────

function PunchPhoto({ src, label }: { src?: string; label: string }) {
  return (
    <div style={{ textAlign: 'center', fontSize: '0.65rem', color: C.lightBrown }}>
      {src
        // A data: URL from the kiosk camera — nothing for next/image to optimize.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={src} alt={`${label} photo`} style={{ width: 54, height: 40, objectFit: 'cover', borderRadius: 3, display: 'block', transform: 'scaleX(-1)' }} />
        : <div style={{ width: 54, height: 40, borderRadius: 3, border: '1px dashed rgba(166,120,90,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>no photo</div>}
      {label}
    </div>
  )
}

function TimesheetTab({ shifts, photos, thisMonday, today, now }: {
  shifts: Shift[]; photos: Record<string, string>; thisMonday: string; today: string; now: string | null
}) {
  const weekStart = addDaysISO(thisMonday, -7)
  const weekEnd = addDaysISO(weekStart, 6)
  const [empId, setEmpId] = useState<string>('all')
  const week = shifts.filter(s => s.date >= weekStart && s.date <= weekEnd && s.clockOut)
  const shown = EMPLOYEES.filter(e => empId === 'all' || e.id === empId)
  const todays = shifts.filter(s => s.date === today)

  return (
    <>
      <div style={card}>
        <h2 style={h2}>Today · {dateLabel(today)}</h2>
        <p style={{ color: C.tan, fontSize: '0.78rem', margin: '0 0 0.5rem' }}>Photos come from the iPad&apos;s front camera at each punch, so you can see who actually punched.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Employee</th><th style={th}>In</th><th style={th}>Lunch</th><th style={th}>Breaks</th><th style={th}>Out</th><th style={th}>Paid</th><th style={th}>UPTO</th><th style={th}>Break pay</th><th style={th}>Punch photos</th></tr></thead>
            <tbody>
              {todays.length === 0 && <tr><td style={td} colSpan={9}>Nobody yet.</td></tr>}
              {todays.map(s => {
                const onLunch = !!s.lunchStart && !s.lunchEnd && !s.clockOut
                const onBreak = !s.clockOut && s.breaks.some(b => !b.end)
                const c = calcShift(s, now ?? s.clockIn)
                return (
                  <tr key={s.id}>
                    <td style={td}>{EMPLOYEES.find(e => e.id === s.empId)?.name}</td>
                    <td style={td}>{s.clockIn}</td>
                    <td style={td}>{s.lunchStart ? `${s.lunchStart}–${s.lunchEnd ?? '…'}` : '—'}</td>
                    <td style={td}>{breakTimes(s)}</td>
                    <td style={td}>{s.clockOut ?? <Pill color={onLunch || onBreak ? C.amber : C.green}>{onLunch ? 'at lunch' : onBreak ? 'on break' : 'on clock'}</Pill>}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtHours(c.workedHours)}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{c.uptoMinutes ? `${c.uptoMinutes} min` : '—'}</td>
                    <td style={td}><BreakPills c={c} /></td>
                    <td style={td}>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <PunchPhoto src={photos[`${s.id}:in`]} label="in" />
                        {s.breaks.flatMap((b, i) => [
                          <PunchPhoto key={`bo${i}`} src={photos[`${s.id}:break-out-${i}`]} label="break" />,
                          ...(b.end ? [<PunchPhoto key={`bi${i}`} src={photos[`${s.id}:break-in-${i}`]} label="back" />] : []),
                        ])}
                        {s.lunchStart && <PunchPhoto src={photos[`${s.id}:lunch-out`]} label="lunch" />}
                        {s.lunchEnd && <PunchPhoto src={photos[`${s.id}:lunch-in`]} label="back" />}
                        {s.clockOut && <PunchPhoto src={photos[`${s.id}:out`]} label="out" />}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

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
        const paidBreakHrs = calcs.reduce((t, c) => t + c.paidBreakMinutes / 60, 0)
        const uptoMin = calcs.reduce((t, c) => t + c.uptoMinutes, 0)
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
                <thead><tr><th style={th}>Day</th><th style={th}>In</th><th style={th}>Lunch</th><th style={th}>Breaks</th><th style={th}>Out</th><th style={th}>Paid</th><th style={th}>UPTO</th><th style={th}>Break pay</th><th style={th}>PTO</th><th style={th}>Notes</th></tr></thead>
                <tbody>
                  {rows.map((s, i) => {
                    const c = calcs[i]
                    return (
                      <tr key={s.id}>
                        <td style={td}>{dateLabel(s.date, { weekday: 'short', month: 'numeric', day: 'numeric' })}</td>
                        <td style={td}>{s.clockIn}</td>
                        <td style={td}>{s.lunchStart ? `${s.lunchStart}–${s.lunchEnd}` : '—'}</td>
                        <td style={{ ...td, fontSize: '0.78rem' }}>{breakTimes(s)}</td>
                        <td style={td}>{s.clockOut}</td>
                        <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtHours(c.workedHours)}</td>
                        <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: c.uptoMinutes > 0 ? C.red : C.cream }}>{c.uptoMinutes ? `${c.uptoMinutes} min` : '—'}</td>
                        <td style={td}><BreakPills c={c} /></td>
                        <td style={{ ...td, color: C.green, fontVariantNumeric: 'tabular-nums' }}>+{(c.workedHours * accrualPerHour(years)).toFixed(2)}</td>
                        <td style={{ ...td, color: C.amber, fontSize: '0.78rem', maxWidth: 280 }}>{c.flags.join(' ')}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.8rem' }}>
              <Stat label="Paid hours" value={fmtHours(total)} sub={`incl. ${fmtHours(paidBreakHrs)} paid breaks`} />
              <Stat label="UPTO" value={`${uptoMin} min`} sub="break time over the paid allowance" color={uptoMin > 0 ? C.red : C.cream} />
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

function PtoTab({ today, thisMonday, requests }: { today: string; thisMonday: string; requests: TimeOffRequest[] }) {
  const rows = useMemo(() => EMPLOYEES.map(e => {
    const history = mockHistory(e, thisMonday)
    const hours = history.reduce((t, w) => t + w.hours, 0)
    const earned = ptoEarned(e.hireDate, history)
    const years = yearsOfService(e.hireDate, today)
    const nextAnniv = nextAnniversary(e.hireDate, today)
    const used = e.ptoUsed + ptoHolds(e.id, requests, today).taken
    return { e, hours, earned, years, nextAnniv, used, balance: earned - used }
  }), [today, thisMonday, requests])

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
              <th style={th}>Hrs worked</th><th style={th}>Earned</th><th style={th}>Used</th><th style={th}>Balance</th><th style={th}>Approved / asked</th><th style={th}>Next bump</th>
            </tr></thead>
            <tbody>
              {rows.map(({ e, hours, earned, years, nextAnniv, used, balance }) => (
                <tr key={e.id}>
                  <td style={td}>{e.name}<div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>{e.role}</div></td>
                  <td style={td}>{dateLabel(e.hireDate, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                  <td style={td}>{years} yr</td>
                  <td style={td}>{annualPtoRate(years)} h / 2080</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{hours.toLocaleString(undefined, { maximumFractionDigits: 0 })}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{earned.toFixed(1)}</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{used.toFixed(1)}</td>
                  <td style={{ ...td, fontWeight: 700, color: C.green, fontVariantNumeric: 'tabular-nums' }}>{balance.toFixed(1)} h</td>
                  <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: C.tan }}>{(() => { const h = ptoHolds(e.id, requests, today); return h.booked || h.pending ? `${h.booked.toFixed(1)} / ${h.pending.toFixed(1)}` : '—' })()}</td>
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
        <p style={p}><b style={{ color: C.cream }}>Every break is punched,</b> out and back in, same as lunch. Break time is a daily total, settled at the end of the day: 15 paid minutes per break earned, so 30 on an 8+ hour day. They can take two 15s or one 30. Anything over is <b style={{ color: C.cream }}>UPTO</b> (unpaid time off). A 10-hour shift with 37 minutes of breaks pays 30 and logs 7 minutes of UPTO. Lunch is separate. It&apos;s already unpaid, so it doesn&apos;t count as UPTO.</p>
        <p style={p}><b style={{ color: C.cream }}>To not pay the extra minutes</b>, federal rules say employees must be told ahead of time, clearly, how much paid break time they get, that running over is against the rules and can lead to discipline, and that extra time is unpaid. Put it in the handbook and have people sign it. The kiosk also says it every time someone starts a break.</p>
        <p style={p}>Each employee sees their break minutes and any UPTO on the clock when they punch out, and on their printed summary.</p>
      </div>
      <div style={card}>
        <h2 style={h2}>PTO</h2>
        <p style={p}>Every paid hour worked, overtime included, earns PTO. Year 1 is {PTO_RULES.baseAnnual} h per {PTO_RULES.fullTimeHours} worked ({(PTO_RULES.baseAnnual / PTO_RULES.fullTimeHours).toFixed(4)} per hour). Each work anniversary adds {PTO_RULES.stepPerYear} h to that rate, so it&apos;s 80 at 5 years, 120 at 10 and 160 at 15.</p>
        <p style={p}><b style={{ color: C.cream }}>Montana law:</b> earned vacation counts as wages. Use-it-or-lose-it isn&apos;t allowed, and any unused balance has to be paid out when someone leaves. A cap on how much a balance can build up <i>is</i> allowed, but we&apos;re not using caps for now.</p>
        <p style={p}>Every employee sees the PTO they earned on the time clock, and on their printed summary (e.g. an 8-hour day in year 1 earns 0.15 h).</p>
      </div>
      <div style={card}>
        <h2 style={h2}>Time off</h2>
        <p style={p}>Employees ask for time off at the iPad with their own PIN, as PTO or unpaid. They pick the days, and each day defaults to their scheduled shift. They can enter fewer hours for a partial day.</p>
        <p style={p}>A PTO request can&apos;t be for more than they have free. &ldquo;Free&rdquo; means their balance minus approved PTO that hasn&apos;t been taken yet, minus requests still waiting on a decision. That way nobody can ask for the same hours twice.</p>
        <p style={p}>You approve or deny requests on the Schedule tab. It shows who else is off those days and how many people are still working. Approved time off shows on the schedule and on their printed summary.</p>
        <p style={p}><b style={{ color: C.cream }}>Pay rules:</b> PTO hours are paid at the regular rate. They don&apos;t count toward the 40 hours for overtime, since they aren&apos;t hours worked. They also don&apos;t earn more PTO.</p>
      </div>
    </>
  )
}
