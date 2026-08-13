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

type Lane = 'receiving' | 'harvest' | 'processing' | 'smokehouse' | 'retail' | 'pickup'
type View = 'week' | 'month' | 'quarter'

interface CalEvent {
  id: string; lane: Lane; date: string; title: string; subtitle?: string; status?: string; href?: string; planned?: boolean
  // Clock times, on the lanes that have them (smokehouse cooks). `nights` is the
  // number of midnights a cook crosses; `carriedIn` marks the copy that sits on
  // a morning the cook ran into rather than the day it was lit.
  startsAt?: string; endsAt?: string; nights?: number; carriedIn?: boolean
}
// When the kiosk last managed to import a cook cycle. Null on a database with
// no cooks at all.
interface SmokehouseFeed { lastCookAt: string | null; lastImportAt: string | null }

const LANES: { key: Lane; label: string; emoji: string; color: string }[] = [
  { key: 'receiving',  label: 'Receiving',  emoji: '📦', color: '#60A5FA' },
  { key: 'harvest',    label: 'Harvest',    emoji: '🐄', color: '#F87171' },
  { key: 'processing', label: 'Processing', emoji: '🔪', color: '#FBBF24' },
  { key: 'smokehouse', label: 'Smokehouse', emoji: '🔥', color: '#FB923C' },
  { key: 'retail',     label: 'Retail',     emoji: '🛒', color: '#34D399' },
  { key: 'pickup',     label: 'Pickup',     emoji: '💵', color: '#A78BFA' },
]
const LANE_COLOR: Record<Lane, string> = Object.fromEntries(LANES.map(l => [l.key, l.color])) as Record<Lane, string>

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

// Seven EQUAL columns. `repeat(7, 1fr)` is not equal: a 1fr track still floors
// at its content's min width, so a day holding "Granite Peak Plumbing & Heating"
// stretched its column and squeezed the rest — the day cells drifted out from
// under the Sun/Mon/Tue headings above them (Charlie, 2026-08-04). minmax(0,1fr)
// removes that floor and lets the event chips ellipsis inside their cell.
const DAY_COLS = 'repeat(7, minmax(0, 1fr))'
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

