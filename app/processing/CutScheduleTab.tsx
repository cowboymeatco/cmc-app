'use client'
import { Fragment, useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { HarvestAppointment, HarvestLog, CarcassAssignment } from '@/lib/types'
import AssignCarcassesModal from './AssignCarcassesModal'
import GrindAllModal from './GrindAllModal'
import {
  type PriorityWeights, type ScheduleEntry, type BreakItem, type ListItem, type FutureBooking,
  type FutureItem, type HarvestDay,
  DEFAULT_WEIGHTS, WEIGHT_LABELS, buildEntries, loadScheduleData, uniqueCarcasses as uniqueOf,
  calcScore, speciesColor, speciesIcon, portionBadge, cutDateByKey, hangAtCut, hangColor,
  carcassTotals, FUTURE_WINDOW_DEFAULT_DAYS, FUTURE_WINDOW_CHOICES,
} from '@/lib/cutSchedule'
import { isoDate, dateLabel, addDaysISO, mondayOfISO } from '@/lib/dates'

// How far out the bookings rail looks. Remembered per machine so the planner
// doesn't reset to 30 days every morning.
const WINDOW_STORAGE_KEY = 'cmc.cutSchedule.futureWindowDays'

// Everything GrindAllModal needs about the slot the card is being written for.
type GrindTarget = {
  appointmentId:         string
  appointmentCustomerId: string
  species:               string
  portion:               string
  producer:              string
  carcassTag:            string
  customerName:          string
  carcassCount:          number
}

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

// A kill day, drawn into the cutting plan where it falls.
//
// Not something you can drag, date or delete — it isn't part of the plan, it's
// the reason the plan skips a day. Deliberately quieter than a day break so
// the cutting days still read as the structure of the list.
function HarvestDayRow({ day }: { day: HarvestDay }) {
  const breakdown = [...day.species.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([sp, n]) => `${speciesIcon(sp)} ${n}`)
    .join('   ')
  return (
    <div
      title="Booked on the harvest calendar — no cutting planned for this day"
      style={{
        display: 'flex', alignItems: 'center', gap: '0.6rem',
        background: 'rgba(166,120,90,0.09)',
        border: '1px solid rgba(166,120,90,0.3)',
        borderRadius: 4, padding: '0.4rem 0.75rem',
      }}
    >
      <span style={{ fontSize: '0.9rem', userSelect: 'none' }}>🔪</span>
      <span style={{
        color: C.tan, fontSize: '0.68rem', fontWeight: 700,
        letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap',
      }}>
        Harvest day
      </span>
      <span style={{ color: C.lightBrown, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
        {dateLabel(day.date, { weekday: 'long', month: 'short', day: 'numeric' })}
      </span>
      <span style={{ flex: 1, height: 1, background: 'rgba(166,120,90,0.2)' }} />
      <span style={{ color: C.tan, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
        {day.head} head
      </span>
      {breakdown && (
        <span style={{ color: C.lightBrown, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
          {breakdown}
        </span>
      )}
      <span style={{ color: C.lightBrown, fontSize: '0.64rem', fontStyle: 'italic', whiteSpace: 'nowrap' }}>
        no cutting — crew is on the kill floor
      </span>
    </div>
  )
}

export default function CutScheduleTab() {
  const [entries,     setEntries]     = useState<ListItem[]>([])
  const [weights,     setWeights]     = useState<PriorityWeights>(DEFAULT_WEIGHTS)
  const [showWeights, setShowWeights] = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [loadError,   setLoadError]   = useState(false)
  const [saving,      setSaving]      = useState(false)
  const [savedAt,     setSavedAt]     = useState<string | null>(null)
  const [dragging,    setDragging]    = useState<string | null>(null)
  const [dragOver,    setDragOver]    = useState<string | null>(null)
  const [cutting,     setCutting]     = useState<Set<string>>(new Set())
  const [breakError,  setBreakError]  = useState<{ key: string; msg: string } | null>(null)

  // Cached source data, so the assign modal can read carcasses/customers and we
  // can rebuild the list after an assignment changes without a full reload.
  const [logs,        setLogs]        = useState<HarvestLog[]>([])
  const [appts,       setAppts]       = useState<HarvestAppointment[]>([])
  const [assignments, setAssignments] = useState<CarcassAssignment[]>([])
  const [assignModal, setAssignModal] = useState<{ appointments: HarvestAppointment[]; carcasses: HarvestLog[] } | null>(null)
  const [grindModal,  setGrindModal]  = useState<GrindTarget | null>(null)
  // Booked animals not harvested yet — a heads-up rail, not part of the
  // schedule itself. See lib/cutSchedule FutureBooking.
  const [futureBookings, setFutureBookings] = useState<FutureBooking[]>([])
  // Kill days off the harvest calendar — read-only context, not part of the plan.
  const [harvestDays,    setHarvestDays]    = useState<HarvestDay[]>([])
  const [futureWindow,   setFutureWindow]   = useState<number>(FUTURE_WINDOW_DEFAULT_DAYS)
  // Weeks the planner has explicitly opened or closed; anything untouched
  // follows the default below.
  const [weekOverride,   setWeekOverride]   = useState<Map<string, boolean>>(new Map())

  const todayISO = isoDate()

  // localStorage isn't there during SSR, so read it after mount.
  useEffect(() => {
    const saved = Number(window.localStorage.getItem(WINDOW_STORAGE_KEY))
    if (FUTURE_WINDOW_CHOICES.some(c => c.days === saved)) setFutureWindow(saved)
  }, [])

  const changeWindow = (days: number) => {
    setFutureWindow(days)
    try { window.localStorage.setItem(WINDOW_STORAGE_KEY, String(days)) } catch { /* private mode */ }
  }

  // ── Load from cooler inventory ────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { logs, apptMap, instrIds, saved, assignments, futureBookings, harvestDays } = await loadScheduleData(todayISO)
      setLogs(logs)
      setAppts([...apptMap.values()])
      setAssignments(assignments)
      setFutureBookings(futureBookings)
      setHarvestDays(harvestDays)
      setEntries(buildEntries(logs, apptMap, instrIds, saved, assignments, weights, futureBookings))
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayISO])

  useEffect(() => { loadAll() }, [loadAll])

  // Open the assign modal for the carcass row's whole producer group. A company
  // dropping several hogs books ONE appointment per buyer, so scoping the modal
  // to a single booking made a mixed-up tag unfixable — the buyer you want is on
  // the appointment next door (Jill, 2026-07-28). Group = same producer, species
  // and kill day; a carcass with no producer falls back to its own booking.
  const openAssign = (entry: ScheduleEntry) => {
    const appt = appts.find(a => a.id === entry.source_appointment_id)
    if (!appt) return
    const producer = entry.producer.trim()
    const byId = new Map(logs.filter(l => l.appointment_id === appt.id).map(l => [l.id, l]))
    if (producer) {
      for (const l of logs) {
        if ((l.producer ?? '').trim() === producer && l.species === entry.species && l.harvest_date === entry.harvest_date) {
          byId.set(l.id, l)
        }
      }
    }
    const carcasses = [...byId.values()]
    const apptIds = new Set<string>([appt.id, ...carcasses.map(l => l.appointment_id).filter(Boolean)])
    const appointments = appts.filter(a => apptIds.has(a.id))
    setAssignModal({ appointments, carcasses })
  }

  // The one slot on this row that has no cut sheet, or null when that question
  // has more than one answer. A split carcass waiting on two sheets, or an
  // unassigned booking whose buyers haven't been placed, has no single slot to
  // write a card for — those get assigned first, which is the button next door.
  const grindSlot = (entry: ScheduleEntry): { id: string; name: string } | null => {
    if (entry.has_instructions || !entry.source_appointment_id) return null
    if (entry.cut_customers.length) {
      const open = entry.cut_customers.filter(c => !c.has_instructions)
      return open.length === 1 ? { id: open[0].appointment_customer_id, name: open[0].name } : null
    }
    // Unassigned: buildEntries resolves a lone unplaced customer onto the row
    // and files everything else under 'standalone', which names nobody.
    if (entry.appointment_customer_id === 'standalone') return null
    return { id: entry.appointment_customer_id, name: entry.customer_name }
  }

  const openGrindAll = (entry: ScheduleEntry) => {
    const slot = grindSlot(entry)
    const appt = appts.find(a => a.id === entry.source_appointment_id)
    if (!slot || !appt) return
    setGrindModal({
      appointmentId:         appt.id,
      appointmentCustomerId: slot.id,
      species:               appt.species || entry.species,
      portion:               entry.portion,
      producer:              entry.producer || appt.source || '',
      carcassTag:            entry.carcass_tag,
      // Blank on a house booking; the modal falls back to the producer.
      customerName:          slot.name === entry.producer ? '' : slot.name,
      carcassCount:          logs.filter(l => l.appointment_id === appt.id).length,
    })
  }

  // ── Recalculate ───────────────────────────────────────────────────────────────
  const handleRecalculate = () => {
    setEntries(prev => {
      const rescored = prev.map(e =>
        e.type === 'carcass' ? { ...e, priority_score: calcScore(e, weights) } : e
      )
      // Day breaks, locked carcasses AND anything still waiting on a date are
      // anchors: they keep their slot. Without that last group, recalculating
      // shuffled the undated pile into the schedule — and since fresh carcasses
      // score low, it dealt them straight to the bottom, back under the last
      // day break. Nothing leaves the rail except by hand.
      // Anything that isn't a scoreable carcass keeps its slot outright —
      // breaks, and the not-yet-harvested placeholders, which have no score to
      // sort by and were put where they are by hand.
      const dates   = cutDateByKey(prev)
      const waiting = (e: ListItem) => e.type === 'carcass' && !dates.get(e.key)
      const anchors = rescored.filter(e => e.type !== 'carcass' || e.locked || waiting(e))
      const movable = rescored.filter(
        (e): e is ScheduleEntry => e.type === 'carcass' && !e.locked && !waiting(e)
      )
      movable.sort((a, b) => b.priority_score - a.priority_score)
      const result: (ListItem | null)[] = new Array(rescored.length).fill(null)
      for (const a of anchors) result[a.rank - 1] = a
      let ui = 0
      for (let i = 0; i < result.length; i++) {
        if (!result[i]) result[i] = movable[ui++]
      }
      return result.map((e, i) => ({ ...(e as ListItem), rank: i + 1 }))
    })
  }

  // ── Drag-and-drop ─────────────────────────────────────────────────────────────
  const handleDragStart = (key: string) => setDragging(key)
  const handleDragOver  = (e: React.DragEvent, key: string) => {
    e.preventDefault()
    if (key !== dragOver) setDragOver(key)
  }
  const handleDrop = (targetKey: string) => {
    if (!dragging || dragging === targetKey) { setDragging(null); setDragOver(null); return }
    setEntries(prev => {
      const list    = [...prev]
      const fromIdx = list.findIndex(e => e.key === dragging)
      const toIdx   = list.findIndex(e => e.key === targetKey)
      if (fromIdx === -1 || toIdx === -1) return prev
      const [moved] = list.splice(fromIdx, 1)
      list.splice(toIdx, 0, moved)
      return list.map((e, i) => ({ ...e, rank: i + 1 }))
    })
    setDragging(null); setDragOver(null)
  }
  // Dropped onto the waiting rail: send the carcass to the very front of the
  // list, above every day break, which is what "no cut day" means. Breaks
  // themselves have no business in the rail.
  const handleDropToRail = () => {
    if (!dragging) { setDragOver(null); return }
    setEntries(prev => {
      const list    = [...prev]
      const fromIdx = list.findIndex(e => e.key === dragging)
      if (fromIdx === -1 || list[fromIdx].type === 'break') return prev
      const [moved] = list.splice(fromIdx, 1)
      list.unshift(moved)
      return list.map((e, i) => ({ ...e, rank: i + 1 }))
    })
    setDragging(null); setDragOver(null)
  }

  const handleDragEnd = () => { setDragging(null); setDragOver(null) }

  const handleToggleLock = (key: string) =>
    setEntries(prev => prev.map(e =>
      e.type === 'carcass' && e.key === key ? { ...e, locked: !e.locked } : e))

  const handleNoteChange = (key: string, note: string) =>
    setEntries(prev => prev.map(e =>
      e.type === 'carcass' && e.key === key ? { ...e, entry_notes: note } : e))

  // ── Day breaks ────────────────────────────────────────────────────────────────
  const handleAddBreak = () =>
    setEntries(prev => {
      const newBreak: BreakItem = {
        type: 'break', key: `break_${crypto.randomUUID()}`, rank: 0, break_date: '',
      }
      return [newBreak, ...prev].map((e, i) => ({ ...e, rank: i + 1 }))
    })

  const handleRemoveBreak = (key: string) => {
    setBreakError(prev => (prev?.key === key ? null : prev))
    setEntries(prev => prev.filter(e => e.key !== key).map((e, i) => ({ ...e, rank: i + 1 })))
  }

  // One break per day. Two breaks on the same date split a day's cutting into
  // two headings that both claim to be that day, and the crew view then renders
  // the date twice (Charlie, 2026-08-05). The date is refused rather than
  // merged, so the planner sees which break he already has and moves that one.
  const handleBreakDate = (key: string, break_date: string) => {
    const clash = break_date && entries.some(
      e => e.type === 'break' && e.key !== key && e.break_date === break_date
    )
    if (clash) {
      setBreakError({
        key,
        msg: `${dateLabel(break_date, { weekday: 'long', month: 'short', day: 'numeric' })} already has a day break`,
      })
      return
    }
    setBreakError(prev => (prev?.key === key ? null : prev))
    setEntries(prev => prev.map(e =>
      e.type === 'break' && e.key === key ? { ...e, break_date } : e))
  }

  // Called here and will also be called by the processing scanner
  const handleMarkCut = async (entry: ScheduleEntry) => {
    // Cut status lives on the harvest log (the physical carcass), so a split
    // animal can only be marked cut as a whole. The row is now the carcass
    // rather than one buyer's portion, so the warning reads off its own cut
    // customers — the check used to look for sibling ROWS, which no longer
    // exist, and would have gone quiet without anyone noticing.
    if (entry.cut_customers.length > 1) {
      const others = entry.cut_customers.map(c => `${c.portion} — ${c.name}`).join(', ')
      const ok = window.confirm(
        `This carcass${entry.carcass_tag ? ` (tag ${entry.carcass_tag})` : ''} is split between ${others}. ` +
        `Marking it cut takes the whole animal off the schedule. Only continue if EVERY portion has been cut.`
      )
      if (!ok) return
    }
    setCutting(prev => new Set(prev).add(entry.key))
    try {
      await fetch('/api/harvest', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: entry.harvest_log_id, status: 'cut' }),
      })
      // Drop every row of this carcass and re-rank, so stale rank gaps can't
      // corrupt the anchor math in handleRecalculate.
      setEntries(prev => prev
        .filter(e => !(e.type === 'carcass' && e.harvest_log_id === entry.harvest_log_id))
        .map((e, i) => ({ ...e, rank: i + 1 })))
    } finally {
      setCutting(prev => { const s = new Set(prev); s.delete(entry.key); return s })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      // Placeholders are rebuilt from the bookings on every load, so only the
      // ones actually dropped on a cutting day carry information worth saving.
      // Writing the unplaced ones too would put a few hundred dead rows in the
      // table on every save and tell us nothing we can't re-derive.
      const placedDates = cutDateByKey(entries)
      const toSave = entries.filter(e => e.type !== 'future' || placedDates.get(e.key))
      const res = await fetch('/api/cut-schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          schedule_date: todayISO,
          items: toSave.map(e => e.type === 'break'
            ? {
                kind:                    'break' as const,
                appointment_id:          null,
                appointment_customer_id: null,
                manual_rank:             e.rank,
                locked:                  false,
                notes:                   '',
                break_date:              e.break_date || null,
              }
            : e.type === 'future'
            ? {
                kind:                    'future' as const,
                appointment_id:          null,
                appointment_customer_id: null,
                manual_rank:             e.rank,
                locked:                  false,
                notes:                   '',
                break_date:              null,
                future_appointment_id:   e.appointment_id,
                future_seq:              e.seq,
              }
            : {
                kind:                    'carcass' as const,
                appointment_id:          e.appointment_id,
                appointment_customer_id: e.appointment_customer_id,
                manual_rank:             e.rank,
                locked:                  e.locked,
                notes:                   e.entry_notes,
                break_date:              null,
              }),
        }),
      })
      if (res.ok) setSavedAt(new Date().toLocaleTimeString())
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  const carcasses = entries.filter((e): e is ScheduleEntry => e.type === 'carcass')
  const uniqueCarcasses = uniqueOf(carcasses)

  // How long each carcass will have hung by the day it's laid out to be cut.
  // Split rows share a carcass, so the averages run off the deduped list.
  const cutDates  = cutDateByKey(entries)
  const atCutByKey = new Map(
    carcasses.map(e => [e.key, hangAtCut(e.harvest_date, cutDates.get(e.key), e.days_hanging)])
  )
  const avgHang  = uniqueCarcasses.length
    ? uniqueCarcasses.reduce((s, e) => s + e.days_hanging, 0) / uniqueCarcasses.length : 0
  const avgAtCut = uniqueCarcasses.length
    ? uniqueCarcasses.reduce((s, e) => s + (atCutByKey.get(e.key) ?? e.days_hanging), 0) / uniqueCarcasses.length : 0
  // Only worth its own chip once the plan actually reaches past today —
  // otherwise it just repeats Avg Hang.
  const scheduledAhead = uniqueCarcasses.some(e => (atCutByKey.get(e.key) ?? 0) > e.days_hanging)

  // Which carcasses still have no cut day: nothing dated sits above them, so
  // nobody has decided when they get cut. Everything else is under a dated day
  // break and has one. This is the tally Charlie works off to push the next
  // day's list to the crew (2026-08-05).
  const noDay       = carcasses.filter(e => !cutDates.get(e.key))
  const noDayTotals = carcassTotals(noDay)

  // Same rule for the not-yet-harvested placeholders: one with nothing dated
  // above it is still sitting in the rail waiting to be dragged onto a day.
  const futures       = entries.filter((e): e is FutureItem => e.type === 'future')
  const unplacedFuture = futures.filter(e => !cutDates.get(e.key))
  const noDayKeys     = new Set([...noDay, ...unplacedFuture].map(e => e.key))

  // ── Harvest days ──────────────────────────────────────────────────────────────
  // The plan lists cutting days, so the days it skips read as idle when they're
  // usually kill days — the crew is on the harvest floor, not the saw (Charlie,
  // 2026-08-24: "so folks can see why we aren't cutting on somedays"). Kill days
  // come off the harvest calendar and sit in the running order where they fall,
  // which puts the reason for a gap next to the gap.
  //
  // A kill day hangs above the next cutting day after it, and only inside the
  // span the plan actually covers — one past the last cutting day isn't
  // explaining a gap yet, it's just calendar noise. Breaks are matched in DATE
  // order rather than list order, so a plan whose days got dragged out of
  // sequence still files each kill day against the right one.
  const datedBreaks = entries
    .filter((e): e is BreakItem => e.type === 'break' && !!e.break_date)
    .sort((a, b) => a.break_date.localeCompare(b.break_date))
  const planEnd = datedBreaks.length ? datedBreaks[datedBreaks.length - 1].break_date : ''
  const harvestBefore  = new Map<string, HarvestDay[]>()   // break key → kill days above it
  const alsoHarvesting = new Map<string, number>()         // break date → head killed that day
  for (const hd of harvestDays) {
    if (!planEnd || hd.date > planEnd) continue
    const host = datedBreaks.find(b => b.break_date >= hd.date)
    if (!host) continue
    // Cutting and killing on the same day is normal and worth saying on the
    // day break itself — it explains a short cut list rather than a missing one.
    if (host.break_date === hd.date) { alsoHarvesting.set(hd.date, hd.head); continue }
    const list = harvestBefore.get(host.key) ?? []
    list.push(hd)
    harvestBefore.set(host.key, list)
  }

  // The rail lists them by booking, so 6 head of one producer read as one
  // block you pull animals off, not six identical loose cards. Only bookings
  // inside the chosen window are offered — a head already placed still renders
  // in the schedule above no matter how narrow the window gets.
  const windowEnd = addDaysISO(todayISO, futureWindow)
  const futureGroups = futureBookings
    .filter(fb => fb.harvest_date <= windowEnd)
    .map(fb => ({
      booking: fb,
      pending: unplacedFuture
        .filter(f => f.appointment_id === fb.id)
        .sort((a, b) => a.seq - b.seq),
    }))
    .filter(g => g.pending.length > 0)

  // At 13 weeks the rail runs to a couple hundred head, so bookings stack into
  // the week they're killed in. The next two weeks are open by default —
  // that's the part anyone is actually cutting soon — and the rest sit folded
  // with their totals showing until someone needs them.
  const futureWeeks: {
    key: string; monday: string; groups: typeof futureGroups; head: number; open: boolean
  }[] = []
  for (const g of futureGroups) {
    const monday = mondayOfISO(g.booking.harvest_date)
    let wk = futureWeeks.find(w => w.key === monday)
    if (!wk) {
      wk = { key: monday, monday, groups: [], head: 0, open: true }
      futureWeeks.push(wk)
    }
    wk.groups.push(g)
    wk.head += g.pending.length
  }
  futureWeeks.sort((a, b) => a.monday.localeCompare(b.monday))
  for (const [i, wk] of futureWeeks.entries()) {
    wk.open = weekOverride.get(wk.key) ?? i < 2
  }
  const toggleWeek = (key: string, open: boolean) =>
    setWeekOverride(prev => new Map(prev).set(key, open))

  // Dates carrying more than one break. handleBreakDate stops new ones, but
  // plans saved before that rule went in can still hold a pair (the live plan
  // did, on 2026-08-10) — flag those so they get fixed instead of sitting there
  // silently splitting a day in two.
  const dupDates = new Set(
    entries
      .filter((e): e is BreakItem => e.type === 'break' && !!e.break_date)
      .map(e => e.break_date)
      .filter((d, i, all) => all.indexOf(d) !== i)
  )

  return (
    <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', maxWidth: 1200 }}>
    <div style={{ flex: '1 1 auto', minWidth: 0, maxWidth: 900 }}>

      {loadError && (
        <div style={{
          background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.45)',
          borderRadius: 4, padding: '0.6rem 1rem', marginBottom: '1rem',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.75rem',
          color: C.red, fontSize: '0.85rem', fontWeight: 700,
        }}>
          <span>⚠ Couldn&apos;t load the cooler — the schedule below may be incomplete.</span>
          <button
            onClick={loadAll}
            style={{
              background: 'transparent', border: `1px solid rgba(239,68,68,0.45)`, color: C.red,
              borderRadius: 4, padding: '0.3rem 0.9rem', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
            }}
          >
            ↻ Retry
          </button>
        </div>
      )}

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {!loading && carcasses.length > 0 && [
            { label: 'In Cooler',      value: uniqueCarcasses.length,                                 color: C.tan,   title: 'Carcasses chilling right now' },
            { label: 'Missing Sheet',  value: carcasses.filter(e => !e.has_instructions).length,      color: C.red,   title: 'Cut jobs with no cut sheet on file' },
            { label: 'Locked',         value: carcasses.filter(e => e.locked).length,                 color: C.amber, title: 'Rows pinned in place when you recalculate' },
            { label: 'Avg Hang',       value: uniqueCarcasses.length ? avgHang.toFixed(1) + 'd' : '—', color: C.lightBrown, title: 'Average days hung as of today' },
            ...(scheduledAhead ? [{
              label: 'Avg At Cut',
              value: avgAtCut.toFixed(1) + 'd',
              color: hangColor(avgAtCut),
              title: 'Average days each carcass will have hung by the day break it sits under',
            }] : []),
          ].map(stat => (
            <div key={stat.label} title={stat.title} style={{
              background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4,
              padding: '0.35rem 0.85rem', display: 'flex', alignItems: 'baseline', gap: '0.4rem',
            }}>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: stat.color }}>{stat.value}</span>
              <span style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{stat.label}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.6rem' }}>
          <Link
            href="/cut-schedule"
            title="Read-only phone view of this schedule — send this link to the crew"
            style={{
              background: 'rgba(59,130,246,0.12)', color: '#3B82F6',
              border: '1px solid rgba(59,130,246,0.45)', borderRadius: 4,
              padding: '0.5rem 1rem', fontWeight: 700, fontSize: '0.85rem',
              textDecoration: 'none', whiteSpace: 'nowrap',
              display: 'inline-flex', alignItems: 'center',
            }}
          >
            📱 Crew View ↗
          </Link>
          <button
            onClick={handleAddBreak}
            disabled={loading || carcasses.length === 0}
            title="Insert a day break, then drag it to where one day's cutting ends"
            style={{
              background: 'rgba(245,158,11,0.12)', color: C.amber,
              border: `1px solid rgba(245,158,11,0.45)`, borderRadius: 4,
              padding: '0.5rem 1rem', fontWeight: 700, fontSize: '0.85rem',
              cursor: (loading || carcasses.length === 0) ? 'not-allowed' : 'pointer',
              opacity: (loading || carcasses.length === 0) ? 0.5 : 1, whiteSpace: 'nowrap',
            }}
          >
            ➕ Day Break
          </button>

          <button
            onClick={handleSave}
            disabled={saving || loading || entries.length === 0}
            style={{
              background: (saving || entries.length === 0) ? C.medBrown : C.green,
              color: C.dark, border: 'none', borderRadius: 4,
              padding: '0.5rem 1.4rem', fontWeight: 700, fontSize: '0.85rem',
              cursor: (saving || loading || entries.length === 0) ? 'not-allowed' : 'pointer',
              opacity: loading ? 0.5 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save Order'}
          </button>
        </div>
      </div>

      {/* Saved indicator */}
      {savedAt && (
        <div style={{
          background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.3)',
          borderRadius: 4, padding: '0.45rem 1rem', marginBottom: '1rem',
          fontSize: '0.8rem', color: C.green,
        }}>
          ✓ Order saved at {savedAt}
        </div>
      )}

      {/* Priority Weights accordion */}
      <div style={{
        background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
        borderRadius: 6, marginBottom: '1.25rem', overflow: 'hidden',
      }}>
        <button
          onClick={() => setShowWeights(w => !w)}
          style={{
            width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '0.7rem 1.25rem', background: 'none', border: 'none',
            color: C.tan, cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600,
          }}
        >
          <span>⚖️ Priority Weights</span>
          <span style={{ fontSize: '0.75rem', color: C.lightBrown }}>{showWeights ? '▲ Hide' : '▼ Adjust'}</span>
        </button>

        {showWeights && (
          <div style={{ padding: '0 1.25rem 1.25rem', borderTop: '1px solid rgba(166,120,90,0.15)' }}>
            <p style={{ fontSize: '0.75rem', color: C.lightBrown, margin: '0.75rem 0 1rem' }}>
              Higher weight = bigger impact on priority score. Locked items keep their position when you recalculate.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '1.25rem' }}>
              {(Object.keys(weights) as (keyof PriorityWeights)[]).map(key => (
                <div key={key}>
                  <label style={{
                    display: 'flex', justifyContent: 'space-between',
                    fontSize: '0.8rem', color: C.tan, marginBottom: '0.4rem',
                  }}>
                    <span>{WEIGHT_LABELS[key]}</span>
                    <span style={{ color: C.cream, fontWeight: 700 }}>{weights[key]}</span>
                  </label>
                  <input
                    type="range" min={0} max={10} step={1} value={weights[key]}
                    onChange={e => setWeights(w => ({ ...w, [key]: parseInt(e.target.value) }))}
                    style={{ width: '100%', accentColor: C.amber }}
                  />
                </div>
              ))}
            </div>
            <button
              onClick={handleRecalculate}
              style={{
                marginTop: '1rem', background: C.amber, color: C.dark,
                border: 'none', borderRadius: 4, padding: '0.45rem 1.1rem',
                fontWeight: 700, fontSize: '0.82rem', cursor: 'pointer',
              }}
            >
              Recalculate
            </button>
          </div>
        )}
      </div>

      {/* Loading */}
      {loading && (
        <div style={{ textAlign: 'center', padding: '4rem', color: C.lightBrown, fontSize: '0.9rem' }}>
          Loading cooler inventory…
        </div>
      )}

      {/* Empty state */}
      {!loading && carcasses.length === 0 && (
        <div style={{
          background: C.dark, border: '1px solid rgba(166,120,90,0.2)',
          borderRadius: 6, padding: '3rem', textAlign: 'center',
        }}>
          <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>🧊</div>
          <p style={{ color: C.tan, fontSize: '1rem', margin: '0 0 0.5rem' }}>Cooler is empty</p>
          <p style={{ color: C.lightBrown, fontSize: '0.82rem', margin: 0 }}>
            Carcasses logged in the Harvest module with status <em>chilling</em> will appear here automatically.
          </p>
        </div>
      )}

      {/* Schedule list */}
      {!loading && entries.length > 0 && (
        <>
          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '24px 30px 1fr 80px 56px 64px 84px 52px 44px 30px 58px',
            gap: '0.5rem', padding: '0 0.75rem', marginBottom: '0.4rem',
          }}>
            {['', '#', 'Customer', 'Species', 'Cut', 'Hang Wt', 'Hanging', 'Sheet', 'Score', '', ''].map((h, i) => (
              <span key={i} style={{
                fontSize: '0.65rem', color: C.lightBrown,
                textTransform: 'uppercase', letterSpacing: '0.1em',
                textAlign: i >= 4 ? 'center' : 'left',
              }}>
                {h}
              </span>
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {(() => {
            // A day break heads the day it sits on top of, so its subtotal is the
            // carcasses BELOW it, down to the next break (or end of list).
            // Walk bottom-up, accumulating carcasses; each break claims whatever
            // has piled up beneath it, then resets. Deduped by carcass so a split
            // animal counts its hanging weight once, not once per customer portion.
            // Not-yet-harvested placeholders count as head but carry NO weight —
            // there is no hanging weight until the animal is on the rail, and
            // guessing one would quietly corrupt the day's lb total (Charlie,
            // 2026-08-19: "just do a head count on those").
            const dayTotals = new Map<string, { lbs: number; count: number; future: number }>()
            {
              let lbs = 0
              let future = 0
              let ids = new Set<string>()
              for (let i = entries.length - 1; i >= 0; i--) {
                const e = entries[i]
                if (e.type === 'break') {
                  dayTotals.set(e.key, { lbs, count: ids.size + future, future })
                  lbs = 0
                  future = 0
                  ids = new Set<string>()
                } else if (e.type === 'future') {
                  future++
                } else if (!ids.has(e.harvest_log_id)) {
                  ids.add(e.harvest_log_id)
                  if (e.hot_carcass_weight_lbs != null) lbs += e.hot_carcass_weight_lbs
                }
              }
            }
            let carcassNo = 0
            // Carcasses still waiting on a date live in the rail, not here — the
            // schedule shows only what's actually been given a day.
            return entries.filter(e => e.type === 'break' || !noDayKeys.has(e.key)).map(entry => {
              const isDragging = dragging === entry.key
              const isOver     = dragOver  === entry.key

              // ── Day break divider ──────────────────────────────────────────────
              if (entry.type === 'break') {
                const day = dayTotals.get(entry.key) ?? { lbs: 0, count: 0, future: 0 }
                const killedToday = entry.break_date ? alsoHarvesting.get(entry.break_date) : undefined
                return (
                  <Fragment key={entry.key}>
                  {(harvestBefore.get(entry.key) ?? []).map(hd => (
                    <HarvestDayRow key={hd.date} day={hd} />
                  ))}
                  <div
                    draggable
                    onDragStart={() => handleDragStart(entry.key)}
                    onDragOver={e  => handleDragOver(e, entry.key)}
                    onDrop={() => handleDrop(entry.key)}
                    onDragEnd={handleDragEnd}
                    style={{
                      display: 'flex', alignItems: 'center', gap: '0.6rem',
                      background: 'rgba(245,158,11,0.08)',
                      border: `1px dashed ${isOver ? C.amber : 'rgba(245,158,11,0.55)'}`,
                      borderRadius: 4, padding: '0.5rem 0.75rem',
                      opacity: isDragging ? 0.4 : 1, cursor: 'grab',
                      transition: 'border-color 0.1s, opacity 0.15s',
                      boxShadow: isOver ? `0 0 0 2px ${C.amber}44` : 'none',
                    }}
                  >
                    <span style={{ color: C.amber, fontSize: '1rem', userSelect: 'none' }}>⠿</span>
                    <span style={{
                      color: C.amber, fontSize: '0.68rem', fontWeight: 700,
                      letterSpacing: '0.12em', textTransform: 'uppercase', whiteSpace: 'nowrap',
                    }}>
                      ▸ Day Break
                    </span>
                    <input
                      type="date"
                      value={entry.break_date}
                      onChange={e => handleBreakDate(entry.key, e.target.value)}
                      onClick={e => e.stopPropagation()}
                      onDragStart={e => e.stopPropagation()}
                      style={{
                        flex: '0 0 auto', background: 'rgba(0,0,0,0.25)',
                        border: '1px solid rgba(245,158,11,0.35)', borderRadius: 3,
                        color: C.cream, fontSize: '0.78rem', padding: '3px 6px',
                        outline: 'none', colorScheme: 'dark',
                      }}
                    />
                    {entry.break_date && (
                      <span style={{ color: C.tan, fontSize: '0.72rem', whiteSpace: 'nowrap' }}>
                        {dateLabel(entry.break_date, { weekday: 'long' })}
                      </span>
                    )}
                    {killedToday != null && (
                      <span
                        title="Booked on the harvest calendar for the same day — expect a shorter cut list"
                        style={{ color: C.lightBrown, fontSize: '0.68rem', whiteSpace: 'nowrap' }}
                      >
                        🔪 also killing {killedToday} head
                      </span>
                    )}
                    {(() => {
                      const warn = breakError?.key === entry.key
                        ? `${breakError.msg} — one break per day`
                        : entry.break_date && dupDates.has(entry.break_date)
                          ? 'Another break is on this day too — give one of them a different date'
                          : null
                      return warn ? (
                        <span style={{
                          flex: 1, minWidth: 0, color: C.red, fontSize: '0.7rem', fontWeight: 700,
                          overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                        }}>
                          ⚠ {warn}
                        </span>
                      ) : (
                        <span style={{ flex: 1, height: 1, background: 'rgba(245,158,11,0.25)' }} />
                      )
                    })()}
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
                      <span style={{ color: C.amber, fontSize: '0.82rem', fontWeight: 700 }}>
                        {Math.round(day.lbs).toLocaleString()} lb
                      </span>
                      <span style={{ color: C.lightBrown, fontSize: '0.64rem' }}>
                        · {day.count} {day.count === 1 ? 'carcass' : 'carcasses'} this day
                      </span>
                      {day.future > 0 && (
                        <span
                          title={`${day.future} of these ${day.future === 1 ? 'is' : 'are'} booked but not harvested yet — counted as head, no hanging weight`}
                          style={{ color: C.lightBrown, fontSize: '0.64rem', fontStyle: 'italic' }}
                        >
                          ({day.future} upcoming)
                        </span>
                      )}
                    </span>
                    <button
                      title="Remove day break"
                      onClick={e => { e.stopPropagation(); handleRemoveBreak(entry.key) }}
                      style={{
                        width: 26, height: 24, background: 'rgba(239,68,68,0.12)',
                        border: '1px solid rgba(239,68,68,0.4)', borderRadius: 3,
                        cursor: 'pointer', color: C.red, fontSize: '0.8rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      ✕
                    </button>
                  </div>
                  </Fragment>
                )
              }

              // ── Placed future booking ──────────────────────────────────────────
              // Given a cutting day before the animal exists. Takes a number in
              // the running order like any other head, but every column that
              // depends on a real carcass (weight, hang, sheet, score) is empty
              // because there is nothing to read yet.
              if (entry.type === 'future') {
                carcassNo++
                // You can't cut an animal before it's killed. Easy to do by
                // accident when dragging onto a day break that sits earlier in
                // the list than the booking's harvest date.
                const fCutDate = cutDates.get(entry.key)
                const tooEarly = !!fCutDate && fCutDate < entry.harvest_date
                return (
                  <div
                    key={entry.key}
                    draggable
                    onDragStart={() => handleDragStart(entry.key)}
                    onDragOver={e  => handleDragOver(e, entry.key)}
                    onDrop={() => handleDrop(entry.key)}
                    onDragEnd={handleDragEnd}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '24px 30px 1fr 80px 56px 64px 84px 52px 44px 30px 58px',
                      gap: '0.5rem', alignItems: 'center',
                      background: 'rgba(0,0,0,0.18)',
                      border: `1px dashed ${isOver ? C.amber : tooEarly ? 'rgba(239,68,68,0.55)' : 'rgba(166,120,90,0.35)'}`,
                      borderLeft: `4px dashed ${speciesColor(entry.species)}`,
                      borderRadius: 4, padding: '0.5rem 0.75rem',
                      opacity: isDragging ? 0.4 : 1, cursor: 'grab',
                      transition: 'border-color 0.1s, opacity 0.15s',
                      boxShadow: isOver ? `0 0 0 2px ${C.amber}44` : 'none',
                    }}
                  >
                    <span style={{ color: C.medBrown, fontSize: '1rem', userSelect: 'none', textAlign: 'center' }}>⠿</span>
                    <span style={{
                      fontFamily: 'Georgia, serif', fontSize: '0.95rem', fontWeight: 700,
                      textAlign: 'center', color: C.medBrown,
                    }}>
                      {carcassNo}
                    </span>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', minWidth: 0 }}>
                        <span style={{
                          fontWeight: 600, fontSize: '0.87rem', color: C.tan, fontStyle: 'italic',
                          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                        }}>
                          {entry.source || 'Booked'}
                        </span>
                        {entry.head_count > 1 && (
                          <span style={{
                            fontSize: '0.62rem', color: C.lightBrown, fontFamily: 'monospace',
                            background: 'rgba(0,0,0,0.3)', borderRadius: 2, padding: '0 4px', flexShrink: 0,
                          }}>
                            {entry.seq} of {entry.head_count}
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize: '0.68rem', color: tooEarly ? C.red : C.lightBrown }}>
                        {tooEarly ? '⚠ cut day is before harvest ' : '🔮 Booked — harvest '}
                        {dateLabel(entry.harvest_date, { month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                    <div>
                      <span style={{
                        display: 'inline-flex', alignItems: 'center', gap: 4,
                        background: 'transparent',
                        border: `1px dashed ${speciesColor(entry.species)}66`,
                        color: speciesColor(entry.species), borderRadius: 3,
                        padding: '2px 7px', fontSize: '0.75rem', fontWeight: 700, whiteSpace: 'nowrap',
                      }}>
                        {speciesIcon(entry.species)} {entry.species}
                      </span>
                    </div>
                    {/* Cut, hang weight, hanging, sheet, score — nothing exists yet */}
                    <div style={{ textAlign: 'center', color: C.medBrown, fontSize: '0.85rem' }}>—</div>
                    <div style={{ textAlign: 'center', color: C.medBrown, fontSize: '0.85rem' }}>—</div>
                    <div style={{ textAlign: 'center', color: C.medBrown, fontSize: '0.85rem' }}>—</div>
                    <div style={{ textAlign: 'center', color: C.medBrown, fontSize: '0.85rem' }}>—</div>
                    <div style={{ textAlign: 'center', color: C.medBrown, fontSize: '0.85rem' }}>—</div>
                    <div />
                    <div />
                  </div>
                )
              }

              // ── Carcass row ────────────────────────────────────────────────────
              carcassNo++
              const seqNo   = carcassNo
              const pb      = portionBadge(entry.portion)
              const cutDate = cutDates.get(entry.key)
              const atCut   = atCutByKey.get(entry.key) ?? entry.days_hanging

              return (
                <div
                  key={entry.key}
                  draggable
                  onDragStart={() => handleDragStart(entry.key)}
                  onDragOver={e  => handleDragOver(e, entry.key)}
                  onDrop={() => handleDrop(entry.key)}
                  onDragEnd={handleDragEnd}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '24px 30px 1fr 80px 56px 64px 84px 52px 44px 30px 58px',
                    gap: '0.5rem', alignItems: 'center',
                    background: C.dark,
                    borderTop:    `1px solid ${isOver ? C.amber : entry.locked ? 'rgba(239,68,68,0.35)' : 'rgba(166,120,90,0.18)'}`,
                    borderRight:  `1px solid ${isOver ? C.amber : entry.locked ? 'rgba(239,68,68,0.35)' : 'rgba(166,120,90,0.18)'}`,
                    borderBottom: `1px solid ${isOver ? C.amber : entry.locked ? 'rgba(239,68,68,0.35)' : 'rgba(166,120,90,0.18)'}`,
                    borderLeft: `4px solid ${speciesColor(entry.species)}`,
                    borderRadius: 4, padding: '0.6rem 0.75rem',
                    opacity: isDragging ? 0.4 : 1, cursor: 'grab',
                    transition: 'border-color 0.1s, opacity 0.15s',
                    boxShadow: isOver ? `0 0 0 2px ${C.amber}44` : 'none',
                  }}
                >
                  {/* Drag handle */}
                  <span style={{ color: C.medBrown, fontSize: '1rem', userSelect: 'none', textAlign: 'center' }}>⠿</span>

                  {/* Rank */}
                  <span style={{
                    fontFamily: 'Georgia, serif', fontSize: '0.95rem', fontWeight: 700, textAlign: 'center',
                    color: seqNo <= 3 ? C.amber : C.lightBrown,
                  }}>
                    {seqNo}
                  </span>

                  {/* Customer + tag + weight + note */}
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.45rem', minWidth: 0 }}>
                      <span style={{
                        fontWeight: 600, fontSize: '0.87rem', color: C.cream,
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {entry.customer_name}
                      </span>
                      {entry.carcass_tag && (
                        <span style={{
                          fontSize: '0.66rem', color: C.medBrown, fontFamily: 'monospace',
                          background: 'rgba(0,0,0,0.3)', borderRadius: 2, padding: '0 4px', flexShrink: 0,
                        }}>
                          {entry.carcass_tag}
                        </span>
                      )}
                      {/* One row, one animal — the customer column already
                          carries both names. This says how many sheets come off
                          it, and which portion each buyer took. */}
                      {entry.cut_customers.length > 1 && (
                        <span
                          title={entry.cut_customers
                            .map(cc => `${cc.portion} — ${cc.name}${cc.has_instructions ? '' : ' (NO SHEET)'}`)
                            .join('\n')}
                          style={{
                            fontSize: '0.6rem', fontWeight: 700, flexShrink: 0,
                            background: `${C.amber}1A`, border: `1px solid ${C.amber}55`, color: C.amber,
                            borderRadius: 3, padding: '0 5px', whiteSpace: 'nowrap',
                          }}
                        >
                          🔗 split · {entry.cut_customers.length} sheets
                        </span>
                      )}
                    </div>
                    {/* Only the producer name may truncate — the assigned badge and
                        the Assign button sit outside the ellipsis so a long producer
                        can never clip the one control that fixes the row. On a narrow
                        window they wrap to their own line rather than spilling under
                        the species column, where the chip paints over them. */}
                    <div style={{
                      fontSize: '0.68rem',
                      display: 'flex', alignItems: 'center', minWidth: 0,
                      flexWrap: 'wrap', rowGap: 3,
                    }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', flex: '1 1 auto', minWidth: 70 }}>
                        <span style={{ color: C.medBrown }}>Producer:</span>{' '}
                        {entry.producer
                          ? <span style={{ color: C.lightBrown }}>{entry.producer}</span>
                          : <span style={{ color: C.amber }}>⚠ not set</span>}
                        {!entry.assigned && entry.customer_count > 1 && (
                          <span style={{ color: C.amber }} title="This appointment has multiple cut customers not yet assigned to individual carcasses — shown as one row per carcass until you assign them">
                            {' · '}{entry.customer_count} cut customers
                          </span>
                        )}
                      </span>
                      {/* Per-appointment assignment progress badge */}
                      {entry.customer_count > 1 && entry.appt_total_carcasses > 0 && (() => {
                        const done = entry.appt_assigned_carcasses >= entry.appt_total_carcasses
                        const color = done ? C.green : entry.appt_assigned_carcasses > 0 ? C.amber : C.medBrown
                        return (
                          <span
                            title={`${entry.appt_assigned_carcasses} of ${entry.appt_total_carcasses} of this appointment's carcasses fully assigned to cut customers`}
                            style={{
                              marginLeft: 6, padding: '0 5px', borderRadius: 3, flexShrink: 0,
                              background: `${color}1A`, border: `1px solid ${color}55`, color,
                              fontSize: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap',
                            }}
                          >
                            {done ? '✓ ' : ''}{entry.appt_assigned_carcasses}/{entry.appt_total_carcasses} assigned
                          </span>
                        )
                      })()}
                      {/* Assign / reassign carcass → cut customer. On EVERY carcass
                          that came off an appointment — a one-animal, one-buyer
                          booking still gets the wrong tag hung on it sometimes,
                          and without the button there was no way back (Jill). */}
                      {entry.source_appointment_id && (
                        <button
                          onClick={e => { e.stopPropagation(); openAssign(entry) }}
                          onDragStart={e => e.stopPropagation()}
                          title={entry.assigned ? 'Reassign this carcass to a different cut customer' : 'Assign this producer’s carcasses to specific cut customers'}
                          style={{
                            marginLeft: 6, padding: '0 6px', height: 16, lineHeight: '14px', flexShrink: 0,
                            background: entry.assigned ? 'rgba(166,120,90,0.12)' : 'rgba(245,158,11,0.16)',
                            border: `1px solid ${entry.assigned ? 'rgba(166,120,90,0.35)' : 'rgba(245,158,11,0.5)'}`,
                            borderRadius: 3, cursor: 'pointer',
                            color: entry.assigned ? C.tan : C.amber,
                            fontSize: '0.62rem', fontWeight: 700, whiteSpace: 'nowrap',
                          }}
                        >
                          ⇄ {entry.assigned ? 'Reassign' : 'Assign'}
                        </button>
                      )}
                    </div>
                    <input
                      type="text"
                      value={entry.entry_notes}
                      onChange={e => handleNoteChange(entry.key, e.target.value)}
                      placeholder="Add note…"
                      onClick={e => e.stopPropagation()}
                      onDragStart={e => e.stopPropagation()}
                      style={{
                        background: 'transparent', border: 'none',
                        borderBottom: '1px solid rgba(166,120,90,0.2)',
                        color: C.tan, fontSize: '0.7rem', width: '100%',
                        padding: '1px 0', outline: 'none',
                      }}
                    />
                  </div>

                  {/* Species */}
                  <div>
                    <span style={{
                      display: 'inline-flex', alignItems: 'center', gap: 4,
                      background: `${speciesColor(entry.species)}1A`,
                      border: `1px solid ${speciesColor(entry.species)}55`,
                      color: speciesColor(entry.species), borderRadius: 3,
                      padding: '2px 7px', fontSize: '0.75rem', fontWeight: 700,
                      whiteSpace: 'nowrap',
                    }}>
                      {speciesIcon(entry.species)} {entry.species}
                    </span>
                  </div>

                  {/* Portion */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{
                      background: `${pb.color}1A`, border: `1px solid ${pb.color}55`,
                      color: pb.color, borderRadius: 3, padding: '2px 7px',
                      fontSize: '0.75rem', fontWeight: 700,
                    }}>
                      {pb.label}
                    </span>
                  </div>

                  {/* Hanging (hot carcass) weight — prominent */}
                  <div style={{ textAlign: 'center', lineHeight: 1 }}>
                    {entry.hot_carcass_weight_lbs != null ? (
                      <>
                        <span style={{ fontSize: '1.05rem', fontWeight: 700, color: C.cream }}>{entry.hot_carcass_weight_lbs}</span>
                        <span style={{ fontSize: '0.6rem', color: C.lightBrown, marginLeft: 2 }}>lb</span>
                      </>
                    ) : (
                      <span style={{ fontSize: '0.85rem', color: C.medBrown }}>—</span>
                    )}
                  </div>

                  {/* Days hanging — today, then what it'll be on its cut day */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: hangColor(entry.days_hanging) }}>
                      {entry.days_hanging}d
                    </span>
                    {cutDate && atCut > entry.days_hanging && (
                      <div
                        title={`Will have hung ${atCut} days by ${dateLabel(cutDate, { weekday: 'long', month: 'short', day: 'numeric' })}, the day break it sits under`}
                        style={{ fontSize: '0.72rem', fontWeight: 700, color: hangColor(atCut), lineHeight: 1.2 }}
                      >
                        → {atCut}d
                      </div>
                    )}
                    <div style={{ fontSize: '0.63rem', color: C.lightBrown }}>
                      {dateLabel(entry.harvest_date, { month: 'short', day: 'numeric' })}
                    </div>
                  </div>

                  {/* Instructions */}
                  <div style={{ textAlign: 'center' }}>
                    {entry.has_instructions
                      ? <span style={{ color: C.green, fontSize: '1rem' }} title="Cut sheet on file">✓</span>
                      : (<>
                          <span style={{ color: C.red, fontSize: '0.76rem', fontWeight: 700 }} title="No cut sheet">⚠ Missing</span>
                          {/* A house animal never gets a sheet off the customer
                              form — CMC's own grinder cows had no way to one at
                              all (Charlie, 2026-08-19). Only shown where a single
                              sheet-less slot can be named; anything more tangled
                              gets assigned first. */}
                          {grindSlot(entry) && (
                            <button
                              onClick={e => { e.stopPropagation(); openGrindAll(entry) }}
                              onDragStart={e => e.stopPropagation()}
                              title="Write an all-grind cut card for this animal — no steaks, chops or roasts"
                              style={{
                                display: 'block', margin: '3px auto 0', padding: '0 5px', height: 16, lineHeight: '14px',
                                background: 'rgba(245,158,11,0.16)', border: '1px solid rgba(245,158,11,0.5)',
                                borderRadius: 3, cursor: 'pointer', color: C.amber,
                                fontSize: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap',
                              }}
                            >
                              Grind all
                            </button>
                          )}
                        </>)
                    }
                  </div>

                  {/* Score */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '0.76rem', color: C.lightBrown }}>{entry.priority_score.toFixed(1)}</span>
                  </div>

                  {/* Lock */}
                  <button
                    title={entry.locked ? 'Unlock position' : 'Lock position'}
                    onClick={e => { e.stopPropagation(); handleToggleLock(entry.key) }}
                    style={{
                      width: 26, height: 24,
                      background: entry.locked ? 'rgba(239,68,68,0.15)' : 'rgba(166,120,90,0.1)',
                      border: `1px solid ${entry.locked ? 'rgba(239,68,68,0.4)' : 'rgba(166,120,90,0.2)'}`,
                      borderRadius: 3, cursor: 'pointer', fontSize: '0.78rem',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                  >
                    {entry.locked ? '🔒' : '🔓'}
                  </button>

                  {/* Mark as Cut */}
                  <button
                    title="Mark as cut — removes from cooler list"
                    onClick={e => { e.stopPropagation(); handleMarkCut(entry) }}
                    disabled={cutting.has(entry.key)}
                    style={{
                      height: 24, padding: '0 6px',
                      background: cutting.has(entry.key) ? 'rgba(76,175,80,0.1)' : 'rgba(76,175,80,0.15)',
                      border: '1px solid rgba(76,175,80,0.4)',
                      borderRadius: 3, cursor: cutting.has(entry.key) ? 'not-allowed' : 'pointer',
                      fontSize: '0.72rem', fontWeight: 700, color: C.green,
                      display: 'flex', alignItems: 'center', justifyContent: 'center', whiteSpace: 'nowrap',
                    }}
                  >
                    {cutting.has(entry.key) ? '…' : 'Cut ✓'}
                  </button>
                </div>
              )
            })
            })()}
          </div>

          {/* Legend */}
          <div style={{
            marginTop: '1.25rem', padding: '0.6rem 1rem',
            background: 'rgba(0,0,0,0.2)', borderRadius: 4,
            display: 'flex', gap: '1.5rem', flexWrap: 'wrap',
            fontSize: '0.71rem', color: C.lightBrown,
          }}>
            <span>⠿ Drag to reorder</span>
            <span style={{ color: C.red }}>→ Drag a row onto the No Cut Day box to take its day off</span>
            <span style={{ color: C.amber }}>➕ Day Break = start of a cutting day; totals the carcasses below it (drag to move) · one per date</span>
            <span style={{ color: C.tan }}>🔪 Harvest day = booked on the kill floor, nothing cut that day (from the harvest calendar — not editable here)</span>
            <span>→ = days hung by the day it&apos;s scheduled to be cut</span>
            <span>🔒 Lock = pin when recalculating</span>
            <span style={{ color: C.red }}>⚠ Missing = no cut sheet linked</span>
            <span>
              Hanging: <span style={{ color: C.green }}>0–5d</span>
              {' · '}<span style={{ color: C.amber }}>6–9d</span>
              {' · '}<span style={{ color: C.red }}>10+d</span>
            </span>
          </div>
        </>
      )}

      {/* Assign carcasses → cut customers */}
      {assignModal && (
        <AssignCarcassesModal
          appointments={assignModal.appointments}
          carcasses={assignModal.carcasses}
          existing={assignments.filter(a =>
            assignModal.appointments.some(ap => ap.id === a.appointment_id) ||
            assignModal.carcasses.some(l => l.id === a.harvest_log_id)
          )}
          onClose={() => setAssignModal(null)}
          onSaved={() => { setAssignModal(null); loadAll() }}
        />
      )}

      {/* Write an all-grind cut card for an animal that will never get one from
          a customer */}
      {grindModal && (
        <GrindAllModal
          {...grindModal}
          onClose={() => setGrindModal(null)}
          onSaved={() => { setGrindModal(null); loadAll() }}
        />
      )}
    </div>

    {/* ── Waiting on a date ────────────────────────────────────────────────────
        Carcasses nobody has picked a cut day for. They sit out here rather than
        filling in at the bottom of the schedule, where they silently inherited
        whatever the last day break happened to be (Charlie, 2026-08-05). Drag
        one onto a row to slot it into that day; drag a scheduled row back here
        to take its day away again. */}
    {!loading && (carcasses.length > 0 || futureBookings.length > 0) && (
      <aside
        onDragOver={e => { e.preventDefault(); setDragOver('__rail__') }}
        onDrop={handleDropToRail}
        onDragLeave={() => setDragOver(prev => (prev === '__rail__' ? null : prev))}
        style={{
          flex: '0 0 236px', position: 'sticky', top: '0.5rem',
          background: C.dark, borderRadius: 6,
          border: `1px solid ${dragOver === '__rail__' ? C.amber : noDayTotals.head > 0 ? 'rgba(239,68,68,0.45)' : 'rgba(76,175,80,0.3)'}`,
          boxShadow: dragOver === '__rail__' ? `0 0 0 2px ${C.amber}44` : 'none',
          padding: '0.75rem 0.8rem', maxHeight: 'calc(100dvh - 120px)', overflowY: 'auto',
          transition: 'border-color 0.1s',
        }}
      >
        <div style={{
          fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.09em', textTransform: 'uppercase',
          color: noDayTotals.head > 0 ? C.red : C.green, marginBottom: '0.5rem',
        }}>
          {noDayTotals.head > 0 ? '⚠ No cut day' : '✓ No cut day'}
        </div>

        <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', marginBottom: '0.6rem' }}>
          <span style={{ fontSize: '1.5rem', fontWeight: 700, lineHeight: 1, color: noDayTotals.head > 0 ? C.red : C.green }}>
            {noDayTotals.head}
          </span>
          <span style={{ fontSize: '0.66rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.07em' }}>head</span>
          <span style={{ fontSize: '0.85rem', fontWeight: 700, color: C.cream, marginLeft: '0.25rem' }}>
            {Math.round(noDayTotals.lbs).toLocaleString()}
          </span>
          <span style={{ fontSize: '0.66rem', color: C.lightBrown }}>lb</span>
        </div>

        {noDay.length === 0 ? (
          <p style={{ fontSize: '0.72rem', color: C.lightBrown, lineHeight: 1.5, margin: 0 }}>
            Every carcass in the cooler has a cut day. Anything harvested from here on lands in this box until you give it one —
            and you can drag a row out of the schedule onto this box to take its day back off.
          </p>
        ) : (
          <>
            <p style={{ fontSize: '0.68rem', color: C.lightBrown, lineHeight: 1.45, margin: '0 0 0.6rem' }}>
              Drag onto the day you want it cut. Drag a scheduled row back here to take its day off again.
              The crew&apos;s list doesn&apos;t show these.
            </p>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
              {noDay.map(entry => (
                <div
                  key={entry.key}
                  draggable
                  onDragStart={() => handleDragStart(entry.key)}
                  onDragEnd={handleDragEnd}
                  style={{
                    background: 'rgba(239,68,68,0.06)',
                    border: '1px solid rgba(239,68,68,0.3)',
                    borderLeft: `4px solid ${speciesColor(entry.species)}`,
                    borderRadius: 4, padding: '0.45rem 0.55rem',
                    cursor: 'grab', opacity: dragging === entry.key ? 0.4 : 1,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.35rem', minWidth: 0 }}>
                    <span style={{ color: C.medBrown, fontSize: '0.8rem', userSelect: 'none' }}>⠿</span>
                    <span style={{
                      fontWeight: 600, fontSize: '0.78rem', color: C.cream, minWidth: 0,
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      {entry.customer_name}
                    </span>
                    {entry.carcass_tag && (
                      <span style={{
                        fontSize: '0.62rem', color: C.medBrown, fontFamily: 'monospace',
                        background: 'rgba(0,0,0,0.3)', borderRadius: 2, padding: '0 3px', flexShrink: 0,
                      }}>
                        {entry.carcass_tag}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.4rem', marginTop: 3, fontSize: '0.66rem', flexWrap: 'wrap' }}>
                    <span style={{ color: speciesColor(entry.species), fontWeight: 700 }}>
                      {speciesIcon(entry.species)} {entry.species}
                    </span>
                    {entry.hot_carcass_weight_lbs != null && (
                      <span style={{ color: C.lightBrown }}>{entry.hot_carcass_weight_lbs}lb</span>
                    )}
                    <span style={{ color: hangColor(entry.days_hanging), fontWeight: 700 }}>
                      {entry.days_hanging}d
                    </span>
                    {!entry.has_instructions && (
                      <span style={{ color: C.red, fontWeight: 700 }}>⚠ no sheet</span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {/* ── Upcoming bookings — booked, not harvested yet ──────────────────────
            A staging view so the crew can see what's coming before it's even on
            the rail. NOT draggable onto a cut day — there's no real carcass to
            schedule yet. The moment Harvest logs the animal in, its appointment
            drops off this list on its own (status moves off 'Booked') and the
            real carcass appears in No Cut Day above — nothing to swap by hand. */}
        {futureBookings.length > 0 && (
          <div style={{ marginTop: '1rem', paddingTop: '0.85rem', borderTop: '1px solid rgba(166,120,90,0.2)' }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              gap: '0.4rem', marginBottom: '0.5rem',
            }}>
              <span style={{
                fontSize: '0.66rem', fontWeight: 700, letterSpacing: '0.09em',
                textTransform: 'uppercase', color: C.lightBrown,
              }}>
                🔮 Upcoming
              </span>
              <div style={{ display: 'flex', gap: 2 }}>
                {FUTURE_WINDOW_CHOICES.map(c => (
                  <button
                    key={c.days}
                    onClick={() => changeWindow(c.days)}
                    title={`Show bookings up to ${c.label} out`}
                    style={{
                      background: futureWindow === c.days ? 'rgba(245,158,11,0.16)' : 'transparent',
                      border: `1px solid ${futureWindow === c.days ? 'rgba(245,158,11,0.5)' : 'rgba(166,120,90,0.25)'}`,
                      color: futureWindow === c.days ? C.amber : C.lightBrown,
                      borderRadius: 3, padding: '1px 5px', fontSize: '0.6rem',
                      fontWeight: 700, cursor: 'pointer',
                    }}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <p style={{ fontSize: '0.68rem', color: C.lightBrown, lineHeight: 1.45, margin: '0 0 0.6rem' }}>
              Booked, not harvested yet. Drag a head onto the day you plan to cut it — a big
              booking can be spread over several days. They turn into the real carcasses once
              they&apos;re in the cooler.
            </p>

            {futureGroups.length === 0 && (
              <p style={{ fontSize: '0.7rem', color: C.lightBrown, margin: 0 }}>
                Nothing booked in the next {futureWindow} days — try a wider window.
              </p>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {futureWeeks.map(wk => (
                <div key={wk.key}>
                  <button
                    onClick={() => toggleWeek(wk.key, !wk.open)}
                    style={{
                      width: '100%', display: 'flex', alignItems: 'baseline', gap: '0.35rem',
                      background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(166,120,90,0.18)',
                      borderRadius: 3, padding: '0.25rem 0.4rem', cursor: 'pointer',
                      color: C.tan, fontSize: '0.66rem', fontWeight: 700, textAlign: 'left',
                    }}
                  >
                    <span style={{ color: C.lightBrown }}>{wk.open ? '▾' : '▸'}</span>
                    <span>Wk of {dateLabel(wk.monday, { month: 'short', day: 'numeric' })}</span>
                    <span style={{ marginLeft: 'auto', color: C.lightBrown, fontWeight: 400 }}>
                      {wk.head} head
                    </span>
                  </button>

                  {wk.open && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem', marginTop: '0.4rem' }}>
                      {wk.groups.map(({ booking, pending }) => (
                        <div key={booking.id}>
                          <div style={{
                            display: 'flex', alignItems: 'baseline', gap: '0.35rem',
                            marginBottom: '0.3rem', minWidth: 0,
                          }}>
                            <span style={{
                              fontWeight: 600, fontSize: '0.75rem', color: C.tan, minWidth: 0,
                              whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                            }}>
                              {booking.source || 'Booked'}
                            </span>
                            <span style={{ color: C.lightBrown, fontSize: '0.64rem', flexShrink: 0 }}>
                              {dateLabel(booking.harvest_date, { month: 'short', day: 'numeric' })}
                            </span>
                            {/* Only meaningful once part of the booking has been placed. */}
                            {pending.length < booking.head_count && (
                              <span
                                title={`${booking.head_count - pending.length} of ${booking.head_count} already given a cut day`}
                                style={{ color: C.green, fontSize: '0.62rem', fontWeight: 700, flexShrink: 0 }}
                              >
                                {booking.head_count - pending.length}/{booking.head_count} placed
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                            {pending.map(f => (
                              <div
                                key={f.key}
                                draggable
                                onDragStart={() => handleDragStart(f.key)}
                                onDragEnd={handleDragEnd}
                                title="Drag onto the day you plan to cut this one"
                                style={{
                                  background: 'rgba(0,0,0,0.15)',
                                  border: `1px dashed ${speciesColor(f.species)}66`,
                                  borderLeft: `4px dashed ${speciesColor(f.species)}`,
                                  borderRadius: 4, padding: '0.35rem 0.5rem',
                                  display: 'flex', alignItems: 'baseline', gap: '0.4rem',
                                  cursor: 'grab', opacity: dragging === f.key ? 0.4 : 1,
                                  fontSize: '0.68rem',
                                }}
                              >
                                <span style={{ color: C.medBrown, fontSize: '0.8rem', userSelect: 'none' }}>⠿</span>
                                <span style={{ color: speciesColor(f.species), fontWeight: 700 }}>
                                  {speciesIcon(f.species)} {f.species}
                                </span>
                                {f.head_count > 1 && (
                                  <span style={{ color: C.lightBrown, fontFamily: 'monospace' }}>
                                    {f.seq} of {f.head_count}
                                  </span>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </aside>
    )}
    </div>
  )
}
