'use client'
// The punch clock — what the iPad at the employee entrance runs.
//
// You tap your name on the roster, then enter your PIN — checked against you
// alone, so two people can share a PIN. The server hands back a short-lived
// session for you, and every punch acts only on your shift. First time on the
// clock? Tapping your name goes straight to picking your own PIN (typed
// twice, so a typo can't lock you out of it).
// The server stamps the time, not the iPad. The front camera takes a small
// photo at each punch, and the clock signs itself out after a few idle seconds
// so the next person can't punch on your session.

import { useCallback, useEffect, useRef, useState } from 'react'
import { addDaysISO, dateLabel, isoDate, isoDateTime, mondayOfISO } from '@/lib/dates'
import { LabelRoll, parseRoll, rollFrameCSS, rollPrintScript } from '@/lib/label'
import {
  BREAK_RULES, MAX_PAID_BREAK_MINUTES, Segment, Shift,
  accrualPerHour, annualPtoRate, calcShift, fmt12, fmtHours, nextAnniversary, shiftSegments, splitOvertime, toMin, yearsOfService,
} from '@/lib/timekeeping'
import { Schedule, TimeOffRequest, TkEmployee, ptoSummary } from '@/lib/timeclock'
import { BreakPills, C, Stat, api, bigBtn, card, h2, printBackButton } from './shared'
import { MySchedule } from './ScheduleTab'

const IDLE_SIGN_OUT_MS = 20_000
const IDLE_SCHEDULE_MS = 90_000
const ROLL_KEY = 'timeclockLabelRoll' // per device, like the scanner's printer pick

interface Me { employee: TkEmployee; shifts: Shift[]; schedule: Schedule; requests: TimeOffRequest[] }
interface RosterEntry { id: string; name: string; needsSetup: boolean }
const PICKED_IDLE_MS = 30_000  // a name tapped and walked away from goes back to the roster

