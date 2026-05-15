'use client'
import { useEffect, useState, useCallback } from 'react'
import { HarvestAppointment, HarvestLog } from '@/lib/types'

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

interface ScheduleEntry {
  key:                       string
  harvest_log_id:            string
  appointment_id:            string
  appointment_customer_id:   string
  customer_name:             string
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
}

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
  appointment_id:          string
  appointment_customer_id: string
  manual_rank:             number
  locked:                  boolean
  notes:                   string
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

function portionBadge(p: string): { label: string; color: string } {
  switch (p) {
    case 'Whole':   return { label: 'Whole', color: '#EF4444' }
    case 'Half':    return { label: '½',     color: '#F97316' }
    case 'Quarter': return { label: '¼',     color: C.amber }
    default:        return { label: p,       color: C.tan }
  }
}

export default function CutScheduleTab() {
  const [entries,     setEntries]     = useState<ScheduleEntry[]>([])
  const [weights,     setWeights]     = useState<PriorityWeights>(DEFAULT_WEIGHTS)
  const [showWeights, setShowWeights] = useState(false)
  const [loading,     setLoading]     = useState(true)
  const [saving,      setSaving]      = useState(false)
  const [savedAt,     setSavedAt]     = useState<string | null>(null)
  const [dragging,    setDragging]    = useState<string | null>(null)
  const [dragOver,    setDragOver]    = useState<string | null>(null)

  const todayISO = new Date().toISOString().slice(0, 10)

  // ── Build ranked list from cooler inventory ───────────────────────────────────
  const buildEntries = useCallback((
    harvestLogs:    HarvestLog[],
    apptMap:        Map<string, HarvestAppointment>,
    instructionIds: Set<string>,
    savedItems:     SavedItem[],
    w:              PriorityWeights
  ): ScheduleEntry[] => {
    const raw: Omit<ScheduleEntry, 'priority_score' | 'rank'>[] = []

    for (const log of harvestLogs) {
      const appt      = log.appointment_id ? apptMap.get(log.appointment_id) : undefined
      const customers = appt?.customers ?? []
      const daysHanging = calcDaysHanging(log.harvest_date)

      if (customers.length > 0) {
        for (const cust of customers) {
          const hasInstructions = !!(cust.linked_cutting_instruction_id &&
            instructionIds.has(cust.linked_cutting_instruction_id))
          const saved = savedItems.find(
            s => s.appointment_id === log.id && s.appointment_customer_id === cust.id
          )
          raw.push({
            key:                     `${log.id}__${cust.id}`,
            harvest_log_id:          log.id,
            appointment_id:          log.id,
            appointment_customer_id: cust.id,
            customer_name:           cust.customer_name,
            species:                 log.species,
            portion:                 cust.portion,
            harvest_date:            log.harvest_date,
            carcass_tag:             log.carcass_tag,
            hot_carcass_weight_lbs:  log.hot_carcass_weight_lbs,
            has_instructions:        hasInstructions,
            cutting_instruction_id:  cust.linked_cutting_instruction_id || null,
            days_hanging:            daysHanging,
            locked:                  saved?.locked ?? false,
            entry_notes:             saved?.notes  ?? '',
          })
        }
      } else {
        const saved = savedItems.find(
          s => s.appointment_id === log.id && s.appointment_customer_id === 'standalone'
        )
        raw.push({
          key:                     `${log.id}__standalone`,
          harvest_log_id:          log.id,
          appointment_id:          log.id,
          appointment_customer_id: 'standalone',
          customer_name:           log.producer || appt?.source || 'Unknown',
          species:                 log.species,
          portion:                 'Whole',
          harvest_date:            log.harvest_date,
          carcass_tag:             log.carcass_tag,
          hot_carcass_weight_lbs:  log.hot_carcass_weight_lbs,
          has_instructions:        false,
          cutting_instruction_id:  null,
          days_hanging:            daysHanging,
          locked:                  saved?.locked ?? false,
          entry_notes:             saved?.notes  ?? '',
        })
      }
    }

    const scored: ScheduleEntry[] = raw.map(e => ({
      ...e,
      priority_score: calcScore(e, w),
      rank: 0,
    }))

    if (savedItems.length > 0) {
      const savedRank = new Map(savedItems.map(s => [
        `${s.appointment_id}__${s.appointment_customer_id}`,
        s.manual_rank,
      ]))
      scored.sort((a, b) => {
        const ra = savedRank.get(a.key) ?? 9999
        const rb = savedRank.get(b.key) ?? 9999
        if (ra !== rb) return ra - rb
        return b.priority_score - a.priority_score
      })
    } else {
      scored.sort((a, b) => b.priority_score - a.priority_score)
    }

    return scored.map((e, i) => ({ ...e, rank: i + 1 }))
  }, [])

  // ── Load from cooler inventory ────────────────────────────────────────────────
  useEffect(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/harvest?status=chilling').then(r => r.json()),
      fetch('/api/appointments').then(r => r.json()),
      fetch('/api/cutting-instructions').then(r => r.json()),
      fetch(`/api/cut-schedule?date=${todayISO}`).then(r => r.json()).catch(() => []),
    ]).then(([harvestData, apptData, instrData, savedData]) => {
      const logs    = Array.isArray(harvestData) ? (harvestData as HarvestLog[]) : []
      const appts   = Array.isArray(apptData)    ? (apptData    as HarvestAppointment[]) : []
      const apptMap = new Map(appts.map(a => [a.id, a]))
      const instrIds = new Set<string>(
        Array.isArray(instrData) ? instrData.map((i: { id: string }) => i.id) : []
      )
      const saved = Array.isArray(savedData) ? (savedData as SavedItem[]) : []
      setEntries(buildEntries(logs, apptMap, instrIds, saved, weights))
    }).finally(() => setLoading(false))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todayISO, buildEntries])

  // ── Recalculate ───────────────────────────────────────────────────────────────
  const handleRecalculate = () => {
    setEntries(prev => {
      const rescored = prev.map(e => ({ ...e, priority_score: calcScore(e, weights) }))
      const locked   = rescored.filter(e => e.locked)
      const unlocked = rescored.filter(e => !e.locked)
      unlocked.sort((a, b) => b.priority_score - a.priority_score)
      const result: ScheduleEntry[] = new Array(rescored.length).fill(null)
      for (const l of locked) result[l.rank - 1] = l
      let ui = 0
      for (let i = 0; i < result.length; i++) {
        if (!result[i]) result[i] = { ...unlocked[ui++], rank: i + 1 }
      }
      return result.map((e, i) => ({ ...e, rank: i + 1 }))
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
    setEntries(prev => prev.map(e => e.key === key ? { ...e, locked: !e.locked } : e))

  const handleNoteChange = (key: string, note: string) =>
    setEntries(prev => prev.map(e => e.key === key ? { ...e, entry_notes: note } : e))

  const handleSave = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/cut-schedule', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          schedule_date: todayISO,
          items: entries.map(e => ({
            appointment_id:          e.appointment_id,
            appointment_customer_id: e.appointment_customer_id,
            manual_rank:             e.rank,
            locked:                  e.locked,
            notes:                   e.entry_notes,
          })),
        }),
      })
      if (res.ok) setSavedAt(new Date().toLocaleTimeString())
    } finally {
      setSaving(false)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div style={{ maxWidth: 900 }}>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          {!loading && entries.length > 0 && [
            { label: 'In Cooler',      value: entries.length,                                       color: C.tan },
            { label: 'Missing Sheet',  value: entries.filter(e => !e.has_instructions).length,      color: C.red },
            { label: 'Locked',         value: entries.filter(e => e.locked).length,                 color: C.amber },
            { label: 'Avg Hang',       value: entries.length ? (entries.reduce((s, e) => s + e.days_hanging, 0) / entries.length).toFixed(1) + 'd' : '—', color: C.lightBrown },
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
      {!loading && entries.length === 0 && (
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
            gridTemplateColumns: '24px 30px 1fr 80px 56px 72px 52px 44px 30px',
            gap: '0.5rem', padding: '0 0.75rem', marginBottom: '0.4rem',
          }}>
            {['', '#', 'Customer', 'Species', 'Cut', 'Hanging', 'Sheet', 'Score', ''].map((h, i) => (
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
            {entries.map(entry => {
              const pb         = portionBadge(entry.portion)
              const isDragging = dragging === entry.key
              const isOver     = dragOver  === entry.key
              const hangColor  = entry.days_hanging >= 10 ? C.red : entry.days_hanging >= 6 ? C.amber : C.green

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
                    gridTemplateColumns: '24px 30px 1fr 80px 56px 72px 52px 44px 30px',
                    gap: '0.5rem', alignItems: 'center',
                    background: C.dark,
                    border: `1px solid ${isOver ? C.amber : entry.locked ? 'rgba(239,68,68,0.35)' : 'rgba(166,120,90,0.18)'}`,
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
                    color: entry.rank <= 3 ? C.amber : C.lightBrown,
                  }}>
                    {entry.rank}
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
                      {entry.hot_carcass_weight_lbs != null && (
                        <span style={{ fontSize: '0.66rem', color: C.lightBrown, flexShrink: 0 }}>
                          {entry.hot_carcass_weight_lbs} lb
                        </span>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.3rem' }}>
                    <span style={{
                      display: 'inline-block', width: 7, height: 7, borderRadius: '50%',
                      background: speciesColor(entry.species), flexShrink: 0,
                    }} />
                    <span style={{ fontSize: '0.78rem', color: C.tan }}>{entry.species}</span>
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
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div style={{
            marginTop: '1.25rem', padding: '0.6rem 1rem',
            background: 'rgba(0,0,0,0.2)', borderRadius: 4,
            display: 'flex', gap: '1.5rem', flexWrap: 'wrap',
            fontSize: '0.71rem', color: C.lightBrown,
          }}>
            <span>⠿ Drag to reorder</span>
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
    </div>
  )
}
