'use client'
// Phone planner for the cut schedule — the office's way to lay out cutting days
// away from the desk (Charlie, 2026-11-27). Same model and same save as the
// desktop Cut Schedule tab under /processing: lib/cutSchedule builds the list,
// POST /api/cut-schedule stores it, so the two screens edit ONE plan.
//
// Phones can't drag, so everything is a tap: tap a carcass to move it to a day,
// nudge it up or down inside its day, lock it, or note it. Tap a day's ⋯ to
// redate or remove it. Nothing is written until Save.
//
// Left on the desktop on purpose: assigning buyers, grind-all, scan-sheet links,
// marking cut / delivered, lay-out-by-weight, priority weights, and the upcoming
// bookings rail. A booking head already placed on a day still shows here and can
// be moved; unplaced ones stay hidden, exactly as they are on the crew view.
//
// Saving replaces the whole plan, so before it writes, the page checks whether
// anyone else saved since it loaded and asks before overwriting their work.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  DEFAULT_WEIGHTS, buildEntries, loadScheduleData, planIsLive, cutDateByKey,
  moveItemToDay, moveDayIntoDateOrder, dayLoads, avgLbsFor, rowLbs, hangAtCut, hangColor,
  speciesColor, speciesIcon, portionBadge, nextCuttingDayISO,
  type ListItem, type ScheduleEntry, type BreakItem, type FutureItem,
  type SavedItem, type CarcassAverages, type HarvestDay,
} from '@/lib/cutSchedule'
import { isoDate, dateLabel, dayOfWeekISO } from '@/lib/dates'

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

// ── Plan model helpers (pure) ────────────────────────────────────────────────
// The plan is one ordered list; a break heads the day below it. These cut it
// into sections, edit a section, and stitch it back with fresh ranks.

type Section = { brk: BreakItem | null; items: ListItem[] }

function toSections(list: ListItem[]): Section[] {
  const out: Section[] = [{ brk: null, items: [] }]
  for (const e of list) {
    if (e.type === 'break') out.push({ brk: e, items: [] })
    else out[out.length - 1].items.push(e)
  }
  return out
}

function fromSections(secs: Section[]): ListItem[] {
  const out: ListItem[] = []
  for (const s of secs) {
    if (s.brk) out.push(s.brk)
    out.push(...s.items)
  }
  return out.map((e, i) => ({ ...e, rank: i + 1 }))
}

const reRank = (list: ListItem[]) => list.map((e, i) => ({ ...e, rank: i + 1 }))

/** A split carcass is one row per buyer; it moves and shows as one unit. */
const unitKey = (e: ListItem) => (e.type === 'carcass' ? `c_${e.harvest_log_id}` : e.key)

function toUnits(items: ListItem[]): ListItem[][] {
  const map = new Map<string, ListItem[]>()
  const order: string[] = []
  for (const e of items) {
    const k = unitKey(e)
    if (!map.has(k)) { map.set(k, []); order.push(k) }
    map.get(k)!.push(e)
  }
  return order.map(k => map.get(k)!)
}

/** Booking placeholders show only once they're on a dated day — an unplaced
 *  one belongs to the desktop's bookings rail, not the no-day pile. */
const unitVisible = (unit: ListItem[], dated: boolean) => unit[0].type === 'carcass' || dated

function nudge(list: ListItem[], uk: string, dir: -1 | 1): ListItem[] {
  const secs = toSections(list)
  for (const s of secs) {
    const units = toUnits(s.items)
    const i = units.findIndex(u => unitKey(u[0]) === uk)
    if (i === -1) continue
    const dated = !!s.brk?.break_date
    let j = i + dir
    while (j >= 0 && j < units.length && !unitVisible(units[j], dated)) j += dir
    if (j < 0 || j >= units.length) return list
    ;[units[i], units[j]] = [units[j], units[i]]
    s.items = units.flat()
    return fromSections(secs)
  }
  return list
}

/** No cut day = above every break, which is where an unscheduled row lives. */
function moveToPile(list: ListItem[], uk: string): ListItem[] {
  const unit = list.filter(e => e.type !== 'break' && unitKey(e) === uk)
  const rest = list.filter(e => e.type === 'break' || unitKey(e) !== uk)
  return reRank([...unit, ...rest])
}

/** An empty day, slotted in date order. */
function addDay(list: ListItem[], date: string): ListItem[] {
  if (list.some(e => e.type === 'break' && e.break_date === date)) return list
  const brk: BreakItem = { type: 'break', key: `break_${crypto.randomUUID()}`, rank: 0, break_date: date }
  let at = list.findIndex(e => e.type === 'break' && !!e.break_date && e.break_date > date)
  if (at === -1) at = list.length
  return reRank([...list.slice(0, at), brk, ...list.slice(at)])
}

/** Removing a day sends its carcasses back to No cut day — never silently
 *  into the day above, which is what deleting a break on the desktop does. */
