'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { HarvestAppointment, HarvestLog, ChillLog } from '@/lib/types'

type Tab = 'harvest' | 'chill' | 'killsheet'

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
  orange:     '#F97316',
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
    <div style={{ marginBottom: '0.85rem', gridColumn: half ? 'span 1' : 'span 2' }}>
      <label style={LABEL}>{label}</label>
      {children}
    </div>
  )
}

const SEX_OPTIONS: Record<string, string[]> = {
  Beef:  ['Steer', 'Heifer', 'Bull', 'Cow'],
  Hog:   ['Barrow', 'Gilt', 'Boar', 'Sow'],
  Lamb:  ['Wether', 'Ewe', 'Ram'],
  Goat:  ['Wether', 'Doe', 'Buck'],
}

// ── Carcass tag label — 2.4" × max 5" Brother DK continuous, Code 128 ───────
function printCarcassTags(h: HarvestLog) {
  const dateStr    = new Date(h.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const totalHCW   = h.hot_carcass_weight_lbs
  // Average half weight — same number on both tags
  const avgHalfWt  = totalHCW != null ? (totalHCW / 2) : null

  const identParts = [
    h.ear_tag ? `ET: ${h.ear_tag}` : null,
    h.sex     || null,
    h.breed   || null,
  ].filter(Boolean)
  const identLine = identParts.join('  ·  ')

  const css = `
    @page { size: 2.4in 5in; margin: 0.18in 0.14in 0.1in; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; color: #000; width: 2.12in; }

    .label           { page-break-after: always; }
    .label:last-child { page-break-after: auto; }

    /* ── Header ── */
    .header   { text-align: center; margin-bottom: 4pt; }
    .co       { font-size: 10pt; font-weight: 900; letter-spacing: 0.18em;
                text-transform: uppercase; line-height: 1.1; }
    .co-sub   { font-size: 6.5pt; letter-spacing: 0.2em; text-transform: uppercase;
                color: #444; margin-top: 1pt; }

    hr        { border: none; border-top: 0.75pt solid #000; margin: 4pt 0; }
    hr.thin   { border-top: 0.4pt solid #bbb; margin: 3pt 0; }

    /* ── Half badge ── */
    .half-badge { text-align: center; font-size: 11pt; font-weight: 900;
                  letter-spacing: 0.22em; text-transform: uppercase;
                  border: 2pt solid #000; padding: 3pt 0; margin: 3pt 0; }

    /* ── Animal identity ── */
    .producer { text-align: center; font-size: 10.5pt; font-weight: 700;
                line-height: 1.15; margin-bottom: 1pt; }
    .species  { text-align: center; font-size: 9pt; font-weight: 600;
                text-transform: uppercase; letter-spacing: 0.1em; color: #333; }
    .tagnum   { text-align: center; font-size: 52pt; font-weight: 900;
                line-height: 1.0; letter-spacing: 0.02em; margin: 2pt 0; }
    .ident    { text-align: center; font-size: 7.5pt; color: #333;
                letter-spacing: 0.03em; margin-bottom: 2pt; }

    /* ── Barcode ── */
    .bc-wrap     { text-align: center; margin: 4pt 0; padding: 0 2pt; }
    .bc-wrap svg { max-width: 100%; display: block; margin: 0 auto; }

    /* ── Data rows ── */
    .row      { display: flex; justify-content: space-between; align-items: baseline;
                font-size: 8.5pt; padding: 2pt 0; border-bottom: 0.3pt solid #eee; }
    .row:last-child { border-bottom: none; }
    .row.hl   { font-size: 10.5pt; font-weight: 700; padding: 3pt 0; }
    .lbl      { color: #555; }
    .val      { font-weight: 600; color: #000; }
    .val.big  { font-size: 12pt; }

    /* ── OTM warning ── */
    .otm { margin-top: 5pt; text-align: center; font-size: 8.5pt; font-weight: 700;
           color: #bb0000; border: 2pt solid #bb0000; padding: 3pt 0;
           letter-spacing: 0.14em; text-transform: uppercase; }
  `

  function makeLabel(side: 'L' | 'R', bcId: string) {
    const halfLabel  = side === 'L' ? '◀  L HALF' : 'R HALF  ▶'
    // Short scannable value: YYMMDD-TAG-SIDE  (e.g. 260514-001-L) — ~12 chars vs 38 for a UUID
    const shortDate  = h.harvest_date.replace(/-/g, '').slice(2)  // "260514"
    const barcodeVal = `${shortDate}-${h.carcass_tag}-${side}`
    const producerHtml = h.producer   ? `<div class="producer">${h.producer}</div>` : ''
    const identHtml    = identLine    ? `<div class="ident">${identLine}</div>`      : ''
    const otmHtml      = h.over_30_months ? `<div class="otm">&#9888; Over 30 Months</div>` : ''

    const avgHtHtml  = avgHalfWt != null
      ? `<div class="row hl"><span class="lbl">Avg Half Wt</span><span class="val big">${avgHalfWt.toFixed(1)} lbs</span></div>`
      : ''
    const totalHtml  = totalHCW != null
      ? `<div class="row"><span class="lbl">Total HCW</span><span class="val">${totalHCW} lbs</span></div>`
      : ''
    const yieldHtml  = h.yield_pct != null
      ? `<div class="row"><span class="lbl">Yield</span><span class="val">${h.yield_pct}%</span></div>`
      : ''
    const inspHtml   = h.inspector_initials
      ? `<div class="row"><span class="lbl">Inspector</span><span class="val">${h.inspector_initials}</span></div>`
      : ''
    const dateHtml   = `<div class="row"><span class="lbl">Date</span><span class="val">${dateStr}</span></div>`

    return `
    <div class="label">
      <div class="header">
        <div class="co">Cowboy Meat Co.</div>
        <div class="co-sub">Forsyth, Montana &nbsp;&middot;&nbsp; Carcass Tag</div>
      </div>
      <div class="half-badge">${halfLabel}</div>
      <hr/>
      ${producerHtml}
      <div class="species">${h.species}</div>
      <div class="tagnum">${h.carcass_tag || '—'}</div>
      ${identHtml}
      <div class="bc-wrap"><svg id="${bcId}"></svg></div>
      <hr/>
      ${dateHtml}${avgHtHtml}${totalHtml}${yieldHtml}${inspHtml}
      ${otmHtml}
      <script>
        JsBarcode("#${bcId}", "${barcodeVal}", {
          format: "CODE128", width: 2.4, height: 70,
          displayValue: true, fontSize: 9, margin: 10, textMargin: 2,
        });
      <\/script>
    </div>`
  }

  const html = `<!DOCTYPE html><html><head>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>${css}</style>
  </head><body>
  ${makeLabel('L', 'bc-l')}
  ${makeLabel('R', 'bc-r')}
  <script>window.onload = function() { window.print(); };<\/script>
  </body></html>`

  const w = window.open('', '_blank', 'width=300,height=580')
  if (w) { w.document.write(html); w.document.close() }
}

// ── Temp colour helper ────────────────────────────────────────────────────────
function tempColor(t: number | null) {
  if (t === null) return C.lightBrown
  if (t <= 40) return C.green
  if (t <= 50) return C.yellow
  return C.red
}

// ══════════════════════════════════════════════════════════════════════════════
// CARCASS ROW (inside harvest form)
// ══════════════════════════════════════════════════════════════════════════════
interface CarcassRow {
  carcass_tag:          string
  ear_tag:              string
  breed:                string
  sex:                  string
  live_weight_lbs:      string
  half_1_weight:        string   // each half weighed separately
  half_2_weight:        string
  intervention_applied: boolean
  intervention_temp_f:  string   // per-carcass override; falls back to header default
  final_carcass_temp_f: string
  ccp_pass:             boolean
  is_verification:      boolean
  direct_observation:   boolean
  over_30_months:       boolean
  notes:                string
  // mixed-kill mode fields
  appointment_id:       string
  producer:             string
  species:              string
}

function emptyCarcass(): CarcassRow {
  return {
    carcass_tag: '', ear_tag: '', breed: '', sex: '', live_weight_lbs: '',
    half_1_weight: '', half_2_weight: '',
    intervention_applied: true, intervention_temp_f: '',
    final_carcass_temp_f: '', ccp_pass: true,
    is_verification: false, direct_observation: false,
    over_30_months: false, notes: '',
    appointment_id: '', producer: '', species: '',
  }
}

function CarcassForm({
  idx, row, species, onChange, defaultSolutionTemp, verificationCount,
  isMixed, appointments, onProducerChange, onRemove,
}: {
  idx:                 number
  row:                 CarcassRow
  species:             string
  onChange:            (idx: number, field: keyof CarcassRow, val: string | boolean) => void
  defaultSolutionTemp: string
  verificationCount:   number
  isMixed?:            boolean
  appointments?:       HarvestAppointment[]
  onProducerChange?:   (idx: number, appt: HarvestAppointment | null) => void
  onRemove?:           (idx: number) => void
}) {
  const effectiveSpecies = (isMixed ? row.species : species) || 'Beef'
  const sexOpts = SEX_OPTIONS[effectiveSpecies] ?? ['Unknown']
  const h1  = parseFloat(row.half_1_weight)
  const h2  = parseFloat(row.half_2_weight)
  const hcw = (!isNaN(h1) && !isNaN(h2)) ? h1 + h2 : (!isNaN(h1) ? h1 : (!isNaN(h2) ? h2 : NaN))
  const lw  = parseFloat(row.live_weight_lbs)
  const yld = (!isNaN(lw) && !isNaN(hcw) && lw > 0) ? ((hcw / lw) * 100).toFixed(1) : '—'
  const perTag = (!isNaN(hcw)) ? (hcw / 2).toFixed(1) : '—'

  const f = (field: keyof CarcassRow) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange(idx, field, e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value)

  const canAddVerification = !row.is_verification && verificationCount >= 2

  return (
    <div style={{
      background: row.is_verification ? 'rgba(59,130,246,0.06)' : 'rgba(255,255,255,0.04)',
      border: `1px solid ${row.is_verification ? 'rgba(59,130,246,0.4)' : (isMixed && !row.appointment_id ? 'rgba(217,119,6,0.45)' : 'rgba(166,120,90,0.2)')}`,
      borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem',
    }}>

      {/* Mixed mode — producer selector */}
      {isMixed && (
        <div style={{ marginBottom: '0.85rem', paddingBottom: '0.85rem', borderBottom: '1px solid rgba(166,120,90,0.2)' }}>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={LABEL}>Producer / Appointment</label>
              <select
                style={{ ...INPUT, borderColor: !row.appointment_id ? 'rgba(217,119,6,0.55)' : undefined }}
                value={row.appointment_id}
                onChange={e => {
                  const appt = appointments?.find(a => a.id === e.target.value) ?? null
                  onProducerChange?.(idx, appt)
                }}
              >
                <option value="">— Select producer —</option>
                {(appointments ?? []).map(a => {
                  const name = a.source || a.customers?.[0]?.customer_name || 'Unknown'
                  return <option key={a.id} value={a.id}>{name} — {a.head_count} {a.species}</option>
                })}
              </select>
            </div>
            {onRemove && (
              <button
                onClick={() => onRemove(idx)}
                title="Remove this row"
                style={{ background: 'rgba(180,40,40,0.12)', border: '1px solid rgba(180,40,40,0.35)', borderRadius: 3, color: '#e05555', cursor: 'pointer', padding: '0.45rem 0.65rem', fontSize: '0.85rem', flexShrink: 0 }}
              >✕</button>
            )}
          </div>
        </div>
      )}

      {/* Card header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
        <span style={{ fontSize: '0.72rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
          {isMixed
            ? `Kill #${row.carcass_tag || (idx + 1)}${row.producer ? ` — ${row.producer}` : ' — unassigned'}`
            : `Head ${idx + 1}`}
        </span>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* OTM toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.78rem',
            color: row.over_30_months ? C.orange : C.lightBrown,
            background: row.over_30_months ? 'rgba(249,115,22,0.12)' : 'transparent',
            border: `1px solid ${row.over_30_months ? 'rgba(249,115,22,0.45)' : 'rgba(166,120,90,0.2)'}`,
            borderRadius: 3, padding: '0.2rem 0.55rem', transition: 'all 0.15s',
          }}>
            <input
              type="checkbox"
              checked={row.over_30_months}
              onChange={e => onChange(idx, 'over_30_months', e.target.checked)}
              style={{ accentColor: C.orange, width: 13, height: 13 }}
            />
            OTM
          </label>
          {row.is_verification && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.78rem',
              color: row.direct_observation ? C.blue : C.lightBrown }}>
              <input
                type="checkbox"
                checked={row.direct_observation}
                onChange={e => onChange(idx, 'direct_observation', e.target.checked)}
                style={{ accentColor: C.blue, width: 14, height: 14 }}
              />
              Direct Observation
            </label>
          )}
          <button
            onClick={() => {
              if (row.is_verification) {
                onChange(idx, 'is_verification', false)
                onChange(idx, 'direct_observation', false)
              } else if (!canAddVerification) {
                onChange(idx, 'is_verification', true)
              }
            }}
            disabled={canAddVerification}
            title={canAddVerification ? '2 verification animals already selected' : row.is_verification ? 'Remove verification flag' : 'Mark as HACCP verification animal'}
            style={{
              background: row.is_verification ? 'rgba(59,130,246,0.2)' : canAddVerification ? 'rgba(255,255,255,0.03)' : 'rgba(255,255,255,0.05)',
              border: `1px solid ${row.is_verification ? 'rgba(59,130,246,0.5)' : 'rgba(166,120,90,0.25)'}`,
              borderRadius: 3, padding: '0.22rem 0.65rem',
              color: row.is_verification ? C.blue : canAddVerification ? 'rgba(166,120,90,0.3)' : C.lightBrown,
              fontSize: '0.73rem', cursor: canAddVerification ? 'not-allowed' : 'pointer',
              fontWeight: row.is_verification ? 700 : 400,
            }}
          >
            {row.is_verification ? '✓ Verification' : '◎ Verification'}
          </button>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        {/* Tag */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Carcass Tag #</label>
          <input style={INPUT} value={row.carcass_tag} onChange={f('carcass_tag')} placeholder="e.g. 001" />
        </div>
        {/* Ear Tag */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Ear Tag / ID</label>
          <input style={INPUT} value={row.ear_tag} onChange={f('ear_tag')} placeholder="e.g. 987" />
        </div>
        {/* Sex */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Sex</label>
          <select style={{ ...INPUT }} value={row.sex} onChange={f('sex')}>
            <option value="">Select…</option>
            {sexOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        {/* Breed */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Breed</label>
          <input style={INPUT} value={row.breed} onChange={f('breed')} placeholder="e.g. Angus" />
        </div>
        {/* Live weight */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Live Weight (lbs)</label>
          <input type="number" step="0.1" style={INPUT} value={row.live_weight_lbs} onChange={f('live_weight_lbs')} placeholder="e.g. 1240" />
        </div>
        {/* Spacer */}
        <div />
      </div>

      {/* Half weights */}
      <div style={{ marginBottom: '0.5rem' }}>
        <label style={LABEL}>Hot Carcass Weight — enter by half</label>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
          <input type="number" step="0.1" style={INPUT} value={row.half_1_weight} onChange={f('half_1_weight')} placeholder="Half 1 (lbs)" />
          <input type="number" step="0.1" style={INPUT} value={row.half_2_weight} onChange={f('half_2_weight')} placeholder="Half 2 (lbs)" />
        </div>
      </div>
      {/* HCW summary */}
      <div style={{ fontSize: '0.8rem', marginBottom: '1rem', display: 'flex', gap: '1.5rem' }}>
        <span style={{ color: C.tan }}>
          Total HCW: <strong style={{ color: C.cream }}>{isNaN(hcw) ? '—' : `${hcw.toFixed(1)} lbs`}</strong>
        </span>
        <span style={{ color: C.tan }}>
          Per-tag weight: <strong style={{ color: C.cream }}>{perTag === '—' ? '—' : `${perTag} lbs / half`}</strong>
        </span>
        <span style={{ color: C.tan }}>
          Yield: <strong style={{ color: C.cream }}>{yld}{yld !== '—' ? '%' : ''}</strong>
        </span>
      </div>

      {/* CCP */}
      <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '0.85rem', marginBottom: '0.85rem' }}>
        <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.75rem' }}>
          CCP — Antimicrobial Intervention
        </div>
        <div style={{ marginBottom: '0.85rem', display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <input
            type="checkbox"
            id={`int-applied-${idx}`}
            checked={row.intervention_applied}
            onChange={f('intervention_applied')}
            style={{ accentColor: C.tan, width: 16, height: 16 }}
          />
          <label htmlFor={`int-applied-${idx}`} style={{ ...LABEL, margin: 0 }}>Intervention Applied</label>
        </div>
        <div style={{ display: 'flex', gap: '0.75rem' }}>
          {[true, false].map(v => (
            <label key={String(v)} style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', fontSize: '0.85rem', color: row.ccp_pass === v ? (v ? C.green : C.red) : C.lightBrown }}>
              <input type="radio" name={`ccp-${idx}`} checked={row.ccp_pass === v} onChange={() => onChange(idx, 'ccp_pass', v)} style={{ accentColor: v ? C.green : C.red }} />
              {v ? 'CCP Pass' : 'CCP Fail'}
            </label>
          ))}
        </div>
      </div>

      {/* Notes */}
      <div>
        <label style={LABEL}>Notes</label>
        <input style={INPUT} value={row.notes} onChange={f('notes')} placeholder="Optional" />
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// HARVEST TAB
// ══════════════════════════════════════════════════════════════════════════════
function HarvestTab() {
  const [appointments, setAppointments] = useState<HarvestAppointment[]>([])
  const [harvestLogs, setHarvestLogs] = useState<HarvestLog[]>([])
  const [selected, setSelected] = useState<HarvestAppointment | null>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [mixedMode, setMixedMode] = useState(false)

  const [header, setHeader] = useState({
    harvest_date:          new Date().toISOString().slice(0, 10),
    inspector_initials:    '',
    performed_by:          '',
    intervention_type:     'Hot Water',
    default_solution_temp: '',
  })
  const [carcasses, setCarcasses] = useState<CarcassRow[]>([emptyCarcass()])

  const load = useCallback(async () => {
    const [aRes, hRes] = await Promise.all([
      fetch('/api/appointments'),
      fetch('/api/harvest?type=log'),
    ])
    const appts: HarvestAppointment[] = await aRes.json().catch(() => [])
    const logs: HarvestLog[]          = await hRes.json().catch(() => [])
    setAppointments(Array.isArray(appts) ? appts.filter(a => a.status === 'AnimalIn') : [])
    setHarvestLogs(Array.isArray(logs) ? logs : [])
  }, [])

  useEffect(() => { load() }, [load])

  async function selectAppt(a: HarvestAppointment) {
    setSelected(a)
    setSuccess(false)
    setHeader(h => ({ ...h, harvest_date: a.harvest_date }))

    // Count existing harvest entries for this date so tag numbers continue sequentially
    const existingForDate = harvestLogs.filter(h => h.harvest_date === a.harvest_date).length

    // Fetch receiving records for this appointment (sorted by animal_index)
    let receivingAnimals: { animal_index: number; sex: string; over_30_months: boolean; ear_tag: string; breed: string }[] = []
    try {
      const res = await fetch(`/api/receiving?type=animal&appointment_id=${encodeURIComponent(a.id)}`)
      if (res.ok) receivingAnimals = await res.json().catch(() => [])
    } catch { /* ignore — just won't pre-fill */ }

    const rows = Array.from({ length: a.head_count }, (_, i) => {
      const tagNum  = String(existingForDate + i + 1).padStart(3, '0')
      const animal  = receivingAnimals[i] ?? null
      return {
        ...emptyCarcass(),
        carcass_tag:    tagNum,
        ear_tag:        animal?.ear_tag        ?? '',
        breed:          animal?.breed          ?? '',
        sex:            animal?.sex            ?? '',
        over_30_months: animal?.over_30_months ?? false,
      }
    })
    setCarcasses(rows)
  }

  function updateCarcass(idx: number, field: keyof CarcassRow, val: string | boolean) {
    setCarcasses(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }

  function handleProducerChange(idx: number, appt: HarvestAppointment | null) {
    setCarcasses(prev => prev.map((r, i) => i === idx ? {
      ...r,
      appointment_id: appt?.id ?? '',
      producer:       appt ? (appt.source || appt.customers?.[0]?.customer_name || '') : '',
      species:        appt?.species ?? '',
      sex:            r.sex || '',
    } : r))
  }

  function addMixedRow() {
    const existingCount = harvestLogs.filter(h => h.harvest_date === header.harvest_date).length
    const tagNum = String(existingCount + carcasses.length + 1).padStart(3, '0')
    setCarcasses(prev => [...prev, { ...emptyCarcass(), carcass_tag: tagNum }])
  }

  function removeMixedRow(idx: number) {
    setCarcasses(prev => {
      const next = prev.filter((_, i) => i !== idx)
      // Re-sequence tag numbers
      const base = harvestLogs.filter(h => h.harvest_date === header.harvest_date).length
      return next.map((r, i) => ({ ...r, carcass_tag: String(base + i + 1).padStart(3, '0') }))
    })
  }

  function enterMixedMode() {
    setSelected(null)
    setMixedMode(true)
    const existingCount = harvestLogs.filter(h => h.harvest_date === header.harvest_date).length
    setCarcasses([{ ...emptyCarcass(), carcass_tag: String(existingCount + 1).padStart(3, '0') }])
  }

  function exitMixedMode() {
    setMixedMode(false)
    setSelected(null)
    setCarcasses([emptyCarcass()])
  }

  const hf = (k: keyof typeof header) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setHeader(p => ({ ...p, [k]: e.target.value }))

  async function markNoShow(a: HarvestAppointment) {
    const label = a.source || a.customers?.[0]?.customer_name || 'this appointment'
    if (!window.confirm(`Mark ${label} as No Show? This will remove them from the Ready to Harvest list.`)) return
    await fetch('/api/appointments', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: a.id, status: 'NoShow' }),
    })
    if (selected?.id === a.id) setSelected(null)
    setAppointments(prev => prev.filter(x => x.id !== a.id))
  }

  function buildCarcassPayload(c: CarcassRow) {
    const h1  = parseFloat(c.half_1_weight)
    const h2  = parseFloat(c.half_2_weight)
    const hcw = (!isNaN(h1) && !isNaN(h2)) ? h1 + h2
              : (!isNaN(h1) ? h1 : (!isNaN(h2) ? h2 : null))
    const solTemp = c.intervention_temp_f
      ? parseFloat(c.intervention_temp_f)
      : header.default_solution_temp ? parseFloat(header.default_solution_temp) : null
    return {
      carcass_tag:            c.carcass_tag,
      ear_tag:                c.ear_tag,
      breed:                  c.breed,
      sex:                    c.sex,
      live_weight_lbs:        c.live_weight_lbs ? parseFloat(c.live_weight_lbs) : null,
      half_1_weight_lbs:      !isNaN(h1) ? h1 : null,
      half_2_weight_lbs:      !isNaN(h2) ? h2 : null,
      hot_carcass_weight_lbs: hcw,
      intervention_applied:   c.intervention_applied,
      intervention_temp_f:    solTemp,
      final_carcass_temp_f:   c.final_carcass_temp_f ? parseFloat(c.final_carcass_temp_f) : null,
      ccp_pass:               c.ccp_pass,
      is_verification:        c.is_verification,
      direct_observation:     c.direct_observation,
      over_30_months:         c.over_30_months,
      notes:                  c.notes,
    }
  }

  async function handleSubmit() {
    if (!mixedMode && !selected) return
    setSaving(true)

    if (mixedMode) {
      // Group rows by appointment_id, submit each group separately
      const groups = new Map<string, CarcassRow[]>()
      for (const c of carcasses) {
        const key = c.appointment_id || '__unassigned__'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(c)
      }
      await Promise.all([...groups.entries()].map(([apptId, rows]) => {
        const appt = appointments.find(a => a.id === apptId)
        return fetch('/api/harvest', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            type:               'log',
            appointment_id:     apptId === '__unassigned__' ? null : apptId,
            harvest_date:       header.harvest_date,
            species:            appt?.species ?? rows[0].species ?? 'Beef',
            inspector_initials: header.inspector_initials,
            performed_by:       header.performed_by,
            intervention_type:  header.intervention_type,
            producer:           rows[0].producer,
            carcasses:          rows.map(buildCarcassPayload),
          }),
        })
      }))
    } else {
      await fetch('/api/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:               'log',
          appointment_id:     selected!.id,
          harvest_date:       header.harvest_date,
          species:            selected!.species,
          inspector_initials: header.inspector_initials,
          performed_by:       header.performed_by,
          intervention_type:  header.intervention_type,
          producer:           selected!.source || (selected!.customers?.[0]?.customer_name ?? ''),
          carcasses:          carcasses.map(buildCarcassPayload),
        }),
      })
    }

    setSaving(false)
    setSuccess(true)
    setSelected(null)
    if (mixedMode) setCarcasses([{ ...emptyCarcass(), carcass_tag: String(carcasses.length + 1).padStart(3, '0') }])
    load()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — appointment list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            Ready to Harvest ({appointments.length})
          </span>
          <button
            onClick={mixedMode ? exitMixedMode : enterMixedMode}
            title={mixedMode ? 'Exit Mixed Kill mode' : 'Enter Mixed Kill mode — log animals from multiple appointments in kill order'}
            style={{
              fontSize: '0.7rem', fontWeight: 700, padding: '0.25rem 0.6rem', borderRadius: 3, cursor: 'pointer',
              background: mixedMode ? 'rgba(217,119,6,0.25)' : 'rgba(166,120,90,0.12)',
              border: mixedMode ? '1px solid rgba(217,119,6,0.6)' : '1px solid rgba(166,120,90,0.3)',
              color: mixedMode ? '#f59e0b' : C.tan,
            }}
          >
            {mixedMode ? '⚡ Mixed ON' : '⚡ Mixed Kill'}
          </button>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {appointments.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>
              No animals checked in yet.<br />
              <span style={{ fontSize: '0.78rem' }}>Check in via Receiving first.</span>
            </p>
          )}
          {appointments.map(a => (
            <div
              key={a.id}
              onClick={() => selectAppt(a)}
              style={{
                padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.12)',
                cursor: 'pointer', background: selected?.id === a.id ? 'rgba(166,120,90,0.12)' : 'transparent',
                transition: 'background 0.15s',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.15rem' }}>
                  {a.species} — {a.head_count} head
                </div>
                <button
                  onClick={e => { e.stopPropagation(); markNoShow(a) }}
                  title="Mark as No Show"
                  style={{ background: 'rgba(180,40,40,0.15)', border: '1px solid rgba(180,40,40,0.5)', borderRadius: 4, color: '#e05555', cursor: 'pointer', fontSize: '0.7rem', padding: '0.15rem 0.45rem', fontWeight: 700, flexShrink: 0, marginLeft: '0.5rem' }}
                >No Show</button>
              </div>
              {a.source && (
                <div style={{ fontSize: '0.85rem', color: C.tan, fontWeight: 600, marginBottom: '0.1rem' }}>
                  {a.source}
                </div>
              )}
              <div style={{ fontSize: '0.76rem', color: C.lightBrown }}>
                {new Date(a.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </div>
              {a.customers?.length > 0 && (
                <div style={{ fontSize: '0.74rem', color: C.lightBrown, marginTop: '0.1rem' }}>
                  {a.customers.map(c => c.customer_name).join(', ')}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Recent harvests */}
        {harvestLogs.length > 0 && (
          <>
            <div style={{ padding: '0.65rem 1.25rem', borderTop: '1px solid rgba(166,120,90,0.2)', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Recent ({harvestLogs.slice(0, 5).length})
            </div>
            {harvestLogs.slice(0, 8).map(h => (
              <div key={h.id} style={{ padding: '0.65rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.08)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div>
                    <div style={{ color: C.cream, fontSize: '0.85rem' }}>
                      {h.species} — Tag {h.carcass_tag || '—'}
                      {h.ear_tag ? <span style={{ color: C.lightBrown, fontWeight: 400 }}> · {h.ear_tag}</span> : null}
                    </div>
                    {h.producer && (
                      <div style={{ fontSize: '0.76rem', color: C.tan, fontWeight: 600 }}>{h.producer}</div>
                    )}
                    <div style={{ fontSize: '0.74rem', color: C.lightBrown }}>
                      {new Date(h.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                      {h.hot_carcass_weight_lbs ? ` · ${h.hot_carcass_weight_lbs} lbs HCW` : ''}
                      {h.yield_pct ? ` · ${h.yield_pct}%` : ''}
                    </div>
                  </div>
                  <button
                    onClick={() => printCarcassTags(h)}
                    title="Print carcass tag"
                    style={{ background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.3)', color: C.tan, borderRadius: 3, padding: '2px 7px', fontSize: '0.7rem', cursor: 'pointer', flexShrink: 0, marginLeft: '0.4rem' }}
                  >
                    🏷 Tag
                  </button>
                </div>
              </div>
            ))}
          </>
        )}
      </div>

      {/* Right — harvest form */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
        {success && (
          <div style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 4, padding: '0.85rem 1.25rem', marginBottom: '1.5rem', color: C.green, fontSize: '0.9rem' }}>
            ✓ Harvest logged — appointment updated to Processing
          </div>
        )}

        {!mixedMode && !selected ? (
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '60%', gap: '1rem', color: C.lightBrown, fontSize: '0.9rem' }}>
            <div>← Select an appointment to log harvest</div>
            <div style={{ fontSize: '0.78rem', color: C.lightBrown, opacity: 0.7 }}>
              or use <strong style={{ color: C.tan }}>⚡ Mixed Kill</strong> to log animals from multiple groups in rail order
            </div>
          </div>
        ) : (
          <>
            {/* Mixed mode banner */}
            {mixedMode && (
              <div style={{ background: 'rgba(217,119,6,0.12)', border: '1px solid rgba(217,119,6,0.4)', borderRadius: 4, padding: '0.75rem 1.1rem', marginBottom: '1.25rem', display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <span style={{ fontSize: '1.1rem' }}>⚡</span>
                <div>
                  <div style={{ fontSize: '0.85rem', fontWeight: 700, color: '#f59e0b' }}>Mixed Kill Mode</div>
                  <div style={{ fontSize: '0.76rem', color: C.tan, marginTop: '0.1rem' }}>
                    Each animal row has its own producer selector. Add animals in actual kill order — group by appointment happens automatically on submit.
                  </div>
                </div>
              </div>
            )}

            {/* Appointment summary (single-appointment mode only) */}
            {!mixedMode && selected && (
              <div style={{ background: 'rgba(166,120,90,0.08)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
                <div style={{ color: C.cream, fontWeight: 700, fontSize: '1rem' }}>
                  {selected.species} — {selected.head_count} head
                </div>
                {selected.customers?.length > 0 && (
                  <div style={{ fontSize: '0.8rem', color: C.tan, marginTop: '0.2rem' }}>
                    {selected.customers.map(c => c.customer_name).join(', ')}
                  </div>
                )}
              </div>
            )}

            {/* Header fields — row 1 */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 1rem', marginBottom: '0.85rem' }}>
              <div>
                <label style={LABEL}>Harvest Date</label>
                <input type="date" style={INPUT} value={header.harvest_date} onChange={hf('harvest_date')} />
              </div>
              <div>
                <label style={LABEL}>Inspector Initials</label>
                <input style={INPUT} value={header.inspector_initials} onChange={hf('inspector_initials')} placeholder="e.g. JD" />
              </div>
              <div>
                <label style={LABEL}>Performed By</label>
                <input style={INPUT} value={header.performed_by} onChange={hf('performed_by')} placeholder="Name" />
              </div>
            </div>
            {/* Header fields — row 2 (CCP defaults) */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 2fr', gap: '0 1rem', marginBottom: '1rem', padding: '0.75rem 1rem', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.18)', borderRadius: 3 }}>
              <div>
                <label style={LABEL}>Intervention Type (day)</label>
                <select style={{ ...INPUT }} value={header.intervention_type} onChange={hf('intervention_type')}>
                  <option value="Hot Water">Hot Water</option>
                  <option value="Steam">Steam</option>
                  <option value="Organic Acid">Organic Acid</option>
                  <option value="Other">Other</option>
                </select>
              </div>
              <div>
                <label style={LABEL}>Default Solution Temp (°F)</label>
                <input type="number" step="0.1" style={INPUT} value={header.default_solution_temp} onChange={hf('default_solution_temp')} placeholder="e.g. 165" />
              </div>
              <div style={{ display: 'flex', alignItems: 'flex-end', paddingBottom: '0.1rem' }}>
                <span style={{ fontSize: '0.75rem', color: C.lightBrown, fontStyle: 'italic' }}>
                  These apply to all carcasses. You can override the solution temp per carcass below.
                </span>
              </div>
            </div>

            {/* HACCP Verification Summary */}
            {(() => {
              const verCount  = carcasses.filter(c => c.is_verification).length
              const hasDir    = carcasses.some(c => c.is_verification && c.direct_observation)
              const ready     = verCount === 2 && hasDir
              if (verCount === 0) return null
              return (
                <div style={{
                  marginBottom: '1rem', padding: '0.7rem 1rem', borderRadius: 3,
                  background: ready ? 'rgba(76,175,80,0.1)' : 'rgba(217,119,6,0.12)',
                  border: `1px solid ${ready ? 'rgba(76,175,80,0.35)' : 'rgba(217,119,6,0.4)'}`,
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                }}>
                  <span style={{ fontSize: '1rem' }}>{ready ? '✓' : '⚠'}</span>
                  <div>
                    <div style={{ fontSize: '0.82rem', fontWeight: 600, color: ready ? C.green : C.yellow }}>
                      HACCP Hot Water Verification
                    </div>
                    <div style={{ fontSize: '0.76rem', color: C.tan, marginTop: '0.15rem' }}>
                      {verCount} of 2 verification {verCount === 1 ? 'animal' : 'animals'} selected
                      {' · '}
                      {hasDir ? '1 Direct Observation ✓' : 'Direct Observation needed on 1 verification animal'}
                    </div>
                  </div>
                </div>
              )
            })()}

            {/* Per-carcass forms */}
            <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '1.25rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem' }}>
                {mixedMode
                  ? `Carcass Records — ${carcasses.length} animal${carcasses.length !== 1 ? 's' : ''} (mixed)`
                  : `Carcass Records — ${selected!.head_count} head`}
              </div>
              {(() => {
                const verificationCount = carcasses.filter(c => c.is_verification).length
                return carcasses.map((row, i) => (
                  <CarcassForm
                    key={i}
                    idx={i}
                    row={row}
                    species={mixedMode ? (row.species || 'Beef') : selected!.species}
                    onChange={updateCarcass}
                    defaultSolutionTemp={header.default_solution_temp}
                    verificationCount={verificationCount}
                    isMixed={mixedMode}
                    appointments={mixedMode ? appointments : undefined}
                    onProducerChange={mixedMode ? handleProducerChange : undefined}
                    onRemove={mixedMode && carcasses.length > 1 ? removeMixedRow : undefined}
                  />
                ))
              })()}

              {/* Add Animal button (mixed mode only) */}
              {mixedMode && (
                <button
                  onClick={addMixedRow}
                  style={{
                    width: '100%', padding: '0.65rem', borderRadius: 4, cursor: 'pointer',
                    background: 'rgba(166,120,90,0.08)', border: '1px dashed rgba(166,120,90,0.35)',
                    color: C.tan, fontSize: '0.85rem', fontWeight: 600, marginTop: '0.25rem',
                  }}
                >
                  + Add Animal
                </button>
              )}
            </div>

            {/* Validation warning (mixed mode) */}
            {mixedMode && carcasses.some(c => !c.appointment_id) && (
              <div style={{ background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.35)', borderRadius: 3, padding: '0.6rem 1rem', marginBottom: '1rem', fontSize: '0.8rem', color: '#f59e0b' }}>
                ⚠ Assign a producer to every animal before submitting
              </div>
            )}

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                style={BTN(C.tan)}
                onClick={handleSubmit}
                disabled={saving || (mixedMode && carcasses.some(c => !c.appointment_id))}
              >
                {saving ? 'Saving…' : '✓ Log Harvest'}
              </button>
              <button
                style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }}
                onClick={mixedMode ? exitMixedMode : () => setSelected(null)}
              >
                {mixedMode ? 'Exit Mixed Mode' : 'Cancel'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CHILL LOG TAB
// ══════════════════════════════════════════════════════════════════════════════
function ChillTab() {
  const [carcasses, setCarcasses] = useState<HarvestLog[]>([])
  const [chillLogs, setChillLogs] = useState<ChillLog[]>([])
  const [selected, setSelected] = useState<HarvestLog | null>(null)
  const [saving, setSaving] = useState(false)

  const [form, setForm] = useState({
    checked_at:    new Date().toISOString().slice(0, 16),
    carcass_temp_f: '',
    cooler_temp_f:  '',
    checked_by:     '',
    notes:          '',
  })

  const load = useCallback(async () => {
    const [cRes, lRes] = await Promise.all([
      fetch('/api/harvest?type=log'),
      fetch('/api/harvest?type=chill'),
    ])
    const c: HarvestLog[] = await cRes.json()
    const l: ChillLog[] = await lRes.json()
    setCarcasses(c.filter(h => h.status === 'chilling'))
    setChillLogs(l)
  }, [])

  useEffect(() => { load() }, [load])

  function hoursAgo(dateStr: string) {
    const diff = Date.now() - new Date(dateStr).getTime()
    return (diff / 3600000).toFixed(1)
  }

  function latestTemp(harvestId: string): number | null {
    const readings = chillLogs.filter(l => l.harvest_log_id === harvestId)
    if (readings.length === 0) return null
    return readings[0].carcass_temp_f
  }

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleAddReading() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/harvest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:           'chill',
        harvest_log_id: selected.id,
        carcass_tag:    selected.carcass_tag,
        checked_at:     form.checked_at,
        carcass_temp_f: form.carcass_temp_f ? parseFloat(form.carcass_temp_f) : null,
        cooler_temp_f:  form.cooler_temp_f ? parseFloat(form.cooler_temp_f) : null,
        checked_by:     form.checked_by,
        notes:          form.notes,
      }),
    })

    // If temp is ≤40 and it's been 24+ hrs, offer to mark complete
    const hrs = parseFloat(hoursAgo(selected.created_at))
    const temp = parseFloat(form.carcass_temp_f)
    if (!isNaN(temp) && temp <= 40 && hrs >= 24) {
      await fetch('/api/harvest', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'log', id: selected.id, status: 'complete' }),
      })
    }

    setSaving(false)
    setSelected(null)
    setForm({ checked_at: new Date().toISOString().slice(0, 16), carcass_temp_f: '', cooler_temp_f: '', checked_by: '', notes: '' })
    load()
  }

  // USDA: beef ≤40°F in 48hr, pork ≤40°F in 24hr
  function deadline(h: HarvestLog) {
    const hrs = h.species === 'Hog' ? 24 : 48
    const t = new Date(h.created_at)
    t.setHours(t.getHours() + hrs)
    return t
  }

  function deadlineColor(h: HarvestLog) {
    const dl = deadline(h)
    const lt = latestTemp(h.id)
    if (lt !== null && lt <= 40) return C.green
    const hoursLeft = (dl.getTime() - Date.now()) / 3600000
    if (hoursLeft < 4) return C.red
    if (hoursLeft < 12) return C.orange
    return C.tan
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — chilling carcasses */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Chilling ({carcasses.length})
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {carcasses.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>No carcasses chilling</p>
          )}
          {carcasses.map(h => {
            const lt = latestTemp(h.id)
            const hrs = hoursAgo(h.created_at)
            const dl = deadline(h)
            const dlStr = dl.toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
            return (
              <div
                key={h.id}
                onClick={() => setSelected(h)}
                style={{
                  padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.12)',
                  cursor: 'pointer', background: selected?.id === h.id ? 'rgba(166,120,90,0.12)' : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>
                      {h.species} — Tag {h.carcass_tag || '—'}
                    </div>
                    <div style={{ fontSize: '0.78rem', color: C.tan, marginTop: '0.15rem' }}>
                      {hrs} hrs in cooler
                      {h.hot_carcass_weight_lbs ? ` · ${h.hot_carcass_weight_lbs} lbs HCW` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: tempColor(lt) }}>
                      {lt !== null ? `${lt}°F` : '—'}
                    </div>
                    <div style={{ fontSize: '0.7rem', color: C.lightBrown }}>latest</div>
                  </div>
                </div>
                <div style={{ fontSize: '0.73rem', color: deadlineColor(h), marginTop: '0.4rem' }}>
                  ⏱ Deadline: {dlStr}
                </div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right — add reading + history */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '50%', color: C.lightBrown, fontSize: '0.9rem' }}>
            ← Select a carcass to log a temperature
          </div>
        ) : (
          <>
            <div style={{ background: 'rgba(166,120,90,0.08)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1.25rem' }}>
              <div style={{ color: C.cream, fontWeight: 700 }}>{selected.species} — Tag {selected.carcass_tag || '—'}</div>
              <div style={{ fontSize: '0.8rem', color: C.tan, marginTop: '0.2rem' }}>
                {hoursAgo(selected.created_at)} hrs in cooler
                {selected.hot_carcass_weight_lbs ? ` · ${selected.hot_carcass_weight_lbs} lbs HCW` : ''}
                {selected.sex ? ` · ${selected.sex}` : ''}
              </div>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem', marginBottom: '1rem' }}>
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={LABEL}>Time Checked</label>
                <input type="datetime-local" style={INPUT} value={form.checked_at} onChange={f('checked_at')} />
              </div>
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={LABEL}>Checked By</label>
                <input style={INPUT} value={form.checked_by} onChange={f('checked_by')} placeholder="Name" />
              </div>
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={LABEL}>Carcass Temp (°F)</label>
                <input type="number" step="0.1" style={{ ...INPUT, color: tempColor(form.carcass_temp_f ? parseFloat(form.carcass_temp_f) : null) }} value={form.carcass_temp_f} onChange={f('carcass_temp_f')} placeholder="e.g. 38.5" />
              </div>
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={LABEL}>Cooler Temp (°F)</label>
                <input type="number" step="0.1" style={INPUT} value={form.cooler_temp_f} onChange={f('cooler_temp_f')} placeholder="e.g. 34" />
              </div>
            </div>

            <div style={{ marginBottom: '1rem' }}>
              <label style={LABEL}>Notes</label>
              <input style={INPUT} value={form.notes} onChange={f('notes')} placeholder="Optional" />
            </div>

            <button style={BTN(C.tan)} onClick={handleAddReading} disabled={saving || !form.carcass_temp_f}>
              {saving ? 'Saving…' : '+ Add Reading'}
            </button>

            {/* Reading history */}
            {chillLogs.filter(l => l.harvest_log_id === selected.id).length > 0 && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '1rem' }}>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
                  Temperature History
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {chillLogs.filter(l => l.harvest_log_id === selected.id).map(l => (
                    <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.85rem', background: 'rgba(255,255,255,0.04)', borderRadius: 3 }}>
                      <div>
                        <span style={{ color: C.cream, fontWeight: 700, fontSize: '1rem', marginRight: '0.75rem' }}>
                          <span style={{ color: tempColor(l.carcass_temp_f) }}>{l.carcass_temp_f}°F</span>
                        </span>
                        {l.cooler_temp_f != null && <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>Cooler: {l.cooler_temp_f}°F</span>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.8rem', color: C.tan }}>
                          {new Date(l.checked_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
                        </div>
                        {l.checked_by && <div style={{ fontSize: '0.75rem', color: C.lightBrown }}>{l.checked_by}</div>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// KILL SHEET TAB
// ══════════════════════════════════════════════════════════════════════════════

const TD: React.CSSProperties = {
  padding: '0.6rem 0.85rem',
  color: C.cream,
  verticalAlign: 'middle',
  whiteSpace: 'nowrap',
}

function StatBlock({ label, value }: { label: string; value: string | number }) {
  return (
    <div>
      <div style={{ fontSize: '0.69rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.15rem' }}>{label}</div>
      <div style={{ fontSize: '1.15rem', fontWeight: 700, color: C.cream }}>{value}</div>
    </div>
  )
}

type EditVals = {
  live_weight_lbs:   string
  half_1_weight_lbs: string
  half_2_weight_lbs: string
  ear_tag:           string
  sex:               string
  breed:             string
  notes:             string
}

function emptyEdit(l: HarvestLog): EditVals {
  return {
    live_weight_lbs:   l.live_weight_lbs   != null ? String(l.live_weight_lbs)   : '',
    half_1_weight_lbs: l.half_1_weight_lbs != null ? String(l.half_1_weight_lbs) : '',
    half_2_weight_lbs: l.half_2_weight_lbs != null ? String(l.half_2_weight_lbs) : '',
    ear_tag:           l.ear_tag  ?? '',
    sex:               l.sex      ?? '',
    breed:             l.breed    ?? '',
    notes:             l.notes    ?? '',
  }
}

function KillSheetTab() {
  const todayStr = new Date().toISOString().slice(0, 10)
  const [date, setDate]           = useState(todayStr)
  const [logs, setLogs]           = useState<HarvestLog[]>([])
  const [pending, setPending]     = useState<HarvestAppointment[]>([])
  const [loading, setLoading]     = useState(false)
  const [editId, setEditId]       = useState<string | null>(null)
  const [editVals, setEditVals]   = useState<EditVals | null>(null)
  const [saving, setSaving]       = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    const [hRes, aRes] = await Promise.all([
      fetch(`/api/harvest?type=log&date=${date}`),
      fetch('/api/appointments'),
    ])
    const allLogs: HarvestLog[]             = await hRes.json().catch(() => [])
    const allAppts: HarvestAppointment[]    = await aRes.json().catch(() => [])
    setLogs(Array.isArray(allLogs) ? allLogs : [])
    setPending(Array.isArray(allAppts) ? allAppts.filter(a => a.harvest_date === date && a.status === 'AnimalIn') : [])
    setLoading(false)
  }, [date])

  useEffect(() => { load() }, [load])

  function startEdit(l: HarvestLog) {
    setEditId(l.id)
    setEditVals(emptyEdit(l))
  }

  function cancelEdit() {
    setEditId(null)
    setEditVals(null)
  }

  async function saveEdit(id: string) {
    if (!editVals) return
    setSaving(true)
    const lw = editVals.live_weight_lbs   !== '' ? parseFloat(editVals.live_weight_lbs)   : null
    const h1 = editVals.half_1_weight_lbs !== '' ? parseFloat(editVals.half_1_weight_lbs) : null
    const h2 = editVals.half_2_weight_lbs !== '' ? parseFloat(editVals.half_2_weight_lbs) : null
    const hcw = (h1 != null && h2 != null) ? h1 + h2
              : (h1 != null ? h1 : (h2 != null ? h2 : null))
    const yieldPct = lw && hcw ? Math.round((hcw / lw) * 1000) / 10 : null
    await fetch('/api/harvest', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        live_weight_lbs:        lw,
        half_1_weight_lbs:      h1,
        half_2_weight_lbs:      h2,
        hot_carcass_weight_lbs: hcw,
        yield_pct:              yieldPct,
        ear_tag:                editVals.ear_tag,
        sex:                    editVals.sex,
        breed:                  editVals.breed,
        notes:                  editVals.notes,
      }),
    })
    setSaving(false)
    setEditId(null)
    setEditVals(null)
    load()
  }

  const shiftDate = (days: number) => {
    const d = new Date(date + 'T12:00:00')
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().slice(0, 10))
  }

  const totalHead   = logs.length
  const totalHCW    = logs.reduce((s, l) => s + (l.hot_carcass_weight_lbs ?? 0), 0)
  const totalLW     = logs.reduce((s, l) => s + (l.live_weight_lbs ?? 0), 0)
  const yieldLogs   = logs.filter(l => l.yield_pct != null)
  const avgDress    = yieldLogs.length > 0 ? yieldLogs.reduce((s, l) => s + (l.yield_pct ?? 0), 0) / yieldLogs.length : null

  const bySpecies = logs.reduce<Record<string, Record<string, number>>>((acc, l) => {
    if (!acc[l.species]) acc[l.species] = {}
    const sex = l.sex || 'Unknown'
    acc[l.species][sex] = (acc[l.species][sex] ?? 0) + 1
    return acc
  }, {})

  const formattedDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  })

  const NAV_BTN: React.CSSProperties = {
    background: 'rgba(166,120,90,0.12)', border: '1px solid rgba(166,120,90,0.3)',
    color: C.tan, borderRadius: 3, padding: '0.4rem 0.75rem',
    fontSize: '1rem', cursor: 'pointer', lineHeight: 1,
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.1rem' }}>

      {/* Date nav */}
      <div data-print-hide style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <button onClick={() => shiftDate(-1)} style={NAV_BTN}>‹</button>
          <input
            type="date"
            value={date}
            onChange={e => setDate(e.target.value)}
            style={{ ...INPUT, width: 'auto', padding: '0.4rem 0.75rem' }}
          />
          <button onClick={() => shiftDate(1)} style={NAV_BTN}>›</button>
          <span style={{ color: C.tan, fontSize: '0.9rem', fontWeight: 600, marginLeft: '0.25rem' }}>
            {formattedDate}
          </span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
          {date !== todayStr && (
            <button onClick={() => setDate(todayStr)} style={{ ...BTN('rgba(166,120,90,0.12)', C.tan), border: '1px solid rgba(166,120,90,0.3)' }}>
              Today
            </button>
          )}
          <button onClick={() => window.print()} style={{ ...BTN('rgba(166,120,90,0.12)', C.tan), border: '1px solid rgba(166,120,90,0.3)' }}>
            Print
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {logs.length > 0 && (
        <div data-print-summary style={{
          display: 'flex', gap: '1.5rem', padding: '0.85rem 1.25rem', flexWrap: 'wrap', alignItems: 'center',
          background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4,
        }}>
          <StatBlock label="Head Harvested" value={totalHead} />
          <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(166,120,90,0.2)' }} />
          <StatBlock label="Total Live Wt" value={totalLW > 0 ? `${totalLW.toLocaleString()} lbs` : '—'} />
          <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(166,120,90,0.2)' }} />
          <StatBlock label="Total HCW" value={totalHCW > 0 ? `${totalHCW.toLocaleString()} lbs` : '—'} />
          {avgDress !== null && (
            <>
              <div style={{ width: 1, alignSelf: 'stretch', background: 'rgba(166,120,90,0.2)' }} />
              <StatBlock label="Avg Dress %" value={`${avgDress.toFixed(1)}%`} />
            </>
          )}
          {Object.entries(bySpecies).map(([sp, sexMap]) => (
            <div key={sp} style={{ marginLeft: '0.5rem' }}>
              <div style={{ fontSize: '0.69rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.15rem' }}>{sp}</div>
              <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                {Object.entries(sexMap).map(([sex, n]) => (
                  <span key={sex} style={{ fontSize: '0.82rem', color: C.tan, fontWeight: 600 }}>{sex} {n}</span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Print-only title */}
      <div data-print-title style={{ display: 'none' }}>
        <div style={{ fontSize: '13pt', fontWeight: 700, marginBottom: '4pt' }}>Cowboy Meat Company — Kill Sheet</div>
        <div style={{ fontSize: '10pt', color: '#444', marginBottom: '10pt' }}>{formattedDate}</div>
      </div>

      {/* Kill sheet table */}
      {loading ? (
        <p style={{ color: C.lightBrown, textAlign: 'center', padding: '2.5rem', fontSize: '0.9rem' }}>Loading…</p>
      ) : logs.length === 0 && pending.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '3.5rem', color: C.lightBrown, fontSize: '0.9rem', background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4 }}>
          No harvest activity for this date.
        </div>
      ) : (
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.875rem' }}>
            <thead>
              <tr style={{ background: 'rgba(166,120,90,0.12)', borderBottom: '1px solid rgba(166,120,90,0.3)' }}>
                {['Kill #', 'Producer', 'Species', 'Ear Tag', 'Sex', 'Breed', 'Live Wt', 'L Half', 'R Half', 'Total HCW', 'Dress %', 'CCP', 'Tag #', ''].map(h => (
                  <th key={h} style={{ padding: '0.65rem 0.85rem', textAlign: ['Live Wt','L Half','R Half','Total HCW','Dress %'].includes(h) ? 'right' : 'left', color: C.lightBrown, fontSize: '0.69rem', textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 600, whiteSpace: 'nowrap' }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {logs.map((l, i) => {
                const killNum    = parseInt(l.carcass_tag, 10) || (i + 1)
                const isEditing  = editId === l.id
                const dressColor = l.yield_pct == null ? C.lightBrown
                  : l.yield_pct >= 58 ? C.green
                  : l.yield_pct >= 54 ? C.yellow
                  : C.red
                const rowBg = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)'

                if (isEditing && editVals) {
                  const ev = editVals
                  const setEv = (k: keyof EditVals, v: string) => setEditVals(prev => prev ? { ...prev, [k]: v } : prev)
                  const h1p = ev.half_1_weight_lbs !== '' ? parseFloat(ev.half_1_weight_lbs) : null
                  const h2p = ev.half_2_weight_lbs !== '' ? parseFloat(ev.half_2_weight_lbs) : null
                  const hcwPreview = (h1p != null && h2p != null) ? h1p + h2p
                                   : (h1p != null ? h1p : (h2p != null ? h2p : null))
                  const lwp = ev.live_weight_lbs !== '' ? parseFloat(ev.live_weight_lbs) : null
                  const previewDress = lwp && hcwPreview ? (hcwPreview / lwp * 100).toFixed(1) : null
                  const EINPUT: React.CSSProperties = { ...INPUT, padding: '0.3rem 0.5rem', fontSize: '0.83rem' }
                  return (
                    <tr key={l.id} style={{ borderBottom: '1px solid rgba(166,120,90,0.2)', background: 'rgba(166,120,90,0.07)' }}>
                      <td style={{ ...TD, color: C.lightBrown }}>{killNum}</td>
                      <td style={{ ...TD, color: C.tan, fontWeight: 600 }}>{l.producer || '—'}</td>
                      <td style={TD}>{l.species}</td>
                      <td style={TD}><input value={ev.ear_tag} onChange={e => setEv('ear_tag', e.target.value)} style={{ ...EINPUT, width: 80, fontFamily: 'monospace' }} /></td>
                      <td style={TD}>
                        <select value={ev.sex} onChange={e => setEv('sex', e.target.value)} style={{ ...EINPUT, width: 90 }}>
                          <option value="">—</option>
                          {(SEX_OPTIONS[l.species] ?? ['Steer','Heifer','Bull','Cow']).map(s => <option key={s}>{s}</option>)}
                        </select>
                      </td>
                      <td style={TD}><input value={ev.breed} onChange={e => setEv('breed', e.target.value)} style={{ ...EINPUT, width: 80 }} /></td>
                      {/* Live Wt */}
                      <td style={TD}><input type="number" value={ev.live_weight_lbs} onChange={e => setEv('live_weight_lbs', e.target.value)} placeholder="lbs" style={{ ...EINPUT, width: 72, textAlign: 'right' }} /></td>
                      {/* L Half */}
                      <td style={TD}><input type="number" value={ev.half_1_weight_lbs} onChange={e => setEv('half_1_weight_lbs', e.target.value)} placeholder="lbs" style={{ ...EINPUT, width: 72, textAlign: 'right' }} /></td>
                      {/* R Half */}
                      <td style={TD}><input type="number" value={ev.half_2_weight_lbs} onChange={e => setEv('half_2_weight_lbs', e.target.value)} placeholder="lbs" style={{ ...EINPUT, width: 72, textAlign: 'right' }} /></td>
                      {/* Total (auto) */}
                      <td style={{ ...TD, textAlign: 'right', color: C.tan, fontWeight: 700 }}>{hcwPreview != null ? hcwPreview.toFixed(0) : '—'}</td>
                      {/* Dress (auto) */}
                      <td style={{ ...TD, textAlign: 'right', color: C.tan, fontWeight: 600 }}>{previewDress ? `${previewDress}%` : '—'}</td>
                      <td style={{ ...TD, textAlign: 'center' }}>{l.ccp_pass ? <span style={{ color: C.green }}>✓</span> : <span style={{ color: C.red }}>✗</span>}</td>
                      <td style={{ ...TD, fontFamily: 'monospace', fontWeight: 700 }}>{l.carcass_tag}</td>
                      <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                        <button onClick={() => saveEdit(l.id)} disabled={saving} style={{ ...BTN(C.tan), fontSize: '0.75rem', padding: '0.3rem 0.75rem', marginRight: '0.35rem' }}>
                          {saving ? '…' : 'Save'}
                        </button>
                        <button onClick={cancelEdit} style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)', fontSize: '0.75rem', padding: '0.3rem 0.6rem' }}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  )
                }

                return (
                  <tr key={l.id} style={{ borderBottom: '1px solid rgba(166,120,90,0.08)', background: rowBg }}>
                    <td style={{ ...TD, color: C.lightBrown, width: 42, fontWeight: 700 }}>{killNum}</td>
                    <td style={{ ...TD, color: C.tan, fontWeight: 600 }}>{l.producer || '—'}</td>
                    <td style={TD}>{l.species}</td>
                    <td style={{ ...TD, fontFamily: 'monospace' }}>{l.ear_tag || '—'}</td>
                    <td style={TD}>{l.sex || '—'}</td>
                    <td style={{ ...TD, color: C.lightBrown }}>{l.breed || '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', color: C.lightBrown }}>{l.live_weight_lbs != null ? l.live_weight_lbs.toLocaleString() : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{l.half_1_weight_lbs != null ? l.half_1_weight_lbs.toLocaleString() : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right' }}>{l.half_2_weight_lbs != null ? l.half_2_weight_lbs.toLocaleString() : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{l.hot_carcass_weight_lbs != null ? l.hot_carcass_weight_lbs.toLocaleString() : '—'}</td>
                    <td style={{ ...TD, textAlign: 'right', fontWeight: 600, color: dressColor }}>{l.yield_pct != null ? `${l.yield_pct}%` : '—'}</td>
                    <td style={{ ...TD, textAlign: 'center' }}>{l.ccp_pass ? <span style={{ color: C.green, fontSize: '0.9rem' }}>✓</span> : <span style={{ color: C.red, fontSize: '0.9rem' }}>✗</span>}</td>
                    <td style={{ ...TD, fontFamily: 'monospace', fontWeight: 700 }}>{l.carcass_tag || '—'}</td>
                    <td style={{ ...TD, whiteSpace: 'nowrap' }}>
                      <button onClick={() => startEdit(l)} style={{ background: 'rgba(166,120,90,0.1)', border: '1px solid rgba(166,120,90,0.25)', color: C.tan, borderRadius: 3, padding: '0.2rem 0.55rem', fontSize: '0.72rem', cursor: 'pointer', marginRight: '0.3rem' }}>
                        Edit
                      </button>
                      <button onClick={() => printCarcassTags(l)} title="Print both carcass tags" style={{ background: 'rgba(166,120,90,0.1)', border: '1px solid rgba(166,120,90,0.25)', color: C.tan, borderRadius: 3, padding: '0.2rem 0.55rem', fontSize: '0.72rem', cursor: 'pointer' }}>
                        🏷×2
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
            {logs.length > 1 && (
              <tfoot>
                <tr style={{ borderTop: '2px solid rgba(166,120,90,0.35)', background: 'rgba(166,120,90,0.08)' }}>
                  <td colSpan={6} style={{ ...TD, fontWeight: 700, color: C.tan, fontSize: '0.78rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Totals — {totalHead} head
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{totalLW > 0 ? totalLW.toLocaleString() : '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>
                    {logs.reduce((s, l) => s + (l.half_1_weight_lbs ?? 0), 0) > 0
                      ? logs.reduce((s, l) => s + (l.half_1_weight_lbs ?? 0), 0).toLocaleString() : '—'}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>
                    {logs.reduce((s, l) => s + (l.half_2_weight_lbs ?? 0), 0) > 0
                      ? logs.reduce((s, l) => s + (l.half_2_weight_lbs ?? 0), 0).toLocaleString() : '—'}
                  </td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700 }}>{totalHCW > 0 ? totalHCW.toLocaleString() : '—'}</td>
                  <td style={{ ...TD, textAlign: 'right', fontWeight: 700, color: avgDress != null ? (avgDress >= 58 ? C.green : avgDress >= 54 ? C.yellow : C.red) : C.lightBrown }}>
                    {avgDress != null ? `${avgDress.toFixed(1)}%` : '—'}
                  </td>
                  <td colSpan={3} style={TD} />
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      )}

      {/* Pending — not yet harvested */}
      {pending.length > 0 && (
        <div data-print-pending style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '0.85rem 1.25rem' }}>
          <div style={{ fontSize: '0.69rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>
            Pending — Not Yet Harvested &nbsp;({pending.reduce((s, a) => s + a.head_count, 0)} head)
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.45rem' }}>
            {pending.map(a => (
              <span key={a.id} style={{ background: 'rgba(166,120,90,0.1)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 3, padding: '0.3rem 0.8rem', fontSize: '0.82rem', color: C.tan }}>
                {a.source || a.customers?.[0]?.customer_name || 'Unknown'} · {a.head_count} {a.species}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function HarvestPage() {
  const [tab, setTab] = useState<Tab>('harvest')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            Harvest
          </h1>
        </div>

        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
          {(['harvest', 'chill', 'killsheet'] as Tab[]).map(t => (
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
              {t === 'harvest' ? '🐄 Harvest Log' : t === 'chill' ? '🌡️ Chill Log' : '📋 Kill Sheet'}
            </button>
          ))}
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1300px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'harvest' ? <HarvestTab /> : tab === 'chill' ? <ChillTab /> : <KillSheetTab />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
