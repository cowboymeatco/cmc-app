'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { HarvestAppointment, AnimalReceivingLog, BoxReceivingLog } from '@/lib/types'

type Tab = 'animal' | 'box'

// ── Colours ────────────────────────────────────────────────────────────────────
const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  blue:       '#3B82F6',
  yellow:     '#D97706',
}

const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.72rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem',
}
const BTN = (bg: string, color = C.dark): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 3,
  padding: '0.55rem 1.2rem', fontSize: '0.85rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: '1rem' }}>
      <label style={LABEL}>{label}</label>
      {children}
    </div>
  )
}

// ── Status badge ───────────────────────────────────────────────────────────────
function Badge({ status }: { status: string }) {
  const map: Record<string, string> = {
    received: C.green, reviewed: C.tan,
    Booked: C.tan, InstructionsReceived: C.green, AnimalIn: C.blue,
    Processing: C.yellow, Complete: '#6B7280',
  }
  return (
    <span style={{
      background: map[status] ?? C.medBrown, color: status === 'Booked' || status === 'received' ? C.dark : C.cream,
      fontSize: '0.7rem', fontWeight: 700, borderRadius: 99, padding: '2px 10px',
      textTransform: 'uppercase', letterSpacing: '0.08em',
    }}>{status}</span>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVE ANIMAL TAB
// ══════════════════════════════════════════════════════════════════════════════
function AnimalTab() {
  const [appointments, setAppointments] = useState<HarvestAppointment[]>([])
  const [logs, setLogs] = useState<AnimalReceivingLog[]>([])
  const [selected, setSelected] = useState<HarvestAppointment | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const [form, setForm] = useState({
    live_weight_lbs: '',
    received_by: '',
    health_cert_no: '',
    notes: '',
    received_at: new Date().toISOString().slice(0, 16),
  })

  const load = useCallback(async () => {
    const [apptRes, logRes] = await Promise.all([
      fetch('/api/appointments'),
      fetch('/api/receiving?type=animal'),
    ])
    const appts: HarvestAppointment[] = await apptRes.json()
    const ls: AnimalReceivingLog[] = await logRes.json()
    // Only show appointments not yet fully received (not Complete)
    setAppointments(appts.filter(a => a.status !== 'Complete'))
    setLogs(ls)
  }, [])

  useEffect(() => { load() }, [load])

  const checkedInIds = new Set(logs.map(l => l.appointment_id))

  const pending = appointments.filter(a => !checkedInIds.has(a.id))
  const done    = appointments.filter(a =>  checkedInIds.has(a.id))

  function selectAppt(a: HarvestAppointment) {
    setSelected(a)
    setSuccess(false)
    setForm({ live_weight_lbs: '', received_by: '', health_cert_no: '', notes: '', received_at: new Date().toISOString().slice(0, 16) })
  }

  async function handleCheckIn() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/receiving', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:            'animal',
        appointment_id:  selected.id,
        received_at:     form.received_at,
        live_weight_lbs: form.live_weight_lbs ? parseFloat(form.live_weight_lbs) : null,
        received_by:     form.received_by,
        health_cert_no:  form.health_cert_no,
        notes:           form.notes,
      }),
    })
    setSaving(false)
    setSuccess(true)
    setSelected(null)
    load()
  }

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — appointment list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Pending Check-In ({pending.length})
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {pending.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>No animals pending</p>
          )}
          {pending.map(a => (
            <div
              key={a.id}
              onClick={() => selectAppt(a)}
              style={{
                padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.12)',
                cursor: 'pointer', background: selected?.id === a.id ? 'rgba(166,120,90,0.12)' : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>
                  {a.species} — {a.head_count} head
                </span>
                <Badge status={a.status} />
              </div>
              <div style={{ fontSize: '0.78rem', color: C.tan }}>
                {new Date(a.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {a.source ? ` · ${a.source}` : ''}
              </div>
              {a.customers?.length > 0 && (
                <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.2rem' }}>
                  {a.customers.map(c => c.customer_name).join(', ')}
                </div>
              )}
            </div>
          ))}

          {done.length > 0 && (
            <>
              <div style={{ padding: '0.75rem 1.25rem', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', borderTop: '1px solid rgba(166,120,90,0.2)', marginTop: '0.5rem' }}>
                Checked In ({done.length})
              </div>
              {done.map(a => {
                const log = logs.find(l => l.appointment_id === a.id)
                return (
                  <div key={a.id} style={{ padding: '0.85rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.08)', opacity: 0.65 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                      <span style={{ color: C.cream, fontSize: '0.87rem' }}>{a.species} — {a.head_count} head</span>
                      <span style={{ color: C.green, fontSize: '0.75rem', fontWeight: 600 }}>✓ In</span>
                    </div>
                    <div style={{ fontSize: '0.75rem', color: C.tan, marginTop: '0.15rem' }}>
                      {log?.live_weight_lbs ? `${log.live_weight_lbs} lbs live` : ''}
                      {log?.received_by ? ` · Rcvd by ${log.received_by}` : ''}
                    </div>
                  </div>
                )
              })}
            </>
          )}
        </div>
      </div>

      {/* Right — check-in form */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem' }}>
        {success && (
          <div style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 4, padding: '0.85rem 1.25rem', marginBottom: '1.5rem', color: C.green, fontSize: '0.9rem' }}>
            ✓ Animal checked in — appointment updated to AnimalIn
          </div>
        )}

        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: C.lightBrown, fontSize: '0.9rem' }}>
            ← Select an appointment to check in
          </div>
        ) : (
          <>
            {/* Appointment summary */}
            <div style={{ background: 'rgba(166,120,90,0.08)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ color: C.cream, fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.25rem' }}>
                    {selected.species} — {selected.head_count} head
                  </div>
                  <div style={{ color: C.tan, fontSize: '0.82rem' }}>
                    {new Date(selected.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
                  </div>
                  {selected.source && <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginTop: '0.15rem' }}>Source: {selected.source}</div>}
                  {selected.customers?.length > 0 && (
                    <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginTop: '0.15rem' }}>
                      Customers: {selected.customers.map(c => c.customer_name).join(', ')}
                    </div>
                  )}
                </div>
                <Badge status={selected.status} />
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.25rem' }}>
              <Field label="Date / Time Received">
                <input type="datetime-local" style={INPUT} value={form.received_at} onChange={f('received_at')} />
              </Field>
              <Field label="Live Weight (lbs)">
                <input type="number" step="0.1" placeholder="e.g. 1240" style={INPUT} value={form.live_weight_lbs} onChange={f('live_weight_lbs')} />
              </Field>
              <Field label="Received By">
                <input type="text" placeholder="Name" style={INPUT} value={form.received_by} onChange={f('received_by')} />
              </Field>
              <Field label="Health Cert #">
                <input type="text" placeholder="Optional" style={INPUT} value={form.health_cert_no} onChange={f('health_cert_no')} />
              </Field>
            </div>

            <Field label="Notes">
              <textarea placeholder="Any observations, issues, condition notes…" style={{ ...INPUT, height: 80, resize: 'vertical' }} value={form.notes} onChange={f('notes')} />
            </Field>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '0.5rem' }}>
              <button style={BTN(C.green, C.dark)} onClick={handleCheckIn} disabled={saving}>
                {saving ? 'Saving…' : '✓ Check In Animal'}
              </button>
              <button style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }} onClick={() => setSelected(null)}>
                Cancel
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// BOX PRODUCT TAB
// ══════════════════════════════════════════════════════════════════════════════
function BoxTab() {
  const [logs, setLogs] = useState<BoxReceivingLog[]>([])
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const empty = {
    received_at: new Date().toISOString().slice(0, 10),
    vendor: '', product: '', quantity: '1', weight_lbs: '',
    invoice_no: '', lot_no: '', temp_f: '', received_by: '', notes: '',
  }
  const [form, setForm] = useState(empty)

  const load = useCallback(async () => {
    const res = await fetch('/api/receiving?type=box')
    setLogs(await res.json())
  }, [])

  useEffect(() => { load() }, [load])

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleSubmit() {
    if (!form.vendor || !form.product) return
    setSaving(true)
    await fetch('/api/receiving', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:        'box',
        received_at: form.received_at,
        vendor:      form.vendor,
        product:     form.product,
        quantity:    parseInt(form.quantity) || 1,
        weight_lbs:  form.weight_lbs ? parseFloat(form.weight_lbs) : null,
        invoice_no:  form.invoice_no,
        lot_no:      form.lot_no,
        temp_f:      form.temp_f ? parseFloat(form.temp_f) : null,
        received_by: form.received_by,
        notes:       form.notes,
      }),
    })
    setSaving(false)
    setSuccess(true)
    setForm(empty)
    load()
    setTimeout(() => setSuccess(false), 4000)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '400px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — entry form */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
        <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 1.25rem' }}>
          Log Box Product
        </h3>

        {success && (
          <div style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1rem', color: C.green, fontSize: '0.85rem' }}>
            ✓ Entry saved
          </div>
        )}

        <Field label="Date Received">
          <input type="date" style={INPUT} value={form.received_at} onChange={f('received_at')} />
        </Field>
        <Field label="Vendor / Supplier *">
          <input type="text" placeholder="e.g. Nebraska Premium Beef" style={INPUT} value={form.vendor} onChange={f('vendor')} />
        </Field>
        <Field label="Product *">
          <input type="text" placeholder="e.g. Ground Beef 80/20 10lb" style={INPUT} value={form.product} onChange={f('product')} />
        </Field>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
          <Field label="Quantity (boxes/units)">
            <input type="number" min="1" style={INPUT} value={form.quantity} onChange={f('quantity')} />
          </Field>
          <Field label="Total Weight (lbs)">
            <input type="number" step="0.1" placeholder="Optional" style={INPUT} value={form.weight_lbs} onChange={f('weight_lbs')} />
          </Field>
          <Field label="Invoice #">
            <input type="text" placeholder="Optional" style={INPUT} value={form.invoice_no} onChange={f('invoice_no')} />
          </Field>
          <Field label="Lot #">
            <input type="text" placeholder="Optional" style={INPUT} value={form.lot_no} onChange={f('lot_no')} />
          </Field>
        </div>

        <Field label="Temp Check (°F)">
          <input type="number" step="0.1" placeholder="e.g. 34.5" style={INPUT} value={form.temp_f} onChange={f('temp_f')} />
        </Field>
        <Field label="Received By">
          <input type="text" placeholder="Name" style={INPUT} value={form.received_by} onChange={f('received_by')} />
        </Field>
        <Field label="Notes">
          <textarea placeholder="Condition, issues, rejections…" style={{ ...INPUT, height: 72, resize: 'vertical' }} value={form.notes} onChange={f('notes')} />
        </Field>

        <button
          style={{ ...BTN(form.vendor && form.product ? C.tan : C.medBrown), width: '100%', marginTop: '0.25rem', opacity: form.vendor && form.product ? 1 : 0.55 }}
          onClick={handleSubmit}
          disabled={saving || !form.vendor || !form.product}
        >
          {saving ? 'Saving…' : 'Save Entry'}
        </button>
      </div>

      {/* Right — recent log */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Recent Entries
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {logs.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>No box product entries yet</p>
          )}
          {logs.map(log => (
            <div key={log.id} style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>{log.product}</span>
                <span style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
                  {new Date(log.received_at + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </span>
              </div>
              <div style={{ fontSize: '0.8rem', color: C.tan }}>
                {log.vendor}
              </div>
              <div style={{ fontSize: '0.78rem', color: C.lightBrown, marginTop: '0.2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span>Qty: {log.quantity}</span>
                {log.weight_lbs != null && <span>{log.weight_lbs} lbs</span>}
                {log.temp_f != null && <span>{log.temp_f}°F</span>}
                {log.invoice_no && <span>Inv: {log.invoice_no}</span>}
                {log.lot_no && <span>Lot: {log.lot_no}</span>}
                {log.received_by && <span>Rcvd by: {log.received_by}</span>}
              </div>
              {log.notes && <div style={{ fontSize: '0.77rem', color: C.lightBrown, marginTop: '0.3rem', fontStyle: 'italic' }}>{log.notes}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function ReceivingPage() {
  const [tab, setTab] = useState<Tab>('animal')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            Receiving
          </h1>
        </div>

        {/* Tab toggle */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
          {(['animal', 'box'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '0.45rem 1.25rem', border: 'none', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600,
                background: tab === t ? C.medBrown : 'transparent',
                color: tab === t ? C.cream : C.lightBrown,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                transition: 'background 0.15s',
              }}
            >
              {t === 'animal' ? '🐄 Live Animal' : '📦 Box Product'}
            </button>
          ))}
        </div>
      </header>

      {/* Content */}
      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1200px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'animal' ? <AnimalTab /> : <BoxTab />}
      </main>

      {/* Footer */}
      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