function removeDay(list: ListItem[], breakKey: string): ListItem[] {
  const secs = toSections(list)
  const idx = secs.findIndex(s => s.brk?.key === breakKey)
  if (idx <= 0) return list
  const [gone] = secs.splice(idx, 1)
  secs[0].items = [...gone.items, ...secs[0].items]
  return fromSections(secs)
}

/** Fingerprint of the saved plan. Every save deletes and re-inserts the rows,
 *  so their ids change on any save from any screen. */
function planSig(rows: SavedItem[], today: string): string {
  const live = planIsLive(rows, today) ? rows : []
  return live
    .map(r => r.id ?? `${r.kind}|${r.manual_rank}|${r.appointment_id}|${r.future_appointment_id}|${r.future_seq}|${r.break_date}`)
    .sort()
    .join(',')
}

/** Same rows the desktop planner writes (CutScheduleTab handleSave). */
function toSaveItems(entries: ListItem[]) {
  const placed = cutDateByKey(entries)
  return entries
    .filter(e => e.type !== 'future' || placed.get(e.key))
    .map(e => e.type === 'break'
      ? {
          kind: 'break' as const, appointment_id: null, appointment_customer_id: null,
          manual_rank: e.rank, locked: false, notes: '', break_date: e.break_date || null,
        }
      : e.type === 'future'
      ? {
          kind: 'future' as const, appointment_id: null, appointment_customer_id: null,
          manual_rank: e.rank, locked: false, notes: '', break_date: null,
          future_appointment_id: e.appointment_id, future_seq: e.seq,
        }
      : {
          kind: 'carcass' as const, appointment_id: e.appointment_id,
          appointment_customer_id: e.appointment_customer_id,
          manual_rank: e.rank, locked: e.locked, notes: e.entry_notes, break_date: null,
        })
}

const shortDay = (iso: string) => dateLabel(iso, { weekday: 'short', month: 'numeric', day: 'numeric' })
const lbsStr   = (n: number) => Math.round(n).toLocaleString()

// ── Page ─────────────────────────────────────────────────────────────────────

