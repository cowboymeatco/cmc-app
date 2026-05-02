'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'
import type { HarvestAppointment } from '@/lib/types'

const SPECIES  = ['Beef', 'Hog', 'Lamb', 'Goat']
const PORTIONS = ['Whole', 'Half', 'Quarter']
const CONTACTS = ['Email', 'Text Message', 'Phone Call']
const STATUSES = ['Booked', 'InstructionsReceived', 'AnimalIn', 'Processing', 'Complete']

const STATUS_LABELS: Record<string, string> = {
  Booked:               'Booked',
  InstructionsReceived: 'Instructions ✅',
  AnimalIn:             'Animal In',
  Processing:           'Processing',
  Complete:             'Complete',
}

const STATUS_COLORS: Record<string, string> = {
  Booked:               'rgba(201,168,130,0.2)',
  InstructionsReceived: 'rgba(100,180,100,0.2)',
  AnimalIn:             'rgba(100,150,220,0.2)',
  Processing:           'rgba(220,160,50,0.2)',
  Complete:             'rgba(100,100,100,0.2)',
}

const DOT_COLORS: Record<string, string> = {
  Booked:               '#C9A882',
  InstructionsReceived: '#6dbf6d',
  AnimalIn:             '#6496dc',
  Processing:           '#dca032',
  Complete:             '#888',
}

