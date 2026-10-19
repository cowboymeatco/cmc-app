'use client'
// The cut schedule as a week: one column per cutting day, the undated pile in
// a rail on the left, kill days shaded, and each day's pounds against the
// daily limit (Charlie, 2026-10-11: "Optimize the day break or maybe graduate
// into a calendar view?" — the calendar, with days measured in pounds).
//
// A projection, not a second model. The plan is still the one ordered list
// with day breaks that the list view, the save, the crew view and the print
// all read; dropping a card on a column just moves its row under that day's
// break (making the break if the day has none). Switch views any time and
// nothing is lost.

import { useState } from 'react'
import {
  type ListItem, type ScheduleEntry, type FutureItem, type HarvestDay, type CarcassAverages,
  dayLoads, rowLbs, speciesColor, speciesIcon, portionBadge, hangColor, weekDatesISO,
} from '@/lib/cutSchedule'
import { dateLabel, addDaysISO, mondayOfISO, dayOfWeekISO } from '@/lib/dates'

const C = {
  dark: '#1A0A04', darkBrown: '#351E0E', medBrown: '#75471B', lightBrown: '#A6785A',
  tan: '#C9A882', cream: '#F2E8D9', green: '#4CAF50', red: '#EF4444', amber: '#F59E0B',
}

const fmtLbs = (n: number) => Math.round(n).toLocaleString()