export default function CutPlanPage() {
  const [entries,     setEntries]     = useState<ListItem[]>([])
  const [harvestDays, setHarvestDays] = useState<HarvestDay[]>([])
  const [planDate,    setPlanDate]    = useState<string | null>(null)
  const [loading,     setLoading]     = useState(true)
  const [loadError,   setLoadError]   = useState(false)
  const [dirty,       setDirty]       = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [saveMsg,     setSaveMsg]     = useState<{ ok: boolean; text: string } | null>(null)
  const [averages,    setAverages]    = useState<CarcassAverages>({})
  const [cap,         setCap]         = useState<{ beef_eq_per_day: number; lbs_per_day: number | null }>({ beef_eq_per_day: 3, lbs_per_day: null })
  const [openUnit,    setOpenUnit]    = useState<string | null>(null)
  const [openDay,     setOpenDay]     = useState<string | null>(null)
  const [addingDay,   setAddingDay]   = useState(false)
  const [pileOpen,    setPileOpen]    = useState(true)

  const loadedSig = useRef('')
  const inFlight  = useRef(false)
  const dirtyRef  = useRef(false)
  useEffect(() => { dirtyRef.current = dirty }, [dirty])

  const load = useCallback(async () => {
    if (inFlight.current) return
    inFlight.current = true
    try {
      const today = isoDate()
      const d = await loadScheduleData(today)
      // Bookings go in so placeholders already placed on a day survive a save.
      setEntries(buildEntries(d.logs, d.apptMap, d.instrIds, d.saved, d.assignments, DEFAULT_WEIGHTS, d.futureBookings, d.instrByBuyer))
      setHarvestDays(d.harvestDays)
      setPlanDate(d.saved[0]?.schedule_date ?? null)
      loadedSig.current = planSig(d.saved, today)
      setDirty(false)
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      inFlight.current = false
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  // Two small reads for the pounds-per-day bar. A miss falls back quietly.
  useEffect(() => {
    let cancelled = false
    fetch('/api/cut-schedule/averages').then(r => r.json()).then((d: unknown) => {
      const sp = (d as { species?: CarcassAverages })?.species
      if (!cancelled && sp && typeof sp === 'object') setAverages(sp)
    }).catch(() => {})
    fetch('/api/capacity').then(r => r.json()).then((d: unknown) => {
      const st = (d as { settings?: { beef_eq_per_day?: number; lbs_per_day?: number | null } })?.settings
      if (!cancelled && st) setCap({ beef_eq_per_day: Number(st.beef_eq_per_day) || 3, lbs_per_day: st.lbs_per_day ?? null })
    }).catch(() => {})
    return () => { cancelled = true }
  }, [])

  // Waking the phone refreshes — but never over unsaved edits.
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === 'visible' && !dirtyRef.current) load() }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [load])

  useEffect(() => {
    if (!dirty) return
    const warn = (e: BeforeUnloadEvent) => { e.preventDefault() }
    window.addEventListener('beforeunload', warn)
    return () => window.removeEventListener('beforeunload', warn)
  }, [dirty])

  const apply = (fn: (prev: ListItem[]) => ListItem[]) => {
    setEntries(prev => fn(prev))
    setDirty(true)
    setSaveMsg(null)
  }

  const reload = () => {
    if (dirty && !window.confirm('Throw away your unsaved changes and reload the plan?')) return
    setLoading(true)
    load()
  }

  // ── Derived ──────────────────────────────────────────────────────────────
  const todayISO  = isoDate()
  const lbsPerDay = cap.lbs_per_day && cap.lbs_per_day > 0
    ? cap.lbs_per_day
    : Math.round(cap.beef_eq_per_day * (avgLbsFor('Beef', averages) || 725))

  const sections = useMemo(() => toSections(entries), [entries])
  const loads    = useMemo(() => dayLoads(entries, averages), [entries, averages])
  const killByDate = useMemo(() => new Map(harvestDays.map(h => [h.date, h.head])), [harvestDays])

  const datedDays = sections
    .filter((s): s is Section & { brk: BreakItem } => !!s.brk?.break_date)
    .map(s => s.brk)
  const dupDates = new Set(
    datedDays.map(b => b.break_date).filter((d, i, all) => all.indexOf(d) !== i))

  const carcassUnits = toUnits(entries.filter((e): e is ScheduleEntry => e.type === 'carcass'))
  const cutDates     = cutDateByKey(entries)
  const noDayUnits   = carcassUnits.filter(u => !cutDates.get(u[0].key))

  // Unit lookup for the sheet, with the day it sits under.
  const unitIndex = new Map<string, { unit: ListItem[]; date: string }>()
  for (const s of sections) {
    for (const u of toUnits(s.items)) unitIndex.set(unitKey(u[0]), { unit: u, date: s.brk?.break_date ?? '' })
  }
  const sheetUnit = openUnit ? unitIndex.get(openUnit) ?? null : null
  const sheetDay  = openDay ? datedDays.find(b => b.key === openDay) ?? sections.find(s => s.brk?.key === openDay)?.brk ?? null : null

  const lastDated   = datedDays.length ? datedDays[datedDays.length - 1].break_date : ''
  // Default for a new day: the cutting day after the last planned one, or
  // today (next weekday if it's a weekend) when nothing is planned ahead.
  const todayIsWeekend = dayOfWeekISO(todayISO) === 0 || dayOfWeekISO(todayISO) === 6
  const suggestDate = lastDated && lastDated >= todayISO
    ? nextCuttingDayISO(lastDated)
    : todayIsWeekend ? nextCuttingDayISO(todayISO) : todayISO

  // ── Save ─────────────────────────────────────────────────────────────────
  const save = async () => {
    if (dupDates.size) {
      window.alert('Two days share the same date. Fix or remove one before saving.')
      return
    }
    setSaving(true)
    setSaveMsg(null)
    try {
      let latest: unknown = null
      try {
        const r = await fetch('/api/cut-schedule?latest=1', { cache: 'no-store' })
        latest = r.ok ? await r.json() : null
      } catch { latest = null }
      if (latest === null) {
        if (!window.confirm('Couldn’t check whether anyone else saved the plan since you opened it. Save anyway?')) return
      } else if (planSig(Array.isArray(latest) ? latest as SavedItem[] : [], isoDate()) !== loadedSig.current) {
        if (!window.confirm(
          'Someone saved the cut plan from another screen since you opened it.\n\n' +
          'Saving now REPLACES their version with yours. Cancel, then Reload, to see theirs first.'
        )) return
      }
      const res = await fetch('/api/cut-schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ schedule_date: isoDate(), items: toSaveItems(entries) }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        setSaveMsg({ ok: false, text: `Not saved — ${(d as { error?: string })?.error ?? `HTTP ${res.status}`}` })
        return
      }
      const at = new Date().toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'America/Denver' })
      setDirty(false)
      await load()
      setSaveMsg({ ok: true, text: `Saved ${at}` })
    } catch {
      setSaveMsg({ ok: false, text: 'Not saved — network error. Your changes are still here; try again.' })
    } finally {
      setSaving(false)
    }
  }

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, color: C.cream }}>
      <header style={{
        position: 'sticky', top: 0, zIndex: 20, background: C.dark,
        borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0.75rem 1rem',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
      }}>
        <div style={{ minWidth: 0 }}>
          <h1 style={{
            fontFamily: 'Georgia, serif', fontSize: '1.05rem', fontWeight: 700, margin: 0,
            letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap',
          }}>
            ✏️ Plan Cut Days
          </h1>
          <div style={{ fontSize: '0.7rem', color: C.lightBrown, marginTop: 2 }}>
            {planDate ? <>plan saved {dateLabel(planDate, { month: 'short', day: 'numeric' })}</> : 'no saved plan yet'}
            {' · '}{lbsStr(lbsPerDay)} lb/day cap
          </div>
        </div>
        <button onClick={reload} disabled={loading} style={btn('ghost', loading)}>
          {loading ? '…' : '↻ Reload'}
        </button>
      </header>

      <main style={{ maxWidth: 560, margin: '0 auto', padding: '0.9rem 0.75rem 7rem' }}>
        {loading && entries.length === 0 && (
          <div style={{ textAlign: 'center', padding: '4rem 1rem', color: C.lightBrown }}>Loading cooler inventory…</div>
        )}

        {!loading && loadError && entries.length === 0 && (
          <div style={{ ...card, padding: '2.5rem 1.25rem', textAlign: 'center', borderColor: 'rgba(239,68,68,0.4)' }}>
            <p style={{ color: C.red, fontWeight: 700, margin: '0 0 0.5rem' }}>Couldn&apos;t reach the server</p>
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', margin: '0 0 1rem' }}>Check your signal and try again.</p>
            <button onClick={load} style={btn('ghost')}>↻ Retry</button>
          </div>
        )}

        {entries.length > 0 && (
          <>
            {/* Stats */}
            <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.8rem' }}>
              {[
                { label: 'on rail',    value: String(carcassUnits.length), color: C.tan },
                { label: 'no cut day', value: String(noDayUnits.length),   color: noDayUnits.length ? C.amber : C.green },
                { label: 'days',       value: String(datedDays.length),    color: C.cream },
              ].map(s => (
                <div key={s.label} style={{ ...card, flex: 1, padding: '0.5rem', textAlign: 'center' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, color: s.color, lineHeight: 1.1 }}>{s.value}</div>
                  <div style={{ fontSize: '0.62rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{s.label}</div>
                </div>
              ))}
            </div>

            {loadError && (
              <Banner color={C.red}>Last reload failed — showing what was loaded before.</Banner>
            )}
            {dupDates.size > 0 && (
              <Banner color={C.red}>
                {[...dupDates].map(shortDay).join(', ')} {dupDates.size === 1 ? 'has' : 'have'} two day headings. Remove one before saving.
              </Banner>
            )}

            {/* No cut day pile */}
            {sections.map((s, si) => {
              const dated = !!s.brk?.break_date
              const units = toUnits(s.items).filter(u => unitVisible(u, dated))
              if (si === 0) {
                const pileLbs = units.reduce((n, u) => n + rowLbs(u[0], averages).lbs, 0)
                return (
                  <section key="pile" style={{ marginBottom: '1rem' }}>
                    <button
                      onClick={() => setPileOpen(o => !o)}
                      style={{
                        ...headerBar(C.amber), width: '100%', cursor: 'pointer', textAlign: 'left',
                      }}
                    >
                      <span style={{ fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.08em', color: C.amber }}>
                        {pileOpen ? '▾' : '▸'} No cut day
                      </span>
                      <span style={{ color: C.lightBrown, fontSize: '0.72rem' }}>
                        {units.length} head · {lbsStr(pileLbs)} lb
                      </span>
                    </button>
                    {pileOpen && (units.length === 0
                      ? <div style={{ color: C.green, fontSize: '0.82rem', padding: '0.4rem 0.6rem' }}>✓ Every carcass on the rail has a day.</div>
                      : <UnitList units={units} date="" onOpen={setOpenUnit} />)}
                  </section>
                )
              }
              const brk  = s.brk!
              const load = dated ? loads.get(brk.break_date) : undefined
              const over = !!load && load.lbs > lbsPerDay
              const kill = dated ? killByDate.get(brk.break_date) : undefined
              return (
                <section key={brk.key} style={{ marginBottom: '1rem' }}>
                  <div style={{ ...headerBar(dupDates.has(brk.break_date) ? C.red : C.tan), flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontWeight: 700, fontSize: '0.9rem', color: C.cream }}>
                          {dated
                            ? <>{brk.break_date === todayISO ? 'Today — ' : ''}{dateLabel(brk.break_date)}</>
                            : <span style={{ color: C.amber }}>Day — no date set</span>}
                        </div>
                        <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: 1 }}>
                          {load ? <>{load.head} head · <span style={{ color: over ? C.red : C.cream, fontWeight: 700 }}>{lbsStr(load.lbs)}</span> / {lbsStr(lbsPerDay)} lb{load.estHead ? ` (${load.estHead} est.)` : ''}</> : `${units.length} head`}
                          {kill != null && <span style={{ color: C.tan }}> · 🔪 killing {kill} head</span>}
                        </div>
                      </div>
                      <button onClick={() => setOpenDay(brk.key)} style={{ ...btn('ghost'), padding: '0.45rem 0.8rem' }} aria-label="Day options">⋯</button>
                    </div>
                    {load && (
                      <div style={{ height: 5, background: 'rgba(166,120,90,0.25)', borderRadius: 3, overflow: 'hidden' }}>
                        <div style={{
                          width: `${Math.min(100, (load.lbs / Math.max(1, lbsPerDay)) * 100)}%`, height: '100%',
                          background: over ? C.red : load.lbs > lbsPerDay * 0.85 ? C.amber : C.green,
                        }} />
                      </div>
                    )}
                  </div>
                  {units.length === 0
                    ? <div style={{ color: C.lightBrown, fontSize: '0.8rem', padding: '0.4rem 0.6rem', fontStyle: 'italic' }}>Nothing on this day yet — tap a carcass to move it here.</div>
                    : <UnitList units={units} date={brk.break_date} onOpen={setOpenUnit} />}
                </section>
              )
            })}

            {/* Add a day */}
            {addingDay ? (
              <DatePickRow
                initial={suggestDate}
                taken={new Set(datedDays.map(b => b.break_date))}
                confirmLabel="Add day"
                onCancel={() => setAddingDay(false)}
                onPick={d => { apply(prev => addDay(prev, d)); setAddingDay(false) }}
              />
            ) : (
              <button onClick={() => setAddingDay(true)} style={{ ...btn('ghost'), width: '100%', padding: '0.8rem' }}>
                + Add a cutting day
              </button>
            )}

            <div style={{ textAlign: 'center', marginTop: '1.5rem', fontSize: '0.75rem', color: C.lightBrown, lineHeight: 1.6 }}>
              Assigning buyers, marking cut, and lay-out by weight stay on the{' '}
              <Link href="/processing?tab=cut-schedule" style={{ color: C.tan }}>desktop planner</Link>.
              <br />
              <Link href="/cut-schedule" style={{ color: C.tan }}>Crew view</Link>
            </div>
          </>
        )}
      </main>

      {/* Sticky save bar */}
      {entries.length > 0 && (
        <div style={{
          position: 'fixed', left: 0, right: 0, bottom: 0, zIndex: 30,
          background: C.dark, borderTop: '1px solid rgba(166,120,90,0.35)',
          padding: '0.65rem 1rem calc(0.65rem + env(safe-area-inset-bottom))',
        }}>
          {/* Right padding clears the app-wide feedback bubble, which sits
              bottom-right on every page and would otherwise cover Save. */}
          <div style={{ maxWidth: 560, margin: '0 auto', display: 'flex', alignItems: 'center', gap: '0.75rem', paddingRight: '4rem' }}>
            <div style={{ flex: 1, minWidth: 0, fontSize: '0.8rem', fontWeight: 700,
              color: saveMsg ? (saveMsg.ok ? C.green : C.red) : dirty ? C.amber : C.lightBrown }}>
              {saveMsg ? saveMsg.text : dirty ? '● Unsaved changes' : 'No changes'}
            </div>
            <button
              onClick={save}
              disabled={!dirty || saving}
              style={{ ...btn('primary', !dirty || saving), padding: '0.75rem 1.4rem', fontSize: '0.95rem' }}
            >
              {saving ? 'Saving…' : 'Save plan'}
            </button>
          </div>
        </div>
      )}

      {/* Carcass sheet */}
      {sheetUnit && (
        <UnitSheet
          unit={sheetUnit.unit}
          currentDate={sheetUnit.date}
          days={datedDays}
          loads={loads}
          lbsPerDay={lbsPerDay}
          killByDate={killByDate}
          suggestDate={suggestDate}
          onClose={() => setOpenUnit(null)}
          onMoveTo={d => apply(prev => reRank(moveItemToDay(prev, sheetUnit.unit[0].key, d)))}
          onMoveToPile={() => apply(prev => moveToPile(prev, openUnit!))}
          onNudge={dir => apply(prev => nudge(prev, openUnit!, dir))}
          onToggleLock={() => {
            const ids = new Set(sheetUnit.unit.map(e => e.key))
            const next = !(sheetUnit.unit[0] as ScheduleEntry).locked
            apply(prev => prev.map(e => e.type === 'carcass' && ids.has(e.key) ? { ...e, locked: next } : e))
          }}
          onNote={note => {
            const k = sheetUnit.unit[0].key
            apply(prev => prev.map(e => e.type === 'carcass' && e.key === k ? { ...e, entry_notes: note } : e))
          }}
        />
      )}

      {/* Day sheet */}
      {sheetDay && (
        <DaySheet
          brk={sheetDay}
          head={toUnits(sections.find(s => s.brk?.key === sheetDay.key)?.items ?? []).filter(u => u[0].type === 'carcass').length}
          taken={new Set(datedDays.filter(b => b.key !== sheetDay.key).map(b => b.break_date))}
          onClose={() => setOpenDay(null)}
          onRedate={d => {
            apply(prev => reRank(moveDayIntoDateOrder(
              prev.map(e => e.type === 'break' && e.key === sheetDay.key ? { ...e, break_date: d } : e), sheetDay.key)))
            setOpenDay(null)
          }}
          onRemove={() => { apply(prev => removeDay(prev, sheetDay.key)); setOpenDay(null) }}
        />
      )}
    </div>
  )
}

