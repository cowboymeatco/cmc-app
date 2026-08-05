'use client'
// Mobile crew view of the cut schedule — READ-ONLY.
// The crew opens this on their phones before work to see what's on the rail
// today and in what order. Planning (drag, day breaks, assign, save) happens
// on the desktop Cut Schedule tab under /processing; this page just shows the
// latest saved plan, falling back to priority order when nothing is saved yet.
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  type ScheduleEntry,
  DEFAULT_WEIGHTS, buildEntries, loadScheduleData, carcassTotals,
  speciesColor, speciesIcon, portionBadge, hangAtCut, hangColor,
} from '@/lib/cutSchedule'
import { isoDate, dateLabel } from '@/lib/dates'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#EF4444',
  amber:      '#F59E0B',
}

interface Section {
  key:     string
  date:    string | null       // break date heading this day, null = list before the first break
  entries: ScheduleEntry[]
}

export default function CrewCutSchedulePage() {
  const [sections,   setSections]   = useState<Section[]>([])
  const [planDate,   setPlanDate]   = useState<string | null>(null)
  const [loading,    setLoading]    = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError,  setLoadError]  = useState(false)
  const [updatedAt,  setUpdatedAt]  = useState<string | null>(null)
  const inFlight = useRef(false)

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    setRefreshing(true)
    try {
      const today = isoDate()
      const { logs, apptMap, instrIds, saved, assignments } = await loadScheduleData(today)
      const list = buildEntries(logs, apptMap, instrIds, saved, assignments, DEFAULT_WEIGHTS)

      // Split the ordered list into day sections: a break heads the day below
      // it, carcasses before the first break are simply "up first".
      const rawSecs: Section[] = []
      let current: Section = { key: 'first', date: null, entries: [] }
      for (const item of list) {
        if (item.type === 'break') {
          rawSecs.push(current)
          current = { key: item.key, date: item.break_date || null, entries: [] }
        } else {
          current.entries.push(item)
        }
      }
      rawSecs.push(current)

      // Fold days already behind us into the leading section — anything still
      // hanging from a past day is overdue and cuts first.
      const lead: Section = { key: 'first', date: null, entries: [] }
      const rest: Section[] = []
      for (const sec of rawSecs) {
        if (sec.key === 'first' || (sec.date && sec.date < today)) lead.entries.push(...sec.entries)
        else rest.push(sec)
      }
      const secs = [lead, ...rest].filter(s => s.entries.length > 0)

      setSections(secs)
      setPlanDate(saved[0]?.schedule_date ?? null)
      setUpdatedAt(new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }))
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      inFlight.current = false
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Re-fetch whenever the page comes back into view — the guys leave the tab
  // open on their phones, so waking the phone should show fresh data.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible') load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  // Everything below derives from `sections` — one source of truth.
  const entries       = sections.flatMap(s => s.entries)
  const totals        = carcassTotals(entries)
  const missingSheets = entries.filter(e => !e.has_instructions).length
  const todayISO      = isoDate()
  // Rail-order number per row, precomputed so rendering never mutates state.
  const orderNo       = new Map(entries.map((e, i) => [e.key, i + 1]))

  const dayLabel = (date: string | null, isFirst: boolean): string => {
    // Only the leading section is "up first" — a saved break the planner never
    // dated must not masquerade as it.
    if (!date) return isFirst ? 'Up first' : 'Date not set'
    const label = dateLabel(date)
    return date === todayISO ? `Today — ${label}` : label
  }

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, color: C.cream, paddingBottom: '2rem' }}>

      {/* Sticky header */}
      <header style={{
        position: 'sticky', top: 0, zIndex: 10,
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0.8rem 1rem', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            fontFamily: 'Georgia, serif', fontSize: '1.05rem', fontWeight: 700, margin: 0,
            letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            🔪 Cut Schedule
          </h1>
          <div style={{ fontSize: '0.7rem', color: C.lightBrown, marginTop: 2 }}>
            {updatedAt ? `Updated ${updatedAt}` : 'Loading…'}
            {planDate && (
              <> · plan saved {dateLabel(planDate, { month: 'short', day: 'numeric' })}</>
            )}
            {loadError && entries.length > 0 && (
              <span style={{ color: C.red, fontWeight: 700 }}> · ⚠ last refresh failed</span>
            )}
          </div>
        </div>
        <button
          onClick={load}
          disabled={refreshing}
          style={{
            background: 'rgba(201,168,130,0.15)', border: '1px solid rgba(201,168,130,0.4)',
            color: C.tan, borderRadius: 6, padding: '0.55rem 0.9rem',
            fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', flexShrink: 0,
            opacity: refreshing ? 0.5 : 1,
          }}
        >
          {refreshing ? '…' : '↻ Refresh'}
        </button>
      </header>

      <main style={{ maxWidth: 560, margin: '0 auto', padding: '0.9rem 0.75rem' }}>

        {/* Stats strip */}
        {!loading && entries.length > 0 && (
          <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '1rem' }}>
            {[
              { label: 'head', value: String(totals.head), color: C.tan },
              { label: 'lb hanging', value: Math.round(totals.lbs).toLocaleString(), color: C.cream },
              { label: 'no sheet', value: String(missingSheets), color: missingSheets > 0 ? C.red : C.green },
            ].map(s => (
              <div key={s.label} style={{
                flex: 1, background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
                borderRadius: 6, padding: '0.55rem 0.5rem', textAlign: 'center',
              }}>
                <div style={{ fontSize: '1.25rem', fontWeight: 700, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
                <div style={{ fontSize: '0.62rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
              </div>
            ))}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: C.lightBrown }}>
            Loading cooler inventory…
          </div>
        )}

        {/* Couldn't load — never show "empty cooler" for a network error */}
        {!loading && loadError && entries.length === 0 && (
          <div style={{
            background: C.dark, border: '1px solid rgba(239,68,68,0.4)',
            borderRadius: 8, padding: '3rem 1.5rem', textAlign: 'center',
          }}>
            <div style={{ fontSize: '2.2rem', marginBottom: '0.75rem' }}>📡</div>
            <p style={{ color: C.red, fontSize: '1.05rem', fontWeight: 700, margin: '0 0 0.5rem' }}>Couldn&apos;t reach the server</p>
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', margin: '0 0 1.25rem' }}>Check your signal and try again.</p>
            <button
              onClick={load}
              style={{
                background: 'rgba(201,168,130,0.15)', border: '1px solid rgba(201,168,130,0.4)',
                color: C.tan, borderRadius: 6, padding: '0.6rem 1.4rem',
                fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer',
              }}
            >
              ↻ Retry
            </button>
          </div>
        )}

        {/* Empty cooler */}
        {!loading && !loadError && entries.length === 0 && (
          <div style={{
            background: C.dark, border: '1px solid rgba(166,120,90,0.2)',
            borderRadius: 8, padding: '3rem 1.5rem', textAlign: 'center',
          }}>
            <div style={{ fontSize: '2.2rem', marginBottom: '0.75rem' }}>🧊</div>
            <p style={{ color: C.tan, fontSize: '1.05rem', margin: '0 0 0.5rem' }}>Cooler is empty</p>
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', margin: 0 }}>Nothing on the cut list right now.</p>
          </div>
        )}

        {/* Day sections */}
        {!loading && sections.map(sec => {
          const secTotals = carcassTotals(sec.entries)
          return (
            <section key={sec.key} style={{ marginBottom: '1.1rem' }}>
              <div style={{
                display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem',
                padding: '0.45rem 0.6rem', marginBottom: '0.45rem',
                background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.35)', borderRadius: 6,
              }}>
                <span style={{
                  color: C.amber, fontWeight: 700, fontSize: '0.82rem',
                  textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  ▸ {dayLabel(sec.date, sec.key === 'first')}
                </span>
                <span style={{ color: C.lightBrown, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                  {secTotals.head} head · {Math.round(secTotals.lbs).toLocaleString()} lb
                </span>
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.45rem' }}>
                {sec.entries.map(entry => {
                  const no      = orderNo.get(entry.key) ?? 0
                  const pb      = portionBadge(entry.portion)
                  const spColor = speciesColor(entry.species)
                  // What it'll have hung by the day this section is headed for —
                  // that's the number that decides whether it's still fit to cut.
                  const atCut   = hangAtCut(entry.harvest_date, sec.date ?? undefined, entry.days_hanging)
                  return (
                    <div key={entry.key} style={{
                      display: 'flex', gap: '0.7rem', alignItems: 'stretch',
                      background: C.dark, borderRadius: 6, padding: '0.7rem 0.75rem',
                      border: '1px solid rgba(166,120,90,0.18)',
                      borderLeft: `5px solid ${spColor}`,
                    }}>
                      {/* Order number */}
                      <div style={{
                        display: 'flex', alignItems: 'center', flexShrink: 0,
                        fontFamily: 'Georgia, serif', fontSize: '1.3rem', fontWeight: 700,
                        color: no <= 3 ? C.amber : C.lightBrown, minWidth: 26, justifyContent: 'center',
                      }}>
                        {no}
                      </div>

                      {/* Who + what */}
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
                          <span style={{ fontWeight: 700, fontSize: '1rem', color: C.cream }}>
                            {entry.customer_name}
                          </span>
                          <span style={{
                            background: `${pb.color}1A`, border: `1px solid ${pb.color}55`, color: pb.color,
                            borderRadius: 4, padding: '1px 7px', fontSize: '0.78rem', fontWeight: 700,
                          }}>
                            {pb.label}
                          </span>
                        </div>
                        <div style={{ fontSize: '0.78rem', color: C.lightBrown, marginTop: 3 }}>
                          <span style={{ color: spColor, fontWeight: 700 }}>{speciesIcon(entry.species)} {entry.species}</span>
                          {entry.carcass_tag && <span style={{ fontFamily: 'monospace' }}> · tag {entry.carcass_tag}</span>}
                          {entry.producer && <> · {entry.producer}</>}
                        </div>
                        <div style={{ fontSize: '0.78rem', marginTop: 3 }}>
                          {entry.has_instructions
                            ? <span style={{ color: C.green }}>✓ Cut sheet ready</span>
                            : <span style={{
                                color: C.red, fontWeight: 700,
                                background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)',
                                borderRadius: 4, padding: '1px 7px',
                              }}>⚠ NO CUT SHEET</span>
                          }
                        </div>
                        {entry.entry_notes && (
                          <div style={{
                            fontSize: '0.8rem', color: C.tan, marginTop: 4,
                            borderLeft: `2px solid ${C.medBrown}`, paddingLeft: 6, fontStyle: 'italic',
                          }}>
                            {entry.entry_notes}
                          </div>
                        )}
                      </div>

                      {/* Weight + hang */}
                      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
                        <div>
                          {entry.hot_carcass_weight_lbs != null
                            ? <><span style={{ fontSize: '1.2rem', fontWeight: 700, color: C.cream }}>{entry.hot_carcass_weight_lbs}</span><span style={{ fontSize: '0.68rem', color: C.lightBrown }}> lb</span></>
                            : <span style={{ color: C.medBrown }}>—</span>}
                        </div>
                        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: hangColor(entry.days_hanging), marginTop: 2 }}>
                          {entry.days_hanging}d hanging
                        </div>
                        {atCut > entry.days_hanging && (
                          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: hangColor(atCut), marginTop: 1 }}>
                            → {atCut}d at cut
                          </div>
                        )}
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}

        {/* Footer link to the full planner (desktop) */}
        <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: C.lightBrown }}>
          Read-only crew view · plan changes on the{' '}
          <Link href="/processing" style={{ color: C.tan }}>Processing page</Link>
        </div>
      </main>
    </div>
  )
}
