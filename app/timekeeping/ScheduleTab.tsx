'use client'
// Schedule + time-off requests for the /timekeeping mockup.
//
// Managers build the week on the Schedule tab and approve or deny requests.
// Employees see their own schedule and ask for time off at the kiosk, signed
// in with their own PIN. Approved PTO shows on the schedule and comes out of
// the balance; pending PTO is held so nobody can ask for the same hours twice.

import { useState } from 'react'
import { addDaysISO, dateLabel, dayOfWeekISO } from '@/lib/dates'
import { BREAK_RULES, fmt12, fmtHours, toMin } from '@/lib/timekeeping'
import { C, Employee, EMPLOYEES, card, h2, th, td, btn, bigBtn, Pill } from './shared'

// ── Types & rules ───────────────────────────────────────────────────────────

export interface SchedShift { start: string; end: string } // HH:MM
/** `${empId}|${YYYY-MM-DD}` → that day's shift. No entry = off. */
export type Schedule = Record<string, SchedShift>

export interface TimeOffRequest {
  id:        string
  empId:     string
  type:      'PTO' | 'Unpaid'
  days:      { date: string; hours: number }[] // fixed when submitted
  note:      string
  status:    'pending' | 'approved' | 'denied'
  submitted: string // YYYY-MM-DD
}

export const key = (empId: string, date: string) => `${empId}|${date}`

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
 * so nobody can ask for the same hours twice.
 */