// ── Pieces ───────────────────────────────────────────────────────────────────

const card: React.CSSProperties = {
  background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 6,
}

function headerBar(color: string): React.CSSProperties {
  return {
    display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '0.5rem',
    padding: '0.55rem 0.65rem', marginBottom: '0.45rem',
    background: `${color}1A`, border: `1px solid ${color}55`, borderRadius: 6,
  }
}

function btn(kind: 'primary' | 'ghost' | 'danger', disabled = false): React.CSSProperties {
  const base: React.CSSProperties = {
    borderRadius: 6, padding: '0.6rem 0.9rem', fontSize: '0.85rem', fontWeight: 700,
    cursor: disabled ? 'default' : 'pointer', opacity: disabled ? 0.45 : 1, minHeight: 44,
  }
  if (kind === 'primary') return { ...base, background: C.amber, color: C.dark, border: 'none' }
  if (kind === 'danger')  return { ...base, background: 'rgba(239,68,68,0.12)', color: C.red, border: '1px solid rgba(239,68,68,0.45)' }
  return { ...base, background: 'rgba(201,168,130,0.15)', color: C.tan, border: '1px solid rgba(201,168,130,0.4)' }
}

function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{
      background: `${color}1A`, border: `1px solid ${color}66`, color, borderRadius: 6,
      padding: '0.55rem 0.7rem', fontSize: '0.8rem', fontWeight: 700, marginBottom: '0.8rem',
    }}>
      {children}
    </div>
  )
}

