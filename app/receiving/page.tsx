'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { HarvestAppointment, BoxReceivingLog } from '@/lib/types'
import GameIntakeForm from '@/app/game/IntakeTab'
import { isoDate, isoDateTime, addDaysISO, mondayOfISO } from '@/lib/dates'
import { printReceivingLog } from '@/lib/haccpReceivingLog'

type Tab = 'animal' | 'box' | 'game'

// ── Why wild game is a tab here and not a second intake form ──────────────
// Three different things arrive at this building and they share almost no
// fields: a live animal against a booked appointment (ear tag, health cert,
// brand inspection), a vendor's box product we are buying (invoice, lot, temp),
// and a hunter's cooler of boned-out trim that is not ours and can never be
// sold. Three tables, three records — that part is not redundant.
//
// What WOULD go wrong is having two doors for "something showed up". So this
// renders the SAME component the Wild Game module uses, posting to the same
// /api/game endpoint and the same table. There is one game intake form in this
// codebase; it just hangs on two walls. Editing it in app/game/IntakeTab.tsx
// changes both.

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

function Field({ label, children, half }: { label: string; children: React.ReactNode; half?: boolean }) {
  return (
    <div style={{ marginBottom: '1rem', gridColumn: half ? undefined : undefined }}>
      <label style={LABEL}>{label}</label>
      {children}
    </div>
  )
}

// Sex options by species
const SEX_BY_SPECIES: Record<string, string[]> = {
  Beef: ['Steer', 'Heifer', 'Cow', 'Bull'],
  Hog:  ['Barrow', 'Gilt', 'Sow', 'Boar'],
  Lamb: ['Wether', 'Ewe', 'Ram'],
  Goat: ['Wether', 'Doe', 'Buck'],
}

interface AnimalSlot {
  ear_tag:        string
  sex:            string
  breed:          string
  over_30_months: boolean
  photo_url:      string
  uploading:      boolean
  upload_error:   string
  no_show:        boolean
}

function blankSlot(species: string): AnimalSlot {
  const sexOpts = SEX_BY_SPECIES[species] ?? ['Male', 'Female']
  return { ear_tag: '', sex: sexOpts[0], breed: '', over_30_months: false, photo_url: '', uploading: false, upload_error: '', no_show: false }
}

async function resizeImage(file: File, maxPx = 1920, quality = 0.82): Promise<File> {
  const bitmap = await createImageBitmap(file)
  const scale  = Math.min(1, maxPx / Math.max(bitmap.width, bitmap.height))
  const w = Math.round(bitmap.width  * scale)
  const h = Math.round(bitmap.height * scale)
  const canvas = Object.assign(document.createElement('canvas'), { width: w, height: h })
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, w, h)
  bitmap.close()
  return new Promise(resolve =>
    canvas.toBlob(blob => resolve(new File([blob!], file.name, { type: 'image/jpeg' })), 'image/jpeg', quality)
  )
}

