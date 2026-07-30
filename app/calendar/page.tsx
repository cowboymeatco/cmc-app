'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
}

type Lane = 'receiving' | 'harvest' | 'processing' | 'smokehouse'

interface CalEvent {
  id: string; lane: Lane; date: string; title: string; subtitle?: string; status?: string
}

const LANES: { key: Lane; label: string; emoji: string; color: string }[] = [
  { key: 'receiving',  label: 'Receiving',  emoji: '📦', color: '#60A5FA' },
  { key: 'harvest',    label: 'Harvest',    emoji: '🐄', color: '#F87171' },
  { key: 'processing', label: 'Processing', emoji: '🔪', color: '#FBBF24' },
  { key: 'smokehouse', label: 'Smokehouse', emoji: '🔥', color: '#FB923C' },
]
const LANE_COLOR: Record<Lane, string> = Object.fromEntries(LANES.map(l => [l.key, l.color])) as Record<Lane, string>

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// Local-timezone ISO (no UTC shift — the calendar is a wall-clock grid)
const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// The 42-cell (6-week) grid covering a month, starting on the Sunday on/before the 1st.
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}

export default function MasterCalendar() {
  const todayISO = toISO(new Date())
  const [year,  setYear]  = useState(() => new Date().getFullYear())
  const [month, setMonth] = useState(() => new Date().getMonth())
  const [active, setActive] = useState<Set<Lane>>(() => new Set(LANES.map(l => l.key)))
  const [events, setEvents] = useState<CalEvent[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const grid = useMemo(() => monthGrid(year, month), [year, month])
  const rangeFrom = toISO(grid[0])
  const rangeTo   = toISO(grid[41])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr('')
    fetch(`/api/calendar?from=${rangeFrom}&to=${rangeTo}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setEvents(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancelled) setErr('Could not load the calendar.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [rangeFrom, rangeTo])

  // date → events, filtered to the active lanes
  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of events) {
      if (!active.has(e.lane)) continue
      if (!m.has(e.date)) m.set(e.date, [])
      m.get(e.date)!.push(e)
    }
    return m
  }, [events, active])

  // per-lane counts for this month (drives the filter chips)
  const laneCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of events) if (e.date.slice(0, 7) === `${year}-${String(month + 1).padStart(2, '0')}`) c[e.lane] = (c[e.lane] ?? 0) + 1
    return c
  }, [events, year, month])

  function shift(delta: number) {
    const d = new Date(year, month + delta, 1)
    setYear(d.getFullYear()); setMonth(d.getMonth())
  }
  function goToday() { const d = new Date(); setYear(d.getFullYear()); setMonth(d.getMonth()) }
  function toggleLane(k: Lane) {
    setActive(prev => {
      const next = new Set(prev)
      if (next.has(k)) next.delete(k); else next.add(k)
      return next
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', gap: '1rem',
      }}>
        <Link href="/schedule" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Schedule</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Master Calendar
          </h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
            Every lane on one calendar · Phase 1 (preview)
          </p>
        </div>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 1280, margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Controls: month nav + asset-class filter */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button onClick={() => shift(-1)} style={navBtn}>‹</button>
            <div style={{ minWidth: 190, textAlign: 'center', color: C.cream, fontWeight: 700, fontSize: '1rem' }}>{MONTHS[month]} {year}</div>
            <button onClick={() => shift(1)} style={navBtn}>›</button>
            <button onClick={goToday} style={{ ...navBtn, width: 'auto', padding: '0 0.8rem', fontSize: '0.78rem' }}>Today</button>
          </div>
          <div style={{ flex: 1 }} />
          <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap' }}>
            {LANES.map(l => {
              const on = active.has(l.key)
              return (
                <button key={l.key} onClick={() => toggleLane(l.key)} style={{
                  display: 'flex', alignItems: 'center', gap: '0.35rem',
                  background: on ? `${l.color}22` : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${on ? l.color : 'rgba(166,120,90,0.25)'}`,
                  borderRadius: 4, padding: '0.35rem 0.7rem', cursor: 'pointer',
                  color: on ? C.cream : C.lightBrown, fontSize: '0.78rem', fontWeight: on ? 700 : 400,
                }}>
                  <span style={{ width: 9, height: 9, borderRadius: 2, background: l.color, opacity: on ? 1 : 0.4 }} />
                  {l.emoji} {l.label}
                  <span style={{ color: on ? l.color : C.lightBrown, fontWeight: 700 }}>{laneCounts[l.key] ?? 0}</span>
                </button>
              )
            })}
          </div>
        </div>

        {err && <div style={{ padding: '0.75rem', color: '#E8883A', fontSize: '0.85rem' }}>{err}</div>}

        {/* Weekday header */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, marginBottom: 1 }}>
          {WEEKDAYS.map(w => (
            <div key={w} style={{ textAlign: 'center', color: C.tan, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, padding: '0.4rem 0' }}>{w}</div>
          ))}
        </div>

        {/* Month grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 1, background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 4, overflow: 'hidden', opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s' }}>
          {grid.map(d => {
            const iso = toISO(d)
            const inMonth = d.getMonth() === month
            const isToday = iso === todayISO
            const dayEvents = byDay.get(iso) ?? []
            const shown = dayEvents.slice(0, 4)
            const extra = dayEvents.length - shown.length
            return (
              <div key={iso} style={{
                background: inMonth ? C.dark : '#140803',
                minHeight: 108, padding: '0.35rem 0.4rem',
                display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                <div style={{
                  fontSize: '0.72rem', fontWeight: isToday ? 800 : 500, alignSelf: 'flex-end',
                  color: isToday ? C.dark : inMonth ? C.cream : 'rgba(166,120,90,0.45)',
                  background: isToday ? C.tan : 'transparent', borderRadius: 10,
                  minWidth: 18, height: 18, lineHeight: '18px', textAlign: 'center', padding: isToday ? '0 5px' : 0,
                }}>{d.getDate()}</div>
                {shown.map(e => (
                  <div key={e.id} title={`${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}${e.status ? ` (${e.status})` : ''}`} style={{
                    borderLeft: `3px solid ${LANE_COLOR[e.lane]}`,
                    background: `${LANE_COLOR[e.lane]}18`, borderRadius: 3,
                    padding: '1px 4px', fontSize: '0.68rem', color: C.cream,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>{e.title}{e.subtitle ? <span style={{ color: C.lightBrown }}> · {e.subtitle}</span> : null}</div>
                ))}
                {extra > 0 && <div style={{ fontSize: '0.64rem', color: C.lightBrown, paddingLeft: 4 }}>+{extra} more</div>}
              </div>
            )
          })}
        </div>

        <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.75rem', lineHeight: 1.6 }}>
          <strong style={{ color: C.tan }}>Phase 1</strong> — every operational lane on one calendar, off the dates each already
          carries: <strong style={{ color: C.tan }}>Receiving</strong> (animals &amp; box product in),
          <strong style={{ color: C.tan }}> Harvest</strong> (booked kill days),
          <strong style={{ color: C.tan }}> Processing</strong> (packing sessions), and
          <strong style={{ color: C.tan }}> Smokehouse</strong> (value-add jobs). Use the chips to filter by asset class.
          Planned-vs-actual metrics come next in Phase 2.
        </p>
      </main>
    </div>
  )
}

const navBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 4, background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(166,120,90,0.35)', color: C.cream, fontSize: '1.1rem',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}