function Keypad({ value, onKey, disabled }: { value: string; onKey: (k: string) => void; disabled?: boolean }) {
  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'center', gap: 10, marginBottom: '0.8rem' }}>
        {[0, 1, 2, 3].map(i => (
          <span key={i} style={{ width: 20, height: 20, borderRadius: '50%', border: `2px solid ${C.tan}`, background: i < value.length ? C.tan : 'transparent' }} />
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 10, maxWidth: 340, margin: '0 auto' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0'].map(k => (
          <button key={k} onClick={() => onKey(k)} disabled={disabled} style={{
            gridColumn: k === '0' ? 'span 2' : undefined, background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`,
            borderRadius: 10, padding: '1.2rem 0', fontSize: k === 'clear' ? '1rem' : '1.8rem', touchAction: 'manipulation', fontWeight: 700, cursor: disabled ? 'wait' : 'pointer',
          }}>{k === 'clear' ? 'Clear' : k}</button>
        ))}
      </div>
    </>
  )
}
type PunchAction = 'in' | 'out' | 'break-start' | 'break-end' | 'lunch-start' | 'lunch-end'

export const KIND_LABEL: Record<Segment['kind'], string> = { work: 'Work', break: 'Break', lunch: 'Lunch' }

export function KioskClock({ onChange }: { onChange?: () => void }) {
  // Shop clock for display only — punches are stamped by the server.
  const [now, setNow] = useState<string | null>(null)
  const [today, setToday] = useState(() => isoDate())
  useEffect(() => {
    const tick = () => { setNow(isoDateTime().slice(11)); setToday(isoDate()) }
    tick()
    const t = setInterval(tick, 20_000)
    return () => clearInterval(t)
  }, [])

  const [token, setToken] = useState<string | null>(null)
  const [me, setMe] = useState<Me | null>(null)
  const [pin, setPin] = useState('')
  const [pinError, setPinError] = useState('')
  const [roster, setRoster] = useState<RosterEntry[] | null>(null)
  const [picked, setPicked] = useState<RosterEntry | null>(null)
  const [newPin, setNewPin] = useState('')          // first entry of the PIN they're choosing
  const loadRoster = useCallback(() => {
    api<{ roster: RosterEntry[] }>('/api/timeclock/roster').then(r => setRoster(r.roster)).catch(e => setPinError((e as Error).message))
  }, [])
  useEffect(() => { loadRoster() }, [loadRoster])
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [activity, setActivity] = useState(0)   // bumps on every tap, restarts the idle timer
  const [showSched, setShowSched] = useState(false)
  const [roll, setRoll] = useState<LabelRoll>('4in')

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring this device's printer after mount; reading it during render would mismatch the server HTML
    try { setRoll(parseRoll(localStorage.getItem(ROLL_KEY))) } catch { /* private browsing */ }
  }, [])
  const pickRoll = (r: LabelRoll) => {
    setRoll(r)
    try { localStorage.setItem(ROLL_KEY, r) } catch { /* private browsing */ }
  }

  const signOut = useCallback((msg = '') => {
    if (token) api('/api/timeclock/pin', { method: 'DELETE', token }).catch(() => {})
    setToken(null); setMe(null); setPin(''); setNotice(''); setError(''); setShowSched(false)
    setPicked(null); setNewPin('')
    setPinError(msg)
    loadRoster()
  }, [token, loadRoster])

  // A name tapped and then walked away from goes back to the roster.
  useEffect(() => {
    if (!picked || token) return
    const t = setTimeout(() => { setPicked(null); setPin(''); setPinError('') }, PICKED_IDLE_MS)
    return () => clearTimeout(t)
  }, [picked, token, pin])

  const load = useCallback(async (t: string) => {
    try {
      setMe(await api<Me>('/api/timeclock/me', { token: t }))
    } catch (e) {
      if ((e as { status?: number }).status === 401) signOut('Signed out — enter your PIN again.')
      else setError((e as Error).message)
    }
  }, [signOut])

  // Walk away and it signs you out. Filling in a time-off request takes longer than a punch.
  useEffect(() => {
    if (!token) return
    const t = setTimeout(() => signOut(), showSched ? IDLE_SCHEDULE_MS : IDLE_SIGN_OUT_MS)
    return () => clearTimeout(t)
  }, [token, activity, showSched, signOut])

  // Front camera: a PIN can be shared, a face on the timesheet can't. If the
  // camera is off or denied the punch still goes through, with no photo.
  const videoRef = useRef<HTMLVideoElement>(null)
  const [camOk, setCamOk] = useState<boolean | null>(null)
  useEffect(() => {
    if (!token) return
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
  }, [token])

  /** Grab the frame now, at the moment of the punch; upload once the server says which shift it's for. */
  const grabFrame = (): Promise<Blob | null> => {
    const v = videoRef.current
    if (!v || !v.videoWidth) return Promise.resolve(null)
    const c = document.createElement('canvas')
    c.width = 240; c.height = Math.round(240 * v.videoHeight / v.videoWidth)
    c.getContext('2d')?.drawImage(v, 0, 0, c.width, c.height)
    return new Promise(res => c.toBlob(b => res(b), 'image/jpeg', 0.7))
  }

  const submitPin = async (entered: string) => {
    if (!picked) return
    setBusy(true); setPinError('')
    try {
      const r = await api<{ token: string; employee: TkEmployee }>('/api/timeclock/pin', {
        method: 'POST', body: JSON.stringify({ employeeId: picked.id, pin: entered }),
      })
      setToken(r.token); setNotice(''); setError(''); setActivity(a => a + 1)
      await load(r.token)
    } catch (e) {
      setPinError((e as Error).message)
    } finally {
      setPin(''); setBusy(false)
    }
  }

  const press = (k: string) => {
    if (busy) return
    if (k === 'clear') { setPin(''); return }
    const next = (pin + k).slice(0, 4)
    setPin(next)
    if (next.length === 4) submitPin(next)
  }

  // First time: pick your own PIN — type it, type it again, saved, signed in.
  const pressNew = async (k: string) => {
    if (busy || !picked) return
    if (k === 'clear') { setPin(''); return }
    const next = (pin + k).slice(0, 4)
    setPin(next)
    if (next.length < 4) return
    if (!newPin) { setNewPin(next); setPin(''); setPinError(''); return }
    if (next !== newPin) { setNewPin(''); setPin(''); setPinError('Those didn\'t match. Start over — type your new PIN.'); return }
    setBusy(true)
    try {
      const r = await api<{ token: string; employee: TkEmployee }>('/api/timeclock/claim', {
        method: 'POST', body: JSON.stringify({ employeeId: picked.id, pin: next }),
      })
      setToken(r.token); setNewPin(''); setPinError(''); setError(''); setActivity(a => a + 1)
      setNotice('Your PIN is set. Use it every time from now on — don\'t share it.')
      await load(r.token)
    } catch (e) {
      setNewPin(''); setPinError((e as Error).message)
    } finally {
      setPin(''); setBusy(false)
    }
  }

  const clockLine = <div style={{ color: C.tan, fontSize: '0.9rem', marginBottom: '0.8rem', fontVariantNumeric: 'tabular-nums' }}>{dateLabel(today)} · {now ? fmt12(now) : '--:--'} MT</div>
  const back = (
    <button onClick={() => (token ? signOut() : (setPicked(null), setPin(''), setPinError('')))}
      style={{ background: 'none', border: 'none', color: C.tan, fontSize: '1rem', cursor: 'pointer', marginTop: '1rem', padding: '0.6rem' }}>
      ← Not you? Back to names
    </button>
  )

  // ── First time: pick your own PIN ──
  if (!token && picked?.needsSetup) {
    return (
      <div style={{ ...card, maxWidth: 440, margin: '0 auto', textAlign: 'center', padding: '1.5rem' }}>
        <h2 style={h2}>Welcome, {picked.name}</h2>
        <div style={{ color: C.amber, fontSize: '0.85rem', marginBottom: '0.6rem' }}>First time on the clock. Only go on if this is you.</div>
        <div style={{ color: C.cream, marginBottom: 4, fontSize: '1.05rem' }}>{busy ? 'Saving…' : newPin ? 'Type it again to make sure' : 'Pick your own 4-digit PIN'}</div>
        <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginBottom: '0.8rem' }}>You&apos;ll use it every time you punch. Nothing easy like 1111 or 1234.</div>
        <Keypad value={pin} onKey={pressNew} disabled={busy} />
        {pinError && <div style={{ color: C.red, fontSize: '0.9rem', marginTop: '0.7rem' }}>{pinError}</div>}
        {back}
      </div>
    )
  }

  // ── PIN for the name you tapped ──
  if (!token && picked) {
    return (
      <div style={{ ...card, maxWidth: 440, margin: '0 auto', textAlign: 'center', padding: '1.5rem' }}>
        <h2 style={h2}>{picked.name}</h2>
        {clockLine}
        <div style={{ color: C.cream, marginBottom: 6 }}>
          {busy ? 'Checking…' : 'Enter your PIN'}
        </div>
        <Keypad value={pin} onKey={press} disabled={busy} />
        {pinError && <div style={{ color: C.red, fontSize: '0.9rem', marginTop: '0.7rem' }}>{pinError}</div>}
        {back}
      </div>
    )
  }

  // ── Roster: tap your name ──
  if (!token || !me) {
    return (
      <div style={{ ...card, maxWidth: 820, margin: '0 auto', textAlign: 'center', padding: '1.5rem' }}>
        <h2 style={h2}>Tap your name</h2>
        {clockLine}
        {pinError && <div style={{ color: C.red, fontSize: '0.9rem', marginBottom: '0.7rem' }}>{pinError}</div>}
        {roster === null && <div style={{ color: C.tan }}>Loading…</div>}
        {roster?.length === 0 && <div style={{ color: C.tan }}>No one is set up on the time clock yet.</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(170px, 1fr))', gap: 10 }}>
          {roster?.map(r => (
            <button key={r.id} onClick={() => { setPicked(r); setPin(''); setPinError('') }} style={{
              background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 10,
              padding: '1.1rem 0.6rem', fontSize: '1.15rem', fontWeight: 700, cursor: 'pointer', touchAction: 'manipulation', minHeight: 72,
            }}>
              {r.name}
              {r.needsSetup && <div style={{ color: C.amber, fontSize: '0.72rem', fontWeight: 600, marginTop: 2 }}>new — tap to pick your PIN</div>}
            </button>
          ))}
        </div>
      </div>
    )
  }

  // ── Signed in: only your own shift ──
  const emp = me.employee
  const shifts = me.shifts
  const nowHHMM = now ?? '00:00'
  const thisMonday = mondayOfISO(today)
  const open = shifts.find(s => !s.clockOut)
  const onLunch = !!open?.lunchStart && !open.lunchEnd
  const openBreak = open?.breaks.find(b => !b.end)
  const onBreak = !!openBreak
  const rate = accrualPerHour(yearsOfService(emp.hireDate, today))

  const todays = shifts.filter(s => s.date === today)
  const todayCalcs = todays.map(s => calcShift(s, nowHHMM))
  const todayHours = todayCalcs.reduce((t, c) => t + c.workedHours, 0)
  const todayUpto = todayCalcs.reduce((t, c) => t + c.uptoMinutes, 0)
  const todayLunch = todayCalcs.reduce((t, c) => t + (c.lunchUnpaid ? c.lunchMinutes : 0), 0)
  const todayBreakMin = todayCalcs.reduce((t, c) => t + c.breakMinutes, 0)
  const pto = ptoSummary(emp, shifts, me.requests, today, nowHHMM)

  const touch = (msg: string) => { setNotice(msg); setError(''); setActivity(a => a + 1) }

  /** Send a punch; the server stamps the time. `message` builds the confirmation from that time. */
  const punch = async (action: PunchAction, message: (at: string, shift: Shift) => string) => {
    if (busy) return
    setBusy(true); setActivity(a => a + 1)
    const frame = grabFrame()
    try {
      const r = await api<{ shift: Shift; punch: string; now: { time: string } }>('/api/timeclock/punch', { method: 'POST', token, body: JSON.stringify({ action }) })
      touch(message(r.now.time, r.shift))
      const blob = await frame
      if (blob) {
        const fd = new FormData()
        fd.append('file', blob, 'punch.jpg'); fd.append('shift_id', r.shift.id); fd.append('punch', r.punch)
        api('/api/timeclock/photo', { method: 'POST', token, body: fd }).catch(() => {})
      }
      await load(token)
      onChange?.()
    } catch (e) {
      if ((e as { status?: number }).status === 401) signOut('Signed out — enter your PIN again.')
      else { setError((e as Error).message); setNotice('') }
    } finally {
      setBusy(false)
    }
  }

  const clockOutMessage = (at: string, s: Shift) => {
    const c = calcShift(s)
    const paid = todays.filter(x => x.id !== s.id).reduce((t, x) => t + calcShift(x, at).workedHours, 0) + c.workedHours
    return [
      `Clocked out at ${fmt12(at)}. Paid today: ${fmtHours(paid)}.`,
      c.lunchUnpaid && c.lunchMinutes > 0 ? `Lunch ${c.lunchMinutes} min (unpaid).` : '',
      c.breakMinutes > 0 ? `Breaks ${c.breakMinutes} min: ${c.paidBreakMinutes} paid${c.uptoMinutes ? `, ${c.uptoMinutes} min UPTO` : ''}.` : '',
      `You earned ${(paid * rate).toFixed(2)} h of PTO.`,
    ].filter(Boolean).join(' ')
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
    if (next) nextUp = `${next[1]} earned at ${next[0]}h worked (~${fmt12(fmtClock(toMin(nowHHMM) + Math.round((next[0] - w) * 60)))})`
  }

  const print = (range: 'day' | 'week' | 'lastweek') => {
    touch('Printing…')
    const [from, to] = range === 'day' ? [today, today]
      : range === 'week' ? [thisMonday, today]
      : [addDaysISO(thisMonday, -7), addDaysISO(thisMonday, -1)]
    const years = yearsOfService(emp.hireDate, today)
    const accrual: Accrual = {
      balance: pto.onBooks, booked: pto.booked, pending: pto.pending, usedYtd: pto.takenThisYear,
      years, annual: annualPtoRate(years), perHour: accrualPerHour(years),
      nextBump: nextAnniversary(emp.hireDate, today), nextAnnual: annualPtoRate(years + 1),
    }
    const html = buildSummaryHTML(emp, shifts.filter(s => s.date >= from && s.date <= to),
      from, to, range === 'day' ? 'Day' : 'Week', nowHHMM, accrual, roll, window.location.pathname + window.location.search)
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  const submitRequest = async (body: { type: 'PTO' | 'Unpaid'; from: string; to: string; partial: number | null; note: string }) => {
    const r = await api<{ total: number; days: unknown[] }>('/api/timeclock/request', { method: 'POST', token, body: JSON.stringify(body) })
    touch(`Request sent: ${body.type} ${fmtHours(r.total)} (${r.days.length} day${r.days.length > 1 ? 's' : ''}). Your manager will approve or deny it — check back here.`)
    await load(token)
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
        <span style={{ color: C.tan, fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>{dateLabel(today)} · {now ? fmt12(now) : '--:--'} MT</span>
      </div>

      {notice && <div style={{ background: 'rgba(76,175,80,0.12)', border: `1px solid ${C.green}66`, color: C.cream, borderRadius: 4, padding: '0.6rem 0.8rem', marginBottom: '0.8rem', fontSize: '0.9rem' }}>{notice}</div>}
      {error && <div style={{ background: 'rgba(239,68,68,0.12)', border: `1px solid ${C.red}66`, color: C.cream, borderRadius: 4, padding: '0.6rem 0.8rem', marginBottom: '0.8rem', fontSize: '0.9rem' }}>{error}</div>}

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
        <Stat label="Status" value={!open ? 'Off the clock' : onLunch ? 'At lunch' : onBreak ? 'On break' : 'Working'}
          color={!open ? C.tan : onLunch || onBreak ? C.amber : C.green}
          sub={onBreak ? `${breakSoFar} min so far` : open ? `In at ${fmt12(open.clockIn)}` : undefined} />
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

      <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem', opacity: busy ? 0.6 : 1 }}>
        {!open && <button style={bigBtn(C.green)} disabled={busy} onClick={() => punch('in', at => `Clocked in at ${fmt12(at)}.`)}>Clock In</button>}
        {open && !onLunch && !onBreak && <button style={bigBtn(C.blue)} disabled={busy} onClick={() => punch('break-start', at =>
          `Break started at ${fmt12(at)}. You've used ${todayBreakMin} break min today. Paid break time is 15 min per break earned — 30 min on an 8+ hour day — taken however you like. Anything over is UPTO (unpaid), figured when you clock out.`)}>Start Break</button>}
        {onBreak && <button style={bigBtn(C.blue)} disabled={busy} onClick={() => punch('break-end', at => {
          const mins = toMin(at) - toMin(openBreak!.start)
          const total = todayBreakMin - breakSoFar + mins
          return `Back from break at ${fmt12(at)}: ${mins} min. ${total} break min used today${total > MAX_PAID_BREAK_MINUTES ? ` — ${total - MAX_PAID_BREAK_MINUTES} min over 30 will be UPTO` : ''}.`
        })}>End Break</button>}
        {open && !open.lunchStart && !onBreak && <button style={bigBtn(C.amber)} disabled={busy} onClick={() => punch('lunch-start', at =>
          `Lunch started at ${fmt12(at)}. Take at least 30 min — back ${fmt12(fmtClock(toMin(at) + 30))} or later.`)}>Start Lunch</button>}
        {onLunch && <button style={bigBtn(C.amber)} disabled={busy} onClick={() => punch('lunch-end', at => `Back from lunch at ${fmt12(at)}.`)}>End Lunch</button>}
        {open && !onLunch && !onBreak && <button style={bigBtn(C.red)} disabled={busy} onClick={() => punch('out', clockOutMessage)}>Clock Out</button>}
      </div>

      <div style={{ borderTop: '1px solid rgba(166,120,90,0.3)', paddingTop: '0.8rem', marginBottom: '0.8rem' }}>
        <button style={{ ...bigBtn(showSched ? C.medBrown : 'transparent'), border: `1px solid ${C.medBrown}`, color: showSched ? '#fff' : C.cream }}
          onClick={() => setShowSched(v => !v)}>
          📅 My schedule &amp; time off {showSched ? '▴' : '▾'}
        </button>
        {showSched && (
          <div style={{ marginTop: '0.8rem' }}>
            <MySchedule emp={emp} schedule={me.schedule} requests={me.requests} thisMonday={thisMonday} today={today}
              freePto={pto.free} balance={pto.onBooks} onSubmit={submitRequest} />
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
        <button style={{ ...bigBtn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={() => signOut()}>Done — sign out</button>
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


function buildSummaryHTML(
  emp: TkEmployee, shifts: Shift[], from: string, to: string, kind: 'Day' | 'Week',
  nowHHMM: string, acc: Accrual, roll: LabelRoll, backUrl: string,
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
  ${printBackButton(backUrl, 'Back to time clock', true)}
  ${rollPrintScript(roll)}
  </body></html>`
}