function UnitList({ units, date, onOpen }: { units: ListItem[][]; date: string; onOpen: (k: string) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
      {units.map(u => <UnitCard key={unitKey(u[0])} unit={u} date={date} onOpen={() => onOpen(unitKey(u[0]))} />)}
    </div>
  )
}

function UnitCard({ unit, date, onOpen }: { unit: ListItem[]; date: string; onOpen: () => void }) {
  const first = unit[0]
  if (first.type === 'future') {
    const f = first as FutureItem
    return (
      <button onClick={onOpen} style={{
        ...card, display: 'block', width: '100%', textAlign: 'left', cursor: 'pointer', color: C.cream,
        padding: '0.6rem 0.75rem', borderStyle: 'dashed', borderLeft: `5px dashed ${speciesColor(f.species)}`,
      }}>
        <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{f.source || 'Booking'}</div>
        <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: 2 }}>
          {speciesIcon(f.species)} {f.species} · {f.seq} of {f.head_count} · not killed yet ({shortDay(f.harvest_date)})
        </div>
      </button>
    )
  }
  const rows = unit as ScheduleEntry[]
  const e = rows[0]
  const names = rows.length > 1
    ? rows.map(r => r.customer_name).join(' / ')
    : e.customer_name
  const pb = portionBadge(e.portion)
  const atCut = hangAtCut(e.harvest_date, date || undefined, e.days_hanging)
  const missing = rows.some(r => !r.has_instructions)
  const note = rows.map(r => r.entry_notes).find(Boolean)
  return (
    <button onClick={onOpen} style={{
      ...card, display: 'flex', gap: '0.6rem', width: '100%', textAlign: 'left', cursor: 'pointer',
      color: C.cream, padding: '0.6rem 0.7rem', borderLeft: `5px solid ${speciesColor(e.species)}`,
    }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
          {e.locked && <span title="Locked">🔒</span>}
          <span style={{ fontWeight: 700, fontSize: '0.95rem' }}>{names}</span>
          <span style={{ color: pb.color, fontSize: '0.72rem', fontWeight: 700 }}>{rows.length > 1 ? 'Split' : pb.label}</span>
          {e.kill_type && (
            <span style={{ fontSize: '0.64rem', fontWeight: 700, color: e.kill_type === 'USDA' ? C.green : C.amber }}>{e.kill_type}</span>
          )}
        </div>
        <div style={{ fontSize: '0.74rem', color: C.lightBrown, marginTop: 2 }}>
          {speciesIcon(e.species)} {e.species}
          {e.carcass_tag && <span style={{ fontFamily: 'monospace' }}> · {e.carcass_tag}</span>}
          {e.producer && <> · {e.producer}</>}
          {missing && <span style={{ color: e.sheet_state === 'no-buyer' ? C.amber : C.red, fontWeight: 700 }}> · {e.sheet_state === 'no-buyer' ? 'no buyer' : 'no sheet'}</span>}
          {e.carried_from && <span style={{ color: C.amber, fontWeight: 700 }}> · ↪ from {shortDay(e.carried_from)}</span>}
        </div>
        {note && <div style={{ fontSize: '0.75rem', color: C.tan, fontStyle: 'italic', marginTop: 3 }}>{note}</div>}
      </div>
      <div style={{ textAlign: 'right', flexShrink: 0 }}>
        <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
          {e.hot_carcass_weight_lbs != null ? <>{e.hot_carcass_weight_lbs}<span style={{ fontSize: '0.65rem', color: C.lightBrown }}> lb</span></> : <span style={{ color: C.medBrown }}>—</span>}
        </div>
        <div style={{ fontSize: '0.74rem', fontWeight: 700, color: hangColor(atCut) }}>
          {atCut > e.days_hanging ? `${e.days_hanging}→${atCut}d` : `${e.days_hanging}d`}
        </div>
      </div>
    </button>
  )
}