function daysOut(dateStr: string) {
  const d = Math.ceil((new Date(dateStr + 'T12:00:00').getTime() - Date.now()) / 86400000)
  if (d < 0)   return `${Math.abs(d)}d ago`
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

// ── Calendar helpers ──────────────────────────────────────────────────────────

function startOfMonth(year: number, month: number) { return new Date(year, month, 1) }
function daysInMonth(year: number, month: number)  { return new Date(year, month + 1, 0).getDate() }

const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

// ── Component ─────────────────────────────────────────────────────────────────

export default function SchedulePage() {
  const [appointments, setAppointments] = useState<HarvestAppointment[]>([])
  const [loading, setLoading]           = useState(true)
  const [showForm, setShowForm]         = useState(false)
  const [editing, setEditing]           = useState<Partial<HarvestAppointment> | null>(null)
  const [saving, setSaving]             = useState(false)
  const [filter, setFilter]             = useState<'upcoming'|'complete'|'all'>('upcoming')
  const [view, setView]                 = useState<'list'|'calendar'>('calendar')
  const [calYear, setCalYear]           = useState(new Date().getFullYear())
  const [calMonth, setCalMonth]         = useState(new Date().getMonth())
  const [selectedDay, setSelectedDay]   = useState<string | null>(null)

  async function load() {
    setLoading(true)
    const res = await fetch('/api/appointments')
    const data = await res.json()
    setAppointments(Array.isArray(data) ? data : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  const filtered = appointments
    .filter(a => {
      if (filter === 'upcoming') return a.status !== 'Complete'
      if (filter === 'complete') return a.status === 'Complete'
      return true
    })
    .sort((a, b) => a.harvest_date.localeCompare(b.harvest_date))

  const needInstruct = appointments.filter(a => a.status !== 'Complete' && a.customers?.some(c => !c.linked_cutting_instruction_id)).length
  const readyCount   = appointments.filter(a => a.status !== 'Complete' && a.customers?.every(c => !!c.linked_cutting_instruction_id)).length

  async function save() {
    if (!editing) return
    setSaving(true)
    const method = editing.id ? 'PATCH' : 'POST'
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

  function openNew(date?: string) {
    setEditing({ ...blankAppt(), harvest_date: date ?? new Date().toISOString().slice(0, 10) })
    setShowForm(true)
  }
  function openEdit(a: HarvestAppointment) {
    setEditing({ ...a, customers: a.customers ? [...a.customers] : [blankCustomer()] })
    setShowForm(true)
  }

  // Build a map of date → appointments for the calendar
  const apptByDate: Record<string, HarvestAppointment[]> = {}
  for (const a of appointments) {
    if (!apptByDate[a.harvest_date]) apptByDate[a.harvest_date] = []
    apptByDate[a.harvest_date].push(a)
  }

  const dayAppts = selectedDay ? (apptByDate[selectedDay] ?? []) : []

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', paddingBottom: '4rem' }}>

      {/* Header */}
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.5rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: 'var(--tan)', textDecoration: 'none', fontSize: '0.85rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📅 Harvest Schedule</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem', fontSize: '0.8rem' }}>
          {needInstruct > 0 && <span style={{ color: '#f0c040' }}>⚠ {needInstruct} need instructions</span>}
          {readyCount   > 0 && <span style={{ color: '#6dbf6d' }}>✅ {readyCount} ready</span>}
        </div>
      </header>

      <div style={{ maxWidth: '1200px', margin: '0 auto', padding: '1.5rem' }}>

        {/* Toolbar */}
        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => openNew()} style={btnStyle('var(--med-brown)')}>+ New Appointment</button>

          {/* View toggle */}
          <div style={{ display: 'flex', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
            <button onClick={() => setView('calendar')} style={{ ...btnStyle(view === 'calendar' ? 'var(--med-brown)' : 'transparent', view === 'calendar' ? 'var(--cream)' : 'var(--tan)'), borderRadius: 0, padding: '0.45rem 1rem' }}>📅 Calendar</button>
            <button onClick={() => setView('list')}     style={{ ...btnStyle(view === 'list'     ? 'var(--med-brown)' : 'transparent', view === 'list'     ? 'var(--cream)' : 'var(--tan)'), borderRadius: 0, padding: '0.45rem 1rem', borderLeft: '1px solid rgba(166,120,90,0.3)' }}>☰ List</button>
          </div>

          {view === 'list' && (['upcoming','complete','all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={btnStyle(filter === f ? 'var(--light-brown)' : 'rgba(166,120,90,0.15)', filter === f ? 'var(--dark)' : 'var(--tan)')}>
              {f.charAt(0).toUpperCase() + f.slice(1)}
            </button>
          ))}

          <button onClick={load} style={{ ...btnStyle('transparent', 'var(--tan)'), marginLeft: 'auto', border: '1px solid rgba(166,120,90,0.3)' }}>↺ Refresh</button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--tan)', textAlign: 'center', padding: '3rem' }}>Loading…</p>
        ) : view === 'calendar' ? (
          <CalendarView
            year={calYear} month={calMonth}
            apptByDate={apptByDate}
            selectedDay={selectedDay}
            onPrev={() => { if (calMonth === 0) { setCalYear(y => y - 1); setCalMonth(11) } else setCalMonth(m => m - 1) }}
            onNext={() => { if (calMonth === 11) { setCalYear(y => y + 1); setCalMonth(0) } else setCalMonth(m => m + 1) }}
            onToday={() => { setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth()) }}
            onSelectDay={d => setSelectedDay(prev => prev === d ? null : d)}
            onNewOnDay={d => openNew(d)}
            dayAppts={dayAppts}
            onEdit={openEdit}
            onDelete={deleteAppt}
          />
        ) : (
          <ListView filtered={filtered} onEdit={openEdit} onDelete={deleteAppt} onNew={() => openNew()} />
        )}
      </div>

      {/* Modal */}
      {showForm && editing && (
        <Modal
          editing={editing} saving={saving}
          onChange={setEditing}
          onSave={save}
          onClose={() => { setShowForm(false); setEditing(null) }}
        />
      )}
    </div>
  )
}

// ── Calendar View ─────────────────────────────────────────────────────────────

