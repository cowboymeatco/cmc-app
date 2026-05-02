'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { HarvestAppointment } from '@/lib/types'

const SPECIES = ['Beef', 'Hog', 'Lamb', 'Goat']
const PORTIONS = ['Whole', 'Half', 'Quarter']
const CONTACTS = ['Email', 'Text Message', 'Phone Call']
const STATUSES = ['Booked', 'InstructionsReceived', 'AnimalIn', 'Processing', 'Complete']

const STATUS_LABELS: Record<string, string> = {
  Booked:                'Booked',
  InstructionsReceived:  'Instructions ✅',
  AnimalIn:              'Animal In',
  Processing:            'Processing',
  Complete:              'Complete',
}

const STATUS_COLORS: Record<string, string> = {
  Booked:               'rgba(201,168,130,0.2)',
  InstructionsReceived: 'rgba(100,180,100,0.2)',
  AnimalIn:             'rgba(100,150,220,0.2)',
  Processing:           'rgba(220,160,50,0.2)',
  Complete:             'rgba(100,100,100,0.2)',
}

function daysOut(dateStr: string) {
  const d = Math.ceil((new Date(dateStr).getTime() - Date.now()) / 86400000)
  if (d < 0)  return `${Math.abs(d)}d ago`
  if (d === 0) return 'Today'
  if (d === 1) return 'Tomorrow'
  return `${d} days`
}

function blankCustomer() {
  return { id: crypto.randomUUID(), customer_name: '', portion: 'Whole', contact_preference: 'Email', contact_value: '', linked_cutting_instruction_id: '', reminder_last_sent_at: null, reminder_count: 0 }
}

function blankAppt(): Partial<HarvestAppointment> {
  return { harvest_date: new Date().toISOString().slice(0, 10), species: 'Beef', head_count: 1, source: '', notes: '', status: 'Booked', linked_carcass_id: '', customers: [blankCustomer()] }
}

