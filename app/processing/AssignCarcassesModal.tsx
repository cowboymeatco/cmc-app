'use client'
import { useMemo, useState } from 'react'
import { HarvestAppointment, HarvestLog, CarcassAssignment } from '@/lib/types'
import { FRACTION } from '@/lib/cutSchedule'

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

const portionLabel = (p: string) => (p === 'Half' ? '½' : p === 'Quarter' ? '¼' : 'Whole')
const portionColor = (p: string) => (p === 'Whole' ? C.red : p === 'Half' ? '#F97316' : C.amber)
const PORTIONS = ['Whole', 'Half', 'Quarter'] as const

// 1.5 → "1½". Used for carcass fill and for a customer's running total, so
// someone buying a hog and a half reads as "1½" rather than 1.5.
function fracLabel(n: number): string {
  if (n === 0) return '0'
  const whole = Math.floor(n + 1e-9)
  const rest  = n - whole
  const frac  = Math.abs(rest - 0.5) < 1e-9 ? '½' : Math.abs(rest - 0.25) < 1e-9 ? '¼' : Math.abs(rest - 0.75) < 1e-9 ? '¾' : ''
  if (!frac) return String(+n.toFixed(2))
  return whole ? `${whole}${frac}` : frac
}

// One customer's stake in one carcass. A customer can hold several of these —
// a hog and a half is a Whole on one carcass plus a Half on another.
interface Placement { logId: string; portion: string }

