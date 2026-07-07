'use client'
import { useMemo, useState } from 'react'
import { HarvestAppointment, HarvestLog, CarcassAssignment } from '@/lib/types'

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

// Portion → fraction of one whole carcass.
const FRACTION: Record<string, number> = { Whole: 1, Half: 0.5, Quarter: 0.25 }
const portionLabel = (p: string) => (p === 'Half' ? '½' : p === 'Quarter' ? '¼' : 'Whole')
const portionColor = (p: string) => (p === 'Whole' ? C.red : p === 'Half' ? '#F97316' : C.amber)

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

  // placement[customerId] = harvest_log_id the customer is assigned to (or undefined)
  const [placement, setPlacement] = useState<Record<string, string | undefined>>(() => {
    const init: Record<string, string | undefined> = {}
    for (const a of existing) init[a.appointment_customer_id] = a.harvest_log_id
    return init
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  const fracOf = (custId: string) => {
    const c = customers.find(c => c.id === custId)
    return FRACTION[c?.portion ?? 'Whole'] ?? 1
  }

  // Fill level (0–1) per carcass, from current placement.
  const fill = useMemo(() => {
    const m = new Map<string, number>()
    for (const [custId, logId] of Object.entries(placement)) {
      if (!logId) continue
      m.set(logId, (m.get(logId) ?? 0) + fracOf(custId))
    }
    return m
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [placement, customers])

  const place = (custId: string, logId: string) => {
    setError('')
    setPlacement(prev => {
      // toggle off if clicking the carcass it's already on
      if (prev[custId] === logId) return { ...prev, [custId]: undefined }
      return { ...prev, [custId]: logId }
    })
  }

  const assignedCount   = Object.values(placement).filter(Boolean).length
  const unassignedNames = customers.filter(c => !placement[c.id]).map(c => c.customer_name)

  async function save() {
    setSaving(true); setError('')
    const assignments = customers
      .filter(c => placement[c.id])
      .map(c => ({
        harvest_log_id:                placement[c.id]!,
        appointment_customer_id:       c.id,
        customer_name:                 c.customer_name,
        portion:                       c.portion || 'Whole',
        linked_cutting_instruction_id: c.linked_cutting_instruction_id || null,
      }))
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
                <span style={{ fontWeight: 700 }}>{full ? 'full' : f === 0 ? 'open' : `${f === 0.5 ? '½' : f === 0.25 ? '¼' : f === 0.75 ? '¾' : f} full`}</span>
              </div>
            )
          })}
        </div>

        {/* Per-customer carcass picker */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {customers.map(cust => {
            const myFrac  = FRACTION[cust.portion || 'Whole'] ?? 1
            const placed  = placement[cust.id]
            const pColor  = portionColor(cust.portion || 'Whole')
            return (
              <div key={cust.id} style={{
                display: 'flex', alignItems: 'center', gap: '0.6rem', flexWrap: 'wrap',
                background: C.dark, border: `1px solid ${placed ? 'rgba(76,175,80,0.3)' : 'rgba(166,120,90,0.2)'}`,
                borderRadius: 4, padding: '0.55rem 0.75rem',
              }}>
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
                    const selected = placed === log.id
                    const used     = fill.get(log.id) ?? 0
                    // room left if we (conceptually) remove this customer first
                    const without  = selected ? used - myFrac : used
                    const fits     = without + myFrac <= 1.0001
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
