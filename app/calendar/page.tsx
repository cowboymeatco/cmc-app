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
  return (
    <>
      <WeekdayHeader />
      <div style={{ display: 'grid', gridTemplateColumns: DAY_COLS, gap: 1, background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 4, overflow: 'hidden' }}>
        {grid.map(d => {
          const iso = toISO(d); const inMonth = d.getMonth() === month
          const evs = byDay.get(iso) ?? []; const shown = evs.slice(0, 4); const extra = evs.length - shown.length
          return (
            <div key={iso} style={{ background: inMonth ? C.dark : '#140803', minHeight: 108, padding: '0.35rem 0.4rem', display: 'flex', flexDirection: 'column', gap: 3 }}>
              <DayNumber n={d.getDate()} today={iso === todayISO} dim={!inMonth} />
              {shown.map(e => <EventPill key={e.id} e={e} showSub />)}
              {extra > 0 && <div style={{ fontSize: '0.64rem', color: C.lightBrown, paddingLeft: 4 }}>+{extra} more</div>}
            </div>
          )
        })}
      </div>
    </>
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