function CalendarView({ year, month, apptByDate, selectedDay, onPrev, onNext, onToday, onSelectDay, onNewOnDay, dayAppts, onEdit, onDelete }: {
  year: number; month: number
  apptByDate: Record<string, HarvestAppointment[]>
  selectedDay: string | null
  onPrev: () => void; onNext: () => void; onToday: () => void
  onSelectDay: (d: string) => void
  onNewOnDay: (d: string) => void
  dayAppts: HarvestAppointment[]
  onEdit: (a: HarvestAppointment) => void
  onDelete: (id: string) => void
}) {
  const today    = new Date().toISOString().slice(0, 10)
  const firstDow = startOfMonth(year, month).getDay()
  const numDays  = daysInMonth(year, month)
  const cells: (number | null)[] = [...Array(firstDow).fill(null), ...Array.from({ length: numDays }, (_, i) => i + 1)]
  while (cells.length % 7 !== 0) cells.push(null)

  function dateStr(day: number) {
    return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
  }

  return (
    <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
      {/* Calendar grid */}
      <div style={{ flex: '1 1 600px', background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: '4px', overflow: 'hidden' }}>
        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
          <button onClick={onPrev} style={navBtn()}>‹</button>
          <div style={{ textAlign: 'center' }}>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {MONTH_NAMES[month]} {year}
            </span>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onToday} style={{ ...navBtn(), fontSize: '0.7rem', padding: '0.3rem 0.7rem' }}>Today</button>
            <button onClick={onNext} style={navBtn()}>›</button>
          </div>
        </div>

        {/* Day-of-week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: 'rgba(0,0,0,0.3)' }}>
          {DAY_NAMES.map(d => (
            <div key={d} style={{ textAlign: 'center', padding: '0.5rem', fontSize: '0.68rem', color: 'var(--light-brown)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>

        {/* Weeks */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {cells.map((day, i) => {
            if (!day) return <div key={`e${i}`} style={{ minHeight: '90px', borderRight: '1px solid rgba(166,120,90,0.08)', borderBottom: '1px solid rgba(166,120,90,0.08)', background: 'rgba(0,0,0,0.15)' }} />
            const ds       = dateStr(day)
            const appts    = apptByDate[ds] ?? []
            const isToday  = ds === today
            const isSel    = ds === selectedDay
            return (
              <div key={ds} onClick={() => onSelectDay(ds)}
                style={{ minHeight: '90px', padding: '0.4rem 0.5rem', borderRight: '1px solid rgba(166,120,90,0.08)', borderBottom: '1px solid rgba(166,120,90,0.08)', cursor: 'pointer', background: isSel ? 'rgba(117,71,27,0.35)' : isToday ? 'rgba(117,71,27,0.15)' : 'transparent', transition: 'background 0.15s', position: 'relative' }}>
                <span style={{ fontSize: '0.78rem', fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--tan)' : 'var(--off-white)', display: 'block', marginBottom: '0.3rem' }}>
                  {isToday ? <span style={{ background: 'var(--med-brown)', borderRadius: '50%', width: '22px', height: '22px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{day}</span> : day}
                </span>
                {appts.slice(0, 3).map(a => (
                  <div key={a.id} style={{ fontSize: '0.68rem', background: DOT_COLORS[a.status] ? `${DOT_COLORS[a.status]}33` : 'rgba(166,120,90,0.2)', borderLeft: `2px solid ${DOT_COLORS[a.status] ?? 'var(--tan)'}`, padding: '0.15rem 0.35rem', marginBottom: '0.2rem', borderRadius: '2px', color: 'var(--cream)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {a.species} {a.customers?.[0]?.customer_name ? `· ${a.customers[0].customer_name}` : ''}
                  </div>
                ))}
                {appts.length > 3 && <div style={{ fontSize: '0.65rem', color: 'var(--tan)' }}>+{appts.length - 3} more</div>}
                {/* Quick-add on hover */}
                {appts.length === 0 && (
                  <button onClick={e => { e.stopPropagation(); onNewOnDay(ds) }} title="Add appointment" style={{ position: 'absolute', bottom: '4px', right: '4px', background: 'transparent', border: 'none', color: 'rgba(166,120,90,0.4)', fontSize: '1rem', cursor: 'pointer', lineHeight: 1, padding: '2px' }}>+</button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Day detail panel */}
      <div style={{ flex: '0 0 280px', background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: '4px', overflow: 'hidden', minHeight: '200px' }}>
        {selectedDay ? (
          <>
            <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.15)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ fontFamily: 'Georgia, serif', fontSize: '0.95rem', fontWeight: 700, color: 'var(--cream)' }}>
                {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
              </span>
              <button onClick={() => onNewOnDay(selectedDay)} style={btnStyle('var(--med-brown)', 'var(--cream)')}>+ Add</button>
            </div>
            {dayAppts.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--tan)', fontSize: '0.85rem' }}>No appointments this day</div>
            ) : (
              <div style={{ padding: '0.75rem' }}>
                {dayAppts.map(a => (
                  <div key={a.id} style={{ background: STATUS_COLORS[a.status] ?? 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: '4px', padding: '0.75rem', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.4rem' }}>
                      <span style={{ fontWeight: 700, color: 'var(--cream)', fontSize: '0.9rem' }}>{a.species} · {a.head_count} head</span>
                      <div style={{ display: 'flex', gap: '0.4rem' }}>
                        <button onClick={() => onEdit(a)} style={smallBtn()}>✎</button>
                        <button onClick={() => onDelete(a.id)} style={smallBtn('rgba(180,60,60,0.3)', '#f08080')}>✕</button>
                      </div>
                    </div>
                    {a.source && <div style={{ fontSize: '0.78rem', color: 'var(--tan)', marginBottom: '0.3rem' }}>📍 {a.source}</div>}
                    {a.customers?.map(c => (
                      <div key={c.id} style={{ fontSize: '0.78rem', color: 'var(--off-white)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{c.customer_name} <span style={{ color: 'var(--tan)' }}>({c.portion})</span></span>
                        <span>{c.linked_cutting_instruction_id ? <span style={{ color: '#6dbf6d' }}>✅</span> : <span style={{ color: '#f0c040' }}>⚠</span>}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: '0.5rem' }}>
                      <span style={{ fontSize: '0.7rem', padding: '0.15rem 0.5rem', borderRadius: '3px', background: 'rgba(0,0,0,0.3)', color: 'var(--cream)' }}>{STATUS_LABELS[a.status]}</span>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        ) : (
          <div style={{ padding: '2.5rem 1.5rem', textAlign: 'center', color: 'var(--tan)', fontSize: '0.85rem' }}>
            <div style={{ fontSize: '2rem', marginBottom: '0.75rem' }}>📅</div>
            Click a day to see appointments
          </div>
        )}
      </div>
    </div>
  )
}

// ── List View ─────────────────────────────────────────────────────────────────

function ListView({ filtered, onEdit, onDelete, onNew }: { filtered: HarvestAppointment[]; onEdit: (a: HarvestAppointment) => void; onDelete: (id: string) => void; onNew: () => void }) {
  if (filtered.length === 0) return (
    <div style={{ textAlign: 'center', padding: '4rem', color: 'var(--tan)' }}>
      <p style={{ fontSize: '1.1rem', marginBottom: '1rem' }}>No appointments found.</p>
      <button onClick={onNew} style={btnStyle('var(--med-brown)')}>+ New Appointment</button>
    </div>
  )
  return (
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
                  <button onClick={() => onEdit(a)} style={{ ...smallBtn(), marginRight: '0.5rem' }}>✎ Edit</button>
                  <button onClick={() => onDelete(a.id)} style={smallBtn('rgba(180,60,60,0.3)', '#f08080')}>✕</button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ── Edit Modal ────────────────────────────────────────────────────────────────

function Modal({ editing, saving, onChange, onSave, onClose }: {
  editing: Partial<HarvestAppointment>; saving: boolean
  onChange: (a: Partial<HarvestAppointment>) => void
  onSave: () => void; onClose: () => void
}) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50, padding: '1rem' }} onClick={onClose}>
      <div style={{ background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '6px', padding: '2rem', width: '100%', maxWidth: '620px', maxHeight: '90vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        <h2 style={{ margin: '0 0 1.5rem', color: 'var(--cream)', fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          {editing.id ? 'Edit Appointment' : 'New Appointment'}
        </h2>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginBottom: '1rem' }}>
          <Field label="Harvest Date">
            <input type="date" value={editing.harvest_date ?? ''} onChange={e => onChange({ ...editing, harvest_date: e.target.value })} style={inputStyle()} />
          </Field>
          <Field label="Species">
            <select value={editing.species ?? 'Beef'} onChange={e => onChange({ ...editing, species: e.target.value as any })} style={inputStyle()}>
              {SPECIES.map(s => <option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Head Count">
            <input type="number" min={1} value={editing.head_count ?? 1} onChange={e => onChange({ ...editing, head_count: parseInt(e.target.value) })} style={inputStyle()} />
          </Field>
          <Field label="Status">
            <select value={editing.status ?? 'Booked'} onChange={e => onChange({ ...editing, status: e.target.value as any })} style={inputStyle()}>
              {STATUSES.map(s => <option key={s} value={s}>{STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Source / Ranch">
          <input value={editing.source ?? ''} onChange={e => onChange({ ...editing, source: e.target.value })} style={inputStyle()} placeholder="Ranch or source name" />
        </Field>
        <div style={{ height: '0.75rem' }} />
        <Field label="Notes">
          <textarea value={editing.notes ?? ''} onChange={e => onChange({ ...editing, notes: e.target.value })} style={{ ...inputStyle(), minHeight: '70px', resize: 'vertical' }} />
        </Field>

        {/* Customers */}
        <div style={{ marginTop: '1.5rem' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.75rem' }}>
            <span style={{ color: 'var(--light-brown)', fontSize: '0.75rem', letterSpacing: '0.12em', textTransform: 'uppercase' }}>Customers</span>
            <button onClick={() => onChange({ ...editing, customers: [...(editing.customers ?? []), blankCustomer()] })} style={smallBtn()}>+ Add</button>
          </div>
          {(editing.customers ?? []).map((c, idx) => (
            <div key={c.id} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: '4px', padding: '1rem', marginBottom: '0.75rem' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
                <Field label="Name">
                  <input value={c.customer_name} onChange={e => { const cs = [...(editing.customers ?? [])]; cs[idx] = { ...c, customer_name: e.target.value }; onChange({ ...editing, customers: cs }) }} style={inputStyle()} />
                </Field>
                <Field label="Portion">
                  <select value={c.portion} onChange={e => { const cs = [...(editing.customers ?? [])]; cs[idx] = { ...c, portion: e.target.value }; onChange({ ...editing, customers: cs }) }} style={inputStyle()}>
                    {PORTIONS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Contact">
                  <select value={c.contact_preference} onChange={e => { const cs = [...(editing.customers ?? [])]; cs[idx] = { ...c, contact_preference: e.target.value }; onChange({ ...editing, customers: cs }) }} style={inputStyle()}>
                    {CONTACTS.map(p => <option key={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Contact Value">
                  <input value={c.contact_value} onChange={e => { const cs = [...(editing.customers ?? [])]; cs[idx] = { ...c, contact_value: e.target.value }; onChange({ ...editing, customers: cs }) }} style={inputStyle()} placeholder="email or phone" />
                </Field>
              </div>
              {(editing.customers ?? []).length > 1 && (
                <button onClick={() => onChange({ ...editing, customers: (editing.customers ?? []).filter((_, i) => i !== idx) })} style={{ ...smallBtn('rgba(180,60,60,0.2)', '#f08080'), marginTop: '0.5rem', fontSize: '0.75rem' }}>Remove customer</button>
              )}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', justifyContent: 'flex-end' }}>
          <button onClick={onClose} style={btnStyle('transparent', 'var(--tan)')}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={btnStyle('var(--med-brown)')}>{saving ? 'Saving…' : 'Save Appointment'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display: 'block', fontSize: '0.7rem', color: 'var(--light-brown)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.35rem' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle  = (): React.CSSProperties => ({ width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '3px', padding: '0.5rem 0.75rem', color: 'var(--cream)', fontSize: '0.88rem' })
const td          = (): React.CSSProperties => ({ padding: '0.75rem 1rem', color: 'var(--off-white)', verticalAlign: 'middle' })
const btnStyle    = (bg: string, color = 'var(--cream)'): React.CSSProperties => ({ background: bg, color, border: 'none', borderRadius: '3px', padding: '0.55rem 1.1rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer', letterSpacing: '0.04em' })
const smallBtn    = (bg = 'rgba(166,120,90,0.2)', color = 'var(--tan)'): React.CSSProperties => ({ background: bg, color, border: 'none', borderRadius: '3px', padding: '0.3rem 0.7rem', fontSize: '0.78rem', cursor: 'pointer' })
const navBtn      = (): React.CSSProperties => ({ background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.2)', color: 'var(--tan)', borderRadius: '3px', padding: '0.3rem 0.7rem', cursor: 'pointer', fontSize: '1rem' })
