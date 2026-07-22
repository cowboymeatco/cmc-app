'use client'
import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { HarvestAppointment, HarvestLog, CarcassAssignment } from '@/lib/types'
import AssignCarcassesModal from './AssignCarcassesModal'
import {
  type PriorityWeights, type ScheduleEntry, type BreakItem, type ListItem,
  DEFAULT_WEIGHTS, WEIGHT_LABELS, buildEntries, loadScheduleData, uniqueCarcasses as uniqueOf,
  calcScore, speciesColor, speciesIcon, portionBadge,
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

  // Cached source data, so the assign modal can read carcasses/customers and we
  // can rebuild the list after an assignment changes without a full reload.
  const [logs,        setLogs]        = useState<HarvestLog[]>([])
  const [appts,       setAppts]       = useState<HarvestAppointment[]>([])
  const [assignments, setAssignments] = useState<CarcassAssignment[]>([])
  const [assignModal, setAssignModal] = useState<{ appointment: HarvestAppointment; carcasses: HarvestLog[] } | null>(null)

  const todayISO = isoDate()

  // ── Load from cooler inventory ────────────────────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    try {
      const { logs, apptMap, instrIds, saved, assignments } = await loadScheduleData(todayISO)
      setLogs(logs)
      setAppts([...apptMap.values()])
      setAssignments(assignments)
      setEntries(buildEntries(logs, apptMap, instrIds, saved, assignments, weights))
      setLoadError(false)
    } catch {
      setLoadError(true)
    } finally {
      setLoading(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayISO])

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
    // Cut status lives on the harvest log (the physical carcass), so a split
    // animal can only be marked cut as a whole — warn before taking the other
    // customer's half off the schedule with it.
    const siblings = entries.filter(
      (e): e is ScheduleEntry =>
        e.type === 'carcass' && e.harvest_log_id === entry.harvest_log_id && e.key !== entry.key
    )
    if (siblings.length > 0) {
      const others = siblings.map(s => s.customer_name).join(', ')
      const ok = window.confirm(
        `This carcass${entry.carcass_tag ? ` (tag ${entry.carcass_tag})` : ''} is split with ${others}. ` +
        `Marking it cut removes ALL of its cut jobs from the schedule. Only continue if every portion has been cut.`
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
  const uniqueCarcasses = uniqueOf(carcasses)

  return (
    <div style={{ maxWidth: 900 }}>

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
                        {dateLabel(entry.break_date, { weekday: 'long' })}
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
                    {/* Only the producer name may truncate — the assigned badge and
                        the Assign button sit outside the ellipsis so a long producer
                        can never clip the one control that fixes the row. */}
                    <div style={{
                      fontSize: '0.68rem',
                      display: 'flex', alignItems: 'center', minWidth: 0,
                    }}>
                      <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }}>
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
                      {/* Assign / reassign carcass → cut customer */}
                      {entry.source_appointment_id && (entry.assigned || entry.customer_count > 1) && (
                        <button
                          onClick={e => { e.stopPropagation(); openAssign(entry) }}
                          onDragStart={e => e.stopPropagation()}
                          title={entry.assigned ? 'Reassign this carcass to a different cut customer' : 'Assign this appointment’s carcasses to specific cut customers'}
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

                  {/* Days hanging */}
                  <div style={{ textAlign: 'center' }}>
                    <span style={{ fontSize: '0.9rem', fontWeight: 700, color: hangColor }}>
                      {entry.days_hanging}d
                    </span>
                    <div style={{ fontSize: '0.63rem', color: C.lightBrown }}>
                      {dateLabel(entry.harvest_date, { month: 'short', day: 'numeric' })}
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