const toISO = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`

// Everything with a clock time on it is read in the plant's timezone, not the
// viewer's. The API already pins its side to Mountain; if the page disagreed, a
// cook's bar would sit at one hour and its label would read another.
const TZ = 'America/Denver'
const TZ_DAY  = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' })
const TZ_TIME = new Intl.DateTimeFormat('en-US', { timeZone: TZ, hour: 'numeric', minute: '2-digit' })
const TZ_WALL = new Intl.DateTimeFormat('en-US', {
  timeZone: TZ, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
})
// The instant as the plant's wall clock reads it, flattened to a number so the
// hour grid can do plain arithmetic on it.
function wallMs(d: Date): number {
  const p: Record<string, string> = {}
  for (const { type, value } of TZ_WALL.formatToParts(d)) p[type] = value
  return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute)
}
const wallDayMs = (d: Date) => Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
const shortDay = (d: Date) => `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}`

// 42-cell (6-week) grid covering a month, starting on the Sunday on/before the 1st.
function monthGrid(year: number, month: number): Date[] {
  const first = new Date(year, month, 1)
  const start = new Date(year, month, 1 - first.getDay())
  return Array.from({ length: 42 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}
function weekDays(anchor: Date): Date[] {
  const start = new Date(anchor.getFullYear(), anchor.getMonth(), anchor.getDate() - anchor.getDay())
  return Array.from({ length: 7 }, (_, i) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + i))
}
// The three months of the calendar quarter containing `anchor`.
function quarterMonths(anchor: Date): { y: number; m: number }[] {
  const q0 = Math.floor(anchor.getMonth() / 3) * 3
  return [0, 1, 2].map(i => { const d = new Date(anchor.getFullYear(), q0 + i, 1); return { y: d.getFullYear(), m: d.getMonth() } })
}

export default function MasterCalendar() {
  const todayISO = toISO(new Date())
  const [view, setView] = useState<View>('month')
  const [anchor, setAnchor] = useState<Date>(() => { const n = new Date(); return new Date(n.getFullYear(), n.getMonth(), n.getDate()) })
  const [active, setActive] = useState<Set<Lane>>(() => new Set(LANES.map(l => l.key)))
  const [events, setEvents] = useState<CalEvent[]>([])
  const [feed, setFeed] = useState<SmokehouseFeed | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // The date range to fetch + render, per view.
  const { rangeFrom, rangeTo } = useMemo(() => {
    if (view === 'week') { const w = weekDays(anchor); return { rangeFrom: toISO(w[0]), rangeTo: toISO(w[6]) } }
    if (view === 'quarter') {
      const qm = quarterMonths(anchor)
      const g0 = monthGrid(qm[0].y, qm[0].m); const g2 = monthGrid(qm[2].y, qm[2].m)
      return { rangeFrom: toISO(g0[0]), rangeTo: toISO(g2[41]) }
    }
    const g = monthGrid(anchor.getFullYear(), anchor.getMonth())
    return { rangeFrom: toISO(g[0]), rangeTo: toISO(g[41]) }
  }, [view, anchor])

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr('')
    fetch(`/api/calendar?from=${rangeFrom}&to=${rangeTo}`)
      .then(r => r.json())
      .then(d => {
        if (cancelled) return
        // Tolerate the old bare-array shape as well as { events, smokehouseFeed }.
        setEvents(Array.isArray(d) ? d : Array.isArray(d?.events) ? d.events : [])
        setFeed(Array.isArray(d) ? null : d?.smokehouseFeed ?? null)
      })
      .catch(() => { if (!cancelled) setErr('Could not load the calendar.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [rangeFrom, rangeTo])

  const byDay = useMemo(() => {
    const m = new Map<string, CalEvent[]>()
    for (const e of events) {
      if (!active.has(e.lane)) continue
      if (!m.has(e.date)) m.set(e.date, [])
      m.get(e.date)!.push(e)
    }
    return m
  }, [events, active])

  // per-lane counts over the whole loaded range (drives the filter chips)
  const laneCounts = useMemo(() => {
    const c: Record<string, number> = {}
    for (const e of events) c[e.lane] = (c[e.lane] ?? 0) + 1
    return c
  }, [events])

  // The Smokehouse lane is fed by an import that runs off-site, so it can die
  // quietly and leave the lane looking merely idle. Past three days with nothing
  // imported, say so — but only while looking at a range that reaches today, and
  // only while the lane is actually switched on.
  const staleFeed = useMemo(() => {
    if (!feed?.lastImportAt || !active.has('smokehouse') || rangeTo < todayISO) return null
    const days = Math.floor((Date.now() - new Date(feed.lastImportAt).getTime()) / 86_400_000)
    return days >= 3 ? { days, lastCookAt: feed.lastCookAt } : null
  }, [feed, active, rangeTo, todayISO])

  const navLabel = useMemo(() => {
    if (view === 'week') { const w = weekDays(anchor); return `${shortDay(w[0])} – ${shortDay(w[6])}, ${w[6].getFullYear()}` }
    if (view === 'quarter') { const qm = quarterMonths(anchor); return `Q${Math.floor(anchor.getMonth() / 3) + 1} ${anchor.getFullYear()} · ${MONTHS[qm[0].m].slice(0, 3)}–${MONTHS[qm[2].m].slice(0, 3)}` }
    return `${MONTHS[anchor.getMonth()]} ${anchor.getFullYear()}`
  }, [view, anchor])

  function shift(delta: number) {
    setAnchor(a => {
      if (view === 'week')    return new Date(a.getFullYear(), a.getMonth(), a.getDate() + 7 * delta)
      if (view === 'quarter') return new Date(a.getFullYear(), a.getMonth() + 3 * delta, 1)
      return new Date(a.getFullYear(), a.getMonth() + delta, 1)
    })
  }
  function goToday() { const n = new Date(); setAnchor(new Date(n.getFullYear(), n.getMonth(), n.getDate())) }
  function toggleLane(k: Lane) {
    setActive(prev => { const n = new Set(prev); if (n.has(k)) n.delete(k); else n.add(k); return n })
  }

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/schedule" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Schedule</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Master Calendar</h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>Every lane on one calendar · Phase 1 (preview)</p>
        </div>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 1360, margin: '0 auto', boxSizing: 'border-box' }}>
        {/* Controls */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
            <button onClick={() => shift(-1)} style={navBtn}>‹</button>
            <div style={{ minWidth: 210, textAlign: 'center', color: C.cream, fontWeight: 700, fontSize: '1rem' }}>{navLabel}</div>
            <button onClick={() => shift(1)} style={navBtn}>›</button>
            <button onClick={goToday} style={{ ...navBtn, width: 'auto', padding: '0 0.8rem', fontSize: '0.78rem' }}>Today</button>
          </div>
          {/* View switcher */}
          <div style={{ display: 'flex', gap: 2, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 5, padding: 2 }}>
            {(['week', 'month', 'quarter'] as View[]).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '0.3rem 0.85rem', borderRadius: 3, border: 'none', cursor: 'pointer',
                background: view === v ? C.tan : 'transparent', color: view === v ? C.dark : C.lightBrown,
                fontSize: '0.78rem', fontWeight: view === v ? 700 : 500, textTransform: 'capitalize',
              }}>{v}</button>
            ))}
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

        {staleFeed && (
          <div style={{
            display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap',
            background: 'rgba(251,146,60,0.12)', border: '1px solid rgba(251,146,60,0.45)',
            borderRadius: 5, padding: '0.55rem 0.85rem', marginBottom: '0.75rem',
            color: '#FB923C', fontSize: '0.78rem', lineHeight: 1.6,
          }}>
            <strong>🔥 Smokehouse feed is {staleFeed.days} days behind.</strong>
            <span style={{ color: C.cream }}>
              The last cook imported off the controller
              {staleFeed.lastCookAt ? ` started ${new Date(staleFeed.lastCookAt).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}` : ''} —
              anything cooked since then is missing from this lane. Check <code style={{ color: C.tan }}>ftp_server.py</code> on the packaging kiosk.
            </span>
          </div>
        )}

        <div style={{ opacity: loading ? 0.5 : 1, transition: 'opacity 0.15s' }}>
          {view === 'week'    && <WeekView    days={weekDays(anchor)} byDay={byDay} todayISO={todayISO} />}
          {view === 'week' && active.has('smokehouse') && (
            <SmokehouseWeek days={weekDays(anchor)} events={events} todayISO={todayISO} />
          )}
          {view === 'month'   && <MonthView   year={anchor.getFullYear()} month={anchor.getMonth()} byDay={byDay} todayISO={todayISO} />}
          {view === 'quarter' && <QuarterView months={quarterMonths(anchor)} byDay={byDay} todayISO={todayISO} />}
        </div>

        <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.75rem', lineHeight: 1.6 }}>
          <strong style={{ color: C.tan }}>Phase 1</strong> — every operational lane on one calendar, off the dates each already carries.
          <strong style={{ color: C.tan }}> Week</strong> for the leads, <strong style={{ color: C.tan }}>Quarter</strong> for the 90-day view.
          Click any event to jump to where its detail lives. Planned-vs-actual metrics come next in Phase 2.
        </p>
      </main>
    </div>
  )
}

// ── One event pill (clickable → its detail page) ───────────────────────────────
function EventPill({ e, showSub }: { e: CalEvent; showSub: boolean }) {
  const tip = `${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}${e.status ? ` (${e.status})` : ''}`
  // Planned items read as an outline (dashed, hollow) so they're clearly the
  // schedule, not an actual record that happened.
  const style: React.CSSProperties = e.planned ? {
    display: 'block', border: `1px dashed ${LANE_COLOR[e.lane]}`, background: 'transparent',
    borderRadius: 3, padding: '0 4px', fontSize: '0.68rem', color: LANE_COLOR[e.lane], textDecoration: 'none',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', fontStyle: 'italic',
  } : {
    display: 'block', borderLeft: `3px solid ${LANE_COLOR[e.lane]}`, background: `${LANE_COLOR[e.lane]}18`,
    borderRadius: 3, padding: '1px 4px', fontSize: '0.68rem', color: C.cream, textDecoration: 'none',
    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
  }
  const inner = <>{e.title}{showSub && e.subtitle ? <span style={{ color: C.lightBrown }}> · {e.subtitle}</span> : null}</>
  return e.href
    ? <a href={e.href} title={tip} style={style}>{inner}</a>
    : <div title={tip} style={style}>{inner}</div>
}

function DayNumber({ n, today, dim }: { n: number; today: boolean; dim: boolean }) {
  return (
    <div style={{
      fontSize: '0.72rem', fontWeight: today ? 800 : 500, alignSelf: 'flex-end',
      color: today ? C.dark : dim ? 'rgba(166,120,90,0.45)' : C.cream,
      background: today ? C.tan : 'transparent', borderRadius: 10,
      minWidth: 18, height: 18, lineHeight: '18px', textAlign: 'center', padding: today ? '0 5px' : 0,
    }}>{n}</div>
  )
}

// ── Month: 6-week grid, up to 4 events + "N more" ──────────────────────────────
function MonthView({ year, month, byDay, todayISO }: { year: number; month: number; byDay: Map<string, CalEvent[]>; todayISO: string }) {
  const grid = monthGrid(year, month)
  const weeks = Array.from({ length: 6 }, (_, i) => grid.slice(i * 7, i * 7 + 7))
  return (
    <>
      <WeekdayHeader />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 1, background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 4, overflow: 'hidden' }}>
        {weeks.map((week, i) => (
          <MonthWeekRow key={i} week={week} month={month} byDay={byDay} todayISO={todayISO} />
        ))}
      </div>
    </>
  )
}

// One week of the month grid. An overnight cook is NOT two chips here — it is a
// single bar stretched across the days it ran, which is the whole point of
// showing it on a month at all (Charlie, 2026-08-13). The bar lives in a lane
// reserved under the day numbers so its ends line up across cells; the chips it
// replaces are filtered out of the day lists below it.
const SPAN_TOP = 27   // clears the cell padding + day number
const SPAN_H   = 17   // one bar plus its gap
const isoLocal = (ts: string) => TZ_DAY.format(new Date(ts))
const addDays  = (iso: string, n: number) => {
  const [y, m, d] = iso.split('-').map(Number)
  return toISO(new Date(y, (m ?? 1) - 1, (d ?? 1) + n))
}

function MonthWeekRow({ week, month, byDay, todayISO }: { week: Date[]; month: number; byDay: Map<string, CalEvent[]>; todayISO: string }) {
  const isoOf = week.map(toISO)
  const first = isoOf[0], last = isoOf[6]

  // A cook is one bar however many chips it left behind — the head and its
  // carried-in copies share a base id, so collapse on that.
  const bars = new Map<string, { e: CalEvent; from: number; to: number; opensLeft: boolean; opensRight: boolean }>()
  for (const iso of isoOf) {
    for (const e of byDay.get(iso) ?? []) {
      if (!e.startsAt || !(e.nights ?? 0)) continue
      const base = e.id.replace(/-n\d+$/, '')
      if (bars.has(base)) continue
      const startISO = isoLocal(e.startsAt)
      const endISO   = addDays(startISO, e.nights!)
      bars.set(base, {
        e,
        from: startISO < first ? 0 : isoOf.indexOf(startISO),
        to:   endISO   > last  ? 6 : isoOf.indexOf(endISO),
        opensLeft:  startISO < first,   // ran in from the week above
        opensRight: endISO   > last,    // runs on into the week below
      })
    }
  }
  const spans = [...bars.values()].sort((a, b) => a.from - b.from || a.e.startsAt!.localeCompare(b.e.startsAt!))
  const lane = spans.length * SPAN_H

  return (
    <div style={{ position: 'relative', display: 'grid', gridTemplateColumns: DAY_COLS, gap: 1 }}>
      {week.map(d => {
        const iso = toISO(d); const inMonth = d.getMonth() === month
        // Anything drawn as a bar is not repeated as a chip.
        const evs = (byDay.get(iso) ?? []).filter(e => !(e.startsAt && (e.nights ?? 0)))
        const shown = evs.slice(0, 4); const extra = evs.length - shown.length
        return (
          <div key={iso} style={{ background: inMonth ? C.dark : '#140803', minHeight: 108, padding: '0.35rem 0.4rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
            <DayNumber n={d.getDate()} today={iso === todayISO} dim={!inMonth} />
            {lane > 0 && <div style={{ height: lane - 3, flexShrink: 0 }} />}
            {shown.map(e => <EventPill key={e.id} e={e} showSub />)}
            {extra > 0 && <div style={{ fontSize: '0.64rem', color: C.lightBrown, paddingLeft: 4 }}>+{extra} more</div>}
          </div>
        )
      })}

      {spans.map((s, i) => {
        const label   = s.e.title.replace(/[🔥↗↳]/g, '').trim()
        const running = !s.e.endsAt
        const when    = `${clockOf(s.e.startsAt!)} → ${running ? 'still running' : clockOf(s.e.endsAt!)}`
        const color   = LANE_COLOR[s.e.lane]
        const style: React.CSSProperties = {
          position: 'absolute', top: SPAN_TOP + i * SPAN_H, height: 15, zIndex: 2,
          left:  `calc(${(s.from / 7) * 100}% + 4px)`,
          width: `calc(${((s.to - s.from + 1) / 7) * 100}% - 8px)`,
          background: running ? 'transparent' : `${color}2A`,
          border: `1px ${running ? 'dashed' : 'solid'} ${color}`,
          // Square off whichever end runs past this week so the bar reads as
          // continuing rather than starting or stopping at the row break.
          borderLeftWidth: s.opensLeft ? 0 : 1, borderRightWidth: s.opensRight ? 0 : 1,
          borderTopLeftRadius: s.opensLeft ? 0 : 3, borderBottomLeftRadius: s.opensLeft ? 0 : 3,
          borderTopRightRadius: s.opensRight ? 0 : 3, borderBottomRightRadius: s.opensRight ? 0 : 3,
          color: C.cream, fontSize: '0.64rem', lineHeight: '13px', padding: '0 5px',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          textDecoration: 'none', boxSizing: 'border-box',
        }
        const body = <>{s.opensLeft ? '↳ ' : ''}{s.e.title.startsWith('🔥') ? '🔥 ' : ''}{label}<span style={{ color: C.lightBrown }}> · {when}</span></>
        const tip  = `${label} — ${when}${s.e.subtitle ? ` (${s.e.subtitle})` : ''}`
        return s.e.href
          ? <a key={s.e.id} href={s.e.href} title={tip} style={style}>{body}</a>
          : <div key={s.e.id} title={tip} style={style}>{body}</div>
      })}
    </div>
  )
}

// ── Week: 7 tall columns, every event listed (for the leads) ───────────────────
function WeekView({ days, byDay, todayISO }: { days: Date[]; byDay: Map<string, CalEvent[]>; todayISO: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 1, background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 4, overflow: 'hidden' }}>
      {days.map(d => {
        const iso = toISO(d); const evs = byDay.get(iso) ?? []; const today = iso === todayISO
        return (
          <div key={iso} style={{ background: C.dark, minHeight: 420, padding: '0.4rem 0.45rem', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid rgba(166,120,90,0.2)', paddingBottom: 3, marginBottom: 2 }}>
              <span style={{ fontSize: '0.66rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{WEEKDAYS[d.getDay()]}</span>
              <DayNumber n={d.getDate()} today={today} dim={false} />
            </div>
            {evs.length === 0 && <span style={{ fontSize: '0.66rem', color: 'rgba(166,120,90,0.3)' }}>—</span>}
            {evs.map(e => <EventPill key={e.id} e={e} showSub />)}
          </div>
        )
      })}
    </div>
  )
}

// ── Smokehouse: the week on a 24-hour axis ────────────────────────────────────
// 84 of our 414 logged cooks cross midnight in Mountain time, so a lane keyed on
// the day a cook was lit could never answer "how is the smokehouse actually
// running this week" — a 10pm ham read as one Tuesday chip and left Wednesday
// morning looking idle. Here every cook is a bar on a real time axis, cut at
// midnight so
// an overnight reads as one run continuing into the next column (Charlie,
// 2026-08-13).
const HOURS = Array.from({ length: 24 }, (_, i) => i)
const HOUR_PX = 15
const hourLabel = (h: number) => (h === 0 ? '12a' : h < 12 ? `${h}a` : h === 12 ? '12p' : `${h - 12}p`)
const clockOf = (ts: string) => TZ_TIME.format(new Date(ts)).replace(/\s/g, '').toLowerCase()

function SmokehouseWeek({ days, events, todayISO }: { days: Date[]; events: CalEvent[]; todayISO: string }) {
  // Only the primary rows carry the true span — the carried-in copies exist for
  // the day columns above and would draw the same cook twice here.
  const cooks = events.filter(e => e.lane === 'smokehouse' && e.startsAt && !e.carriedIn)

  type Seg = { key: string; col: number; top: number; height: number; e: CalEvent; head: boolean; tail: boolean }
  const segs: Seg[] = []
  for (const e of cooks) {
    const s = wallMs(new Date(e.startsAt!))
    // A cook with no end time is still in the house; draw it up to now.
    const end = e.endsAt ? wallMs(new Date(e.endsAt)) : wallMs(new Date())
    if (!(end > s)) continue
    days.forEach((d, col) => {
      const dayStart = wallDayMs(d)
      const dayEnd = dayStart + 86_400_000
      const a = Math.max(s, dayStart)
      const b = Math.min(end, dayEnd)
      if (b <= a) return
      segs.push({
        key: `${e.id}-${col}`, col,
        top: ((a - dayStart) / 3_600_000) * HOUR_PX,
        height: Math.max(4, ((b - a) / 3_600_000) * HOUR_PX),
        e, head: a === s, tail: b === end,
      })
    })
  }

  const now = new Date()
  const nowISO = TZ_DAY.format(now)
  const nowWall = wallMs(now)
  const nowTop = ((nowWall - Math.floor(nowWall / 86_400_000) * 86_400_000) / 3_600_000) * HOUR_PX

  return (
    <div style={{ marginTop: '1rem' }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', marginBottom: 6, flexWrap: 'wrap' }}>
        <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.82rem' }}>🔥 Smokehouse — by the hour</span>
        <span style={{ color: C.lightBrown, fontSize: '0.66rem' }}>
          {cooks.length
            ? `${cooks.length} cook${cooks.length === 1 ? '' : 's'} this week · a bar that reaches the bottom carries into the next day`
            : 'no cooks logged this week'}
        </span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: `34px ${DAY_COLS}`, background: C.dark, border: '1px solid rgba(166,120,90,0.15)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ borderBottom: '1px solid rgba(166,120,90,0.2)' }} />
        {days.map(d => {
          const iso = toISO(d)
          return (
            <div key={`h-${iso}`} style={{
              textAlign: 'center', padding: '3px 0', borderBottom: '1px solid rgba(166,120,90,0.2)',
              borderLeft: '1px solid rgba(166,120,90,0.12)',
              color: iso === todayISO ? C.tan : C.lightBrown, fontSize: '0.6rem',
              textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: iso === todayISO ? 800 : 400,
            }}>{WEEKDAYS[d.getDay()]} {d.getDate()}</div>
          )
        })}

        {/* hour gutter */}
        <div style={{ position: 'relative', height: 24 * HOUR_PX }}>
          {HOURS.filter(h => h % 3 === 0).map(h => (
            <div key={h} style={{ position: 'absolute', top: h * HOUR_PX - 4, right: 4, fontSize: '0.54rem', color: 'rgba(166,120,90,0.75)', lineHeight: 1 }}>
              {hourLabel(h)}
            </div>
          ))}
        </div>

        {days.map((d, col) => {
          const iso = toISO(d)
          return (
            <div key={iso} style={{
              position: 'relative', height: 24 * HOUR_PX,
              borderLeft: '1px solid rgba(166,120,90,0.12)',
              background: iso === todayISO ? 'rgba(201,168,130,0.05)' : 'transparent',
            }}>
              {HOURS.map(h => (
                <div key={h} style={{
                  position: 'absolute', top: h * HOUR_PX, left: 0, right: 0,
                  borderTop: `1px solid rgba(166,120,90,${h % 6 === 0 ? 0.16 : 0.06})`,
                }} />
              ))}
              {iso === nowISO && (
                <div title="now" style={{ position: 'absolute', top: nowTop, left: 0, right: 0, borderTop: `1px solid ${C.tan}`, zIndex: 3 }} />
              )}
              {segs.filter(s => s.col === col).map(s => {
                const label = s.e.title.replace(/[🔥↗↳]/g, '').trim()
                const running = !s.e.endsAt
                const tip = [label, s.e.subtitle, running ? 'still running' : ''].filter(Boolean).join(' — ')
                const body = (
                  <>
                    {!s.head && <span style={{ color: C.tan }}>↳ </span>}
                    {s.head ? `${clockOf(s.e.startsAt!)} ` : ''}{label}
                  </>
                )
                const style: React.CSSProperties = {
                  position: 'absolute', top: s.top, height: s.height, left: 2, right: 2,
                  background: running ? 'transparent' : `${LANE_COLOR.smokehouse}30`,
                  border: `1px ${running ? 'dashed' : 'solid'} ${LANE_COLOR.smokehouse}`,
                  // Square off the edge that continues into the neighbouring day
                  // so a split cook reads as one run, not two.
                  borderTopLeftRadius: s.head ? 3 : 0, borderTopRightRadius: s.head ? 3 : 0,
                  borderBottomLeftRadius: s.tail ? 3 : 0, borderBottomRightRadius: s.tail ? 3 : 0,
                  borderTopWidth: s.head ? 1 : 0, borderBottomWidth: s.tail ? 1 : 0,
                  color: C.cream, fontSize: '0.6rem', lineHeight: 1.15, padding: '1px 3px',
                  overflow: 'hidden', textDecoration: 'none', zIndex: 2, boxSizing: 'border-box',
                }
                return s.e.href
                  ? <a key={s.key} href={s.e.href} title={tip} style={style}>{body}</a>
                  : <div key={s.key} title={tip} style={style}>{body}</div>
              })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Quarter: three compact month grids side by side (for the 90-day view) ──────
function QuarterView({ months, byDay, todayISO }: { months: { y: number; m: number }[]; byDay: Map<string, CalEvent[]>; todayISO: string }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '1rem' }}>
      {months.map(({ y, m }) => {
        const grid = monthGrid(y, m)
        return (
          <div key={`${y}-${m}`}>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: '0.85rem', marginBottom: 6, textAlign: 'center' }}>{MONTHS[m]} {y}</div>
            <div style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 1, border: '1px solid transparent' }}>
              {WEEKDAYS.map(w => <div key={w} style={{ textAlign: 'center', color: C.lightBrown, fontSize: '0.56rem', fontWeight: 700 }}>{w[0]}</div>)}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 1, background: 'rgba(166,120,90,0.12)', border: '1px solid rgba(166,120,90,0.12)', borderRadius: 3, overflow: 'hidden' }}>
              {grid.map(d => {
                const iso = toISO(d); const inMonth = d.getMonth() === m; const today = iso === todayISO
                const evs = byDay.get(iso) ?? []; const dots = evs.slice(0, 6); const extra = evs.length - dots.length
                return (
                  <div key={iso} style={{ background: inMonth ? C.dark : '#140803', minHeight: 46, padding: '2px 3px', display: 'flex', flexDirection: 'column', gap: 2 }}>
                    <span style={{ fontSize: '0.58rem', fontWeight: today ? 800 : 400, color: today ? C.tan : inMonth ? C.cream : 'rgba(166,120,90,0.4)', textAlign: 'right', lineHeight: 1 }}>{d.getDate()}</span>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: 2, alignContent: 'flex-start' }}>
                      {dots.map(e => (
                        e.href
                          ? <a key={e.id} href={e.href} title={`${e.title}${e.subtitle ? ` — ${e.subtitle}` : ''}`} style={{ width: 7, height: 7, borderRadius: 2, background: LANE_COLOR[e.lane], display: 'block' }} />
                          : <span key={e.id} title={e.title} style={{ width: 7, height: 7, borderRadius: 2, background: LANE_COLOR[e.lane], display: 'block' }} />
                      ))}
                      {extra > 0 && <span style={{ fontSize: '0.5rem', color: C.lightBrown, lineHeight: '7px' }}>+{extra}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function WeekdayHeader() {
  return (
    // Same column track AND the same 1px border box as the day grid below it,
    // or the labels sit a pixel off their columns.
    <div style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 1, marginBottom: 1, border: '1px solid transparent' }}>
      {WEEKDAYS.map(w => (
        <div key={w} style={{ textAlign: 'center', color: C.tan, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, padding: '0.4rem 0' }}>{w}</div>
      ))}
    </div>
  )
}

const navBtn: React.CSSProperties = {
  width: 34, height: 34, borderRadius: 4, background: 'rgba(255,255,255,0.05)',
  border: '1px solid rgba(166,120,90,0.35)', color: C.cream, fontSize: '1.1rem',
  cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
}