function Sheet({ title, onClose, children }: { title: React.ReactNode; onClose: () => void; children: React.ReactNode }) {
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])
  return (
    <div onClick={onClose} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(0,0,0,0.55)', display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
      <div onClick={e => e.stopPropagation()} style={{
        background: C.darkBrown, width: '100%', maxWidth: 560, maxHeight: '88vh', overflowY: 'auto',
        borderRadius: '12px 12px 0 0', border: '1px solid rgba(166,120,90,0.4)', borderBottom: 'none',
        padding: '0.9rem 1rem calc(1rem + env(safe-area-inset-bottom))',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '0.75rem', marginBottom: '0.75rem' }}>
          <div style={{ minWidth: 0 }}>{title}</div>
          <button onClick={onClose} style={{ ...btn('ghost'), padding: '0.4rem 0.8rem' }} aria-label="Close">✕</button>
        </div>
        {children}
      </div>
    </div>
  )
}

const sheetLabel: React.CSSProperties = {
  fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em',
  fontWeight: 700, margin: '0.9rem 0 0.4rem',
}

function UnitSheet(props: {
  unit: ListItem[]; currentDate: string; days: BreakItem[]
  loads: Map<string, { lbs: number; head: number }>; lbsPerDay: number
  killByDate: Map<string, number>; suggestDate: string
  onClose: () => void; onMoveTo: (d: string) => void; onMoveToPile: () => void
  onNudge: (dir: -1 | 1) => void; onToggleLock: () => void; onNote: (n: string) => void
}) {
  const { unit, currentDate, days, loads, lbsPerDay, killByDate, onClose } = props
  const [newDay, setNewDay] = useState(false)
  const first = unit[0]
  const isCarcass = first.type === 'carcass'
  const e = isCarcass ? (first as ScheduleEntry) : null
  const f = !isCarcass ? (first as FutureItem) : null

  const moveAndClose = (fn: () => void) => { fn(); onClose() }

  return (
    <Sheet
      onClose={onClose}
      title={
        <>
          <div style={{ fontWeight: 700, fontSize: '1.02rem' }}>
            {e ? (unit as ScheduleEntry[]).map(r => r.customer_name).join(' / ') : f!.source || 'Booking'}
          </div>
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: 2 }}>
            {e
              ? <>{speciesIcon(e.species)} {e.species}{e.carcass_tag ? ` · tag ${e.carcass_tag}` : ''} · killed {shortDay(e.harvest_date)} · {e.days_hanging}d hanging</>
              : <>{speciesIcon(f!.species)} {f!.species} · {f!.seq} of {f!.head_count} · kills {shortDay(f!.harvest_date)}</>}
          </div>
          <div style={{ fontSize: '0.75rem', color: C.amber, marginTop: 2, fontWeight: 700 }}>
            Now: {currentDate ? dateLabel(currentDate) : 'No cut day'}
          </div>
        </>
      }
    >
      <div style={{ display: 'flex', gap: '0.5rem' }}>
        <button onClick={() => props.onNudge(-1)} style={{ ...btn('ghost'), flex: 1 }}>↑ Up</button>
        <button onClick={() => props.onNudge(1)} style={{ ...btn('ghost'), flex: 1 }}>↓ Down</button>
        {e && (
          <button onClick={props.onToggleLock} style={{ ...btn('ghost'), flex: 1, color: e.locked ? C.amber : C.tan }}>
            {e.locked ? '🔒 Locked' : '🔓 Lock'}
          </button>
        )}
      </div>

      <div style={sheetLabel}>Move to</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        {currentDate && (
          <button onClick={() => moveAndClose(props.onMoveToPile)} style={{ ...btn('ghost'), textAlign: 'left', color: C.amber }}>
            No cut day
          </button>
        )}
        {days.map(d => {
          const here = d.break_date === currentDate
          const load = loads.get(d.break_date)
          const tooEarly = !!f && d.break_date <= f.harvest_date
          const at = e ? hangAtCut(e.harvest_date, d.break_date, e.days_hanging) : null
          const over = (load?.lbs ?? 0) > lbsPerDay
          return (
            <button
              key={d.key}
              disabled={here}
              onClick={() => moveAndClose(() => props.onMoveTo(d.break_date))}
              style={{
                ...btn('ghost', here), display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                gap: '0.5rem', textAlign: 'left', color: C.cream,
                borderColor: here ? C.amber : 'rgba(201,168,130,0.4)',
              }}
            >
              <span>
                {dateLabel(d.break_date, { weekday: 'short', month: 'short', day: 'numeric' })}
                {here && <span style={{ color: C.amber }}> · here</span>}
                {killByDate.has(d.break_date) && <span style={{ color: C.tan, fontWeight: 400 }}> · kill day</span>}
                {tooEarly && <span style={{ color: C.red }}> · before it&apos;s killed</span>}
              </span>
              <span style={{ fontSize: '0.74rem', fontWeight: 400, color: C.lightBrown, whiteSpace: 'nowrap' }}>
                {at != null && <span style={{ color: hangColor(at), fontWeight: 700 }}>{at}d · </span>}
                <span style={{ color: over ? C.red : C.lightBrown }}>{lbsStr(load?.lbs ?? 0)}/{lbsStr(lbsPerDay)} lb</span>
              </span>
            </button>
          )
        })}
        {newDay ? (
          <DatePickRow
            initial={props.suggestDate}
            taken={new Set()}
            confirmLabel="Move here"
            onCancel={() => setNewDay(false)}
            onPick={d => moveAndClose(() => props.onMoveTo(d))}
          />
        ) : (
          <button onClick={() => setNewDay(true)} style={{ ...btn('ghost'), textAlign: 'left' }}>+ Another date…</button>
        )}
      </div>

      {e && (
        <>
          <div style={sheetLabel}>Note for the crew</div>
          <textarea
            defaultValue={e.entry_notes}
            onBlur={ev => { if (ev.target.value !== e.entry_notes) props.onNote(ev.target.value) }}
            rows={2}
            placeholder="e.g. customer picking up Friday"
            style={{
              width: '100%', boxSizing: 'border-box', background: C.dark, color: C.cream,
              border: '1px solid rgba(166,120,90,0.4)', borderRadius: 6, padding: '0.55rem',
              fontSize: '16px', fontFamily: 'inherit', resize: 'vertical',
            }}
          />
          {(unit as ScheduleEntry[]).length > 1 && (
            <div style={{ marginTop: '0.6rem', fontSize: '0.75rem', color: C.lightBrown }}>
              Split carcass — moves as one animal:{' '}
              {(unit as ScheduleEntry[]).map(r => `${portionBadge(r.portion).label} ${r.customer_name}`).join(', ')}
            </div>
          )}
        </>
      )}
    </Sheet>
  )
}

