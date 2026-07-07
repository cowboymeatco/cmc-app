'use client'
import { useEffect, useState, useRef } from 'react'
import Link from 'next/link'
import type { HarvestAppointment, AppointmentCustomer, Customer } from '@/lib/types'
import { isoDate, addDaysISO, dayOfWeekISO } from '@/lib/dates'
import { SPECIES_CLR, SPECIES_EMOJI } from '@/lib/cutSchedule'

const SPECIES  = ['Beef', 'Hog', 'Lamb', 'Goat']
const PORTIONS = ['Whole', 'Half', 'Quarter']
const CONTACTS = ['Email', 'Text Message', 'Phone Call']
const STATUSES = ['Booked', 'Confirmed', 'InstructionsReceived', 'AnimalIn', 'Processing', 'Complete']

const STATUS_LABELS: Record<string, string> = {
  Booked:               'Booked',
  Confirmed:            'Confirmed',
  InstructionsReceived: 'Instructions ✅',
  AnimalIn:             'Animal In',
  Processing:           'Processing',
  Complete:             'Complete',
}

const STATUS_COLORS: Record<string, string> = {
  Booked:               'rgba(201,168,130,0.2)',
  Confirmed:            'rgba(45,212,191,0.2)',
  InstructionsReceived: 'rgba(100,180,100,0.2)',
  AnimalIn:             'rgba(100,150,220,0.2)',
  Processing:           'rgba(220,160,50,0.2)',
  Complete:             'rgba(100,100,100,0.2)',
}

// Bright, high-contrast text colors for the Status dropdown. The open option
// list renders on the OS default (white on Windows), so we also paint a dark
// background on each option — that keeps these colors readable in BOTH the
// closed control (dark) and the open list.
const STATUS_TEXT: Record<string, string> = {
  Booked:               '#E8C9A0',
  Confirmed:            '#34E2CC',
  InstructionsReceived: '#74D86E',
  AnimalIn:             '#85B6F0',
  Processing:           '#F2BC4D',
  Complete:             '#C2C8D2',
}
const STATUS_OPT_BG = '#2a1d16'
function statusColor(s: string) { return STATUS_TEXT[s] ?? 'var(--cream)' }

function speciesColor(s: string) { return SPECIES_CLR[s] ?? '#9CA3AF' }

// Encode: full days use "FULL|{note}", closed days use plain reason text
function encodeBlock(type: 'closed' | 'full', note: string) {
  return type === 'full' ? `FULL|${note}` : note
}
function decodeBlock(reason: string): { type: 'full' | 'closed'; note: string } {
  if (reason.startsWith('FULL|')) return { type: 'full', note: reason.slice(5) }
  if (reason === 'FULL')          return { type: 'full', note: '' }
  return { type: 'closed', note: reason }
}

// Find the next weekday that isn't blocked or a federal holiday
function findNextOpen(blockedSet: Record<string, string>): string {
  let ds = addDaysISO(isoDate(), 1)
  for (let i = 0; i < 365; i++) {
    const dow = dayOfWeekISO(ds)
    if (dow !== 0 && dow !== 6 && !blockedSet[ds] && !HOLIDAYS[ds]) return ds
    ds = addDaysISO(ds, 1)
  }
  return isoDate()
}

function abbrevProducer(source: string): string {
  if (!source) return '?'
  const words = source.trim().split(/\s+/)
  if (words.length === 1) return words[0].slice(0, 11)
  if (words[0].length <= 7) return `${words[0]} ${words[1][0]}.`
  return words[0].slice(0, 11)
}

