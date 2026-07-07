'use client'
import { useEffect, useState, useCallback } from 'react'
import { HarvestAppointment, HarvestLog, CarcassAssignment } from '@/lib/types'
import AssignCarcassesModal from './AssignCarcassesModal'

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

interface PriorityWeights {
  days_hanging:     number
  has_instructions: number
  portion_size:     number
}

// Portion → fraction of one whole carcass (a carcass is "assigned" once its
// portions sum to a whole).
const FRACTION: Record<string, number> = { Whole: 1, Half: 0.5, Quarter: 0.25 }

interface ScheduleEntry {
  type:                      'carcass'
  key:                       string
  harvest_log_id:            string
  appointment_id:            string   // = harvest_log_id (the saved-schedule key; kept for back-compat)
  source_appointment_id:     string | null  // the REAL harvest appointment id (drives the assign modal)
  appointment_customer_id:   string
  customer_name:             string
  producer:                  string
  species:                   string
  portion:                   string
  harvest_date:              string
  carcass_tag:               string
  hot_carcass_weight_lbs:    number | null
  has_instructions:          boolean
  cutting_instruction_id:    string | null
  days_hanging:              number
  priority_score:            number
  rank:                      number
  locked:                    boolean
  entry_notes:               string
  customer_count:            number   // # of cut customers on the appointment (>1 & unassigned = collapsed, see buildEntries)
  assigned:                  boolean  // true = this row is a real carcass→customer assignment (one cut job per portion)
  appt_assigned_carcasses:   number   // # of this appointment's carcasses fully assigned (portions sum to a whole)
  appt_total_carcasses:      number   // # of this appointment's carcasses currently in the cooler
}

// A moveable "day break" divider the crew inserts between carcasses to mark
// where one day of cutting ends and the next begins. Lives in the same ordered
// list as carcasses (one manual_rank sequence) so it keeps its relative spot.
interface BreakItem {
  type:       'break'
  key:        string
  rank:       number
  break_date: string  // ISO 'YYYY-MM-DD', or '' when not yet chosen
}

type ListItem = ScheduleEntry | BreakItem

const DEFAULT_WEIGHTS: PriorityWeights = {
  days_hanging:     5,
  has_instructions: 8,
  portion_size:     3,
}

const WEIGHT_LABELS: Record<keyof PriorityWeights, string> = {
  days_hanging:     'Days Hanging',
  has_instructions: 'Instructions Ready',
  portion_size:     'Portion Size',
}

type SavedItem = {
  id?:                     string
  kind?:                   'carcass' | 'break'
  appointment_id:          string | null
  appointment_customer_id: string | null
  manual_rank:             number
  locked:                  boolean
  notes:                   string
  break_date?:             string | null
}

function calcDaysHanging(harvestDate: string): number {
  const harvest = new Date(harvestDate + 'T12:00:00')
  const today   = new Date()
  today.setHours(12, 0, 0, 0)
  return Math.max(0, Math.floor((today.getTime() - harvest.getTime()) / 86400000))
}

function calcScore(
  entry: Pick<ScheduleEntry, 'days_hanging' | 'has_instructions' | 'portion'>,
  w: PriorityWeights
): number {
  let score = 0
  score += Math.min(entry.days_hanging, 14) * w.days_hanging
  if (!entry.has_instructions) score -= w.has_instructions * 10
  const portionScore = entry.portion === 'Whole' ? 3 : entry.portion === 'Half' ? 2 : 1
  score += portionScore * w.portion_size
  return score
}

function speciesColor(s: string): string {
  switch (s) {
    case 'Beef': return '#A78BFA'
    case 'Hog':  return '#F59E0B'
    case 'Lamb': return '#60A5FA'
    case 'Goat': return '#4CAF50'
    default:     return C.tan
  }
}

function speciesIcon(s: string): string {
  switch (s) {
    case 'Beef': return '🐄'
    case 'Hog':  return '🐖'
    case 'Lamb': return '🐑'
    case 'Goat': return '🐐'
    default:     return '🏷'
  }
}