export default function WeekView({
  entries, cutDates, noDayKeys, railFutures, harvestDays, averages, averagesNote,
  lbsPerDay, lbsPerDayNote, onLbsPerDay, todayISO, atCutByKey,
  dragging, onDragStart, onDragEnd, onDropOnDay, onDropBefore, onDropToRail, onLayout, layoutBusy,
}: {
  entries:       ListItem[]
  cutDates:      Map<string, string>
  noDayKeys:     Set<string>
  /** Not-yet-harvested heads still in the rail, inside the bookings window. */
  railFutures:   FutureItem[]
  harvestDays:   HarvestDay[]
  averages:      CarcassAverages
  averagesNote:  string
  lbsPerDay:     number
  lbsPerDayNote: string
  onLbsPerDay:   (n: number) => void
  todayISO:      string
  atCutByKey:    Map<string, number>
  dragging:      string | null
  onDragStart:   (key: string) => void
  onDragEnd:     () => void
  onDropOnDay:   (date: string) => void
  onDropBefore:  (targetKey: string) => void
  onDropToRail:  () => void
  onLayout:      () => void
  layoutBusy:    boolean
}) {
  const [monday, setMonday] = useState(mondayOfISO(todayISO))
  const [overDay, setOverDay] = useState<string | null>(null)
  const [overKey, setOverKey] = useState<string | null>(null)
  const [lbsDraft, setLbsDraft] = useState<string | null>(null)

  const loads = dayLoads(entries, averages)
  const killByDate = new Map(harvestDays.map(h => [h.date, h]))

  // Mon–Fri always; a weekend column only when the plan actually has a day
  // there (it happens — a Saturday cut before a holiday).
  const week = weekDatesISO(monday)
  const days = week.filter(d => {
    const dow = dayOfWeekISO(d)
    return (dow >= 1 && dow <= 5) || loads.has(d)
  })

  // Rows by day, in list order (the order the crew cuts in).
  const rowsByDay = new Map<string, ListItem[]>()
  for (const e of entries) {
    if (e.type === 'break') continue
    const d = cutDates.get(e.key)
    if (!d) continue
    rowsByDay.set(d, [...(rowsByDay.get(d) ?? []), e])
  }

  const railCarcasses = entries.filter((e): e is ScheduleEntry => e.type === 'carcass' && noDayKeys.has(e.key))
  const railLbs = (() => {
    const seen = new Set<string>(); let lbs = 0
    for (const e of railCarcasses) { if (seen.has(e.harvest_log_id)) continue; seen.add(e.harvest_log_id); lbs += rowLbs(e, averages).lbs }
    return { head: seen.size, lbs }
  })()
  // One card per booking in the rail; dragging it moves one head.
  const railBookings = (() => {
    const by = new Map<string, FutureItem[]>()
    for (const f of railFutures) by.set(f.appointment_id, [...(by.get(f.appointment_id) ?? []), f])
    return [...by.values()].map(list => list.sort((a, b) => a.seq - b.seq))
      .sort((a, b) => a[0].harvest_date.localeCompare(b[0].harvest_date) || a[0].source.localeCompare(b[0].source))
  })()

  // Elsewhere in the plan but not this week — so the nav tells you where to look.
  const otherWeeks = [...loads.keys()].filter(d => !week.includes(d)).sort()
  const earlier = otherWeeks.filter(d => d < monday).length
  const later   = otherWeeks.filter(d => d > week[6]).length

  const commitLbs = () => {
    if (lbsDraft == null) return
    const n = Math.round(Number(lbsDraft))
    setLbsDraft(null)
    if (Number.isFinite(n) && n > 0 && n !== lbsPerDay) onLbsPerDay(n)
  }

  const navBtn: React.CSSProperties = {
    background: 'rgba(201,168,130,0.12)', color: C.tan, border: '1px solid rgba(201,168,130,0.45)',
    borderRadius: 4, padding: '0.35rem 0.7rem', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer', whiteSpace: 'nowrap',
  }

  // ── A card ──────────────────────────────────────────────────────────────────
  const card = (e: ListItem, opts: { count?: number } = {}) => {
    if (e.type === 'break') return null
    const isDragging = dragging === e.key
    const isOver = overKey === e.key
    const { lbs, estimated } = rowLbs(e, averages)
    const common: React.CSSProperties = {
      background: e.type === 'future' ? 'rgba(0,0,0,0.18)' : C.dark,
      border: `1px ${e.type === 'future' ? 'dashed' : 'solid'} ${isOver ? C.amber : 'rgba(166,120,90,0.25)'}`,
      borderLeft: `4px ${e.type === 'future' ? 'dashed' : 'solid'} ${speciesColor(e.species)}`,
      borderRadius: 4, padding: '0.4rem 0.5rem', cursor: 'grab',
      opacity: isDragging ? 0.4 : 1, fontSize: '0.74rem', color: C.cream, lineHeight: 1.35,
      boxShadow: isOver ? `0 0 0 2px ${C.amber}44` : 'none',
    }
    const handlers = {
      draggable: true,
      onDragStart: () => onDragStart(e.key),
      onDragEnd,
      onDragOver: (ev: React.DragEvent) => { ev.preventDefault(); ev.stopPropagation(); if (overKey !== e.key) setOverKey(e.key) },
      onDragLeave: () => { if (overKey === e.key) setOverKey(null) },
      onDrop: (ev: React.DragEvent) => { ev.preventDefault(); ev.stopPropagation(); setOverKey(null); setOverDay(null); onDropBefore(e.key) },
    }
    if (e.type === 'future') {
      const n = opts.count ?? 1
      return (
        <div key={e.key} {...handlers} style={common}
          title={`Booked, not harvested yet — harvest ${dateLabel(e.harvest_date, { weekday: 'short', month: 'short', day: 'numeric' })}. Weighed at the ${e.species} average of ${fmtLbs(lbs)} lb.`}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
            <span style={{ fontWeight: 700, color: C.tan, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {speciesIcon(e.species)} {e.source || 'Booked'}
            </span>
            <span style={{ color: C.lightBrown, whiteSpace: 'nowrap' }}>~{fmtLbs(lbs * n)} lb</span>
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.68rem' }}>
            🔮 kill {dateLabel(e.harvest_date, { month: 'short', day: 'numeric' })}
            {n > 1 ? ` · ${n} head (drag moves one)` : e.head_count > 1 ? ` · ${e.seq} of ${e.head_count}` : ''}
          </div>
        </div>
      )
    }
    const name = (e.customer_name ?? '').trim()
    const shown = name || (e.producer ?? '').trim() || 'No buyer yet'
    const atCut = atCutByKey.get(e.key) ?? e.days_hanging
    const pb = portionBadge(e.portion)
    const sheet = e.sheet_state === 'have' ? { t: '✓ sheet', c: C.green }
      : e.sheet_state === 'waiting' ? { t: '⚠ sheet', c: C.red }
      : { t: 'no buyer', c: C.amber }
    return (
      <div key={e.key} {...handlers} style={common}
        title={`${e.carcass_tag ? `Tag ${e.carcass_tag} · ` : ''}${e.species}${e.producer ? ` · ${e.producer}` : ''} · killed ${dateLabel(e.harvest_date, { month: 'short', day: 'numeric' })}${estimated ? ` · no weight yet, shown at the ${e.species} average` : ''}`}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6 }}>
          <span style={{ fontFamily: 'monospace', fontWeight: 700, color: C.cream }}>
            {speciesIcon(e.species)} {e.carcass_tag || '—'}
          </span>
          <span style={{ color: estimated ? C.lightBrown : C.cream, whiteSpace: 'nowrap', fontStyle: estimated ? 'italic' : 'normal' }}>
            {estimated ? '~' : ''}{fmtLbs(lbs)} lb
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 5, minWidth: 0 }}>
          <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: name ? C.cream : C.tan, fontStyle: name ? 'normal' : 'italic' }}>{shown}</span>
          <span style={{ color: pb.color, fontWeight: 700, fontSize: '0.68rem', flexShrink: 0 }}>{pb.label}</span>
          {e.locked && <span title="Locked" style={{ fontSize: '0.68rem' }}>🔒</span>}
        </div>
        <div style={{ display: 'flex', gap: 8, fontSize: '0.66rem', color: C.lightBrown }}>
          <span style={{ color: hangColor(atCut), fontWeight: 700 }}>
            {e.days_hanging}d{atCut !== e.days_hanging ? ` → ${atCut}d` : ''}
          </span>
          <span style={{ color: sheet.c }}>{sheet.t}</span>
          {e.carried_from && <span title={`Still hanging from ${dateLabel(e.carried_from)}`}>↪ {dateLabel(e.carried_from, { weekday: 'short', month: 'numeric', day: 'numeric' })}</span>}
        </div>
      </div>
    )
  }

  // ── Layout ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
      {/* Week toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
        <button onClick={() => setMonday(addDaysISO(monday, -7))} style={navBtn} title="Previous week">◀</button>
        <button onClick={() => setMonday(mondayOfISO(todayISO))} style={navBtn}>This week</button>
        <button onClick={() => setMonday(addDaysISO(monday, 7))} style={navBtn} title="Next week">▶</button>
        <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.9rem' }}>
          Week of {dateLabel(monday, { month: 'short', day: 'numeric' })} – {dateLabel(week[6], { month: 'short', day: 'numeric', year: 'numeric' })}
        </span>
        {(earlier > 0 || later > 0) && (
          <span style={{ color: C.lightBrown, fontSize: '0.72rem' }}>
            {earlier > 0 && `${earlier} cutting day${earlier !== 1 ? 's' : ''} earlier`}
            {earlier > 0 && later > 0 && ' · '}
            {later > 0 && `${later} cutting day${later !== 1 ? 's' : ''} later`}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.74rem', color: C.lightBrown }} title={lbsPerDayNote}>
          A full day =
          <input
            type="number" min={100} step={50}
            value={lbsDraft ?? String(lbsPerDay)}
            onChange={e => setLbsDraft(e.target.value)}
            onBlur={commitLbs}
            onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
            style={{ width: 76, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 3, color: C.cream, fontSize: '0.8rem', padding: '3px 6px', textAlign: 'right' }}
          />
          lb
        </label>
        <button
          onClick={onLayout}
          disabled={layoutBusy || (railCarcasses.length === 0 && railFutures.length === 0)}
          title={`Put everything with no cutting day into the coming days, heaviest priority first, filling each day to ${fmtLbs(lbsPerDay)} lb. Days already laid out are left alone. ${averagesNote}`}
          style={{
            background: 'rgba(245,158,11,0.12)', color: C.amber, border: '1px solid rgba(245,158,11,0.45)',
            borderRadius: 4, padding: '0.45rem 0.9rem', fontWeight: 700, fontSize: '0.82rem',
            cursor: layoutBusy ? 'wait' : 'pointer', whiteSpace: 'nowrap',
            opacity: (railCarcasses.length === 0 && railFutures.length === 0) ? 0.5 : 1,
          }}
        >
          ⚖ Lay out by weight
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'stretch', minHeight: 420 }}>
        {/* Rail: nothing dated above these */}
        <div
          onDragOver={e => { e.preventDefault(); if (overDay !== '__rail__') setOverDay('__rail__') }}
          onDragLeave={() => { if (overDay === '__rail__') setOverDay(null) }}
          onDrop={e => { e.preventDefault(); setOverDay(null); setOverKey(null); onDropToRail() }}
          style={{
            flex: '0 0 200px', display: 'flex', flexDirection: 'column', gap: '0.35rem',
            background: 'rgba(0,0,0,0.2)', border: `1px dashed ${overDay === '__rail__' ? C.amber : 'rgba(166,120,90,0.35)'}`,
            borderRadius: 6, padding: '0.5rem',
          }}
        >
          <div style={{ color: C.tan, fontSize: '0.7rem', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>No day yet</div>
          <div style={{ color: C.lightBrown, fontSize: '0.7rem', marginBottom: '0.25rem' }}>
            {railLbs.head} head · {fmtLbs(railLbs.lbs)} lb on the rail
            {railFutures.length > 0 && <><br />{railFutures.length} booked, not killed</>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', overflowY: 'auto', maxHeight: 640 }}>
            {railCarcasses.map(e => card(e))}
            {railBookings.map(list => card(list[0], { count: list.length }))}
            {railCarcasses.length === 0 && railFutures.length === 0 && (
              <div style={{ color: C.medBrown, fontSize: '0.72rem', fontStyle: 'italic', padding: '0.5rem 0' }}>Everything has a day.</div>
            )}
          </div>
        </div>

        {/* Day columns */}
        <div style={{ flex: 1, display: 'grid', gridTemplateColumns: `repeat(${days.length}, minmax(0, 1fr))`, gap: '0.5rem', minWidth: 0 }}>
          {days.map(d => {
            const load = loads.get(d)
            const kill = killByDate.get(d)
            const rows = rowsByDay.get(d) ?? []
            const isToday = d === todayISO
            const past = d < todayISO
            const pct = lbsPerDay > 0 && load ? load.lbs / lbsPerDay : 0
            const over = pct > 1.001
            const barColor = over ? C.red : pct > 0.85 ? C.amber : C.green
            const isOver = overDay === d
            return (
              <div
                key={d}
                onDragOver={e => { e.preventDefault(); if (overDay !== d) setOverDay(d) }}
                onDragLeave={e => { if (e.currentTarget === e.target && overDay === d) setOverDay(null) }}
                onDrop={e => { e.preventDefault(); setOverDay(null); setOverKey(null); onDropOnDay(d) }}
                style={{
                  display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0,
                  background: kill && rows.length === 0 ? 'rgba(166,120,90,0.08)' : 'rgba(0,0,0,0.12)',
                  border: `1px solid ${isOver ? C.amber : isToday ? 'rgba(245,158,11,0.55)' : 'rgba(166,120,90,0.22)'}`,
                  borderRadius: 6, padding: '0.5rem', opacity: past ? 0.75 : 1,
                  boxShadow: isOver ? `0 0 0 2px ${C.amber}44` : 'none',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                  <span style={{ color: isToday ? C.amber : C.cream, fontWeight: 700, fontSize: '0.82rem' }}>
                    {dateLabel(d, { weekday: 'short' })} <span style={{ color: C.lightBrown, fontWeight: 400 }}>{dateLabel(d, { month: 'numeric', day: 'numeric' })}</span>
                  </span>
                  {load && <span style={{ color: C.tan, fontSize: '0.7rem' }}>{load.head} head</span>}
                </div>
                {kill && (
                  <div title="Kill day off the harvest calendar — the crew is on the harvest floor" style={{ color: C.tan, fontSize: '0.66rem', background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, padding: '1px 6px' }}>
                    🔪 killing {kill.head} head
                  </div>
                )}
                <div title={load ? `${fmtLbs(load.lbs)} lb of ${fmtLbs(lbsPerDay)}${load.estLbs > 0 ? ` (${fmtLbs(load.estLbs)} lb estimated on ${load.estHead} row${load.estHead !== 1 ? 's' : ''})` : ''}` : 'No cutting day here yet — drop a carcass to start one'}>
                  <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 3, overflow: 'hidden' }}>
                    <div style={{ width: `${Math.min(100, pct * 100)}%`, height: '100%', background: barColor, transition: 'width 0.15s' }} />
                  </div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.66rem', color: over ? C.red : C.lightBrown, marginTop: 2 }}>
                    <span>{load ? `${load.estLbs > 0 ? '~' : ''}${fmtLbs(load.lbs)} lb` : '—'}</span>
                    <span>{load ? `${Math.round(pct * 100)}%` : ''}</span>
                  </div>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem', flex: 1 }}>
                  {rows.map(e => card(e))}
                  {rows.length === 0 && !kill && (
                    <div style={{ flex: 1, minHeight: 60, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.medBrown, fontSize: '0.7rem', fontStyle: 'italic', border: '1px dashed rgba(166,120,90,0.18)', borderRadius: 4 }}>
                      drop here
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <p style={{ margin: 0, fontSize: '0.72rem', color: C.lightBrown, lineHeight: 1.5 }}>
        Drop a card on a day to move it there (a day with nothing on it gets its day break made for you); drop it on another card to put it ahead of that one; drop it back on the rail to take its day away.
        Weights marked ~ are the species average from our own kills ({averagesNote}). Save when it looks right — same Save as the list.
      </p>
    </div>
  )
}