function DaySheet({ brk, head, taken, onClose, onRedate, onRemove }: {
  brk: BreakItem; head: number; taken: Set<string>
  onClose: () => void; onRedate: (d: string) => void; onRemove: () => void
}) {
  return (
    <Sheet
      onClose={onClose}
      title={
        <div style={{ fontWeight: 700, fontSize: '1.02rem' }}>
          {brk.break_date ? dateLabel(brk.break_date) : 'Day — no date set'}
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, fontWeight: 400, marginTop: 2 }}>{head} carcass{head === 1 ? '' : 'es'} on this day</div>
        </div>
      }
    >
      <div style={sheetLabel}>Change date</div>
      <DatePickRow
        initial={brk.break_date || isoDate()}
        taken={taken}
        confirmLabel="Change"
        onCancel={onClose}
        onPick={onRedate}
      />
      <div style={sheetLabel}>Remove</div>
      <button
        onClick={() => {
          if (!head || window.confirm(`Remove this day? ${head === 1 ? 'Its carcass goes' : `Its ${head} carcasses go`} back to No cut day.`)) onRemove()
        }}
        style={{ ...btn('danger'), width: '100%' }}
      >
        Remove this day{head ? ` (${head} → No cut day)` : ''}
      </button>
    </Sheet>
  )
}