export function ptoHolds(empId: string, requests: TimeOffRequest[], today: string) {
  let taken = 0, booked = 0, pending = 0
  for (const r of requests) {
    if (r.empId !== empId || r.type !== 'PTO' || r.status === 'denied') continue
    for (const d of r.days) {
      if (r.status === 'pending') pending += d.hours
      else if (d.date < today) taken += d.hours
      else booked += d.hours
    }
  }
  return { taken, booked, pending }
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

function rangeLabel(r: TimeOffRequest): string {
  const first = r.days[0]?.date, last = r.days[r.days.length - 1]?.date
  if (!first) return '—'
  const f = (iso: string) => dateLabel(iso, { weekday: 'short', month: 'numeric', day: 'numeric' })
  return first === last ? f(first) : `${f(first)} – ${f(last)}`
}

// ── Mock data ───────────────────────────────────────────────────────────────

// Each person's usual week: day of week (1 = Mon) → shift.
const USUAL: Record<string, Record<number, SchedShift>> = {
  e1: { 1: { start: '07:00', end: '15:30' }, 2: { start: '07:00', end: '15:30' }, 3: { start: '07:00', end: '15:30' }, 4: { start: '07:00', end: '15:30' }, 5: { start: '07:00', end: '15:30' } },
  e2: { 1: { start: '06:00', end: '16:00' }, 2: { start: '06:00', end: '16:00' }, 3: { start: '06:00', end: '16:00' }, 4: { start: '06:00', end: '16:00' }, 5: { start: '06:00', end: '13:00' } },
  e3: { 1: { start: '08:00', end: '15:00' }, 2: { start: '08:00', end: '15:00' }, 3: { start: '08:00', end: '15:00' }, 4: { start: '08:00', end: '15:00' } },
  e4: { 1: { start: '06:30', end: '15:00' }, 2: { start: '06:30', end: '15:00' }, 3: { start: '06:30', end: '15:00' }, 4: { start: '06:30', end: '15:00' }, 5: { start: '06:30', end: '15:00' } },
  e5: { 1: { start: '16:00', end: '20:15' }, 3: { start: '16:00', end: '20:15' }, 5: { start: '16:00', end: '20:15' } },
}

/** Last week through three weeks out, everyone on their usual shifts. */
export function mockSchedule(thisMonday: string): Schedule {
  const s: Schedule = {}
  for (let d = -7; d < 28; d++) {
    const date = addDaysISO(thisMonday, d)
    const dow = dayOfWeekISO(date)
    for (const e of EMPLOYEES) {
      const sh = USUAL[e.id]?.[dow]
      if (sh) s[key(e.id, date)] = sh
    }
  }
  return s
}

export function mockRequests(thisMonday: string, today: string): TimeOffRequest[] {
  const next = (d: number) => addDaysISO(thisMonday, 7 + d)
  const last = (d: number) => addDaysISO(thisMonday, d - 7)
  return [
    // Already taken, last week — these land in the payroll export.
    { id: 'r0', empId: 'e3', type: 'PTO', status: 'approved', submitted: addDaysISO(today, -20), note: 'Dentist',
      days: [{ date: last(3), hours: 6.5 }] },
    { id: 'r0b', empId: 'e5', type: 'Unpaid', status: 'approved', submitted: addDaysISO(today, -15), note: 'Car trouble',
      days: [{ date: last(2), hours: 4.25 }] },
    { id: 'r1', empId: 'e4', type: 'PTO', status: 'approved', submitted: addDaysISO(today, -9), note: 'Elk hunt',
      days: [{ date: next(0), hours: 8 }, { date: next(1), hours: 8 }] },
    { id: 'r2', empId: 'e1', type: 'PTO', status: 'pending', submitted: addDaysISO(today, -1), note: 'Kid’s doctor appointment — back by noon',
      days: [{ date: next(3), hours: 4 }] },
    { id: 'r3', empId: 'e2', type: 'PTO', status: 'pending', submitted: today, note: 'Family in town',
      days: [{ date: next(0), hours: 9.5 }, { date: next(1), hours: 9.5 }] },
    { id: 'r4', empId: 'e5', type: 'Unpaid', status: 'pending', submitted: today, note: 'School event',
      days: [{ date: next(2), hours: 4.25 }] },
  ]
}

// ── Manager: build the week, decide requests ────────────────────────────────

export function ScheduleTab({ schedule, setSchedule, requests, setRequests, thisMonday, today, freePto }: {
  schedule: Schedule; setSchedule: React.Dispatch<React.SetStateAction<Schedule>>
  requests: TimeOffRequest[]; setRequests: React.Dispatch<React.SetStateAction<TimeOffRequest[]>>
  thisMonday: string; today: string
  freePto: (e: Employee) => number
}) {
  const [weekStart, setWeekStart] = useState(thisMonday)
  const [sel, setSel] = useState<{ empId: string; date: string } | null>(null)
  const [draft, setDraft] = useState<SchedShift>({ start: '07:00', end: '15:30' })
  const days = [0, 1, 2, 3, 4, 5, 6].map(d => addDaysISO(weekStart, d))

  const pick = (empId: string, date: string) => {
    setSel({ empId, date })
    const cur = schedule[key(empId, date)] ?? USUAL[empId]?.[dayOfWeekISO(date)] ?? { start: '07:00', end: '15:30' }
    setDraft(cur)
  }
  const save = () => {
    if (!sel || toMin(draft.end) <= toMin(draft.start)) return
    setSchedule(s => ({ ...s, [key(sel.empId, sel.date)]: draft }))
    setSel(null)
  }
  const clear = () => {
    if (!sel) return
    setSchedule(s => { const n = { ...s }; delete n[key(sel.empId, sel.date)]; return n })
    setSel(null)
  }
  const copyLastWeek = () => setSchedule(s => {
    const n = { ...s }
    for (const e of EMPLOYEES) for (const d of days) {
      const prev = s[key(e.id, addDaysISO(d, -7))]
      if (prev) n[key(e.id, d)] = prev
      else delete n[key(e.id, d)]
    }
    return n
  })
  const decide = (id: string, status: 'approved' | 'denied') =>
    setRequests(rs => rs.map(r => r.id === id ? { ...r, status } : r))

  const pending = requests.filter(r => r.status === 'pending')
  const decided = requests.filter(r => r.status !== 'pending')

  const printWeek = () => {
    const rows = EMPLOYEES.map(e => `<tr><td class="n">${e.name}<div class="role">${e.role}</div></td>${days.map(d => {
      const off = offOn(e.id, d, requests)
      const sh = schedule[key(e.id, d)]
      if (off && off.r.status === 'approved') return `<td class="off">${off.r.type === 'PTO' ? 'PTO' : 'OFF'}</td>`
      return `<td>${sh ? `${fmt12(sh.start)}–${fmt12(sh.end)}` : ''}</td>`
    }).join('')}</tr>`).join('')
    const html = `<!doctype html><html><head><meta charset="utf-8"><title>Schedule ${weekStart}</title><style>
      @page { size: letter landscape; margin: 0.4in; }
      body { font-family: Arial, sans-serif; color: #000; }
      h1 { font-size: 18pt; margin: 0 0 4px; } .sub { margin-bottom: 10px; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #000; padding: 8px 6px; text-align: center; font-size: 12pt; }
      th { background: #eee; } td.n { text-align: left; font-weight: 700; } .role { font-weight: 400; font-size: 9pt; }
      td.off { background: #ddd; font-weight: 700; }
    </style></head><body><h1>Cowboy Meat Co — Schedule</h1>
      <div class="sub">Week of ${dateLabel(weekStart, { month: 'long', day: 'numeric', year: 'numeric' })}</div>
      <table><tr><th></th>${days.map(d => `<th>${dateLabel(d, { weekday: 'short', month: 'numeric', day: 'numeric' })}</th>`).join('')}</tr>${rows}</table>
      <script>window.onload = () => window.print()</script></body></html>`
    const w = window.open('', '_blank')
    if (w) { w.document.write(html); w.document.close() }
  }

  const selEmp = sel ? EMPLOYEES.find(e => e.id === sel.empId) : null

  return (
    <>
      <div style={card}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
          <h2 style={{ ...h2, margin: 0 }}>Schedule</h2>
          <button style={btn(C.medBrown)} onClick={() => setWeekStart(w => addDaysISO(w, -7))}>←</button>
          <span style={{ color: C.cream, fontWeight: 700, minWidth: 170, textAlign: 'center' }}>
            Week of {dateLabel(weekStart, { month: 'short', day: 'numeric' })}{weekStart === thisMonday ? ' (this week)' : ''}
          </span>
          <button style={btn(C.medBrown)} onClick={() => setWeekStart(w => addDaysISO(w, 7))}>→</button>
          <span style={{ flex: 1 }} />
          <button style={btn(C.medBrown)} onClick={copyLastWeek}>Copy last week</button>
          <button style={btn(C.medBrown)} onClick={printWeek}>🖨 Print week</button>
        </div>

        {sel && selEmp && (
          <div style={{ background: C.darkBrown, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.7rem', marginBottom: '0.8rem', display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
            <b style={{ color: C.cream }}>{selEmp.name}</b>
            <span style={{ color: C.tan }}>{dateLabel(sel.date)}</span>
            <input type="time" value={draft.start} onChange={e => setDraft(d => ({ ...d, start: e.target.value }))} style={timeInput} />
            <span style={{ color: C.tan }}>to</span>
            <input type="time" value={draft.end} onChange={e => setDraft(d => ({ ...d, end: e.target.value }))} style={timeInput} />
            <span style={{ color: C.tan, fontSize: '0.8rem' }}>
              {toMin(draft.end) > toMin(draft.start) ? `${fmtHours(scheduledHours(draft))} paid` : 'end must be after start'}
            </span>
            <button style={btn(C.green)} onClick={save}>Save</button>
            <button style={btn(C.red)} onClick={clear}>Day off</button>
            <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={() => setSel(null)}>Cancel</button>
          </div>
        )}

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 860 }}>
            <thead><tr>
              <th style={th}>Employee</th>
              {days.map(d => (
                <th key={d} style={{ ...th, textAlign: 'center', color: d === today ? C.cream : C.lightBrown }}>
                  {dateLabel(d, { weekday: 'short', month: 'numeric', day: 'numeric' })}
                </th>
              ))}
              <th style={{ ...th, textAlign: 'right' }}>Hours</th>
            </tr></thead>
            <tbody>
              {EMPLOYEES.map(e => {
                let work = 0, pto = 0
                const cells = days.map(d => {
                  const sh = schedule[key(e.id, d)]
                  const off = offOn(e.id, d, requests)
                  const approvedOff = off?.r.status === 'approved'
                  if (sh && !approvedOff) work += scheduledHours(sh)
                  if (approvedOff && off.r.type === 'PTO') pto += off.hours
                  // A partial day (e.g. 4 of 8) still works the rest.
                  if (sh && approvedOff && off.hours < scheduledHours(sh)) work += scheduledHours(sh) - off.hours
                  const selected = sel?.empId === e.id && sel.date === d
                  return (
                    <td key={d} onClick={() => pick(e.id, d)} style={{
                      ...td, textAlign: 'center', cursor: 'pointer', padding: '0.35rem 0.25rem',
                      background: selected ? 'rgba(96,165,250,0.18)' : approvedOff ? 'rgba(76,175,80,0.12)' : undefined,
                      outline: off?.r.status === 'pending' ? `2px dashed ${C.amber}` : undefined, outlineOffset: -3,
                    }}>
                      {sh
                        ? <div style={{ fontSize: '0.8rem', whiteSpace: 'nowrap', opacity: approvedOff && off.hours >= scheduledHours(sh) ? 0.45 : 1, textDecoration: approvedOff && off.hours >= scheduledHours(sh) ? 'line-through' : undefined }}>
                            {fmt12(sh.start)}–{fmt12(sh.end)}
                          </div>
                        : !off && <span style={{ color: C.lightBrown }}>—</span>}
                      {off && (
                        <div style={{ marginTop: 2 }}>
                          <Pill color={off.r.status === 'approved' ? C.green : C.amber}>
                            {off.r.status === 'pending' ? 'Req ' : ''}{off.r.type === 'PTO' ? 'PTO' : 'Off'} {fmtHours(off.hours)}
                          </Pill>
                        </div>
                      )}
                    </td>
                  )
                })
                return (
                  <tr key={e.id}>
                    <td style={td}>{e.name}<div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>{e.role}</div></td>
                    {cells}
                    <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>
                      <b style={{ color: work > 40 ? C.amber : C.cream }}>{fmtHours(work)}</b>
                      {pto > 0 && <div style={{ color: C.green, fontSize: '0.75rem' }}>+{fmtHours(pto)} PTO</div>}
                      {work > 40 && <div style={{ color: C.amber, fontSize: '0.72rem' }}>{fmtHours(work - 40)} OT</div>}
                    </td>
                  </tr>
                )
              })}
              <tr>
                <td style={{ ...td, color: C.lightBrown, fontSize: '0.75rem' }}>Working</td>
                {days.map(d => {
                  const n = EMPLOYEES.filter(e => schedule[key(e.id, d)] && offOn(e.id, d, requests)?.r.status !== 'approved').length
                  return <td key={d} style={{ ...td, textAlign: 'center', color: C.tan, fontSize: '0.8rem' }}>{n}</td>
                })}
                <td style={td} />
              </tr>
            </tbody>
          </table>
        </div>
        <div style={{ color: C.lightBrown, fontSize: '0.75rem', marginTop: 6 }}>
          Tap a day to set or change a shift. Hours are paid hours; the 30-min lunch comes off any 6+ hour day. Dashed amber = a request waiting on you.
        </div>
      </div>

      <div style={card}>
        <h2 style={h2}>Time-off requests {pending.length > 0 && <Pill color={C.amber}>{pending.length} waiting</Pill>}</h2>
        {pending.length === 0 && <div style={{ color: C.tan, fontSize: '0.85rem' }}>Nothing waiting.</div>}
        {pending.map(r => {
          const e = EMPLOYEES.find(x => x.id === r.empId)!
          const hrs = requestHours(r)
          const free = freePto(e) + hrs // their own pending hold shouldn't count against them here
          // Who else is out, and how thin the crew gets, on each day asked for.
          const clashes = r.days.map(d => {
            const others = EMPLOYEES.filter(o => o.id !== e.id && offOn(o.id, d.date, requests))
            const working = EMPLOYEES.filter(o => o.id !== e.id && schedule[key(o.id, d.date)] && offOn(o.id, d.date, requests)?.r.status !== 'approved').length
            return { date: d.date, others, working }
          })
          return (
            <div key={r.id} style={{ background: C.darkBrown, borderRadius: 4, padding: '0.7rem 0.8rem', marginBottom: '0.6rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                <div>
                  <b style={{ color: C.cream }}>{e.name}</b> <span style={{ color: C.tan }}>· {rangeLabel(r)}</span>
                  <div style={{ marginTop: 4 }}>
                    <Pill color={r.type === 'PTO' ? C.green : C.blue}>{r.type} {fmtHours(hrs)}</Pill>
                    {r.days.length > 1 && <span style={{ color: C.tan, fontSize: '0.78rem' }}>{r.days.map(d => `${dateLabel(d.date, { weekday: 'short' })} ${fmtHours(d.hours)}`).join(' · ')}</span>}
                  </div>
                  {r.note && <div style={{ color: C.cream, fontSize: '0.85rem', marginTop: 4 }}>&ldquo;{r.note}&rdquo;</div>}
                  <div style={{ color: C.lightBrown, fontSize: '0.75rem', marginTop: 4 }}>
                    Asked {dateLabel(r.submitted, { month: 'short', day: 'numeric' })}
                    {r.type === 'PTO' && <> · PTO free before this: {free.toFixed(1)} h → after: <b style={{ color: free - hrs < 0 ? C.red : C.tan }}>{(free - hrs).toFixed(1)} h</b></>}
                  </div>
                  {clashes.filter(c => c.others.length).map(c => (
                    <div key={c.date} style={{ color: C.amber, fontSize: '0.78rem', marginTop: 2 }}>
                      {dateLabel(c.date, { weekday: 'short', month: 'numeric', day: 'numeric' })}: also off — {c.others.map(o => o.name).join(', ')} · {c.working} others working
                    </div>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
                  <button style={btn(C.green)} onClick={() => decide(r.id, 'approved')}>Approve</button>
                  <button style={btn(C.red)} onClick={() => decide(r.id, 'denied')}>Deny</button>
                </div>
              </div>
            </div>
          )
        })}
        {decided.length > 0 && (
          <>
            <div style={{ color: C.lightBrown, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0.8rem 0 0.3rem' }}>Decided</div>
            {decided.map(r => (
              <div key={r.id} style={{ color: C.tan, fontSize: '0.82rem', padding: '0.2rem 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                <Pill color={r.status === 'approved' ? C.green : C.red}>{r.status}</Pill>
                {EMPLOYEES.find(x => x.id === r.empId)?.name} · {rangeLabel(r)} · {r.type} {fmtHours(requestHours(r))}
                <button onClick={() => decide(r.id, r.status === 'approved' ? 'denied' : 'approved')} style={{ background: 'none', border: 'none', color: C.lightBrown, textDecoration: 'underline', cursor: 'pointer', fontSize: '0.75rem' }}>
                  change to {r.status === 'approved' ? 'denied' : 'approved'}
                </button>
              </div>
            ))}
          </>
        )}
      </div>
    </>
  )
}

const timeInput: React.CSSProperties = { background: C.dark, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.4rem', fontSize: '0.9rem' }

// ── Employee (kiosk): my schedule, ask for time off ─────────────────────────

export function MySchedule({ emp, schedule, requests, setRequests, thisMonday, today, freePto, balance, onDone }: {
  emp: Employee; schedule: Schedule
  requests: TimeOffRequest[]; setRequests: React.Dispatch<React.SetStateAction<TimeOffRequest[]>>
  thisMonday: string; today: string
  freePto: number   // PTO hours they can still ask for
  balance: number   // PTO hours on the books right now
  onDone: (msg: string) => void
}) {
  const [asking, setAsking] = useState(false)
  const [type, setType] = useState<'PTO' | 'Unpaid'>('PTO')
  const [from, setFrom] = useState(addDaysISO(today, 1))
  const [to, setTo] = useState(addDaysISO(today, 1))
  const [partial, setPartial] = useState('')  // hours per day for a partial day; blank = full shift
  const [note, setNote] = useState('')

  const weeks = [thisMonday, addDaysISO(thisMonday, 7)]
  const mine = requests.filter(r => r.empId === emp.id)

  // Days asked for: every scheduled day in the range. Hours = full shift, or the partial amount.
  const asked: { date: string; hours: number }[] = []
  let unscheduled = 0
  if (from && to && to >= from) {
    for (let d = from; d <= to && asked.length + unscheduled < 31; d = addDaysISO(d, 1)) {
      const sh = schedule[key(emp.id, d)]
      if (!sh) { unscheduled++; continue }
      const full = scheduledHours(sh)
      const p = Number(partial)
      asked.push({ date: d, hours: partial && p > 0 ? Math.min(p, full) : full })
    }
  }
  const total = asked.reduce((t, d) => t + d.hours, 0)
  const overlaps = asked.filter(d => offOn(emp.id, d.date, requests))
  const problem =
    !(to >= from) ? 'The end date is before the start date.'
    : from <= today ? 'Pick a day after today.'
    : asked.length === 0 ? 'You aren’t scheduled any of those days.'
    : overlaps.length ? `You already have a request for ${overlaps.map(d => dateLabel(d.date, { weekday: 'short', month: 'numeric', day: 'numeric' })).join(', ')}.`
    : type === 'PTO' && total > freePto + 1e-9 ? `That’s ${total.toFixed(2)} h and you have ${freePto.toFixed(2)} h of PTO free. Ask for fewer hours, or send the rest as Unpaid.`
    : null

  const submit = () => {
    if (problem) return
    setRequests(rs => [...rs, { id: `r-${emp.id}-${from}-${rs.length}`, empId: emp.id, type, days: asked, note: note.trim(), status: 'pending', submitted: today }])
    setAsking(false); setNote(''); setPartial('')
    onDone(`Request sent: ${type} ${fmtHours(total)} (${asked.length} day${asked.length > 1 ? 's' : ''}). Your manager will approve or deny it — check back here.`)
  }

  const field: React.CSSProperties = { background: C.dark, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 6, padding: '0.6rem', fontSize: '1.05rem' }

  return (
    <div>
      {weeks.map(ws => (
        <div key={ws} style={{ marginBottom: '0.8rem' }}>
          <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>
            {ws === thisMonday ? 'This week' : 'Next week'} · {dateLabel(ws, { month: 'short', day: 'numeric' })}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 4 }}>
            {[0, 1, 2, 3, 4, 5, 6].map(i => {
              const d = addDaysISO(ws, i)
              const sh = schedule[key(emp.id, d)]
              const off = offOn(emp.id, d, requests)
              return (
                <div key={d} style={{ background: d === today ? C.medBrown : C.darkBrown, borderRadius: 6, padding: '0.4rem 0.2rem', textAlign: 'center', minHeight: 70, opacity: d < today ? 0.55 : 1 }}>
                  <div style={{ color: C.tan, fontSize: '0.72rem' }}>{dateLabel(d, { weekday: 'short' })} {dateLabel(d, { month: 'numeric', day: 'numeric' })}</div>
                  {sh ? <div style={{ color: C.cream, fontSize: '0.8rem', fontWeight: 700, lineHeight: 1.25 }}>{fmt12(sh.start)}<br />{fmt12(sh.end)}</div>
                      : <div style={{ color: C.lightBrown, fontSize: '0.8rem' }}>Off</div>}
                  {off && <div style={{ fontSize: '0.68rem', fontWeight: 700, color: off.r.status === 'approved' ? C.green : C.amber }}>{off.r.status === 'pending' ? 'Asked ' : ''}{off.r.type} {fmtHours(off.hours)}</div>}
                </div>
              )
            })}
          </div>
        </div>
      ))}

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.8rem', color: C.tan, fontSize: '0.9rem' }}>
        PTO: <b style={{ color: C.cream }}>{balance.toFixed(2)} h</b> on the books · <b style={{ color: C.green }}>{freePto.toFixed(2)} h</b> free to ask for
      </div>

      {!asking && <button style={bigBtn(C.green)} onClick={() => setAsking(true)}>Ask for time off</button>}

      {asking && (
        <div style={{ background: C.darkBrown, borderRadius: 6, padding: '0.9rem', marginBottom: '0.8rem' }}>
          <div style={{ display: 'flex', gap: 8, marginBottom: '0.7rem' }}>
            {(['PTO', 'Unpaid'] as const).map(t => (
              <button key={t} onClick={() => setType(t)} style={{ ...bigBtn(type === t ? (t === 'PTO' ? C.green : C.blue) : 'transparent'), border: `1px solid ${C.medBrown}`, color: type === t ? '#fff' : C.tan }}>
                {t === 'PTO' ? 'PTO (paid)' : 'Unpaid'}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: '0.7rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '0.7rem' }}>
            <label style={{ color: C.tan }}>From <input type="date" value={from} min={addDaysISO(today, 1)} onChange={e => { setFrom(e.target.value); if (to < e.target.value) setTo(e.target.value) }} style={field} /></label>
            <label style={{ color: C.tan }}>To <input type="date" value={to} min={from} onChange={e => setTo(e.target.value)} style={field} /></label>
            <label style={{ color: C.tan }}>Hours per day <input type="number" inputMode="decimal" min={0.5} step={0.5} placeholder="full shift" value={partial} onChange={e => setPartial(e.target.value)} style={{ ...field, width: 120 }} /></label>
          </div>
          <input placeholder="Note for your manager (optional)" value={note} onChange={e => setNote(e.target.value)} style={{ ...field, width: '100%', marginBottom: '0.7rem' }} />

          {asked.length > 0 && (
            <div style={{ color: C.cream, fontSize: '0.9rem', marginBottom: '0.5rem' }}>
              {asked.map(d => `${dateLabel(d.date, { weekday: 'short', month: 'numeric', day: 'numeric' })} ${fmtHours(d.hours)}`).join(' · ')}
              <div style={{ marginTop: 4 }}>
                Total <b>{fmtHours(total)}</b> {type}
                {type === 'PTO' && <> · PTO free after: <b style={{ color: freePto - total < 0 ? C.red : C.green }}>{(freePto - total).toFixed(2)} h</b></>}
                {unscheduled > 0 && <span style={{ color: C.lightBrown }}> · {unscheduled} day{unscheduled > 1 ? 's' : ''} you&apos;re already off skipped</span>}
              </div>
            </div>
          )}
          {problem && <div style={{ color: C.red, fontSize: '0.9rem', marginBottom: '0.5rem' }}>{problem}</div>}
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={{ ...bigBtn(C.green), opacity: problem ? 0.4 : 1 }} disabled={!!problem} onClick={submit}>Send request</button>
            <button style={{ ...bigBtn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={() => setAsking(false)}>Cancel</button>
          </div>
        </div>
      )}

      {mine.length > 0 && (
        <div style={{ marginTop: '0.8rem' }}>
          <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: 4 }}>My requests</div>
          {mine.map(r => (
            <div key={r.id} style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', color: C.cream, fontSize: '0.95rem', padding: '0.25rem 0' }}>
              <Pill color={r.status === 'approved' ? C.green : r.status === 'denied' ? C.red : C.amber}>{r.status === 'pending' ? 'waiting' : r.status}</Pill>
              {rangeLabel(r)} · {r.type} {fmtHours(requestHours(r))}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