// ── USDA Federal Holidays ─────────────────────────────────────────────────────
function nthWd(y: number, m: number, nth: number, dow: number): number {
  let c = 0
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(y, m - 1, d)
    if (dt.getMonth() !== m - 1) break
    if (dt.getDay() === dow) { c++; if (c === nth) return d }
  }
  return 1
}
function lastWd(y: number, m: number, dow: number): number {
  let last = 1
  for (let d = 1; d <= 31; d++) {
    const dt = new Date(y, m - 1, d)
    if (dt.getMonth() !== m - 1) break
    if (dt.getDay() === dow) last = d
  }
  return last
}
function fmtD(y: number, m: number, d: number) {
  return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`
}
function buildHolidays(year: number): Record<string, string> {
  return {
    [fmtD(year,  1,  1)]:                       "New Year's Day",
    [fmtD(year,  1,  nthWd(year,1,3,1))]:        "MLK Jr. Day",
    [fmtD(year,  2,  nthWd(year,2,3,1))]:        "Presidents' Day",
    [fmtD(year,  5,  lastWd(year,5,1))]:         "Memorial Day",
    [fmtD(year,  6,  19)]:                       "Juneteenth",
    [fmtD(year,  7,  4)]:                        "Independence Day",
    [fmtD(year,  9,  nthWd(year,9,1,1))]:        "Labor Day",
    [fmtD(year, 10,  nthWd(year,10,2,1))]:       "Indigenous Peoples Day",
    [fmtD(year, 11, 11)]:                        "Veterans Day",
    [fmtD(year, 11,  nthWd(year,11,4,4))]:       "Thanksgiving",
    [fmtD(year, 12, 25)]:                        "Christmas Day",
  }
}
const HOLIDAYS: Record<string, string> = {
  ...buildHolidays(2024), ...buildHolidays(2025),
  ...buildHolidays(2026), ...buildHolidays(2027),
}

// ── Calendar helpers ──────────────────────────────────────────────────────────
function startOfMonth(y: number, m: number) { return new Date(y, m, 1) }
function daysInMonth(y: number, m: number)  { return new Date(y, m + 1, 0).getDate() }
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December']
const DAY_NAMES   = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat']

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
function blankAppt(date?: string): Partial<HarvestAppointment> {
  return { harvest_date: date ?? isoDate(), species: 'Beef', head_count: 1, source: '', notes: '', status: 'Booked', linked_carcass_id: '', customers: [blankCustomer()] }
}

interface BlockedDate { date: string; reason: string }

// ── Main Page ─────────────────────────────────────────────────────────────────
export default function SchedulePage() {
  const [appointments, setAppointments] = useState<HarvestAppointment[]>([])
  const [blocked,      setBlocked]      = useState<BlockedDate[]>([])
  const [loading,      setLoading]      = useState(true)
  const [showForm,     setShowForm]     = useState(false)
  const [editing,      setEditing]      = useState<Partial<HarvestAppointment> | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [filter,       setFilter]       = useState<'upcoming'|'complete'|'all'>('upcoming')
  const [view,         setView]         = useState<'list'|'calendar'>('calendar')
  const [calYear,      setCalYear]      = useState(new Date().getFullYear())
  const [calMonth,     setCalMonth]     = useState(new Date().getMonth())
  const [selectedDay,  setSelectedDay]  = useState<string | null>(null)
  const [capacity,     setCapacity]     = useState<{ days_on_hand: number; max_cooler_days: number; available_eq: number; settings: { hogs_per_beef: number; lambs_per_beef: number } } | null>(null)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const [decliningId,  setDecliningId]  = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/capacity').then(r => r.json()).then(d => setCapacity(d)).catch(() => {})
  }, [])

  async function load() {
    setLoading(true)
    const [aRes, bRes] = await Promise.all([
      fetch('/api/appointments'),
      fetch('/api/schedule/blocked'),
    ])
    const aData = await aRes.json()
    const bData = await bRes.json()
    setAppointments(Array.isArray(aData) ? aData : [])
    setBlocked(Array.isArray(bData) ? bData : [])
    setLoading(false)
  }

  useEffect(() => { load() }, [])

  // Separate pending requests from regular appointments
  const pendingRequests = appointments
    .filter(a => a.status === 'PendingRequest')
    .sort((a, b) => a.harvest_date.localeCompare(b.harvest_date))

  const filtered = appointments
    .filter(a => {
      if (a.status === 'PendingRequest') return false   // handled separately above
      if (filter === 'upcoming') return a.status !== 'Complete'
      if (filter === 'complete') return a.status === 'Complete'
      return true
    })
    .sort((a, b) => a.harvest_date.localeCompare(b.harvest_date))

  const needInstruct = appointments.filter(a => a.status !== 'Complete' && a.status !== 'PendingRequest' && a.customers?.some(c => !c.linked_cutting_instruction_id)).length
  const readyCount   = appointments.filter(a => a.status !== 'Complete' && a.status !== 'PendingRequest' && a.customers?.every(c => !!c.linked_cutting_instruction_id)).length

  async function save() {
    if (!editing) return
    setSaving(true)
    const method = editing.id ? 'PATCH' : 'POST'
    await fetch('/api/appointments', { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(editing) })
    setSaving(false); setShowForm(false); setEditing(null); load()
  }

  async function deleteAppt(id: string) {
    if (!confirm('Delete this appointment?')) return
    await fetch(`/api/appointments?id=${id}`, { method: 'DELETE' })
    load()
  }

  async function confirmRequest(id: string) {
    setConfirmingId(id)
    await fetch('/api/appointments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'Booked' }),
    })
    setConfirmingId(null)
    load()
  }

  async function declineRequest(id: string, source: string) {
    if (!confirm(`Decline the request from ${source || 'this customer'}? This will delete it.`)) return
    setDecliningId(id)
    await fetch(`/api/appointments?id=${id}`, { method: 'DELETE' })
    setDecliningId(null)
    load()
  }

  async function blockDate(date: string, reason: string) {
    await fetch('/api/schedule/blocked', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ date, reason }) })
    load()
  }

  async function unblockDate(date: string) {
    await fetch(`/api/schedule/blocked?date=${date}`, { method: 'DELETE' })
    load()
  }

  function openNew(date?: string) {
    setEditing(blankAppt(date))
    setShowForm(true)
  }
  function openEdit(a: HarvestAppointment) {
    setEditing({ ...a, customers: a.customers ? [...a.customers] : [blankCustomer()] })
    setShowForm(true)
  }

  const apptByDate: Record<string, HarvestAppointment[]> = {}
  for (const a of appointments) {
    if (!apptByDate[a.harvest_date]) apptByDate[a.harvest_date] = []
    apptByDate[a.harvest_date].push(a)
  }

  const blockedSet: Record<string, string> = {}
  for (const b of blocked) blockedSet[b.date] = b.reason

  const dayAppts   = selectedDay ? (apptByDate[selectedDay] ?? []) : []
  const dayBlocked = selectedDay ? blockedSet[selectedDay] : undefined

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', paddingBottom: '4rem' }}>

      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.5rem', height: '64px', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: 'var(--tan)', textDecoration: 'none', fontSize: '0.85rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <h1 style={{ margin: 0, fontSize: '1.05rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>📅 Harvest Schedule</h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1.5rem', fontSize: '0.8rem' }}>
          {needInstruct > 0 && <span style={{ color: '#f0c040' }}>⚠ {needInstruct} need instructions</span>}
          {readyCount   > 0 && <span style={{ color: '#6dbf6d' }}>✅ {readyCount} ready</span>}
        </div>
      </header>

      {/* Species legend */}
      <div style={{ background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid rgba(166,120,90,0.12)', padding: '0.4rem 1.5rem', display: 'flex', gap: '1.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        {SPECIES.map(s => (
          <span key={s} style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: 'var(--cream)' }}>
            <span style={{ width: 10, height: 10, borderRadius: '50%', background: speciesColor(s), display: 'inline-block' }} />
            {s}
          </span>
        ))}
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#9CA3AF' }}>
          <span style={{ width: 10, height: 10, borderRadius: '2px', background: 'rgba(200,50,50,0.4)', border: '1px solid rgba(200,50,50,0.6)', display: 'inline-block' }} />
          USDA Holiday
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#9CA3AF' }}>
          <span style={{ width: 10, height: 10, borderRadius: '2px', background: 'repeating-linear-gradient(45deg,rgba(120,120,120,0.4) 0px,rgba(120,120,120,0.4) 2px,transparent 2px,transparent 6px)', border: '1px solid rgba(150,150,150,0.3)', display: 'inline-block' }} />
          Closed
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.75rem', color: '#D97706' }}>
          <span style={{ width: 10, height: 10, borderRadius: '2px', background: 'rgba(217,119,6,0.35)', border: '1px solid rgba(217,119,6,0.6)', display: 'inline-block' }} />
          Full
        </span>
      </div>

      <div style={{ maxWidth: '1300px', margin: '0 auto', padding: '1.25rem 1.5rem' }}>

        {/* Capacity mini-banner */}
        {capacity && (() => {
          const ratio = capacity.days_on_hand / capacity.max_cooler_days
          const clr   = ratio >= 1 ? '#EF4444' : ratio >= 0.75 ? '#F59E0B' : '#4CAF50'
          const pct   = Math.min(100, ratio * 100)
          const avail = capacity.available_eq
          return (
            <Link href="/capacity" style={{ textDecoration: 'none', display: 'block', marginBottom: '1rem' }}>
              <div style={{ background: 'var(--dark)', border: `1px solid ${clr}33`, borderRadius: 4, padding: '0.65rem 1.1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ fontSize: '0.7rem', color: 'rgba(166,120,90,0.6)', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>Cooler Load</span>
                {/* Mini gauge */}
                <div style={{ flex: '0 0 140px', height: 10, background: 'rgba(255,255,255,0.06)', borderRadius: 99, overflow: 'hidden' }}>
                  <div style={{ height: '100%', width: `${pct}%`, background: clr, borderRadius: 99, transition: 'width 0.4s' }} />
                </div>
                <span style={{ fontSize: '0.85rem', fontWeight: 700, color: clr, flexShrink: 0 }}>
                  {capacity.days_on_hand.toFixed(1)} / {capacity.max_cooler_days} days
                </span>
                {avail > 0 ? (
                  <span style={{ fontSize: '0.78rem', color: 'rgba(166,120,90,0.6)', marginLeft: '0.25rem' }}>
                    · Can book: {Math.floor(avail)} more Beef · {Math.floor(avail * capacity.settings.hogs_per_beef)} Hog · {Math.floor(avail * capacity.settings.lambs_per_beef)} Lamb
                  </span>
                ) : (
                  <span style={{ fontSize: '0.78rem', color: '#EF4444', marginLeft: '0.25rem', fontWeight: 600 }}>⚠ At capacity — process before booking more</span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'rgba(166,120,90,0.45)', flexShrink: 0 }}>View details →</span>
              </div>
            </Link>
          )
        })()}

        {/* ── Pending Requests Inbox ── */}
        {pendingRequests.length > 0 && (
          <div style={{ marginBottom: '1.25rem', background: 'rgba(232,136,58,0.06)', border: '1px solid rgba(232,136,58,0.3)', borderRadius: 6, overflow: 'hidden' }}>
            <div style={{ background: 'rgba(232,136,58,0.12)', borderBottom: '1px solid rgba(232,136,58,0.25)', padding: '0.6rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <span style={{ fontSize: '1rem' }}>📬</span>
              <span style={{ color: '#E8883A', fontWeight: 700, fontSize: '0.85rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Booking Requests
              </span>
              <span style={{ background: '#E8883A', color: '#1A0A04', borderRadius: 99, fontSize: '0.72rem', fontWeight: 700, padding: '1px 8px' }}>
                {pendingRequests.length}
              </span>
              <span style={{ marginLeft: 'auto', fontSize: '0.72rem', color: 'rgba(166,120,90,0.6)' }}>
                Confirm to add to schedule · Decline to remove
              </span>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
              {pendingRequests.map((req, idx) => {
                const d = new Date(req.harvest_date + 'T12:00:00')
                const weekLabel = d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                const isConfirming = confirmingId === req.id
                const isDeclining  = decliningId  === req.id
                // Parse contact info from notes
                const lines   = (req.notes ?? '').split('\n')
                const phone   = lines.find(l => l.startsWith('Phone:'))?.replace('Phone:', '').trim() ?? ''
                const email   = lines.find(l => l.startsWith('Email:'))?.replace('Email:', '').trim() ?? ''
                const noteText = lines.filter(l => !l.startsWith('Phone:') && !l.startsWith('Email:')).join(' ').trim()
                return (
                  <div key={req.id} style={{
                    display: 'flex', alignItems: 'center', gap: '1rem',
                    padding: '0.75rem 1.1rem',
                    borderTop: idx > 0 ? '1px solid rgba(166,120,90,0.12)' : 'none',
                    flexWrap: 'wrap',
                  }}>
                    <span style={{ fontSize: '1.1rem' }}>
                      {SPECIES_EMOJI[req.species] ?? '🐄'}
                    </span>
                    <div style={{ flex: 1, minWidth: 200 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}>
                        <span style={{ color: 'var(--cream)', fontWeight: 600, fontSize: '0.9rem' }}>
                          {req.source || 'Unknown'}
                        </span>
                        <span style={{ color: 'var(--tan)', fontSize: '0.82rem' }}>
                          {req.head_count} {req.species} · week of {weekLabel}
                        </span>
                      </div>
                      <div style={{ fontSize: '0.78rem', color: 'rgba(166,120,90,0.7)', marginTop: '0.15rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                        {phone && <span>📞 {phone}</span>}
                        {email && <span>✉ {email}</span>}
                        {noteText && <span>💬 {noteText}</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: '0.5rem', flexShrink: 0 }}>
                      <button
                        onClick={() => confirmRequest(req.id)}
                        disabled={isConfirming || isDeclining}
                        style={{ background: '#4CAF50', color: '#1A0A04', border: 'none', borderRadius: 3, padding: '0.4rem 0.9rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer' }}
                      >
                        {isConfirming ? '…' : '✓ Confirm'}
                      </button>
                      <button
                        onClick={() => declineRequest(req.id, req.source ?? '')}
                        disabled={isConfirming || isDeclining}
                        style={{ background: 'rgba(239,68,68,0.15)', color: '#fca5a5', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 3, padding: '0.4rem 0.9rem', fontSize: '0.82rem', fontWeight: 600, cursor: 'pointer' }}
                      >
                        {isDeclining ? '…' : 'Decline'}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.75rem', marginBottom: '1.25rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={() => openNew()} style={btnStyle('var(--med-brown)')}>+ New Appointment</button>

          <div style={{ display: 'flex', border: '1px solid rgba(166,120,90,0.3)', borderRadius: '3px', overflow: 'hidden' }}>
            <button onClick={() => setView('calendar')} style={{ ...btnStyle(view==='calendar' ? 'var(--med-brown)':'transparent', view==='calendar' ? 'var(--cream)':'var(--tan)'), borderRadius:0, padding:'0.45rem 1rem' }}>📅 Calendar</button>
            <button onClick={() => setView('list')}     style={{ ...btnStyle(view==='list'     ? 'var(--med-brown)':'transparent', view==='list'     ? 'var(--cream)':'var(--tan)'), borderRadius:0, padding:'0.45rem 1rem', borderLeft:'1px solid rgba(166,120,90,0.3)' }}>☰ List</button>
          </div>

          {view === 'list' && (['upcoming','complete','all'] as const).map(f => (
            <button key={f} onClick={() => setFilter(f)} style={btnStyle(filter===f ? 'var(--light-brown)':'rgba(166,120,90,0.15)', filter===f ? 'var(--dark)':'var(--tan)')}>
              {f.charAt(0).toUpperCase()+f.slice(1)}
            </button>
          ))}

          {view === 'calendar' && (
            <button onClick={() => {
              const ds = findNextOpen(blockedSet)
              const dt = new Date(ds + 'T12:00:00')
              setCalYear(dt.getFullYear())
              setCalMonth(dt.getMonth())
              setSelectedDay(ds)
            }} style={{ ...btnStyle('rgba(76,175,80,0.15)', '#4CAF50'), border: '1px solid rgba(76,175,80,0.3)' }}>
              → Next Open
            </button>
          )}
          <button onClick={load} style={{ ...btnStyle('transparent','var(--tan)'), marginLeft:'auto', border:'1px solid rgba(166,120,90,0.3)' }}>↺ Refresh</button>
        </div>

        {loading ? (
          <p style={{ color: 'var(--tan)', textAlign: 'center', padding: '3rem' }}>Loading…</p>
        ) : view === 'calendar' ? (
          <CalendarView
            year={calYear} month={calMonth}
            apptByDate={apptByDate} blockedSet={blockedSet}
            selectedDay={selectedDay}
            onPrev={() => { if (calMonth===0){setCalYear(y=>y-1);setCalMonth(11)}else setCalMonth(m=>m-1) }}
            onNext={() => { if (calMonth===11){setCalYear(y=>y+1);setCalMonth(0)}else setCalMonth(m=>m+1) }}
            onToday={() => { setCalYear(new Date().getFullYear()); setCalMonth(new Date().getMonth()) }}
            onSelectDay={d => setSelectedDay(prev => prev===d ? null : d)}
            onNewOnDay={d => openNew(d)}
            dayAppts={dayAppts}
            dayBlocked={dayBlocked}
            onEdit={openEdit} onDelete={deleteAppt}
            onBlock={blockDate} onUnblock={unblockDate}
          />
        ) : (
          <ListView filtered={filtered} onEdit={openEdit} onDelete={deleteAppt} onNew={() => openNew()} />
        )}
      </div>

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

function CalendarView({
  year, month, apptByDate, blockedSet, selectedDay,
  onPrev, onNext, onToday, onSelectDay, onNewOnDay,
  dayAppts, dayBlocked, onEdit, onDelete, onBlock, onUnblock,
}: {
  year: number; month: number
  apptByDate:  Record<string, HarvestAppointment[]>
  blockedSet:  Record<string, string>
  selectedDay: string | null
  onPrev: () => void; onNext: () => void; onToday: () => void
  onSelectDay:  (d: string) => void
  onNewOnDay:   (d: string) => void
  dayAppts:    HarvestAppointment[]
  dayBlocked:  string | undefined
  onEdit:      (a: HarvestAppointment) => void
  onDelete:    (id: string) => void
  onBlock:     (date: string, reason: string) => void
  onUnblock:   (date: string) => void
}) {
  const today    = isoDate()
  const firstDow = startOfMonth(year, month).getDay()
  const numDays  = daysInMonth(year, month)
  const cells: (number|null)[] = [...Array(firstDow).fill(null), ...Array.from({length: numDays}, (_,i)=>i+1)]
  while (cells.length % 7 !== 0) cells.push(null)
  const [blockReason, setBlockReason] = useState('')
  const [blockType,   setBlockType]   = useState<'closed' | 'full'>('closed')

  function dateStr(day: number) {
    return `${year}-${String(month+1).padStart(2,'0')}-${String(day).padStart(2,'0')}`
  }

  // Monthly species totals for the header
  const monthTotals: Record<string, number> = {}
  for (const [date, appts] of Object.entries(apptByDate)) {
    if (!date.startsWith(`${year}-${String(month+1).padStart(2,'0')}`)) continue
    for (const a of appts) {
      monthTotals[a.species] = (monthTotals[a.species] ?? 0) + (a.head_count ?? 1)
    }
  }

  return (
    <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>

      {/* Calendar grid */}
      <div style={{ flex: '1 1 600px', background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: '4px', overflow: 'hidden' }}>

        {/* Month nav */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.9rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
          <button onClick={onPrev} style={navBtn()}>‹</button>
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.15rem', fontWeight: 700, color: 'var(--cream)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              {MONTH_NAMES[month]} {year}
            </div>
            {/* Monthly species counts */}
            {Object.keys(monthTotals).length > 0 && (
              <div style={{ display: 'flex', gap: '0.75rem', justifyContent: 'center', marginTop: '0.3rem', flexWrap: 'wrap' }}>
                {SPECIES.filter(s => monthTotals[s]).map(s => (
                  <span key={s} style={{ fontSize: '0.7rem', color: speciesColor(s), fontWeight: 600 }}>
                    {SPECIES_EMOJI[s]} {monthTotals[s]} {s}
                  </span>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button onClick={onToday} style={{ ...navBtn(), fontSize: '0.7rem', padding: '0.3rem 0.7rem' }}>Today</button>
            <button onClick={onNext} style={navBtn()}>›</button>
          </div>
        </div>

        {/* Day-of-week headers */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', background: 'rgba(0,0,0,0.3)' }}>
          {DAY_NAMES.map(d => (
            <div key={d} style={{ textAlign: 'center', padding: '0.45rem', fontSize: '0.68rem', color: 'var(--light-brown)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>{d}</div>
          ))}
        </div>

        {/* Week cells */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>
          {cells.map((day, i) => {
            if (!day) return <div key={`e${i}`} style={{ minHeight: '95px', borderRight: '1px solid rgba(166,120,90,0.08)', borderBottom: '1px solid rgba(166,120,90,0.08)', background: 'rgba(0,0,0,0.15)' }} />

            const ds         = dateStr(day)
            const appts      = apptByDate[ds] ?? []
            const isToday    = ds === today
            const isSel      = ds === selectedDay
            const isHoliday  = !!HOLIDAYS[ds]
            const isBlocked  = !!blockedSet[ds]
            const blockInfo  = isBlocked ? decodeBlock(blockedSet[ds]) : null
            const isFull     = blockInfo?.type === 'full'
            const isClosed   = isBlocked && !isFull

            // Species counts for this day
            const dayCounts: Record<string, number> = {}
            for (const a of appts) dayCounts[a.species] = (dayCounts[a.species] ?? 0) + (a.head_count ?? 1)

            const baseBg = isSel ? 'rgba(117,71,27,0.4)' : isToday ? 'rgba(117,71,27,0.18)' : 'transparent'
            const cellBg = isFull
              ? `linear-gradient(rgba(217,119,6,0.18),rgba(217,119,6,0.18)),${baseBg}`
              : isClosed
              ? `repeating-linear-gradient(45deg,rgba(80,80,80,0.25) 0px,rgba(80,80,80,0.25) 3px,${baseBg} 3px,${baseBg} 9px)`
              : isHoliday
              ? `linear-gradient(rgba(200,50,50,0.08),rgba(200,50,50,0.08)),${baseBg}`
              : baseBg

            return (
              <div key={ds} onClick={() => onSelectDay(ds)} style={{
                minHeight: '95px', padding: '0.35rem 0.4rem',
                borderRight: '1px solid rgba(166,120,90,0.08)',
                borderBottom: '1px solid rgba(166,120,90,0.08)',
                cursor: 'pointer', position: 'relative', transition: 'background 0.15s',
                background: cellBg,
              }}>
                {/* Date number */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.2rem' }}>
                  <span style={{ fontSize: '0.78rem', fontWeight: isToday ? 700 : 400, color: isToday ? 'var(--tan)' : 'var(--off-white)' }}>
                    {isToday
                      ? <span style={{ background: 'var(--med-brown)', borderRadius: '50%', width: '20px', height: '20px', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>{day}</span>
                      : day}
                  </span>
                  {isHoliday && (
                    <span title={HOLIDAYS[ds]} style={{ fontSize: '0.58rem', background: 'rgba(200,50,50,0.35)', color: '#fca5a5', borderRadius: '2px', padding: '0 3px', lineHeight: '14px', cursor: 'help' }}>
                      USDA
                    </span>
                  )}
                </div>

                {/* Blocked label */}
                {isFull && (
                  <div style={{ fontSize: '0.58rem', color: '#D97706', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem', fontWeight: 700 }}>
                    Full
                  </div>
                )}
                {isClosed && (
                  <div style={{ fontSize: '0.58rem', color: '#9CA3AF', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>
                    Closed
                  </div>
                )}

                {/* Species count badges */}
                {Object.keys(dayCounts).length > 0 && (
                  <div style={{ display: 'flex', gap: '0.25rem', flexWrap: 'wrap', marginBottom: '0.25rem' }}>
                    {SPECIES.filter(s => dayCounts[s]).map(s => (
                      <span key={s} style={{ fontSize: '0.6rem', background: `${speciesColor(s)}22`, border: `1px solid ${speciesColor(s)}66`, color: speciesColor(s), borderRadius: '3px', padding: '0 4px', lineHeight: '14px', fontWeight: 700 }}>
                        {dayCounts[s]}×{s[0]}
                      </span>
                    ))}
                  </div>
                )}

                {/* Appointment pills — producer name colored by species */}
                {appts.slice(0, 3).map(a => (
                  <div key={a.id} style={{
                    fontSize: '0.67rem',
                    background: `${speciesColor(a.species)}22`,
                    borderLeft: `2px solid ${speciesColor(a.species)}`,
                    padding: '0.12rem 0.3rem', marginBottom: '0.18rem',
                    borderRadius: '2px', color: 'var(--cream)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                  }}>
                    {abbrevProducer(a.source || a.customers?.[0]?.customer_name || '')}
                    {a.head_count > 1 ? ` ×${a.head_count}` : ''}
                  </div>
                ))}
                {appts.length > 3 && <div style={{ fontSize: '0.62rem', color: 'var(--tan)' }}>+{appts.length - 3} more</div>}

                {/* Quick-add */}
                {appts.length === 0 && !isBlocked && (
                  <button onClick={e => { e.stopPropagation(); onNewOnDay(ds) }} title="Add appointment"
                    style={{ position: 'absolute', bottom: '4px', right: '4px', background: 'transparent', border: 'none', color: 'rgba(166,120,90,0.35)', fontSize: '1rem', cursor: 'pointer', lineHeight: 1, padding: '2px' }}>
                    +
                  </button>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Day detail panel */}
      <div style={{ flex: '0 0 300px', background: 'var(--dark)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: '4px', overflow: 'hidden' }}>
        {selectedDay ? (
          <>
            {/* Panel header */}
            <div style={{ padding: '0.9rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.3rem' }}>
                <span style={{ fontFamily: 'Georgia, serif', fontSize: '0.9rem', fontWeight: 700, color: 'var(--cream)' }}>
                  {new Date(selectedDay + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
                </span>
                <button onClick={() => onNewOnDay(selectedDay)} style={btnStyle('var(--med-brown)','var(--cream)')}>+ Add</button>
              </div>

              {/* USDA holiday notice */}
              {HOLIDAYS[selectedDay] && (
                <div style={{ fontSize: '0.75rem', color: '#fca5a5', background: 'rgba(200,50,50,0.15)', border: '1px solid rgba(200,50,50,0.3)', borderRadius: '3px', padding: '0.3rem 0.6rem', marginBottom: '0.4rem' }}>
                  🚫 USDA Holiday: {HOLIDAYS[selectedDay]}
                </div>
              )}

              {/* Species totals for day */}
              {dayAppts.length > 0 && (
                <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '0.4rem' }}>
                  {SPECIES.filter(s => dayAppts.some(a => a.species === s)).map(s => {
                    const total = dayAppts.filter(a => a.species === s).reduce((n, a) => n + (a.head_count ?? 1), 0)
                    return (
                      <span key={s} style={{ fontSize: '0.75rem', color: speciesColor(s), fontWeight: 700 }}>
                        {SPECIES_EMOJI[s]} {total} {s}
                      </span>
                    )
                  })}
                </div>
              )}

              {/* Block / Unblock */}
              {dayBlocked !== undefined ? (() => {
                const info = decodeBlock(dayBlocked)
                return (
                  <div>
                    <div style={{ fontSize: '0.75rem', marginBottom: '0.4rem',
                      color: info.type === 'full' ? '#D97706' : '#9CA3AF' }}>
                      {info.type === 'full' ? '⚠ Full' : '🔒 Closed'}
                      {info.note ? `: ${info.note}` : ''}
                    </div>
                    <button onClick={() => onUnblock(selectedDay)} style={{ ...btnStyle('rgba(100,100,100,0.3)','#9CA3AF'), fontSize: '0.75rem', padding: '0.3rem 0.7rem' }}>
                      ✓ Mark Available
                    </button>
                  </div>
                )
              })() : (
                <div>
                  <div style={{ display: 'flex', gap: '0.25rem', marginBottom: '0.4rem' }}>
                    {(['closed', 'full'] as const).map(t => (
                      <button key={t} onClick={() => setBlockType(t)} style={{
                        background: blockType === t ? (t === 'full' ? 'rgba(217,119,6,0.3)' : 'rgba(100,100,100,0.3)') : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${blockType === t ? (t === 'full' ? 'rgba(217,119,6,0.5)' : 'rgba(150,150,150,0.4)') : 'rgba(166,120,90,0.2)'}`,
                        color: blockType === t ? (t === 'full' ? '#D97706' : '#9CA3AF') : 'var(--tan)',
                        borderRadius: '3px', padding: '0.25rem 0.65rem', fontSize: '0.73rem', cursor: 'pointer', fontWeight: blockType === t ? 700 : 400,
                      }}>
                        {t === 'closed' ? '🔒 Closed' : '⚠ Full'}
                      </button>
                    ))}
                  </div>
                  <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center' }}>
                    <input
                      value={blockReason} onChange={e => setBlockReason(e.target.value)}
                      placeholder="Note (optional)"
                      style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: '3px', padding: '0.3rem 0.5rem', color: 'var(--cream)', fontSize: '0.75rem' }}
                    />
                    <button onClick={() => { onBlock(selectedDay, encodeBlock(blockType, blockReason)); setBlockReason('') }}
                      style={{ ...btnStyle(blockType === 'full' ? 'rgba(217,119,6,0.25)' : 'rgba(180,60,60,0.3)', blockType === 'full' ? '#D97706' : '#fca5a5'), fontSize: '0.75rem', padding: '0.3rem 0.6rem', whiteSpace: 'nowrap' }}>
                      Mark
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Appointment cards */}
            {dayAppts.length === 0 ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: 'var(--tan)', fontSize: '0.85rem' }}>No appointments this day</div>
            ) : (
              <div style={{ padding: '0.75rem', maxHeight: '60vh', overflowY: 'auto' }}>
                {dayAppts.map(a => (
                  <div key={a.id} style={{ background: `${speciesColor(a.species)}11`, border: `1px solid ${speciesColor(a.species)}44`, borderRadius: '4px', padding: '0.75rem', marginBottom: '0.5rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                      <div>
                        <span style={{ fontWeight: 700, color: speciesColor(a.species), fontSize: '0.88rem' }}>{a.species}</span>
                        <span style={{ color: 'var(--cream)', fontSize: '0.88rem' }}> · {a.head_count} head</span>
                      </div>
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <button onClick={() => onEdit(a)} style={smallBtn()}>✎</button>
                        <button onClick={() => onDelete(a.id)} style={smallBtn('rgba(180,60,60,0.3)','#f08080')}>✕</button>
                      </div>
                    </div>
                    {a.source && <div style={{ fontSize: '0.75rem', color: 'var(--tan)', marginBottom: '0.25rem' }}>📍 {a.source}</div>}
                    {a.customers?.map(c => (
                      <div key={c.id} style={{ fontSize: '0.75rem', color: 'var(--off-white)', display: 'flex', justifyContent: 'space-between' }}>
                        <span>{c.customer_name} <span style={{ color: 'var(--tan)' }}>({c.portion})</span></span>
                        <span>{c.linked_cutting_instruction_id ? <span style={{ color: '#6dbf6d' }}>✅</span> : <span style={{ color: '#f0c040' }}>⚠</span>}</span>
                      </div>
                    ))}
                    <div style={{ marginTop: '0.4rem' }}>
                      <span style={{ fontSize: '0.68rem', padding: '0.12rem 0.45rem', borderRadius: '3px', background: 'rgba(0,0,0,0.3)', color: 'var(--cream)' }}>
                        {STATUS_LABELS[a.status] ?? a.status}
                      </span>
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

function ListView({ filtered, onEdit, onDelete, onNew }: {
  filtered: HarvestAppointment[]
  onEdit:   (a: HarvestAppointment) => void
  onDelete: (id: string) => void
  onNew:    () => void
}) {
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
            {['Harvest Date','Species','Head','Producer / Source','Customer(s)','Status','Instructions','Days Out',''].map(h => (
              <th key={h} style={{ padding: '0.75rem 1rem', textAlign: 'left', color: 'var(--light-brown)', fontSize: '0.68rem', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600, whiteSpace: 'nowrap' }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {filtered.map((a, i) => {
            const allReady = a.customers?.every(c => !!c.linked_cutting_instruction_id)
            const someNeed = a.customers?.some(c => !c.linked_cutting_instruction_id)
            return (
              <tr key={a.id} style={{ borderTop: i>0 ? '1px solid rgba(166,120,90,0.1)' : undefined, background: STATUS_COLORS[a.status] ?? 'transparent' }}>
                <td style={td()}>{new Date(a.harvest_date+'T12:00:00').toLocaleDateString('en-US',{month:'short',day:'numeric',year:'numeric'})}</td>
                <td style={td()}><span style={{ color: speciesColor(a.species), fontWeight: 700 }}>{SPECIES_EMOJI[a.species] ?? ''} {a.species}</span></td>
                <td style={td()}>{a.head_count}</td>
                <td style={td()}>{a.source || '—'}</td>
                <td style={td()}>{a.customers?.map(c=>`${c.customer_name}${c.portion!=='Whole'?` (${c.portion})`:''}`).join(', ') || '—'}</td>
                <td style={td()}><span style={{ padding:'0.2rem 0.55rem', borderRadius:'3px', fontSize:'0.73rem', background:'rgba(0,0,0,0.3)', color:'var(--cream)' }}>{STATUS_LABELS[a.status]??a.status}</span></td>
                <td style={td()}>{allReady ? <span style={{ color:'#6dbf6d' }}>✅ Ready</span> : someNeed ? <span style={{ color:'#f0c040' }}>⚠ Needed</span> : '—'}</td>
                <td style={td()}>{daysOut(a.harvest_date)}</td>
                <td style={{ ...td(), whiteSpace:'nowrap' }}>
                  <button onClick={() => onEdit(a)} style={{ ...smallBtn(), marginRight:'0.4rem' }}>✎ Edit</button>
                  <button onClick={() => onDelete(a.id)} style={smallBtn('rgba(180,60,60,0.3)','#f08080')}>✕</button>
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
  editing:  Partial<HarvestAppointment>
  saving:   boolean
  onChange: (a: Partial<HarvestAppointment>) => void
  onSave:   () => void
  onClose:  () => void
}) {
  return (
    <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.7)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:50, padding:'1rem' }} onClick={onClose}>
      <div style={{ background:'var(--dark)', border:'1px solid rgba(166,120,90,0.3)', borderRadius:'6px', padding:'2rem', width:'100%', maxWidth:'640px', maxHeight:'90vh', overflowY:'auto' }} onClick={e=>e.stopPropagation()}>
        <h2 style={{ margin:'0 0 1.5rem', color:'var(--cream)', fontSize:'1.1rem', textTransform:'uppercase', letterSpacing:'0.08em' }}>
          {editing.id ? 'Edit Appointment' : 'New Appointment'}
        </h2>

        <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'1rem', marginBottom:'1rem' }}>
          <Field label="Harvest Date">
            <input type="date" value={editing.harvest_date??''} onChange={e=>onChange({...editing,harvest_date:e.target.value})} style={inputStyle()} />
          </Field>
          <Field label="Species">
            <select value={editing.species??'Beef'} onChange={e=>onChange({...editing,species:e.target.value as any})} style={{ ...inputStyle(), color: speciesColor(editing.species??'') }}>
              {SPECIES.map(s=><option key={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Head Count">
            <input type="number" min={1} value={editing.head_count??1} onChange={e=>onChange({...editing,head_count:parseInt(e.target.value)})} style={inputStyle()} />
          </Field>
          <Field label="Status">
            <select value={editing.status??'Booked'} onChange={e=>onChange({...editing,status:e.target.value as any})} style={{ ...inputStyle(), color: statusColor(editing.status??'Booked'), fontWeight: 600 }}>
              {STATUSES.map(s=><option key={s} value={s} style={{ color: statusColor(s), background: STATUS_OPT_BG, fontWeight: 600 }}>{STATUS_LABELS[s]}</option>)}
            </select>
          </Field>
        </div>

        <Field label="Source / Ranch / Producer">
          <input value={editing.source??''} onChange={e=>onChange({...editing,source:e.target.value})} style={inputStyle()} placeholder="Ranch or producer name (shown on calendar)" />
        </Field>
        <div style={{height:'0.75rem'}}/>
        <Field label="Notes">
          <textarea value={editing.notes??''} onChange={e=>onChange({...editing,notes:e.target.value})} style={{...inputStyle(),minHeight:'70px',resize:'vertical'}} />
        </Field>

        {/* Customers */}
        <div style={{ marginTop:'1.5rem' }}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:'0.75rem' }}>
            <span style={{ color:'var(--light-brown)', fontSize:'0.73rem', letterSpacing:'0.12em', textTransform:'uppercase' }}>Customers</span>
            <button onClick={()=>onChange({...editing,customers:[...(editing.customers??[]),blankCustomer()]})} style={smallBtn()}>+ Add</button>
          </div>
          {(editing.customers??[]).map((c,idx)=>(
            <div key={c.id} style={{ background:'rgba(255,255,255,0.04)', border:'1px solid rgba(166,120,90,0.15)', borderRadius:'4px', padding:'1rem', marginBottom:'0.75rem' }}>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:'0.75rem' }}>
                <Field label="Name">
                  <CustomerNameInput
                    customer={c}
                    onChange={updates=>{const cs=[...(editing.customers??[])];cs[idx]={...c,...updates};onChange({...editing,customers:cs})}}
                  />
                </Field>
                <Field label="Portion">
                  <select value={c.portion} onChange={e=>{const cs=[...(editing.customers??[])];cs[idx]={...c,portion:e.target.value};onChange({...editing,customers:cs})}} style={inputStyle()}>
                    {PORTIONS.map(p=><option key={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Contact">
                  <select value={c.contact_preference} onChange={e=>{const cs=[...(editing.customers??[])];cs[idx]={...c,contact_preference:e.target.value};onChange({...editing,customers:cs})}} style={inputStyle()}>
                    {CONTACTS.map(p=><option key={p}>{p}</option>)}
                  </select>
                </Field>
                <Field label="Contact Value">
                  <input value={c.contact_value} onChange={e=>{const cs=[...(editing.customers??[])];cs[idx]={...c,contact_value:e.target.value};onChange({...editing,customers:cs})}} style={inputStyle()} placeholder="email or phone" />
                </Field>
              </div>
              {(editing.customers??[]).length > 1 && (
                <button onClick={()=>onChange({...editing,customers:(editing.customers??[]).filter((_,i)=>i!==idx)})} style={{...smallBtn('rgba(180,60,60,0.2)','#f08080'),marginTop:'0.5rem',fontSize:'0.75rem'}}>Remove customer</button>
              )}
            </div>
          ))}
        </div>

        <div style={{ display:'flex', gap:'0.75rem', marginTop:'1.5rem', justifyContent:'flex-end' }}>
          <button onClick={onClose} style={btnStyle('transparent','var(--tan)')}>Cancel</button>
          <button onClick={onSave} disabled={saving} style={btnStyle('var(--med-brown)')}>{saving?'Saving…':'Save Appointment'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Customer name autocomplete ────────────────────────────────────────────────
function CustomerNameInput({
  customer, onChange,
}: {
  customer: AppointmentCustomer
  onChange: (updated: Partial<AppointmentCustomer>) => void
}) {
  const [suggestions, setSuggestions] = useState<Customer[]>([])
  const [open,        setOpen]        = useState(false)
  const [timer,       setTimer]       = useState<ReturnType<typeof setTimeout> | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  function handleInput(val: string) {
    onChange({ customer_name: val, customer_id: null })  // clear link when typing
    if (timer) clearTimeout(timer)
    if (val.trim().length < 2) { setSuggestions([]); setOpen(false); return }
    const t = setTimeout(async () => {
      const data = await fetch(`/api/customers?search=${encodeURIComponent(val)}`).then(r => r.json()).catch(() => [])
      setSuggestions(Array.isArray(data) ? data.slice(0, 6) : [])
      setOpen(true)
    }, 220)
    setTimer(t)
  }

  function selectCustomer(c: Customer) {
    onChange({
      customer_id:        c.id,
      customer_name:      c.name,
      contact_preference: c.preferred_contact || 'Phone Call',
      contact_value:      c.phone || c.email || '',
    })
    setOpen(false)
    setSuggestions([])
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ position: 'relative' }}>
        <input
          value={customer.customer_name}
          onChange={e => handleInput(e.target.value)}
          onFocus={() => { if (suggestions.length) setOpen(true) }}
          style={inputStyle()}
          placeholder="Customer name"
        />
        {customer.customer_id && (
          <span style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.7rem', color: '#4CAF50', pointerEvents: 'none' }}>
            ✓ linked
          </span>
        )}
      </div>
      {open && suggestions.length > 0 && (
        <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 100, background: '#2A1408', border: '1px solid rgba(166,120,90,0.4)', borderRadius: '0 0 4px 4px', boxShadow: '0 4px 16px rgba(0,0,0,0.5)', maxHeight: 220, overflowY: 'auto' }}>
          {suggestions.map(c => (
            <div
              key={c.id}
              onMouseDown={() => selectCustomer(c)}
              style={{ padding: '0.55rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid rgba(166,120,90,0.1)' }}
              onMouseEnter={e => (e.currentTarget.style.background = 'rgba(232,136,58,0.1)')}
              onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
            >
              <div style={{ color: 'var(--cream)', fontSize: '0.85rem', fontWeight: 600 }}>{c.name}</div>
              <div style={{ color: 'var(--light-brown)', fontSize: '0.75rem' }}>
                {[c.ranch_name, c.phone, c.email].filter(Boolean).join(' · ')}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ── Style helpers ─────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label style={{ display:'block', fontSize:'0.7rem', color:'var(--light-brown)', letterSpacing:'0.12em', textTransform:'uppercase', marginBottom:'0.35rem' }}>{label}</label>
      {children}
    </div>
  )
}

const inputStyle  = (): React.CSSProperties => ({ width:'100%', background:'rgba(255,255,255,0.06)', border:'1px solid rgba(166,120,90,0.3)', borderRadius:'3px', padding:'0.5rem 0.75rem', color:'var(--cream)', fontSize:'0.88rem', boxSizing:'border-box' })
const td          = (): React.CSSProperties => ({ padding:'0.75rem 1rem', color:'var(--off-white)', verticalAlign:'middle' })
const btnStyle    = (bg: string, color = 'var(--cream)'): React.CSSProperties => ({ background:bg, color, border:'none', borderRadius:'3px', padding:'0.5rem 1.1rem', fontSize:'0.82rem', fontWeight:600, cursor:'pointer', letterSpacing:'0.04em' })
const smallBtn    = (bg = 'rgba(166,120,90,0.2)', color = 'var(--tan)'): React.CSSProperties => ({ background:bg, color, border:'none', borderRadius:'3px', padding:'0.3rem 0.7rem', fontSize:'0.78rem', cursor:'pointer' })
const navBtn      = (): React.CSSProperties => ({ background:'rgba(166,120,90,0.15)', border:'1px solid rgba(166,120,90,0.2)', color:'var(--tan)', borderRadius:'3px', padding:'0.3rem 0.7rem', cursor:'pointer', fontSize:'1rem' })
