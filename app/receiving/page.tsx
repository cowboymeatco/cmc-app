'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { HarvestAppointment, BoxReceivingLog } from '@/lib/types'

type Tab = 'animal' | 'box'

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
  no_show:        boolean
}

function blankSlot(species: string): AnimalSlot {
  const sexOpts = SEX_BY_SPECIES[species] ?? ['Male', 'Female']
  return { ear_tag: '', sex: sexOpts[0], breed: '', over_30_months: false, photo_url: '', uploading: false, no_show: false }
}

// ── Box receiving label printer — 2.4" Brother DK label ──────────────────────
function printReceivingLabel(log: BoxReceivingLog) {
  const date    = new Date(log.received_at + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const boxId   = log.box_identifier ?? 'NO-ID'
  const html = `<!DOCTYPE html><html><head>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    @page { size: 62mm auto; margin: 2mm 3mm; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 8pt; color: #000; margin: 0; padding: 0; width: 56mm; }
    .header { text-align: center; font-size: 6pt; letter-spacing: 0.14em; text-transform: uppercase; color: #555; margin-bottom: 1px; }
    .divider { border: none; border-top: 0.5pt solid #000; margin: 3px 0; }
    .id { text-align: center; font-size: 8pt; font-weight: bold; letter-spacing: 0.06em; font-family: monospace; margin: 2px 0; }
    .barcode-wrap { text-align: center; margin: 3px 0; }
    .barcode-wrap svg { max-width: 100%; }
    .product { font-size: 11pt; font-weight: bold; text-align: center; margin: 3px 0; line-height: 1.2; }
    .vendor { text-align: center; font-size: 7.5pt; color: #444; margin-bottom: 3px; }
    .row { display: flex; justify-content: space-between; font-size: 7.5pt; margin: 1px 0; }
    .lbl { color: #666; }
    .footer { text-align: center; font-size: 6pt; color: #777; margin-top: 3px; }
  </style>
  </head><body>
  <div class="header">Cowboy Meat Co. · Forsyth MT</div>
  <hr class="divider"/>
  <div class="id">${boxId}</div>
  <div class="barcode-wrap"><svg id="bc"></svg></div>
  <hr class="divider"/>
  <div class="product">${log.product}</div>
  ${log.vendor ? `<div class="vendor">${log.vendor}</div>` : ''}
  <hr class="divider"/>
  <div class="row"><span class="lbl">Date:</span><span>${date}</span></div>
  <div class="row"><span class="lbl">Qty:</span><span>${log.quantity}</span></div>
  ${log.weight_lbs != null ? `<div class="row"><span class="lbl">Weight:</span><span>${log.weight_lbs} lbs</span></div>` : ''}
  ${log.lot_no    ? `<div class="row"><span class="lbl">Lot #:</span><span>${log.lot_no}</span></div>`    : ''}
  ${log.invoice_no? `<div class="row"><span class="lbl">Invoice:</span><span>${log.invoice_no}</span></div>` : ''}
  ${log.temp_f != null ? `<div class="row"><span class="lbl">Temp:</span><span>${log.temp_f}°F</span></div>` : ''}
  ${log.received_by ? `<div class="row"><span class="lbl">Rcvd by:</span><span>${log.received_by}</span></div>` : ''}
  <div class="footer">Scan to log as processing input</div>
  <script>
    window.onload = function() {
      JsBarcode("#bc", "${boxId}", {
        format: "CODE128", width: 1.6, height: 42,
        displayValue: true, fontSize: 9, margin: 2, textMargin: 2,
      });
      window.print();
    };
  <\/script>
  </body></html>`
  const w = window.open('', '_blank', 'width=240,height=600')
  if (w) { w.document.write(html); w.document.close() }
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
    received_at:    new Date().toISOString().slice(0, 16),
    received_by:    '',
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
    // Only show appointments still waiting to be checked in
    setAppointments(Array.isArray(appts)
      ? appts.filter(a => a.status === 'Booked' || a.status === 'InstructionsReceived')
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
    setShared({ received_at: new Date().toISOString().slice(0, 16), received_by: '', health_cert_no: '', brand_insp_no: '', notes: '' })
    setSlots(Array.from({ length: a.head_count ?? 1 }, () => blankSlot(a.species)))
  }

  function updateSlot(idx: number, updates: Partial<AnimalSlot>) {
    setSlots(prev => prev.map((s, i) => i === idx ? { ...s, ...updates } : s))
  }

  async function uploadPhoto(idx: number, file: File) {
    if (!selected) return
    updateSlot(idx, { uploading: true })
    const fd = new FormData()
    fd.append('file', file)
    fd.append('appointment_id', selected.id)
    fd.append('animal_index', String(idx + 1))
    try {
      const res = await fetch('/api/receiving/photo', { method: 'POST', body: fd })
      const json = await res.json()
      if (json.url) updateSlot(idx, { photo_url: json.url, uploading: false })
      else updateSlot(idx, { uploading: false })
    } catch {
      updateSlot(idx, { uploading: false })
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
          received_at:    shared.received_at,
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
            </div>

            {/* Shared fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1.25rem' }}>
              <Field label="Date / Time Received">
                <input type="datetime-local" style={INPUT} value={shared.received_at} onChange={e => setShared(p => ({ ...p, received_at: e.target.value }))} />
              </Field>
              <Field label="Received By">
                <input type="text" placeholder="Name" style={INPUT} value={shared.received_by} onChange={e => setShared(p => ({ ...p, received_by: e.target.value }))} />
              </Field>
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
              <button style={BTN(arrivedCount > 0 ? C.green : C.medBrown, C.dark)} onClick={handleCheckIn} disabled={saving || arrivedCount === 0}>
                {saving ? 'Saving…' : noShowCount > 0
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
                <label style={LABEL}>Age at Slaughter</label>
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
function BoxTab() {
  const [logs,       setLogs]       = useState<BoxReceivingLog[]>([])
  const [saving,     setSaving]     = useState(false)
  const [success,    setSuccess]    = useState(false)
  const [dateFilter, setDateFilter] = useState('')
  const [search,     setSearch]     = useState('')

  const empty = {
    received_at: new Date().toISOString().slice(0, 10),
    vendor: '', product: '', quantity: '1', weight_lbs: '',
    invoice_no: '', lot_no: '', temp_f: '', received_by: '', notes: '',
  }
  const [form, setForm] = useState(empty)

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
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', height: '100%' }}>
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
            {(dateFilter || search) && (
              <button onClick={() => { setDateFilter(''); setSearch('') }}
                style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '0.72rem', cursor: 'pointer', textDecoration: 'underline' }}>
                clear
              </button>
            )}
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
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
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
          {(['animal', 'box'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '0.45rem 1.25rem', border: 'none', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600,
              background: tab === t ? C.medBrown : 'transparent',
              color: tab === t ? C.cream : C.lightBrown,
              letterSpacing: '0.05em', textTransform: 'uppercase', transition: 'background 0.15s',
            }}>
              {t === 'animal' ? '🐄 Live Animal' : '📦 Box Product'}
            </button>
          ))}
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1300px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'animal' ? <AnimalTab /> : <BoxTab />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
