'use client'
// Timesheets for /timekeeping: who's on the clock today (with punch photos),
// and each person's pay week, where a manager can fix punches — a forgotten
// clock-out, a missed lunch punch, a shift that never got punched. Every fix
// needs a reason and shows as edited.

import { useState } from 'react'
import { addDaysISO, dateLabel } from '@/lib/dates'
import { Shift, accrualPerHour, annualPtoRate, calcShift, fmt12, fmtHours, splitOvertime, yearsOfService } from '@/lib/timekeeping'
import { TkEmployee } from '@/lib/timeclock'
import { BreakPills, C, Pill, Stat, api, breakTimes, btn, card, h2, td, th } from './shared'

type TkShift = Shift & { editedAt?: string | null; editNote?: string | null }

function PunchPhoto({ src, label }: { src?: string; label: string }) {
  return (
    <div style={{ textAlign: 'center', fontSize: '0.65rem', color: C.lightBrown }}>
      {src
        ? <a href={src} target="_blank" rel="noreferrer">
            {/* A signed, short-lived URL from a private bucket — nothing for next/image to optimize. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt={`${label} photo`} style={{ width: 54, height: 40, objectFit: 'cover', borderRadius: 3, display: 'block', transform: 'scaleX(-1)' }} />
          </a>
        : <div style={{ width: 54, height: 40, borderRadius: 3, border: '1px dashed rgba(166,120,90,0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>no photo</div>}
      {label}
    </div>
  )
}

const t12 = (t: string | null | undefined) => (t ? fmt12(t) : '—')

// ── Editing a shift ─────────────────────────────────────────────────────────

interface Draft { clockIn: string; clockOut: string; lunchStart: string; lunchEnd: string; breaks: string; note: string }

const draftOf = (s?: TkShift): Draft => ({
  clockIn: s?.clockIn ?? '', clockOut: s?.clockOut ?? '', lunchStart: s?.lunchStart ?? '', lunchEnd: s?.lunchEnd ?? '',
  breaks: s ? s.breaks.map(b => `${b.start}-${b.end ?? ''}`).join(', ') : '', note: '',
})

/** "09:30-09:45, 14:00-14:15" → break punches. */
function parseBreaks(text: string): { start: string; end: string | null }[] | string {
  const out: { start: string; end: string | null }[] = []
  for (const part of text.split(',').map(p => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d{1,2}:\d{2})\s*-\s*(\d{1,2}:\d{2})?$/)
    if (!m) return `Couldn't read the break "${part}". Write breaks like 09:30-09:45, 14:00-14:15.`
    const pad = (t: string) => t.padStart(5, '0')
    out.push({ start: pad(m[1]), end: m[2] ? pad(m[2]) : null })
  }
  return out
}

function ShiftEditor({ shift, employeeId, date, onDone }: {
  shift?: TkShift; employeeId: string; date: string; onDone: (saved: boolean) => void
}) {
  const [d, setD] = useState<Draft>(draftOf(shift))
  const [err, setErr] = useState('')
  const [saving, setSaving] = useState(false)
  const set = (k: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => setD(x => ({ ...x, [k]: e.target.value }))
  const input: React.CSSProperties = { background: C.dark, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.35rem', fontSize: '0.85rem' }

  const save = async () => {
    const breaks = parseBreaks(d.breaks)
    if (typeof breaks === 'string') { setErr(breaks); return }
    setSaving(true); setErr('')
    try {
      const body = { clockIn: d.clockIn, clockOut: d.clockOut || null, lunchStart: d.lunchStart || null, lunchEnd: d.lunchEnd || null, breaks, note: d.note }
      if (shift) await api('/api/timekeeping/shifts', { method: 'PATCH', body: JSON.stringify({ id: shift.id, ...body }) })
      else await api('/api/timekeeping/shifts', { method: 'POST', body: JSON.stringify({ employeeId, date, ...body }) })
      onDone(true)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }
  const remove = async () => {
    if (!shift || !confirm('Delete this shift? Only do this if it was punched by mistake — it comes off their hours.')) return
    setSaving(true)
    try { await api(`/api/timekeeping/shifts?id=${shift.id}`, { method: 'DELETE' }); onDone(true) }
    catch (e) { setErr((e as Error).message); setSaving(false) }
  }

  return (
    <div style={{ background: C.darkBrown, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.7rem', margin: '0.4rem 0' }}>
      <div style={{ color: C.cream, fontWeight: 700, marginBottom: 6 }}>{shift ? 'Fix' : 'Add'} shift · {dateLabel(date)}</div>
      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center', color: C.tan, fontSize: '0.82rem' }}>
        <label>In <input type="time" value={d.clockIn} onChange={set('clockIn')} style={input} /></label>
        <label>Out <input type="time" value={d.clockOut} onChange={set('clockOut')} style={input} /></label>
        <label>Lunch <input type="time" value={d.lunchStart} onChange={set('lunchStart')} style={input} /></label>
        <label>to <input type="time" value={d.lunchEnd} onChange={set('lunchEnd')} style={input} /></label>
        <label>Breaks <input value={d.breaks} onChange={set('breaks')} placeholder="09:30-09:45, 14:00-14:15" style={{ ...input, width: 220 }} /></label>
      </div>
      <input value={d.note} onChange={set('note')} placeholder="Why? (required — e.g. forgot to clock out, left at 3:30 per Charlie)"
        style={{ ...input, width: '100%', marginTop: 8 }} />
      {err && <div style={{ color: C.red, fontSize: '0.82rem', marginTop: 6 }}>{err}</div>}
      <div style={{ display: 'flex', gap: 6, marginTop: 8 }}>
        <button style={btn(C.green)} disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save'}</button>
        <button style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }} onClick={() => onDone(false)}>Cancel</button>
        {shift && <button style={{ ...btn('transparent'), border: `1px solid ${C.red}`, color: C.red, marginLeft: 'auto' }} disabled={saving} onClick={remove}>Delete shift</button>}
      </div>
    </div>
  )
}

// ── Tab ─────────────────────────────────────────────────────────────────────

export function TimesheetTab({ employees, shifts, photos, thisMonday, today, now, earliest, reload }: {
  employees: TkEmployee[]; shifts: TkShift[]; photos: Record<string, string>
  thisMonday: string; today: string; now: string | null
  earliest: string  // oldest shift date loaded
  reload: () => Promise<void>
}) {
  const [weekStart, setWeekStart] = useState(addDaysISO(thisMonday, -7))
  const weekEnd = addDaysISO(weekStart, 6)
  const days = [0, 1, 2, 3, 4, 5, 6].map(i => addDaysISO(weekStart, i))
  const [empId, setEmpId] = useState<string>('all')
  const [editing, setEditing] = useState<{ shiftId?: string; empId: string; date: string } | null>(null)
  const nowHHMM = now ?? '00:00'
  const nameOf = (id: string) => employees.find(e => e.id === id)?.name ?? '?'

  const week = shifts.filter(s => s.date >= weekStart && s.date <= weekEnd)
  const shown = employees.filter(e => (empId === 'all' || e.id === empId) && (e.active || week.some(s => s.empId === e.id)))
  // On the clock now, plus anything left open from an earlier day — those need a manager.
  const live = shifts.filter(s => s.date === today || !s.clockOut)

  const done = async (saved: boolean) => { setEditing(null); if (saved) await reload() }

  return (
    <>
      <div style={card}>
        <h2 style={h2}>Today · {dateLabel(today)}</h2>
        <p style={{ color: C.tan, fontSize: '0.78rem', margin: '0 0 0.5rem' }}>Photos come from the iPad&apos;s front camera at each punch, so you can see who actually punched. Tap one to enlarge.</p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead><tr><th style={th}>Employee</th><th style={th}>In</th><th style={th}>Lunch</th><th style={th}>Breaks</th><th style={th}>Out</th><th style={th}>Paid</th><th style={th}>Break pay</th><th style={th}>Punch photos</th><th style={th} /></tr></thead>
            <tbody>
              {live.length === 0 && <tr><td style={td} colSpan={9}>Nobody yet.</td></tr>}
              {live.map(s => {
                const onLunch = !!s.lunchStart && !s.lunchEnd && !s.clockOut
                const onBreak = !s.clockOut && s.breaks.some(b => !b.end)
                const stale = !s.clockOut && s.date !== today
                const c = calcShift(s, stale ? s.clockIn : nowHHMM)
                return (
                  <tr key={s.id}>
                    <td style={td}>{nameOf(s.empId)}{stale && <div style={{ color: C.red, fontSize: '0.75rem' }}>open since {dateLabel(s.date, { weekday: 'short', month: 'numeric', day: 'numeric' })} — never clocked out</div>}</td>
                    <td style={td}>{t12(s.clockIn)}</td>
                    <td style={td}>{s.lunchStart ? `${t12(s.lunchStart)}–${s.lunchEnd ? t12(s.lunchEnd) : '…'}` : '—'}</td>
                    <td style={{ ...td, fontSize: '0.78rem' }}>{breakTimes(s)}</td>
                    <td style={td}>{s.clockOut ? t12(s.clockOut) : <Pill color={stale ? C.red : onLunch || onBreak ? C.amber : C.green}>{stale ? 'still open' : onLunch ? 'at lunch' : onBreak ? 'on break' : 'on clock'}</Pill>}</td>
                    <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{stale ? '—' : fmtHours(c.workedHours)}</td>
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
                    <td style={td}><button style={btn(stale ? C.red : C.medBrown)} onClick={() => setEditing({ shiftId: s.id, empId: s.empId, date: s.date })}>Fix</button></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {editing && live.some(s => s.id === editing.shiftId) && (
          <ShiftEditor shift={live.find(s => s.id === editing.shiftId)} employeeId={editing.empId} date={editing.date} onDone={done} />
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
        <button style={btn(C.medBrown)} onClick={() => setWeekStart(w => addDaysISO(w, -7))} disabled={weekStart <= earliest}>←</button>
        <span style={{ color: C.cream, fontWeight: 700 }}>
          Pay week {dateLabel(weekStart, { month: 'short', day: 'numeric' })} – {dateLabel(weekEnd, { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        <button style={btn(C.medBrown)} onClick={() => setWeekStart(w => addDaysISO(w, 7))} disabled={weekStart >= thisMonday}>→</button>
        <select value={empId} onChange={e => setEmpId(e.target.value)} style={{ background: C.dark, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.4rem', fontSize: '0.85rem' }}>
          <option value="all">All employees</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.name}{e.active ? '' : ' (inactive)'}</option>)}
        </select>
      </div>

      {shown.length === 0 && <div style={{ ...card, color: C.tan }}>No one to show. Add people on the Employees tab.</div>}
      {shown.map(e => {
        const rows = week.filter(s => s.empId === e.id).sort((a, b) => a.date.localeCompare(b.date) || a.clockIn.localeCompare(b.clockIn))
        const calcs = rows.map(s => calcShift(s, s.date === today ? nowHHMM : s.clockIn))
        const total = calcs.reduce((t, c) => t + c.workedHours, 0)
        const { regular, overtime } = splitOvertime(total)
        const paidBreakHrs = calcs.reduce((t, c) => t + c.paidBreakMinutes / 60, 0)
        const uptoMin = calcs.reduce((t, c) => t + c.uptoMinutes, 0)
        const years = yearsOfService(e.hireDate, weekEnd)
        const ptoThisWeek = rows.reduce((t, s, i) => t + calcs[i].workedHours * accrualPerHour(yearsOfService(e.hireDate, s.date)), 0)
        const flagCount = calcs.reduce((t, c) => t + c.flags.length, 0) + rows.filter(s => !s.clockOut && s.date !== today).length
        const worked = new Set(rows.map(s => s.date))

        return (
          <div key={e.id} style={card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
              <h2 style={h2}>{e.name} <span style={{ color: C.lightBrown, fontSize: '0.75rem', textTransform: 'none' }}>{e.role ? `· ${e.role}` : ''}</span></h2>
              {rows.length === 0 ? <Pill color={C.lightBrown}>No punches</Pill> : flagCount > 0 ? <Pill color={C.amber}>{flagCount} to review</Pill> : <Pill color={C.green}>Clean</Pill>}
            </div>
            {rows.length > 0 && (
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead><tr><th style={th}>Day</th><th style={th}>In</th><th style={th}>Lunch</th><th style={th}>Breaks</th><th style={th}>Out</th><th style={th}>Paid</th><th style={th}>UPTO</th><th style={th}>Break pay</th><th style={th}>PTO</th><th style={th}>Notes</th><th style={th} /></tr></thead>
                  <tbody>
                    {rows.map((s, i) => {
                      const c = calcs[i]
                      const open = !s.clockOut
                      return (
                        <tr key={s.id}>
                          <td style={td}>{dateLabel(s.date, { weekday: 'short', month: 'numeric', day: 'numeric' })}</td>
                          <td style={td}>{t12(s.clockIn)}</td>
                          <td style={td}>{s.lunchStart ? `${t12(s.lunchStart)}–${s.lunchEnd ? t12(s.lunchEnd) : '…'}` : '—'}</td>
                          <td style={{ ...td, fontSize: '0.78rem' }}>{breakTimes(s)}</td>
                          <td style={td}>{open ? <Pill color={s.date === today ? C.green : C.red}>{s.date === today ? 'on clock' : 'never out'}</Pill> : t12(s.clockOut)}</td>
                          <td style={{ ...td, fontVariantNumeric: 'tabular-nums' }}>{fmtHours(c.workedHours)}</td>
                          <td style={{ ...td, fontVariantNumeric: 'tabular-nums', color: c.uptoMinutes > 0 ? C.red : C.cream }}>{c.uptoMinutes ? `${c.uptoMinutes} min` : '—'}</td>
                          <td style={td}><BreakPills c={c} /></td>
                          <td style={{ ...td, color: C.green, fontVariantNumeric: 'tabular-nums' }}>+{(c.workedHours * accrualPerHour(yearsOfService(e.hireDate, s.date))).toFixed(2)}</td>
                          <td style={{ ...td, fontSize: '0.78rem', maxWidth: 280 }}>
                            <span style={{ color: C.amber }}>{c.flags.join(' ')}</span>
                            {s.editedAt && <div style={{ color: C.blue }}>✎ Edited: {s.editNote}</div>}
                          </td>
                          <td style={td}><button style={btn(C.medBrown)} onClick={() => setEditing({ shiftId: s.id, empId: e.id, date: s.date })}>Fix</button></td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {editing?.empId === e.id && editing.date >= weekStart && editing.date <= weekEnd && !live.some(s => s.id === editing.shiftId) && (
              <ShiftEditor shift={rows.find(s => s.id === editing.shiftId)} employeeId={e.id} date={editing.date} onDone={done} />
            )}
            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', alignItems: 'center', margin: '0.5rem 0', fontSize: '0.78rem', color: C.lightBrown }}>
              Add a missed shift:
              {days.filter(d => d <= today && !worked.has(d)).map(d => (
                <button key={d} onClick={() => setEditing({ empId: e.id, date: d })}
                  style={{ background: 'none', border: `1px solid ${C.medBrown}`, borderRadius: 4, color: C.tan, cursor: 'pointer', fontSize: '0.75rem', padding: '0.15rem 0.4rem' }}>
                  + {dateLabel(d, { weekday: 'short' })}
                </button>
              ))}
            </div>
            {rows.length > 0 && (
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', marginTop: '0.4rem' }}>
                <Stat label="Paid hours" value={fmtHours(total)} sub={`incl. ${fmtHours(paidBreakHrs)} paid breaks`} />
                <Stat label="UPTO" value={`${uptoMin} min`} sub="break time over the paid allowance" color={uptoMin > 0 ? C.red : C.cream} />
                <Stat label="Regular" value={fmtHours(regular)} />
                <Stat label="Overtime 1.5×" value={fmtHours(overtime)} color={overtime > 0 ? C.amber : C.cream} />
                <Stat label="PTO earned" value={`${ptoThisWeek.toFixed(2)} h`} sub={`at ${annualPtoRate(years)} h / 2080`} color={C.green} />
              </div>
            )}
          </div>
        )
      })}
    </>
  )
}