function DatePickRow({ initial, taken, confirmLabel, onPick, onCancel }: {
  initial: string; taken: Set<string>; confirmLabel: string
  onPick: (d: string) => void; onCancel: () => void
}) {
  const [val, setVal] = useState(initial)
  const clash   = !!val && taken.has(val)
  const weekend = !!val && (dayOfWeekISO(val) === 0 || dayOfWeekISO(val) === 6)
  return (
    <div style={{ ...card, padding: '0.6rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
        <input
          type="date"
          value={val}
          onChange={ev => setVal(ev.target.value)}
          style={{
            flex: 1, minWidth: 0, minHeight: 44, background: C.darkBrown, color: C.cream,
            border: '1px solid rgba(166,120,90,0.4)', borderRadius: 6, padding: '0 0.5rem',
            fontSize: '16px', colorScheme: 'dark',
          }}
        />
        <button disabled={!val || clash} onClick={() => onPick(val)} style={btn('primary', !val || clash)}>{confirmLabel}</button>
        <button onClick={onCancel} style={btn('ghost')}>✕</button>
      </div>
      {clash   && <div style={{ color: C.red,   fontSize: '0.75rem', marginTop: 6, fontWeight: 700 }}>{dateLabel(val)} already has a day.</div>}
      {!clash && weekend && <div style={{ color: C.amber, fontSize: '0.75rem', marginTop: 6 }}>That&apos;s a weekend.</div>}
    </div>
  )
}
