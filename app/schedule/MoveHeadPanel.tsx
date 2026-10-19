'use client'
// Move some of a booking's head to another kill day, from inside the
// appointment editor (Jill, 2026-10-14, /schedule: "Move one animal from an
// appointment to the next day's kill"). Changing the harvest date moves the
// whole booking; this peels part of it off into a new appointment and leaves
// the rest where it was.
//
// Jill ticks what goes: which customer slots (a half-beef pair is two ticks),
// and — once animals are checked in — which ear tags. The server does the
// bookkeeping (see /api/appointments/split).

import { useEffect, useState } from 'react'
import type { AppointmentCustomer, AnimalReceivingLog } from '@/lib/types'
import { addDaysISO, dateLabel } from '@/lib/dates'

export default function MoveHeadPanel({ appointmentId, harvestDate, headCount, customers, onMoved }: {
  appointmentId: string
  harvestDate:   string
  headCount:     number
  customers:     AppointmentCustomer[]
  /** The split happened; the editor should close and the schedule reload. */
  onMoved:       (summary: string) => void
}) {
  const [open,    setOpen]    = useState(false)
  const [head,    setHead]    = useState(1)
  const [toDate,  setToDate]  = useState(addDaysISO(harvestDate, 1))
  const [slots,   setSlots]   = useState<Set<string>>(new Set())
  const [animals, setAnimals] = useState<AnimalReceivingLog[]>([])
  const [picked,  setPicked]  = useState<Set<string>>(new Set())
  const [busy,    setBusy]    = useState(false)
  const [err,     setErr]     = useState('')

  // Checked-in animals, fetched when the panel opens so a booking nobody
  // splits costs nothing.
  useEffect(() => {
    if (!open) return
    let cancelled = false
    fetch(`/api/receiving?type=animal&appointment_id=${encodeURIComponent(appointmentId)}`)
      .then(r => r.json())
      .then((rows: unknown) => {
        if (cancelled || !Array.isArray(rows)) return
        setAnimals((rows as AnimalReceivingLog[]).filter(a => a.status !== 'no_show'))
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [open, appointmentId])

  if (headCount < 2) return null

  const staying = headCount - head
  const mustPickAnimals = Math.max(0, animals.length - staying)
  const toggle = (set: Set<string>, setSet: (s: Set<string>) => void, id: string) => {
    const n = new Set(set); if (n.has(id)) n.delete(id); else n.add(id); setSet(n)
  }

  const problem =
    head < 1 || head >= headCount ? `Move between 1 and ${headCount - 1} head; to move all of it, change the harvest date.` :
    !/^\d{4}-\d{2}-\d{2}$/.test(toDate) ? 'Pick a day.' :
    toDate === harvestDate ? 'That is the day it is already on.' :
    picked.size > head ? `${picked.size} animals ticked but only ${head} head moving.` :
    picked.size < mustPickAnimals ? `${animals.length} animals are checked in and only ${staying} can stay — tick ${mustPickAnimals} to move.` :
    ''

  async function move() {
    if (problem) { setErr(problem); return }
    const what = [
      `${head} head`,
      slots.size ? `${slots.size} customer${slots.size !== 1 ? 's' : ''}` : 'no customers',
      picked.size ? `${picked.size} checked-in animal${picked.size !== 1 ? 's' : ''}` : '',
    ].filter(Boolean).join(', ')
    if (!confirm(`Move ${what} to ${dateLabel(toDate)}?\n\nThe other ${staying} head stay on ${dateLabel(harvestDate)}. Other edits in this form are not saved.`)) return
    setBusy(true); setErr('')
    try {
      const res  = await fetch('/api/appointments/split', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: appointmentId, to_date: toDate, head, slot_ids: [...slots], animal_ids: [...picked] }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setErr(data?.error ?? `Move failed (HTTP ${res.status})`); return }
      const warn = Array.isArray(data?.warnings) && data.warnings.length ? ` Check: ${data.warnings.join('; ')}` : ''
      onMoved(`Moved ${what} to ${dateLabel(toDate)}.${warn}`)
    } catch {
      setErr('Move failed — network error.')
    } finally {
      setBusy(false)
    }
  }

  const box: React.CSSProperties = { border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, padding: '0.9rem 1rem', marginTop: '1.25rem', background: 'rgba(255,255,255,0.03)' }
  const lbl: React.CSSProperties = { display: 'block', fontSize: '0.7rem', color: 'var(--light-brown)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: '0.35rem' }
  const inp: React.CSSProperties = { width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, padding: '0.45rem 0.65rem', color: 'var(--cream)', fontSize: '0.88rem', boxSizing: 'border-box' }
  const row: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--cream)', padding: '0.2rem 0', cursor: 'pointer' }

  if (!open) {
    return (
      <div style={{ marginTop: '1.25rem' }}>
        <button type="button" onClick={() => setOpen(true)} style={{ background: 'transparent', color: 'var(--tan)', border: '1px solid rgba(201,168,130,0.45)', borderRadius: 3, padding: '0.4rem 0.9rem', fontSize: '0.78rem', cursor: 'pointer' }}>
          ↪ Move some head to another day…
        </button>
      </div>
    )
  }

  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
        <strong style={{ color: 'var(--cream)', fontSize: '0.85rem', letterSpacing: '0.06em', textTransform: 'uppercase' }}>↪ Move some head to another day</strong>
        <button type="button" onClick={() => setOpen(false)} style={{ background: 'transparent', border: 'none', color: 'var(--tan)', cursor: 'pointer', fontSize: '0.8rem' }}>close</button>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
        <div>
          <label style={lbl}>Head to move</label>
          <input type="number" min={1} max={headCount - 1} value={head} onChange={e => setHead(parseInt(e.target.value) || 1)} style={inp} />
        </div>
        <div>
          <label style={lbl}>To kill day</label>
          <input type="date" value={toDate} onChange={e => setToDate(e.target.value)} style={inp} />
        </div>
      </div>
      <p style={{ color: 'var(--light-brown)', fontSize: '0.75rem', margin: '0.5rem 0 0' }}>
        {staying} head stay on {dateLabel(harvestDate)}.
      </p>

      {customers.length > 0 && (
        <div style={{ marginTop: '0.9rem' }}>
          <label style={lbl}>Customers going with it</label>
          {customers.map(c => (
            <label key={c.id} style={row}>
              <input type="checkbox" checked={slots.has(c.id)} onChange={() => toggle(slots, setSlots, c.id)} />
              <span>{c.customer_name?.trim() || <em style={{ color: 'var(--light-brown)' }}>unnamed</em>}</span>
              <span style={{ color: 'var(--tan)', fontSize: '0.75rem' }}>{c.portion}{c.linked_cutting_instruction_id ? ' · cut sheet linked' : ''}</span>
            </label>
          ))}
          <p style={{ color: 'var(--light-brown)', fontSize: '0.72rem', margin: '0.3rem 0 0' }}>
            Their cut sheets, carcass assignments and cut-schedule spots follow them. A half-beef pair is two ticks.
          </p>
        </div>
      )}

      {animals.length > 0 && (
        <div style={{ marginTop: '0.9rem' }}>
          <label style={lbl}>Checked-in animals going with it</label>
          {animals.map(a => (
            <label key={a.id} style={row}>
              <input type="checkbox" checked={picked.has(a.id)} onChange={() => toggle(picked, setPicked, a.id)} />
              <span>#{a.animal_index}{a.ear_tag ? ` · ET ${a.ear_tag}` : ''}</span>
              <span style={{ color: 'var(--tan)', fontSize: '0.75rem' }}>{[a.sex, a.breed].filter(Boolean).join(' ')}</span>
            </label>
          ))}
          <p style={{ color: 'var(--light-brown)', fontSize: '0.72rem', margin: '0.3rem 0 0' }}>
            Its number on {dateLabel(harvestDate, { weekday: 'short', month: 'short', day: 'numeric' })}&rsquo;s worksheet stays spent and reads &ldquo;moved to {dateLabel(toDate, { weekday: 'short', month: 'short', day: 'numeric' })}&rdquo;; it gets a fresh number on the new day.
          </p>
        </div>
      )}

      {(err || problem) && (
        <div style={{ color: '#f0c060', fontSize: '0.78rem', marginTop: '0.75rem' }}>{err || problem}</div>
      )}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '0.9rem' }}>
        <button type="button" onClick={move} disabled={busy || !!problem}
          style={{ background: 'var(--med-brown)', color: 'var(--cream)', border: 'none', borderRadius: 3, padding: '0.5rem 1.1rem', fontSize: '0.82rem', fontWeight: 600, cursor: busy || problem ? 'not-allowed' : 'pointer', opacity: busy || problem ? 0.6 : 1 }}>
          {busy ? 'Moving…' : `Move ${head} head to ${dateLabel(toDate, { weekday: 'short', month: 'short', day: 'numeric' })}`}
        </button>
      </div>
    </div>
  )
}