export default function AssignCarcassesModal({
  appointment, carcasses, existing, onClose, onSaved,
}: {
  appointment: HarvestAppointment
  carcasses:   HarvestLog[]
  existing:    CarcassAssignment[]
  onClose:     () => void
  onSaved:     () => void
}) {
  const customers = appointment.customers ?? []

  // placement[customerId] = every carcass that customer has a stake in. A
  // customer buying more than one whole animal's worth spans several.
  const [placement, setPlacement] = useState<Record<string, Placement[]>>(() => {
    const init: Record<string, Placement[]> = {}
    for (const a of existing) {
      (init[a.appointment_customer_id] ??= []).push({ logId: a.harvest_log_id, portion: a.portion || 'Whole' })
    }
    return init
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const basePortion = (custId: string) => customers.find(c => c.id === custId)?.portion || 'Whole'
  const placedOn    = (custId: string, logId: string) => (placement[custId] ?? []).find(p => p.logId === logId)

  // Fill level per carcass, summed from each stake's own portion.
  const fill = useMemo(() => {
    const m = new Map<string, number>()
    for (const list of Object.values(placement)) {
      for (const p of list) m.set(p.logId, (m.get(p.logId) ?? 0) + (FRACTION[p.portion] ?? 0))
    }
    return m
  }, [placement])

  // Toggle a carcass on/off for a customer. A newly added carcass starts at the
  // customer's own portion, or drops to whatever still fits on that carcass.
  const place = (custId: string, logId: string) => {
    setError('')
    setPlacement(prev => {
      const list = prev[custId] ?? []
      if (list.some(p => p.logId === logId)) {
        return { ...prev, [custId]: list.filter(p => p.logId !== logId) }
      }
      const room    = 1 - (fill.get(logId) ?? 0)
      const base    = basePortion(custId)
      const portion = (FRACTION[base] ?? 1) <= room + 1e-4
        ? base
        : PORTIONS.find(p => (FRACTION[p] ?? 1) <= room + 1e-4) ?? 'Quarter'
      return { ...prev, [custId]: [...list, { logId, portion }] }
    })
  }

  const setPortion = (custId: string, logId: string, portion: string) => {
    setError('')
    setPlacement(prev => ({
      ...prev,
      [custId]: (prev[custId] ?? []).map(p => (p.logId === logId ? { ...p, portion } : p)),
    }))
  }

  const totalOf = (custId: string) =>
    (placement[custId] ?? []).reduce((s, p) => s + (FRACTION[p.portion] ?? 0), 0)

  const assignedCount   = customers.filter(c => (placement[c.id] ?? []).length > 0).length
  const unassignedNames = customers.filter(c => (placement[c.id] ?? []).length === 0).map(c => c.customer_name)

  async function save() {
    setSaving(true); setError('')
    // One row per (customer, carcass) — a hog and a half writes two rows, both
    // carrying the same cutting instruction, so each carcass prints its own card.
    const assignments = customers.flatMap(c =>
      (placement[c.id] ?? []).map(p => ({
        harvest_log_id:                p.logId,
        appointment_customer_id:       c.id,
        customer_name:                 c.customer_name,
        portion:                       p.portion || 'Whole',
        linked_cutting_instruction_id: c.linked_cutting_instruction_id || null,
      }))
    )
    const res  = await fetch('/api/carcass-assignments', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ appointment_id: appointment.id, assignments }),
    })
    const json = await res.json().catch(() => ({}))
    setSaving(false)
    if (json.error) { setError(json.error); return }
    onSaved()
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: '#1F0E06', border: '2px solid rgba(166,120,90,0.5)', borderRadius: 6, padding: '1.5rem', maxWidth: 720, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>

        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.5rem' }}>
          <div>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: '1.05rem' }}>Assign carcasses to cut customers</div>
            <div style={{ color: C.lightBrown, fontSize: '0.82rem', marginTop: '0.2rem' }}>
              {appointment.source || 'Appointment'} · {appointment.species} · {carcasses.length} {carcasses.length === 1 ? 'carcass' : 'carcasses'} · {customers.length} customers
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '1.3rem', cursor: 'pointer', padding: '0 0.2rem' }}>✕</button>
        </div>

        <p style={{ fontSize: '0.78rem', color: C.lightBrown, lineHeight: 1.5, margin: '0.4rem 0 1rem' }}>
          Tap a carcass for each customer. A <strong style={{ color: C.cream }}>Whole</strong> fills a carcass; two <strong style={{ color: C.cream }}>Halves</strong> share one. A carcass can&apos;t be filled past one whole.
          Someone taking more than one animal&apos;s worth can be put on several carcasses — tap each one and set how much of it is theirs. A hog and a half is a <strong style={{ color: C.cream }}>Whole</strong> on one plus a <strong style={{ color: C.cream }}>½</strong> on another, and both carcasses print her card.
        </p>

        {/* Carcass fill summary */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', marginBottom: '1rem' }}>
          {carcasses.map(log => {
            const f = fill.get(log.id) ?? 0
            const full = f >= 0.999
            const color = full ? C.green : f > 0 ? C.amber : C.lightBrown
            return (
              <div key={log.id} style={{
                border: `1px solid ${color}66`, background: `${color}14`, borderRadius: 4,
                padding: '0.3rem 0.6rem', fontSize: '0.74rem', color,
                display: 'flex', alignItems: 'center', gap: '0.4rem',
              }}>
                <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{log.carcass_tag || '—'}</span>
                {log.hot_carcass_weight_lbs != null && <span style={{ color: C.lightBrown }}>{log.hot_carcass_weight_lbs}lb</span>}
                <span style={{ fontWeight: 700 }}>{full ? 'full' : f === 0 ? 'open' : `${fracLabel(f)} full`}</span>
              </div>
            )
          })}
        </div>

        {/* Per-customer carcass picker */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {customers.map(cust => {
            const mine    = placement[cust.id] ?? []
            const total   = totalOf(cust.id)
            const pColor  = portionColor(cust.portion || 'Whole')
            return (
              <div key={cust.id} style={{
                display: 'flex', flexDirection: 'column', gap: '0.5rem',
                background: C.dark, border: `1px solid ${mine.length ? 'rgba(76,175,80,0.3)' : 'rgba(166,120,90,0.2)'}`,
                borderRadius: 4, padding: '0.55rem 0.75rem',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 150, display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <span style={{
                      background: `${pColor}1A`, border: `1px solid ${pColor}55`, color: pColor,
                      borderRadius: 3, padding: '1px 6px', fontSize: '0.72rem', fontWeight: 700,
                    }}>
                      {portionLabel(cust.portion || 'Whole')}
                    </span>
                    <span style={{ color: C.cream, fontSize: '0.86rem', fontWeight: 600 }}>{cust.customer_name}</span>
                  </div>

                  <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
                    {carcasses.map(log => {
                      const stake    = placedOn(cust.id, log.id)
                      const selected = !!stake
                      const used     = fill.get(log.id) ?? 0
                      // Room for the smallest portion is enough to join a carcass —
                      // the picker below then sets how much of it is theirs.
                      const fits     = used + (FRACTION.Quarter ?? 0.25) <= 1.0001
                      const disabled = !selected && !fits
                      return (
                        <button
                          key={log.id}
                          onClick={() => place(cust.id, log.id)}
                          disabled={disabled}
                          title={disabled ? 'No room left on this carcass' : `Assign to carcass ${log.carcass_tag || '—'}`}
                          style={{
                            minWidth: 38, padding: '0.3rem 0.5rem', borderRadius: 3,
                            fontFamily: 'monospace', fontSize: '0.8rem', fontWeight: 700,
                            cursor: disabled ? 'not-allowed' : 'pointer',
                            border: selected ? `2px solid ${C.green}` : '1px solid rgba(166,120,90,0.3)',
                            background: selected ? 'rgba(76,175,80,0.18)' : disabled ? 'rgba(0,0,0,0.25)' : 'rgba(255,255,255,0.04)',
                            color: selected ? C.green : disabled ? C.medBrown : C.tan,
                            opacity: disabled ? 0.5 : 1,
                          }}
                        >
                          {log.carcass_tag || '—'}
                        </button>
                      )
                    })}
                  </div>

                  {mine.length > 0 && (
                    <span style={{ marginLeft: 'auto', color: C.green, fontSize: '0.76rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                      {fracLabel(total)} assigned
                    </span>
                  )}
                </div>

                {/* How much of each carcass is theirs — only shown once they're on
                    more than nothing, so a plain Whole customer sees no extra UI. */}
                {mine.length > 0 && (
                  <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', paddingLeft: '0.1rem' }}>
                    {mine.map(p => {
                      const log  = carcasses.find(l => l.id === p.logId)
                      const used = fill.get(p.logId) ?? 0
                      return (
                        <div key={p.logId} style={{ display: 'flex', alignItems: 'center', gap: '0.3rem', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 3, padding: '0.2rem 0.4rem' }}>
                          <span style={{ fontFamily: 'monospace', fontSize: '0.74rem', fontWeight: 700, color: C.tan }}>{log?.carcass_tag || '—'}</span>
                          {PORTIONS.map(opt => {
                            const on   = p.portion === opt
                            // Switching to a bigger share must still fit the carcass.
                            const room = used - (FRACTION[p.portion] ?? 0) + (FRACTION[opt] ?? 0) <= 1.0001
                            return (
                              <button
                                key={opt}
                                onClick={() => setPortion(cust.id, p.logId, opt)}
                                disabled={!room && !on}
                                title={!room && !on ? 'Not enough room left on this carcass' : `${opt} of carcass ${log?.carcass_tag || ''}`}
                                style={{
                                  padding: '0.1rem 0.35rem', borderRadius: 2, fontSize: '0.72rem', fontWeight: 700,
                                  cursor: !room && !on ? 'not-allowed' : 'pointer',
                                  border: 'none',
                                  background: on ? C.green : 'transparent',
                                  color: on ? C.dark : !room ? C.medBrown : C.lightBrown,
                                  opacity: !room && !on ? 0.45 : 1,
                                }}
                              >
                                {portionLabel(opt)}
                              </button>
                            )
                          })}
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>

        {/* Status */}
        <div style={{ marginTop: '1rem', fontSize: '0.8rem', color: unassignedNames.length === 0 ? C.green : C.amber }}>
          {assignedCount} / {customers.length} customers assigned
          {unassignedNames.length > 0 && (
            <span style={{ color: C.lightBrown }}> · still open: {unassignedNames.join(', ')}</span>
          )}
        </div>

        {error && (
          <div style={{ marginTop: '0.75rem', background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 3, padding: '0.55rem 0.75rem', color: C.red, fontSize: '0.82rem' }}>
            {error}
          </div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.25rem' }}>
          <button
            onClick={save}
            disabled={saving}
            style={{
              flex: 1, background: C.green, color: C.dark, border: 'none', borderRadius: 4,
              padding: '0.6rem 1.4rem', fontWeight: 700, fontSize: '0.88rem',
              cursor: saving ? 'not-allowed' : 'pointer', opacity: saving ? 0.6 : 1,
            }}
          >
            {saving ? 'Saving…' : 'Save assignments'}
          </button>
          <button
            onClick={onClose}
            style={{ background: 'rgba(166,120,90,0.12)', color: C.tan, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, padding: '0.6rem 1.2rem', fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer' }}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
