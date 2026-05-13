'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { HarvestAppointment, HarvestLog, ChillLog } from '@/lib/types'

type Tab = 'harvest' | 'chill'

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
function printCarcassLabel(h: HarvestLog) {
  const barcodeVal  = `CT-${h.id}`
  const dateStr     = new Date(h.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const perHalf     = h.hot_carcass_weight_lbs != null ? (h.hot_carcass_weight_lbs / 2).toFixed(1) : null

  // Identifier line: Tag # · Ear Tag · Sex · Breed  (concat whatever we have)
  const identParts  = [
    h.carcass_tag  ? `#${h.carcass_tag}`  : null,
    h.ear_tag      ? `ET: ${h.ear_tag}`   : null,
    h.sex          || null,
    h.breed        || null,
  ].filter(Boolean)
  const identLine   = identParts.join(' · ')

  const producerHtml = h.producer
    ? `<div class="producer">${h.producer}</div>`
    : ''
  const identHtml    = identLine
    ? `<div class="ident">${identLine}</div>`
    : ''
  const otmHtml      = h.over_30_months
    ? `<div class="otm">&#9888; OVER 30 MONTHS</div>`
    : ''
  const hcwHtml      = perHalf != null
    ? `<div class="row"><span class="lbl">HCW / half</span><span class="val">${perHalf} lbs</span></div>`
    : ''
  const yieldHtml    = h.yield_pct != null
    ? `<div class="row"><span class="lbl">Yield</span><span class="val">${h.yield_pct}%</span></div>`
    : ''
  const inspHtml     = h.inspector_initials
    ? `<div class="row"><span class="lbl">Inspector</span><span class="val">${h.inspector_initials}</span></div>`
    : ''

  const html = `<!DOCTYPE html><html><head>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    @page { size: 2.4in 5in; margin: 0.07in 0.12in; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #000; margin: 0; padding: 0; width: 2.16in; }
    .co      { text-align: center; font-size: 7pt; font-weight: bold; letter-spacing: 0.16em;
               text-transform: uppercase; margin-bottom: 1pt; }
    .sub     { text-align: center; font-size: 5.5pt; letter-spacing: 0.22em;
               text-transform: uppercase; color: #555; margin-bottom: 4pt; }
    hr       { border: none; border-top: 0.6pt solid #000; margin: 3pt 0; }
    .species { text-align: center; font-size: 10pt; font-weight: bold;
               text-transform: uppercase; letter-spacing: 0.1em; margin-bottom: 0; }
    .tagnum  { text-align: center; font-size: 38pt; font-weight: bold;
               line-height: 1.05; margin: 0; letter-spacing: 0.03em; }
    .bc-wrap { text-align: center; margin: 4pt 0 2pt; }
    .bc-wrap svg { max-width: 100%; }
    .row      { display: flex; justify-content: space-between; align-items: baseline;
                font-size: 7.5pt; margin: 2pt 0; }
    .lbl      { color: #555; }
    .val      { font-weight: 600; }
    .producer { text-align: center; font-size: 9pt; font-weight: bold; margin-bottom: 1pt; }
    .ident    { text-align: center; font-size: 7pt; color: #444; letter-spacing: 0.04em;
                margin-bottom: 3pt; }
    .otm      { margin-top: 5pt; text-align: center; font-size: 8pt; font-weight: bold;
                color: #bb0000; border: 1.5pt solid #bb0000; padding: 2pt 0;
                letter-spacing: 0.14em; }
  </style>
  </head><body>
  <div class="co">Cowboy Meat Co.</div>
  <div class="sub">&middot; Carcass Tag &middot;</div>
  <hr/>
  ${producerHtml}
  <div class="species">${h.species}</div>
  <div class="tagnum">${h.carcass_tag || '—'}</div>
  ${identHtml}
  <div class="bc-wrap"><svg id="bc"></svg></div>
  <hr/>
  <div class="row"><span class="lbl">Date</span><span class="val">${dateStr}</span></div>
  ${hcwHtml}${yieldHtml}${inspHtml}${otmHtml}
  <script>
    window.onload = function() {
      JsBarcode("#bc", "${barcodeVal}", {
        format: "CODE128", width: 1.4, height: 44,
        displayValue: true, fontSize: 7, margin: 2, textMargin: 1,
      });
      window.print();
    };
  <\/script>
  </body></html>`
  const w = window.open('', '_blank', 'width=290,height=530')
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
}

function emptyCarcass(): CarcassRow {
  return {
    carcass_tag: '', ear_tag: '', breed: '', sex: '', live_weight_lbs: '',
    half_1_weight: '', half_2_weight: '',
    intervention_applied: true, intervention_temp_f: '',
    final_carcass_temp_f: '', ccp_pass: true,
    is_verification: false, direct_observation: false,
    over_30_months: false, notes: '',
  }
}

function CarcassForm({
  idx, row, species, onChange, defaultSolutionTemp, verificationCount,
}: {
  idx:                 number
  row:                 CarcassRow
  species:             string
  onChange:            (idx: number, field: keyof CarcassRow, val: string | boolean) => void
  defaultSolutionTemp: string
  verificationCount:   number
}) {
  const sexOpts = SEX_OPTIONS[species] ?? ['Unknown']
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
      border: `1px solid ${row.is_verification ? 'rgba(59,130,246,0.4)' : 'rgba(166,120,90,0.2)'}`,
      borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem',
    }}>

      {/* Card header row */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '0.85rem' }}>
        <span style={{ fontSize: '0.72rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
          Head {idx + 1}
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

  async function handleSubmit() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/harvest', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:               'log',
        appointment_id:     selected.id,
        harvest_date:       header.harvest_date,
        species:            selected.species,
        inspector_initials: header.inspector_initials,
        performed_by:       header.performed_by,
        intervention_type:  header.intervention_type,
        producer:           selected.source || (selected.customers?.[0]?.customer_name ?? ''),
        carcasses: carcasses.map(c => {
          const h1  = parseFloat(c.half_1_weight)
          const h2  = parseFloat(c.half_2_weight)
          const hcw = (!isNaN(h1) && !isNaN(h2)) ? h1 + h2
                    : (!isNaN(h1) ? h1 : (!isNaN(h2) ? h2 : null))
          // per-carcass solution temp; fall back to header default
          const solTemp = c.intervention_temp_f
            ? parseFloat(c.intervention_temp_f)
            : header.default_solution_temp ? parseFloat(header.default_solution_temp) : null
          return {
            carcass_tag:            c.carcass_tag,
            ear_tag:                c.ear_tag,
            breed:                  c.breed,
            sex:                    c.sex,
            live_weight_lbs:        c.live_weight_lbs ? parseFloat(c.live_weight_lbs) : null,
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
        }),
      }),
    })
    setSaving(false)
    setSuccess(true)
    setSelected(null)
    load()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — appointment list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Ready to Harvest ({appointments.length})
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
                    onClick={() => printCarcassLabel(h)}
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

        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: C.lightBrown, fontSize: '0.9rem' }}>
            ← Select an appointment to log harvest
          </div>
        ) : (
          <>
            {/* Appointment summary */}
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
                Carcass Records — {selected.head_count} head
              </div>
              {(() => {
                const verificationCount = carcasses.filter(c => c.is_verification).length
                return carcasses.map((row, i) => (
                  <CarcassForm
                    key={i}
                    idx={i}
                    row={row}
                    species={selected.species}
                    onChange={updateCarcass}
                    defaultSolutionTemp={header.default_solution_temp}
                    verificationCount={verificationCount}
                  />
                ))
              })()}
            </div>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button style={BTN(C.tan)} onClick={handleSubmit} disabled={saving}>
                {saving ? 'Saving…' : '✓ Log Harvest'}
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
          {(['harvest', 'chill'] as Tab[]).map(t => (
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
              {t === 'harvest' ? '🐄 Harvest Log' : '🌡️ Chill Log'}
            </button>
          ))}
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1300px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'harvest' ? <HarvestTab /> : <ChillTab />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