export default function SchedulePage() {
  const [appointments, setAppointments] = useState<HarvestAppointment[]>([])
  const [loading, setLoading]           = useState(true)
  const [showForm, setShowForm]         = useState(false)
  const [editing, setEditing]           = useState<Partial<HarvestAppointment> | null>(null)
  const [saving, setSaving]             = useState(false)
  const [filter, setFilter]             = useState<string>('upcoming')

  async function load() {
    setLoading(true)
    const res = await fetch('/api/appointments')
    const data = await res.json()
    setAppointments(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = appointments.filter(a => {
    if (filter === 'upcoming') return a.status !== 'Complete'
    if (filter === 'complete') return a.status === 'Complete'
    return true
  }).sort((a, b) => a.harvest_date.localeCompare(b.harvest_date))

  const needInstruct = filtered.filter(a => a.customers?.some(c => !c.linked_cutting_instruction_id)).length
  const readyCount   = filtered.filter(a => a.customers?.every(c => !!c.linked_cutting_instruction_id)).length

  async function save() {
    if (!editing) return
    setSaving(true)
    const isNew = !editing.id
    const method = isNew ? 'POST' : 'PATCH'
    await fetch('/api/appointments', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
    setSaving(false)
    setShowForm(false)
    setEditing(null)
    load()
  }

  async function deleteAppt(id: string) {
    if (!confirm('Delete this appointment?')) return
    await fetch(`/api/appointments?id=${id}`, { method: 'DELETE' })
    load()
  }

  function openNew() { setEditing(blankAppt()); setShowForm(true) }
  function openEdit(a: HarvestAppointment) { setEditing({ ...a, customers: a.customers ? [...a.customers] : [blankCustomer()] }); setShowForm(true) }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', paddingBottom: '4rem' }}>
      {/* Header */}
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.5rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: 'var(--tan)', textDecoration: 'none', fontSize: '0.85rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📅 Harvest Schedule</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem', fontSize: '0.8rem' }}>
          {needInstruct > 0 && <span style={{ color: '#f0c040' }}>⚠ {needInstruct} need instructions</span>}
          {readyCount   > 0 && <span style={{ color: '#6dbf6d' }}>✅ {readyCount} ready</span>}
        </div>
      </header>

      <div style={{ maxWidth: '1100px', margin: '0 auto', padding: '1.5rem' }}>
        {/* Toolbar */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center' }}>
          <button onClick={openNew} style={btnStyle('var(--med-brown)')}>+ New Appointment</button>
          {(['upcoming','complete','all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={btnStyle(filter === f ? 'var(--light-brown)' : 'rgba(166,120,90,0.15)', filter === f ? 'var(--dark)' : 'var(--tan)')}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}
          <button onClick={load} style={{ ...btnStyle('transparent', 'var(--tan)'), marginLeft: 'auto', border: '1px solid rgba(166,120,90,0.3)' }}>↺ Refresh</button>
        </div>

        {/* Table */}
        {loading ? (
          <p style={{ color: 'var(--tan)', textAlign: 'center', padding: '3rem' }}>Loading…</p>
        ) : filtered.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--tan)' }}>
            <p style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>No appointments found.</p>
            <button onClick={openNew} style={btnStyle('var(--med-brown)')}>+ New Appointment</button>
          </div>
        ) : (
          <div style={{ background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: '4px', overflow: 'hidden' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.88rem' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.4)' }}>
                  {['Harvest Date','Species','Head','Customer(s)','Status','Instructions','Days Out',''].map(h => (
                    <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: 'var(--light-brown)', fontSize: '0.7rem', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((a, i) => {
                  const allReady = a.customers?.every(c => !!c.linked_cutting_instruction_id)
                  const someNeed = a.customers?.some(c => !c.linked_cutting_instruction_id)
                  return (
                    <tr key={a.id} style={{ borderTop: i > 0 ? '1px solid rgba(166,120,90,0.1)' : undefined, background: STATUS_COLORS[a.status] ?? 'transparent' }}>
                      <td style={td()}>{new Date(a.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                      <td style={td()}>{a.species}</td>
                      <td style={td()}>{a.head_count}</td>
                      <td style={td()}>{a.customers?.map(c => `${c.customer_name}${c.portion !== 'Whole' ? ` (${c.portion})` : ''}`).join(', ') || '—'}</td>
                      <td style={td()}><span style={{ padding: '0.2rem 0.6rem', borderRadius: '3px', fontSize: '0.75rem', background: 'rgba(0,0,0,0.3)', color: 'var(--cream)' }}>{STATUS_LABELS[a.status] ?? a.status}</span></td>
                      <td style={td()}>{allReady ? <span style={{ color: '#6dbf6d' }}>✅ Ready</span> : someNeed ? <span style={{ color: '#f0c040' }}>⚠ Needed</span> : '—'}</td>
                      <td style={td()}>{daysOut(a.harvest_date)}</td>
                      <td style={{ ...td(), whiteSpace: 'nowrap' }}>
                        <button onClick={() => openEdit(a)} style={{ ...smallBtn(), marginRight: '0.5rem' }}>✎ Edit</button>
                        <button onClick={() => deleteAppt(a.id)} style={smallBtn('rgba(180,60,60,0.3)', '#f08080')}>✕</button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Edit / New modal */}
      {showForm && editing && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }} onClick={() => setShowForm(false)}>
          <div style={{ background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '6px', padding: '2rem', width: '100%', maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
            <h2 style={{ margin: '0 0 1.5rem', color: 'var(--cream)', fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {editing.id ? 'Edit Appointment' : 'New Appointment'}
            </h2>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
              <Field label="Harvest Date">
                <input type="date" value={editing.harvest_date ?? ''} onChange={e => setEditing({ ...editing, harvest_date: e.target.value })} style={inputStyle()} />
              </Field>
              <Field label="Species">
                <select value={editing.species ?? 'Beef'} onChange={e => setEditing({ ...editing, species: e.target.value as any })} style={inputStyle()}>
                  {SPECIES.map(s => <option key={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="Head Count">
                <input type="number" min={1} value={editing.head_count ?? 1} onChange={e => setEditing({ ...editing, head_count: parseInt(e.target.value) })} style={inputStyle()} />
              </Field>
              <Field label="Status">
                <select value={editing.status ?? 'Booked'} onChange={e => setEditing({ ...editing, status: e.target.value as any })} style={inputStyle()}>
                  {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
                </select>
              </Field>
            </div>

            <Field label="Source / Ranch">
              <input value={editing.source ?? ''} onChange={e => setEditing({ ...editing, source: e.target.value })} style={inputStyle()} placeholder="Ranch or source name" />
            </Field>
            <div style={{ height: '0.75rem' }} />
            <Field label="Notes">
              <textarea value={editing.notes ?? ''} onChange={e => setEditing({ ...editing, notes: e.target.value })} style={{ ...inputStyle(), minHeight: '70px', resize: 'vertical' }} />
            </Field>

            {/* Customers */}
            <div style={{ marginTop: '1.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
                <span style={{ color: 'var(--light-brown)', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Customers</span>
                <button onClick={() => setEditing({ ...editing, customers: [...(editing.customers ?? []), blankCustomer()] })} style={smallBtn()}>+ Add</button>
              </div>
              {(editing.customers ?? []).map((c, idx) => (
                <div key={c.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: '4px', padding: '1rem', marginBottom: '0.75rem' }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                    <Field label="Name">
                      <input value={c.customer_name} onChange={e => { const cs = [...(editing.customers ?? [])]; cs[idx] = { ...c, customer_name: e.target.value }; setEditing({ ...editing, customers: cs }) }} style={inputStyle()} />
                    </Field>
                    <Field label="Portion">
                      <select value={c.portion} onChange={e => { const cs = [...(editing.customers ?? [])]; cs[idx] = { ...c, portion: e.target.value }; setEditing({ ...editing, customers: cs }) }} style={inputStyle()}>
                        {PORTIONS.map(p => <option key={p}>{p}</option>)}
                      </select>
                    </Field>
                    <Field label="Contact">
                      <select value={c.contact_preference} onChange={e => { const cs = [...(editing.customers ?? [])]; cs[idx] = { ...c, contact_preference: e.target.value }; setEditing({ ...editing, customers: cs }) }} style={inputStyle()}>
                        {CONTACTS.map(p => <option key={p}>{p}</option>)}
                      </select>
                    </Field>
                    <Field label="Contact Value">
                      <input value={c.contact_value} onChange={e => { const cs = [...(editing.customers ?? [])]; cs[idx] = { ...c, contact_value: e.target.value }; setEditing({ ...editing, customers: cs }) }} style={inputStyle()} placeholder="email or phone" />
                    </Field>
                  </div>
                  {(editing.customers ?? []).length > 1 && (
                    <button onClick={() => { const cs = (editing.customers ?? []).filter((_, i) => i !== idx); setEditing({ ...editing, customers: cs }) }} style={{ ...smallBtn('rgba(180,60,60,0.2)', '#f08080'), marginTop: '0.5rem', fontSize: '0.75rem' }}>Remove customer</button>
                  )}
                </div>
              ))}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
              <button onClick={() => { setShowForm(false); setEditing(null) }} style={btnStyle('transparent', 'var(--tan)')}>Cancel</button>
              <button onClick={save} disabled={saving} style={btnStyle('var(--med-brown)')}>{saving ? 'Saving…' : 'Save Appointment'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--light-brown)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>{label}</label>
      {children}
    </div>
  )
}

function inputStyle(): React.CSSProperties {
  return { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '3px', padding: '0.5rem 0.75rem', color: 'var(--cream)', fontSize: '0.88rem' }
}

function td(): React.CSSProperties {
  return { padding: '0.75rem 1rem', color: 'var(--off-white)', verticalAlign: 'middle' }
}

function btnStyle(bg: string, color = 'var(--cream)'): React.CSSProperties {
  return { background: bg, color, border: 'none', borderRadius: '3px', padding: '0.55rem 1.1rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.04em' }
}

function smallBtn(bg = 'rgba(166,120,90,0.2)', color = 'var(--tan)'): React.CSSProperties {
  return { background: bg, color, border: 'none', borderRadius: '3px', padding: '0.3rem 0.7rem', fontSize: '0.78rem', cursor: 'pointer' }
}