// ── Box receiving label printer — 2.4" Brother DK label ──────────────────────
function printReceivingLabel(log: BoxReceivingLog) {
  const date    = new Date(log.received_at + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const boxId   = log.box_identifier ?? 'NO-ID'

  // Julian date: YYDDDXXX  (YY=year, DDD=day-of-year, XXX=box sequence)
  const d          = new Date(log.received_at + 'T12:00:00')
  const yearStart  = new Date(d.getFullYear(), 0, 0)
  const dayOfYear  = Math.round((d.getTime() - yearStart.getTime()) / 86400000)
  const yy         = String(d.getFullYear()).slice(-2)
  const ddd        = String(dayOfYear).padStart(3, '0')
  const seqStr     = boxId.split('-').pop() ?? '0'
  const xxx        = String(parseInt(seqStr, 10)).padStart(3, '0')
  const julianCode = `${yy}${ddd}${xxx}`

  const html = `<!DOCTYPE html><html><head>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; page-break-inside: avoid; break-inside: avoid; }
    html, body { width: 62mm; background: #fff; }
    #label { width: 56mm; margin: 0 auto; font-family: Arial, sans-serif; font-size: 11pt; color: #000; }
    .header  { text-align: center; font-size: 8pt; letter-spacing: 0.12em; text-transform: uppercase; color: #555; margin-bottom: 2px; }
    .divider { border: none; border-top: 0.5pt solid #000; margin: 4px 0; }
    .id      { text-align: center; font-size: 10pt; font-weight: bold; letter-spacing: 0.06em; font-family: monospace; margin: 3px 0; }
    .julian  { text-align: center; font-size: 13pt; font-weight: bold; letter-spacing: 0.12em; font-family: monospace; margin: 2px 0; }
    .barcode-wrap { text-align: center; margin: 4px 0; }
    .barcode-wrap svg { max-width: 100%; }
    .product { font-size: 16pt; font-weight: bold; text-align: center; margin: 4px 0; line-height: 1.2; }
    .vendor  { text-align: center; font-size: 11pt; color: #333; margin-bottom: 4px; }
    .row     { display: flex; justify-content: space-between; font-size: 11pt; margin: 2px 0; }
    .lbl     { color: #555; }
    .footer  { text-align: center; font-size: 8pt; color: #777; margin-top: 4px; }
  </style>
  </head><body>
  <div id="label">
    <div class="header">Cowboy Meat Co. · Forsyth MT</div>
    <hr class="divider"/>
    <div class="julian">${julianCode}</div>
    <div class="id">${boxId}</div>
    <div class="barcode-wrap"><svg id="bc"></svg></div>
    <hr class="divider"/>
    <div class="product">${log.product}</div>
    ${log.vendor ? `<div class="vendor">${log.vendor}</div>` : ''}
    <hr class="divider"/>
    <div class="row"><span class="lbl">Date:</span><span>${date}</span></div>
    <div class="row"><span class="lbl">Qty:</span><span>${log.quantity}</span></div>
    ${log.weight_lbs != null ? `<div class="row"><span class="lbl">Weight:</span><span>${log.weight_lbs} lbs</span></div>` : ''}
    ${log.lot_no     ? `<div class="row"><span class="lbl">Lot #:</span><span>${log.lot_no}</span></div>`    : ''}
    ${log.invoice_no ? `<div class="row"><span class="lbl">Invoice:</span><span>${log.invoice_no}</span></div>` : ''}
    ${log.temp_f != null ? `<div class="row"><span class="lbl">Temp:</span><span>${log.temp_f}°F</span></div>` : ''}
    ${log.received_by ? `<div class="row"><span class="lbl">Rcvd by:</span><span>${log.received_by}</span></div>` : ''}
    <div class="footer">Scan to log as processing input</div>
  </div>
  <script>
    window.onload = function() {
      JsBarcode("#bc", "${boxId}", {
        format: "CODE128", width: 2.2, height: 55,
        displayValue: true, fontSize: 11, margin: 3, textMargin: 3,
      });
      // Convert label height from screen px → mm, then set exact @page height
      setTimeout(function() {
        var px  = document.getElementById('label').offsetHeight;
        var mm  = Math.ceil(px * 25.4 / 96) + 6;
        var style = document.createElement('style');
        style.textContent = '@page { size: 62mm ' + mm + 'mm; margin: 2mm 3mm; }';
        document.head.appendChild(style);
        window.print();
      }, 300);
    };
  <\/script>
  </body></html>`
  const w = window.open('', '_blank', 'width=240,height=400')
  if (w) { w.document.write(html); w.document.close() }
}

// Whatever was typed into the appointment's notes back on the schedule, ready
// to show at check-in. Appointments that came from a booking request carry
// machine-written "Phone:" / "Email:" lines the schedule strips before display
// (see the Booking Requests panel there) — strip them here too so the crew sees
// the actual instruction, not contact metadata they already have above.
function scheduleNote(raw: string | null | undefined): string {
  return (raw ?? '')
    .split('\n')
    .filter(l => !/^\s*(phone|email)\s*:/i.test(l))
    .join(' ')
    .trim()
}

// ══════════════════════════════════════════════════════════════════════════════
// LIVE ANIMAL TAB
// ══════════════════════════════════════════════════════════════════════════════
function AnimalTab() {
  const [appointments, setAppointments] = useState<HarvestAppointment[]>([])
  const [selected,     setSelected]     = useState<HarvestAppointment | null>(null)
  const [saving,       setSaving]       = useState(false)
  const [success,      setSuccess]      = useState(false)
  const [saveError,    setSaveError]    = useState('')
  const [speciesFilter, setSpeciesFilter] = useState('')
  const [dateFilter,    setDateFilter]    = useState('')

  const [shared, setShared] = useState({
    received_at:    isoDateTime(),
    received_by:    '',
    actual_producer: '',
    health_cert_no: '',
    brand_insp_no:  '',
    notes:          '',
  })
  const [slots, setSlots] = useState<AnimalSlot[]>([])

  const load = useCallback(async () => {
    const [apptRes] = await Promise.all([
      fetch('/api/appointments'),
    ])
    const appts: HarvestAppointment[] = await apptRes.json().catch(() => [])
    // Only show appointments still waiting to be checked in. These are every
    // status BEFORE the animal physically arrives (AnimalIn). Listing them
    // explicitly so a new pre-check-in status can't silently get dropped here
    // the way 'Confirmed' was.
    const PENDING_STATUSES = ['Booked', 'Confirmed', 'InstructionsReceived']
    setAppointments(Array.isArray(appts)
      ? appts.filter(a => PENDING_STATUSES.includes(a.status))
      : [])
    // checked-in animals (AnimalIn/Processing) now live in harvest log only
  }, [])

  useEffect(() => { load() }, [load])

  // All loaded appointments are pending check-in
  const allPending     = appointments
  const pending        = allPending.filter(a =>
    (!speciesFilter || a.species === speciesFilter) &&
    (!dateFilter    || a.harvest_date === dateFilter)
  )
  const pendingSpecies = [...new Set(allPending.map(a => a.species))].sort()
  const pendingDates   = [...new Set(allPending.map(a => a.harvest_date))].sort()

  function selectAppt(a: HarvestAppointment) {
    setSelected(a)
    setSuccess(false)
    setShared({
      received_at:     isoDateTime(),
      received_by:     '',
      actual_producer: a.source || a.customers?.[0]?.customer_name || '',
      health_cert_no:  '',
      brand_insp_no:   '',
      notes:           '',
    })
    setSlots(Array.from({ length: a.head_count ?? 1 }, () => blankSlot(a.species)))
  }

  function updateSlot(idx: number, updates: Partial<AnimalSlot>) {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s))
  }

  async function uploadPhoto(idx: number, file: File) {
    if (!selected) return
    updateSlot(idx, { uploading: true, upload_error: '' })
    try {
      const resized = await resizeImage(file)
      const fd = new FormData()
      fd.append('file', resized)
      fd.append('appointment_id', selected.id)
      fd.append('animal_index', String(idx + 1))
      const res  = await fetch('/api/receiving/photo', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.url) updateSlot(idx, { photo_url: json.url, uploading: false })
      else updateSlot(idx, { uploading: false, upload_error: json.error ?? 'Upload failed' })
    } catch (e) {
      updateSlot(idx, { uploading: false, upload_error: e instanceof Error ? e.message : 'Upload failed' })
    }
  }

  async function handleCheckIn() {
    if (!selected) return
    setSaving(true)
    setSaveError('')
    const animals = slots.map((s, i) => ({
      animal_index:   i + 1,
      ear_tag:        s.ear_tag,
      sex:            s.sex,
      breed:          s.breed,
      over_30_months: s.over_30_months,
      photo_url:      s.photo_url,
      status:         s.no_show ? 'no_show' : 'received',
    }))
    try {
      const res = await fetch('/api/receiving', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:           'animal',
          appointment_id: selected.id,
          // datetime-local wall time → real instant, so timestamptz storage
          // and UTC API-default rows stay consistent
          received_at:    new Date(shared.received_at).toISOString(),
          received_by:    shared.received_by,
          health_cert_no: shared.health_cert_no,
          brand_insp_no:  shared.brand_insp_no,
          notes:          shared.notes,
          animals,
        }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setSaveError(body.error ?? `Save failed (HTTP ${res.status}) — check Supabase logs`)
        setSaving(false)
        return   // keep form intact so data isn't lost
      }

      // Overwrite appointment source + any existing harvest logs with the actual producer name
      if (shared.actual_producer.trim()) {
        await Promise.all([
          fetch('/api/appointments', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: selected.id, source: shared.actual_producer.trim() }),
          }),
          fetch('/api/harvest', {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ appointment_id: selected.id, producer: shared.actual_producer.trim() }),
          }),
        ])
      }

      setSaving(false)
      setSuccess(true)
      setSelected(null)
      setSlots([])
      load()
    } catch (err) {
      setSaveError(`Network error — ${err instanceof Error ? err.message : 'check connection and retry'}`)
      setSaving(false)
    }
  }

  const over30Count  = slots.filter(s => s.over_30_months && !s.no_show).length
  const noShowCount  = slots.filter(s => s.no_show).length
  const arrivedCount = slots.length - noShowCount

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '320px 1fr', gap: '1.5rem', height: '100%' }}>

      {/* Left — appointment list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0.75rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
            <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Pending Check-In ({pending.length}{pending.length !== allPending.length ? ` of ${allPending.length}` : ''})
            </span>
            {(dateFilter || speciesFilter) && (
              <button onClick={() => { setDateFilter(''); setSpeciesFilter('') }}
                style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline' }}>
                clear
              </button>
            )}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
              style={{ ...INPUT, fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}>
              <option value="">All dates</option>
              {pendingDates.map(d => (
                <option key={d} value={d}>
                  {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                </option>
              ))}
            </select>
            {pendingSpecies.length > 1 && (
              <select value={speciesFilter} onChange={e => setSpeciesFilter(e.target.value)}
                style={{ ...INPUT, fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}>
                <option value="">All species</option>
                {pendingSpecies.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            )}
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {pending.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>No animals pending</p>
          )}
          {pending.map(a => (
            <div key={a.id} onClick={() => selectAppt(a)} style={{
              padding: '0.9rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.1)',
              cursor: 'pointer', background: selected?.id === a.id ? 'rgba(166,120,90,0.12)' : 'transparent',
              transition: 'background 0.15s',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.25rem' }}>
                <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>
                  {a.species} · {a.head_count} head
                </span>
                <span style={{ fontSize: '0.7rem', background: 'rgba(166,120,90,0.2)', color: C.tan, borderRadius: 3, padding: '2px 7px' }}>
                  {a.status}
                </span>
              </div>
              <div style={{ fontSize: '0.77rem', color: C.tan }}>
                {new Date(a.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                {a.source ? ` · ${a.source}` : ''}
              </div>
              {a.customers?.length > 0 && (
                <div style={{ fontSize: '0.73rem', color: C.lightBrown, marginTop: '0.15rem' }}>
                  {a.customers.map(c => c.customer_name).join(', ')}
                </div>
              )}
              {/* Marker only — the column is 320px and notes are free text, so
                  the note itself reads in the banner once the row is picked.
                  Without this you'd have to click every row to find the ones
                  carrying an instruction. */}
              {scheduleNote(a.notes) && (
                <div title={scheduleNote(a.notes)} style={{ fontSize: '0.72rem', color: C.tan, marginTop: '0.2rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  📋 {scheduleNote(a.notes)}
                </div>
              )}
            </div>
          ))}

          {/* Checked-in animals live in the Harvest log */}
        </div>
      </div>

      {/* Right — check-in form */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflowY: 'auto' }}>
        {success && (
          <div style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 4, padding: '0.85rem 1.25rem', margin: '1.25rem 1.5rem 0', color: C.green, fontSize: '0.9rem' }}>
            ✓ Animals checked in successfully — they now appear in the Harvest log
          </div>
        )}
        {saveError && (
          <div style={{ background: 'rgba(229,62,62,0.15)', border: '1px solid rgba(229,62,62,0.4)', borderRadius: 4, padding: '0.85rem 1.25rem', margin: '1.25rem 1.5rem 0', color: C.red, fontSize: '0.88rem' }}>
            <strong>⚠ Check-in failed — your data is still here, try again</strong>
            <div style={{ marginTop: '0.35rem', fontFamily: 'monospace', fontSize: '0.8rem', opacity: 0.85 }}>{saveError}</div>
          </div>
        )}

        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: C.lightBrown, fontSize: '0.9rem' }}>
            ← Select an appointment to check in
          </div>
        ) : (
          <div style={{ padding: '1.5rem' }}>
            {/* Appointment banner */}
            <div style={{ background: 'rgba(166,120,90,0.08)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1.5rem' }}>
              <div style={{ color: C.cream, fontWeight: 700, fontSize: '1.05rem', marginBottom: '0.2rem' }}>
                {selected.species} · {selected.head_count} head
              </div>
              <div style={{ color: C.tan, fontSize: '0.82rem' }}>
                {new Date(selected.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
              </div>
              {selected.source && <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginTop: '0.1rem' }}>Ranch: {selected.source}</div>}
              {selected.customers?.length > 0 && (
                <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginTop: '0.1rem' }}>
                  Customers: {selected.customers.map(c => c.customer_name).join(', ')}
                </div>
              )}
              {/* Whatever was noted when the animal was booked. Labelled
                  "From the schedule" so it can't be mistaken for the Notes
                  textarea below, which is for what you see at the dock. */}
              {scheduleNote(selected.notes) && (
                <div style={{ marginTop: '0.7rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(166,120,90,0.25)' }}>
                  <div style={{ color: C.tan, fontSize: '0.68rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>
                    📋 From the schedule
                  </div>
                  <div style={{ color: C.cream, fontSize: '0.85rem', whiteSpace: 'pre-wrap' }}>
                    {scheduleNote(selected.notes)}
                  </div>
                </div>
              )}
            </div>

            {/* Shared fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.25rem' }}>
              <Field label="Date / Time Received">
                <input type="datetime-local" style={INPUT} value={shared.received_at} onChange={e => setShared(p => ({ ...p, received_at: e.target.value }))} />
              </Field>
              <Field label="Received By">
                <input type="text" placeholder="Name" style={INPUT} value={shared.received_by} onChange={e => setShared(p => ({ ...p, received_by: e.target.value }))} />
              </Field>
              <div style={{ gridColumn: 'span 2', marginBottom: '1rem' }}>
                <label style={LABEL}>
                  Actual Producer / Ranch
                  <span style={{ color: C.tan, fontWeight: 400, marginLeft: '0.5rem', textTransform: 'none', letterSpacing: 0 }}>
                    — overrides the scheduled name everywhere
                  </span>
                </label>
                <input
                  type="text"
                  placeholder="e.g. XYZ Ranch — who actually owns the animal"
                  style={{ ...INPUT, borderColor: shared.actual_producer.trim() ? 'rgba(76,175,80,0.5)' : 'rgba(166,120,90,0.35)' }}
                  value={shared.actual_producer}
                  onChange={e => setShared(p => ({ ...p, actual_producer: e.target.value }))}
                />
              </div>
              <Field label="Health Cert #">
                <input type="text" placeholder="Optional" style={INPUT} value={shared.health_cert_no} onChange={e => setShared(p => ({ ...p, health_cert_no: e.target.value }))} />
              </Field>
              <Field label="Brand Inspection #">
                <input type="text" placeholder="Brand inspection number" style={INPUT} value={shared.brand_insp_no} onChange={e => setShared(p => ({ ...p, brand_insp_no: e.target.value }))} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea placeholder="Condition, issues, observations…" style={{ ...INPUT, height: 64, resize: 'vertical' }} value={shared.notes} onChange={e => setShared(p => ({ ...p, notes: e.target.value }))} />
            </Field>

            {/* Per-animal slots */}
            <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', marginTop: '0.5rem', paddingTop: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '1rem' }}>
                <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.95rem', fontFamily: 'Georgia, serif', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                  Individual Animals ({selected.head_count})
                </span>
                {over30Count > 0 && (
                  <span style={{ fontSize: '0.78rem', color: '#fca5a5', background: 'rgba(200,50,50,0.15)', border: '1px solid rgba(200,50,50,0.3)', borderRadius: 3, padding: '0.2rem 0.6rem' }}>
                    ⚠ {over30Count} over 30 months — SRM removal required
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
                {slots.map((slot, idx) => (
                  <AnimalCard
                    key={idx}
                    index={idx + 1}
                    total={slots.length}
                    species={selected.species}
                    slot={slot}
                    onChange={updates => updateSlot(idx, updates)}
                    onPhotoChange={file => uploadPhoto(idx, file)}
                    appointmentId={selected.id}
                  />
                ))}
              </div>
            </div>

            {/* Actions */}
            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem' }}>
              <button style={BTN(arrivedCount > 0 ? C.green : noShowCount > 0 ? C.yellow : C.medBrown, C.dark)} onClick={handleCheckIn} disabled={saving || (arrivedCount === 0 && noShowCount === 0)}>
                {saving ? 'Saving…' : arrivedCount === 0 && noShowCount > 0
                  ? `✓ Record ${noShowCount} No-Show${noShowCount !== 1 ? 's' : ''}`
                  : noShowCount > 0
                    ? `✓ Check In ${arrivedCount} of ${slots.length} (${noShowCount} No-Show)`
                    : `✓ Check In ${slots.length} Animal${slots.length !== 1 ? 's' : ''}`
                }
              </button>
              <button style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }} onClick={() => { setSelected(null); setSlots([]) }}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ── Individual animal card ─────────────────────────────────────────────────────
function AnimalCard({ index, total, species, slot, onChange, onPhotoChange, appointmentId }: {
  index:          number
  total:          number
  species:        string
  slot:           AnimalSlot
  onChange:       (u: Partial<AnimalSlot>) => void
  onPhotoChange:  (f: File) => void
  appointmentId:  string
}) {
  const fileRef = useRef<HTMLInputElement>(null)
  const sexOpts = SEX_BY_SPECIES[species] ?? ['Male', 'Female']
  void appointmentId  // used by parent for photo upload

  const borderColor = slot.no_show
    ? 'rgba(166,120,90,0.15)'
    : slot.over_30_months
      ? 'rgba(200,50,50,0.4)'
      : 'rgba(166,120,90,0.2)'

  return (
    <div style={{
      background: slot.no_show ? 'rgba(0,0,0,0.15)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${borderColor}`,
      borderRadius: 4, padding: '1rem 1.25rem',
      opacity: slot.no_show ? 0.55 : 1,
      transition: 'opacity 0.2s',
    }}>
      {/* Card header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
        <span style={{ color: C.tan, fontWeight: 700, fontSize: '0.82rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
          Animal {index} of {total}
          {slot.ear_tag && !slot.no_show ? <span style={{ color: C.cream, marginLeft: '0.5rem', fontWeight: 400 }}>· Tag #{slot.ear_tag}</span> : ''}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {slot.over_30_months && !slot.no_show && (
            <span style={{ fontSize: '0.72rem', color: '#fca5a5', background: 'rgba(200,50,50,0.2)', borderRadius: 3, padding: '2px 8px' }}>
              ⚠ Over 30 mo
            </span>
          )}
          {/* No-show toggle */}
          <button
            onClick={() => onChange({ no_show: !slot.no_show })}
            style={{
              ...BTN(slot.no_show ? 'rgba(166,120,90,0.3)' : 'rgba(255,255,255,0.04)',
                     slot.no_show ? C.tan : C.lightBrown),
              border: `1px solid ${slot.no_show ? 'rgba(166,120,90,0.5)' : 'rgba(166,120,90,0.2)'}`,
              padding: '0.25rem 0.7rem', fontSize: '0.75rem',
            }}
          >
            {slot.no_show ? '✓ No-Show' : 'No-Show'}
          </button>
        </div>
      </div>

      {/* Hide fields when marked no-show */}
      {!slot.no_show && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 1rem' }}>
            {/* Ear Tag */}
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={LABEL}>Ear Tag #</label>
              <input type="text" placeholder="e.g. 3271" style={INPUT}
                value={slot.ear_tag} onChange={e => onChange({ ear_tag: e.target.value })} />
            </div>
            {/* Sex */}
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={LABEL}>Sex</label>
              <select style={INPUT} value={slot.sex} onChange={e => onChange({ sex: e.target.value })}>
                {sexOpts.map(s => <option key={s}>{s}</option>)}
              </select>
            </div>
            {/* Breed */}
            <div style={{ marginBottom: '0.75rem' }}>
              <label style={LABEL}>Breed</label>
              <input type="text" placeholder="e.g. Angus" style={INPUT}
                value={slot.breed} onChange={e => onChange({ breed: e.target.value })} />
            </div>
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
            {/* Over/Under 30 months — Beef only */}
            {species === 'Beef' && (
              <div>
                <label style={LABEL}>Age at Harvest</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  <button
                    onClick={() => onChange({ over_30_months: false })}
                    style={{
                      ...BTN(!slot.over_30_months ? 'rgba(76,175,80,0.25)' : 'rgba(255,255,255,0.05)', !slot.over_30_months ? C.green : C.lightBrown),
                      border: `1px solid ${!slot.over_30_months ? 'rgba(76,175,80,0.5)' : 'rgba(166,120,90,0.2)'}`,
                      padding: '0.4rem 0.9rem', fontSize: '0.8rem',
                    }}
                  >
                    Under 30 mo
                  </button>
                  <button
                    onClick={() => onChange({ over_30_months: true })}
                    style={{
                      ...BTN(slot.over_30_months ? 'rgba(200,50,50,0.25)' : 'rgba(255,255,255,0.05)', slot.over_30_months ? '#fca5a5' : C.lightBrown),
                      border: `1px solid ${slot.over_30_months ? 'rgba(200,50,50,0.5)' : 'rgba(166,120,90,0.2)'}`,
                      padding: '0.4rem 0.9rem', fontSize: '0.8rem',
                    }}
                  >
                    Over 30 mo ⚠
                  </button>
                </div>
              </div>
            )}

            {/* Photo */}
            <div style={{ marginLeft: species === 'Beef' ? 'auto' : 0 }}>
              <label style={LABEL}>Photo</label>
              {slot.upload_error && (
                <div style={{ fontSize: '0.75rem', color: '#fca5a5', marginBottom: '0.35rem' }}>
                  {slot.upload_error}
                </div>
              )}
              {slot.photo_url ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <img src={slot.photo_url} alt="animal" style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 4, border: '1px solid rgba(166,120,90,0.3)' }} />
                  <button onClick={() => onChange({ photo_url: '' })} style={{ ...BTN('rgba(200,50,50,0.2)', '#fca5a5'), fontSize: '0.75rem', padding: '0.25rem 0.5rem' }}>✕</button>
                </div>
              ) : (
                <label style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: '0.4rem',
                  background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3,
                  padding: '0.4rem 0.85rem', fontSize: '0.8rem', color: C.tan }}>
                  {slot.uploading ? '⏳ Uploading…' : '📷 Add Photo'}
                  <input ref={fileRef} type="file" accept="image/*" capture="environment" style={{ display: 'none' }}
                    onChange={e => { const f = e.target.files?.[0]; if (f) onPhotoChange(f) }} />
                </label>
              )}
            </div>
          </div>
        </>
      )}

      {/* No-show message */}
      {slot.no_show && (
        <div style={{ color: C.lightBrown, fontSize: '0.82rem', fontStyle: 'italic' }}>
          Marked as no-show — will be recorded for metrics but excluded from harvest log.
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// BOX PRODUCT TAB
// ══════════════════════════════════════════════════════════════════════════════
function getWeekRange() {
  const mon = mondayOfISO(isoDate())
  return {
    start: mon,
    end:   addDaysISO(mon, 6),
  }
}

function BoxTab() {
  const [logs,        setLogs]        = useState<BoxReceivingLog[]>([])
  const [saving,      setSaving]      = useState(false)
  const [success,     setSuccess]     = useState(false)
  const [dateFilter,  setDateFilter]  = useState('')
  const [search,      setSearch]      = useState('')
  const [reportModal, setReportModal] = useState(false)
  const [reportRange, setReportRange] = useState(getWeekRange)

  const empty = {
    received_at: isoDate(),
    vendor: '', product: '', quantity: '1', weight_lbs: '',
    invoice_no: '', lot_no: '', temp_f: '', received_by: '', notes: '',
  }
  const [form, setForm] = useState(empty)
  const formPanelRef = useRef<HTMLDivElement>(null)

  function duplicateEntry(log: BoxReceivingLog) {
    setForm({
      received_at: isoDate(),
      vendor:      log.vendor      ?? '',
      product:     log.product     ?? '',
      quantity:    String(log.quantity ?? 1),
      weight_lbs:  log.weight_lbs  != null ? String(log.weight_lbs)  : '',
      invoice_no:  log.invoice_no  ?? '',
      lot_no:      log.lot_no      ?? '',
      temp_f:      log.temp_f      != null ? String(log.temp_f)      : '',
      received_by: log.received_by ?? '',
      notes:       log.notes       ?? '',
    })
    formPanelRef.current?.scrollTo({ top: 0, behavior: 'smooth' })
  }

  const load = useCallback(async () => {
    const res = await fetch('/api/receiving?type=box')
    setLogs(await res.json().catch(() => []))
  }, [])

  useEffect(() => { load() }, [load])

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleSubmit() {
    if (!form.vendor || !form.product) return
    setSaving(true)
    const res = await fetch('/api/receiving', {
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
    const saved: BoxReceivingLog = await res.json()
    setSaving(false); setSuccess(true); setForm(empty); load()
    setTimeout(() => setSuccess(false), 4000)
    // Auto-print the CMC box label immediately
    if (saved?.id) printReceivingLabel(saved)
  }

  const logDates    = [...new Set(logs.map(l => l.received_at.slice(0, 10)))].sort().reverse()
  const filteredLogs = logs.filter(l => {
    if (dateFilter && !l.received_at.startsWith(dateFilter)) return false
    if (search) {
      const q = search.toLowerCase()
      if (!l.product.toLowerCase().includes(q) && !l.vendor.toLowerCase().includes(q)) return false
    }
    return true
  })

  return (
    <>
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — entry form */}
      <div ref={formPanelRef} style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
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
          <Field label="Quantity (units)">
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
        <div style={{ padding: '0.75rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.2)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.55rem' }}>
            <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
              Received ({filteredLogs.length}{filteredLogs.length !== logs.length ? ` of ${logs.length}` : ''})
            </span>
            <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
              {(dateFilter || search) && (
                <button onClick={() => { setDateFilter(''); setSearch('') }}
                  style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline' }}>
                  clear
                </button>
              )}
              <button
                onClick={() => { setReportRange(getWeekRange()); setReportModal(true) }}
                style={{ background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.4)', color: C.tan, borderRadius: 3, padding: '3px 10px', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}
              >
                📋 HACCP Report
              </button>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <select value={dateFilter} onChange={e => setDateFilter(e.target.value)}
              style={{ ...INPUT, fontSize: '0.8rem', padding: '0.35rem 0.6rem', flex: '0 0 auto', width: 'auto' }}>
              <option value="">All dates</option>
              {logDates.map(d => (
                <option key={d} value={d}>
                  {new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                </option>
              ))}
            </select>
            <input
              placeholder="Search product or vendor…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              style={{ ...INPUT, fontSize: '0.8rem', padding: '0.35rem 0.6rem' }}
            />
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filteredLogs.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>
              {logs.length === 0 ? 'No box product entries yet' : 'No entries match filters'}
            </p>
          )}
          {filteredLogs.map(log => (
            <div key={log.id} style={{ padding: '0.9rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.1)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.2rem' }}>
                <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>{log.product}</span>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <span style={{ color: C.lightBrown, fontSize: '0.76rem' }}>
                    {new Date(log.received_at + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  </span>
                  <button
                    onClick={() => duplicateEntry(log)}
                    title="Duplicate this entry"
                    style={{ background: 'rgba(201,168,130,0.15)', border: '1px solid rgba(201,168,130,0.35)', color: C.cream, borderRadius: 3, padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}
                  >
                    ⧉ Dupe
                  </button>
                  <button
                    onClick={() => printReceivingLabel(log)}
                    title="Print receiving label"
                    style={{ background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.3)', color: C.tan, borderRadius: 3, padding: '2px 8px', fontSize: '0.72rem', cursor: 'pointer' }}
                  >
                    🖨 Label
                  </button>
                </div>
              </div>
              <div style={{ fontSize: '0.8rem', color: C.tan }}>{log.vendor}</div>
              <div style={{ fontSize: '0.77rem', color: C.lightBrown, marginTop: '0.2rem', display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
                <span>Qty: {log.quantity}</span>
                {log.weight_lbs != null && <span>{log.weight_lbs} lbs</span>}
                {log.temp_f != null && <span>{log.temp_f}°F</span>}
                {log.invoice_no && <span>Inv: {log.invoice_no}</span>}
                {log.lot_no && <span>Lot: {log.lot_no}</span>}
                {log.received_by && <span>Rcvd by: {log.received_by}</span>}
              </div>
              {log.notes && <div style={{ fontSize: '0.76rem', color: C.lightBrown, marginTop: '0.25rem', fontStyle: 'italic' }}>{log.notes}</div>}
            </div>
          ))}
        </div>
      </div>
    </div>

    {/* ── HACCP Report Modal ─────────────────────────────────────────────── */}
    {reportModal && (
      <div style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
      }} onClick={() => setReportModal(false)}>
        <div style={{
          background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)',
          borderRadius: 6, padding: '1.75rem 2rem', width: 380,
        }} onClick={e => e.stopPropagation()}>
          <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.25rem' }}>
            HACCP Receiving Report
          </h3>
          <p style={{ color: C.lightBrown, fontSize: '0.78rem', margin: '0 0 1.25rem' }}>
            Generates a print-ready log matching your HACCP Receiving form for the selected date range.
          </p>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem', marginBottom: '1.25rem' }}>
            <div>
              <label style={LABEL}>From</label>
              <input type="date" style={INPUT} value={reportRange.start}
                onChange={e => setReportRange(p => ({ ...p, start: e.target.value }))} />
            </div>
            <div>
              <label style={LABEL}>To</label>
              <input type="date" style={INPUT} value={reportRange.end}
                onChange={e => setReportRange(p => ({ ...p, end: e.target.value }))} />
            </div>
          </div>

          {(() => {
            const rangeCount = logs.filter(l =>
              l.received_at >= reportRange.start && l.received_at <= reportRange.end
            ).length
            return (
              <p style={{ color: C.tan, fontSize: '0.8rem', marginBottom: '1.25rem' }}>
                {rangeCount} entr{rangeCount !== 1 ? 'ies' : 'y'} in this range
                {rangeCount > 0 && ` · ${Math.ceil(rangeCount / 10)} page${Math.ceil(rangeCount / 10) !== 1 ? 's' : ''}`}
              </p>
            )
          })()}

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              style={{ ...BTN(C.tan), flex: 1 }}
              onClick={() => {
                const rangeRows = logs
                  .filter(l => l.received_at >= reportRange.start && l.received_at <= reportRange.end)
                  .sort((a, b) => a.received_at.localeCompare(b.received_at))
                printReceivingLog(rangeRows, reportRange.start, reportRange.end)
                setReportModal(false)
              }}
            >
              Print / Save PDF
            </button>
            <button
              style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)', flex: '0 0 auto' }}
              onClick={() => setReportModal(false)}
            >
              Cancel
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
// Wild game intake — the same form the Wild Game module uses, with a line
// pointing at where the animal goes next, because taking it in is only the
// first act: the order, the board and the ticket all live in /game.
function GameTab() {
  return (
    <div>
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
        background: 'rgba(139,111,71,0.12)', border: '1px solid rgba(166,120,90,0.3)',
        borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1.25rem', flexWrap: 'wrap',
      }}>
        <div style={{ fontSize: '0.78rem', color: C.tan, lineHeight: 1.5 }}>
          A hunter&rsquo;s own meat — <strong>not for sale</strong>, never commingled with inspected
          product. Taking it in here issues the claim tag; the board, weigh-out and ticket live in
          the Wild Game module.
        </div>
        <Link href="/game" style={{
          textDecoration: 'none', color: C.cream, fontSize: '0.8rem', fontWeight: 600,
          background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.35)',
          borderRadius: 3, padding: '0.45rem 0.9rem', whiteSpace: 'nowrap',
        }}>
          Wild Game board →
        </Link>
      </div>
      <GameIntakeForm onSaved={() => { /* the form shows the tag and prints it */ }} />
    </div>
  )
}

export default function ReceivingPage() {
  const [tab, setTab] = useState<Tab>('animal')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            Receiving
          </h1>
        </div>

        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
          {(['animal', 'box', 'game'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '0.45rem 1.25rem', border: 'none', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600,
              background: tab === t ? C.medBrown : 'transparent',
              color: tab === t ? C.cream : C.lightBrown,
              letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'background 0.15s',
            }}>
              {t === 'animal' ? '🐄 Live Animal' : t === 'box' ? '📦 Box Product' : '🦌 Wild Game'}
            </button>
          ))}
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1300px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'animal' ? <AnimalTab /> : tab === 'box' ? <BoxTab /> : <GameTab />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