function portionBadge(p: string): { label: string; color: string } {
  switch (p) {
    case 'Whole':   return { label: 'Whole', color: '#EF4444' }
    case 'Half':    return { label: '½',     color: '#F97316' }
    case 'Quarter': return { label: '¼',     color: C.amber }
    default:        return { label: p,       color: C.tan }
  }
}

export default function CutScheduleTab() {
  const [entries,     setEntries]     = useState<ListItem[]>([])
  const [weights,     setWeights]     = useState<PriorityWeights>(DEFAULT_WEIGHTS)
  const [showWeights, setShowWeights] = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [savedAt,     setSavedAt]     = useState<string | null>(null)
  const [dragging,    setDragging]    = useState<string | null>(null)
  const [dragOver,    setDragOver]    = useState<string | null>(null)
  const [cutting,     setCutting]     = useState<Set<string>>(new Set())

  // Cached source data, so the assign modal can read carcasses/customers and we
  // can rebuild the list after an assignment changes without a full reload.
  const [logs,        setLogs]        = useState<HarvestLog[]>([])
  const [appts,       setAppts]       = useState<HarvestAppointment[]>([])
  const [assignments, setAssignments] = useState<CarcassAssignment[]>([])
  const [assignModal, setAssignModal] = useState<{ appointment: HarvestAppointment; carcasses: HarvestLog[] } | null>(null)

  const todayISO = new Date().toISOString().slice(0, 10)

  // ── Build ranked list from cooler inventory ───────────────────────────────────
  const buildEntries = useCallback((
    harvestLogs:    HarvestLog[],
    apptMap:        Map<string, HarvestAppointment>,
    instructionIds: Set<string>,
    savedItems:     SavedItem[],
    assignments:    CarcassAssignment[],
    w:              PriorityWeights
  ): ListItem[] => {
    const raw: Omit<ScheduleEntry, 'type' | 'priority_score' | 'rank'>[] = []

    // Group assignments by the carcass they belong to.
    const assignByLog = new Map<string, CarcassAssignment[]>()
    for (const a of assignments) {
      const bucket = assignByLog.get(a.harvest_log_id)
      if (bucket) bucket.push(a); else assignByLog.set(a.harvest_log_id, [a])
    }

    // Per-appointment progress: how many of its cooler carcasses are FULLY
    // assigned (portions sum to a whole) out of the total in the cooler.
    const fillByLog = new Map<string, number>()
    for (const a of assignments) {
      fillByLog.set(a.harvest_log_id, (fillByLog.get(a.harvest_log_id) ?? 0) + (FRACTION[a.portion] ?? 0))
    }
    const apptStats = new Map<string, { total: number; assigned: number }>()
    for (const log of harvestLogs) {
      const apptId = log.appointment_id ?? ''
      const s = apptStats.get(apptId) ?? { total: 0, assigned: 0 }
      s.total++
      if ((fillByLog.get(log.id) ?? 0) >= 0.999) s.assigned++
      apptStats.set(apptId, s)
    }

    for (const log of harvestLogs) {
      const appt      = log.appointment_id ? apptMap.get(log.appointment_id) : undefined
      const customers = appt?.customers ?? []
      const daysHanging = calcDaysHanging(log.harvest_date)
      const logAssigns  = assignByLog.get(log.id) ?? []

      if (logAssigns.length > 0) {
        // ── REAL FIX: this carcass is assigned to one or more cut customers.
        // Emit one cut job per assigned portion (a true split → two rows that
        // share harvest_log_id, so the head count / day totals still count the
        // carcass once — those dedupe by harvest_log_id).
        for (const asg of logAssigns) {
          const cust    = customers.find(c => c.id === asg.appointment_customer_id)
          const instrId = cust?.linked_cutting_instruction_id || asg.linked_cutting_instruction_id || null
          const saved   = savedItems.find(
            s => s.appointment_id === log.id && s.appointment_customer_id === asg.appointment_customer_id
          )
          raw.push({
            key:                     `${log.id}__${asg.appointment_customer_id}`,
            harvest_log_id:          log.id,
            appointment_id:          log.id,
            source_appointment_id:   appt?.id ?? log.appointment_id ?? null,
            appointment_customer_id: asg.appointment_customer_id,
            customer_name:           cust?.customer_name || asg.customer_name || 'Unknown',
            producer:                log.producer ?? '',
            species:                 log.species,
            portion:                 asg.portion || cust?.portion || 'Whole',
            harvest_date:            log.harvest_date,
            carcass_tag:             log.carcass_tag,
            hot_carcass_weight_lbs:  log.hot_carcass_weight_lbs,
            has_instructions:        !!(instrId && instructionIds.has(instrId)),
            cutting_instruction_id:  instrId,
            days_hanging:            daysHanging,
            locked:                  saved?.locked ?? false,
            entry_notes:             saved?.notes  ?? '',
            customer_count:          customers.length,
            assigned:                true,
            appt_assigned_carcasses: apptStats.get(log.appointment_id ?? '')?.assigned ?? 0,
            appt_total_carcasses:    apptStats.get(log.appointment_id ?? '')?.total ?? 0,
          })
        }
        continue
      }

      // INTERIM (2026-06-26): ONE row per carcass, so the head count stays true.
      // This loop used to emit one row per customer on the appointment, so an
      // appointment with N carcasses and M customers produced N×M rows — a
      // cross-join — because the data records WHO the buyers are but not WHICH
      // carcass is whose. We collapse to the carcass and tie it to the producer.
      // This is now the FALLBACK for carcasses with no assignments yet; once the
      // crew assigns them (Assign button → modal), the branch above takes over.
      const single = customers.length === 1 ? customers[0] : null
      const custId = single ? single.id : 'standalone'
      const hasInstructions = single
        ? !!(single.linked_cutting_instruction_id && instructionIds.has(single.linked_cutting_instruction_id))
        : customers.some(c => c.linked_cutting_instruction_id && instructionIds.has(c.linked_cutting_instruction_id))
      const saved = savedItems.find(
        s => s.appointment_id === log.id && s.appointment_customer_id === custId
      )
      raw.push({
        key:                     `${log.id}__${custId}`,
        harvest_log_id:          log.id,
        appointment_id:          log.id,
        source_appointment_id:   appt?.id ?? log.appointment_id ?? null,
        appointment_customer_id: custId,
        customer_name:           single ? single.customer_name : (log.producer || appt?.source || 'Unknown'),
        producer:                log.producer ?? '',
        species:                 log.species,
        portion:                 single ? single.portion : 'Whole',
        harvest_date:            log.harvest_date,
        carcass_tag:             log.carcass_tag,
        hot_carcass_weight_lbs:  log.hot_carcass_weight_lbs,
        has_instructions:        hasInstructions,
        cutting_instruction_id:  single?.linked_cutting_instruction_id || null,
        days_hanging:            daysHanging,
        locked:                  saved?.locked ?? false,
        entry_notes:             saved?.notes  ?? '',
        customer_count:          customers.length,
        assigned:                false,
        appt_assigned_carcasses: apptStats.get(log.appointment_id ?? '')?.assigned ?? 0,
        appt_total_carcasses:    apptStats.get(log.appointment_id ?? '')?.total ?? 0,
      })
    }

    const scored: ScheduleEntry[] = raw.map(e => ({
      type: 'carcass' as const,
      ...e,
      priority_score: calcScore(e, w),
      rank: 0,
    }))

    // Saved manual ranks for carcasses (keyed by appointment + customer).
    const savedRank = new Map(
      savedItems
        .filter(s => s.kind !== 'break')
        .map(s => [`${s.appointment_id}__${s.appointment_customer_id}`, s.manual_rank])
    )

    // Day-break dividers come straight from saved rows (they aren't re-derived
    // from inventory). Each carries its own saved rank so it slots back in place.
    const breakWraps = savedItems
      .filter(s => s.kind === 'break')
      .map(s => ({
        item:  { type: 'break' as const, key: `break_${s.id ?? s.manual_rank}`, rank: 0, break_date: s.break_date ?? '' } as ListItem,
        saved: s.manual_rank,
        score: 0,
      }))

    const carcassWraps = scored.map(e => ({
      item:  e as ListItem,
      saved: savedRank.get(e.key),
      score: e.priority_score,
    }))

    const combined = [...carcassWraps, ...breakWraps]
    const useSaved = savedItems.length > 0

    combined.sort((a, b) => {
      if (useSaved) {
        const ra = a.saved ?? 9999
        const rb = b.saved ?? 9999
        if (ra !== rb) return ra - rb
      }
      return b.score - a.score
    })

    return combined.map((c, i) => ({ ...c.item, rank: i + 1 }))
  }, [])

  // ── Load from cooler inventory ────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const [harvestData, apptData, instrData, savedData] = await Promise.all([
        fetch('/api/harvest?status=chilling').then(r => r.json()),
        fetch('/api/appointments').then(r => r.json()),
        fetch('/api/cutting-instructions').then(r => r.json()),
        fetch(`/api/cut-schedule?date=${todayISO}`).then(r => r.json()).catch(() => []),
      ])
      const loadedLogs = Array.isArray(harvestData) ? (harvestData as HarvestLog[]) : []
      const loadedAppts = Array.isArray(apptData)    ? (apptData    as HarvestAppointment[]) : []

      // Assignments for exactly the carcasses currently in the cooler.
      const logIds = loadedLogs.map(l => l.id)
      const assignData: CarcassAssignment[] = logIds.length
        ? await fetch(`/api/carcass-assignments?harvest_log_ids=${logIds.join(',')}`)
            .then(r => r.json()).catch(() => [])
        : []
      const loadedAssigns = Array.isArray(assignData) ? assignData : []

      const apptMap  = new Map(loadedAppts.map(a => [a.id, a]))
      const instrIds = new Set<string>(
        Array.isArray(instrData) ? instrData.map((i: { id: string }) => i.id) : []
      )
      const saved = Array.isArray(savedData) ? (savedData as SavedItem[]) : []

      setLogs(loadedLogs)
      setAppts(loadedAppts)
      setAssignments(loadedAssigns)
      setEntries(buildEntries(loadedLogs, apptMap, instrIds, saved, loadedAssigns, weights))
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayISO, buildEntries])

  useEffect(() => { loadAll() }, [loadAll])

  // Open the assign modal for the appointment behind a carcass row.
  const openAssign = (entry: ScheduleEntry) => {
    const appt = appts.find(a => a.id === entry.source_appointment_id)
    if (!appt) return
    const carcasses = logs.filter(l => l.appointment_id === appt.id)
    setAssignModal({ appointment: appt, carcasses })
  }

  // ── Recalculate ───────────────────────────────────────────────────────────────
  const handleRecalculate = () => {
    setEntries(prev => {
      const rescored = prev.map(e =>
        e.type === 'carcass' ? { ...e, priority_score: calcScore(e, weights) } : e
      )
      // Day breaks and locked carcasses are anchors: they keep their slot.
      const anchors = rescored.filter(e => e.type === 'break' || e.locked)
      const movable = rescored.filter(
        (e): e is ScheduleEntry => e.type === 'carcass' && !e.locked
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

  const handleRemoveBreak = (key: string) =>
    setEntries(prev => prev.filter(e => e.key !== key).map((e, i) => ({ ...e, rank: i + 1 })))

  const handleBreakDate = (key: string, break_date: string) =>
    setEntries(prev => prev.map(e =>
      e.type === 'break' && e.key === key ? { ...e, break_date } : e))

  // Called here and will also be called by the processing scanner
  const handleMarkCut = async (entry: ScheduleEntry) => {
    setCutting(prev => new Set(prev).add(entry.key))
    try {
      await fetch('/api/harvest', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: entry.harvest_log_id, status: 'cut' }),
      })
      setEntries(prev => prev.filter(e => e.key !== entry.key))
    } finally {
      setCutting(prev => { const s = new Set(prev); s.delete(entry.key); return s })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/cut-schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          schedule_date: todayISO,
          items: entries.map(e => e.type === 'break'
            ? {
                kind:                    'break' as const,
                appointment_id:          null,
                appointment_customer_id: null,
                manual_rank:             e.rank,
                locked:                  false,
                notes:                   '',
                break_date:              e.break_date || null,
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
  // Unique physical carcasses (a split animal shows as 2+ rows but is 1 carcass),
  // so head-count style stats don't double-count splits.
  const uniqueCarcasses = Array.from(
    new Map(carcasses.map(e => [e.harvest_log_id, e])).values()
  )

  return (
    <div style={{ maxWidth: 900 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {!loading && carcasses.length > 0 && [
            { label: 'In Cooler',      value: uniqueCarcasses.length,                                 color: C.tan },
            { label: 'Missing Sheet',  value: carcasses.filter(e => !e.has_instructions).length,      color: C.red },
            { label: 'Locked',         value: carcasses.filter(e => e.locked).length,                 color: C.amber },
            { label: 'Avg Hang',       value: uniqueCarcasses.length ? (uniqueCarcasses.reduce((s, e) => s + e.days_hanging, 0) / uniqueCarcasses.length).toFixed(1) + 'd' : '—', color: C.lightBrown },
          ].map(stat => (
            <div key={stat.label} style={{
              background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4,
              padding: '0.35rem 0.85rem', display: 'flex', alignItems: 'baseline', gap: '0.4rem',
            }}>
              <span style={{ fontSize: '1rem', fontWeight: 700, color: stat.color }}>{stat.value}</span>
              <span style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.07em' }}>{stat.label}</span>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.6rem' }}>
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
            gridTemplateColumns: '24px 30px 1fr 80px 56px 64px 72px 52px 44px 30px 58px',
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
            const dayTotals = new Map<string, { lbs: number; count: number }>()
            {
              let lbs = 0
              let ids = new Set<string>()
              for (let i = entries.length - 1; i >= 0; i--) {
                const e = entries[i]
                if (e.type === 'break') {
                  dayTotals.set(e.key, { lbs, count: ids.size })
                  lbs = 0
                  ids = new Set<string>()
                } else if (!ids.has(e.harvest_log_id)) {
                  ids.add(e.harvest_log_id)
                  if (e.hot_carcass_weight_lbs != null) lbs += e.hot_carcass_weight_lbs
                }
              }
            }
            let carcassNo = 0
            return entries.map(entry => {
              const isDragging = dragging === entry.key
              const isOver     = dragOver  === entry.key

              // ── Day break divider ──────────────────────────────────────────────
              if (entry.type === 'break') {
                const day = dayTotals.get(entry.key) ?? { lbs: 0, count: 0 }
                return (
                  <div
                    key={entry.key}
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
                        {new Date(entry.break_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long' })}
                      </span>
                    )}
                    <span style={{ flex: 1, height: 1, background: 'rgba(245,158,11,0.25)' }} />
                    <span style={{ display: 'flex', alignItems: 'baseline', gap: 4, whiteSpace: 'nowrap' }}>
                      <span style={{ color: C.amber, fontSize: '0.82rem', fontWeight: 700 }}>
                        {Math.round(day.lbs).toLocaleString()} lb
                      </span>
                      <span style={{ color: C.lightBrown, fontSize: '0.64rem' }}>
                        · {day.count} {day.count === 1 ? 'carcass' : 'carcasses'} this day
                      </span>
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
                )
              }

              // ── Carcass row ────────────────────────────────────────────────────
              carcassNo++
              const seqNo     = carcassNo
              const pb        = portionBadge(entry.portion)
              const hangColor = entry.days_hanging >= 10 ? C.red : entry.days_hanging >= 6 ? C.amber : C.green

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
                    gridTemplateColumns: '24px 30px 1fr 80px 56px 64px 72px 52px 44px 30px 58px',
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
                    </div>
                    <div style={{
                      fontSize: '0.68rem',
                      whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    }}>
                      <span style={{ color: C.medBrown }}>Producer:</span>{' '}
                      {entry.producer
                        ? <span style={{ color: C.lightBrown }}>{entry.producer}</span>
                        : <span style={{ color: C.amber }}>⚠ not set</span>}
                      {!entry.assigned && entry.customer_count > 1 && (
                        <span style={{ color: C.amber }} title="This appointment has multiple cut customers not yet assigned to individual carcasses — shown as one row per carcass until you assign them">
                          {' · '}{entry.customer_count} cut customers
                        </span>
                      )}
                      {/* Per-appointment assignment progress badge */}
                      {entry.customer_count > 1 && entry.appt_total_carcasses > 0 && (() => {
                        const done = entry.appt_assigned_carcasses >= entry.appt_total_carcasses
                        const color = done ? C.green : entry.appt_assigned_carcasses > 0 ? C.amber : C.medBrown
                        return (
                          <span
                            title={`${entry.appt_assigned_carcasses} of ${entry.appt_total_carcasses} of this appointment's carcasses fully assigned to cut customers`}
                            style={{
                              marginLeft: 6, padding: '0 5px', borderRadius: 3, verticalAlign: 'middle',
                              background: `${color}1A`, border: `1px solid ${color}55`, color,
                              fontSize: '0.6rem', fontWeight: 700, whiteSpace: 'nowrap',
                            }}
                          >
                            {done ? '✓ ' : ''}{entry.appt_assigned_carcasses}/{entry.appt_total_carcasses} assigned
                          </span>
                        )
                      })()}
                      {/* Assign / reassign carcass → cut customer */}
                      {entry.source_appointment_id && (entry.assigned || entry.customer_count > 1) && (
                        <button
                          onClick={e => { e.stopPropagation(); openAssign(entry) }}
                          onDragStart={e => e.stopPropagation()}
                          title={entry.assigned ? 'Reassign this carcass to a different cut customer' : 'Assign this appointment’s carcasses to specific cut customers'}
                          style={{
                            marginLeft: 6, padding: '0 6px', height: 16, lineHeight: '14px',
                            background: entry.assigned ? 'rgba(166,120,90,0.12)' : 'rgba(245,158,11,0.16)',
                            border: `1px solid ${entry.assigned ? 'rgba(166,120,90,0.35)' : 'rgba(245,158,11,0.5)'}`,
                            borderRadius: 3, cursor: 'pointer',
                            color: entry.assigned ? C.tan : C.amber,
                            fontSize: '0.62rem', fontWeight: 700, verticalAlign: 'middle',
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

                  {/* Days hanging */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: hangColor }}>
                      {entry.days_hanging}d
                    </span>
                    <div style={{ fontSize: '0.63rem', color: C.lightBrown }}>
                      {new Date(entry.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                    </div>
                  </div>

                  {/* Instructions */}
                  <div style={{ textAlign: 'center' }}>
                    {entry.has_instructions
                      ? <span style={{ color: C.green, fontSize: '1rem' }} title="Cut sheet on file">✓</span>
                      : <span style={{ color: C.red, fontSize: '0.76rem', fontWeight: 700 }} title="No cut sheet">⚠ Missing</span>
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
            <span style={{ color: C.amber }}>➕ Day Break = start of a cutting day; totals the carcasses below it (drag to move)</span>
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
          appointment={assignModal.appointment}
          carcasses={assignModal.carcasses}
          existing={assignments.filter(a => a.appointment_id === assignModal.appointment.id)}
          onClose={() => setAssignModal(null)}
          onSaved={() => { setAssignModal(null); loadAll() }}
        />
      )}
    </div>
  )
}
