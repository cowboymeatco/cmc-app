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

// ── Carcass tag label — 2.4" Brother DK, Code 128 barcode ───────────────────
function printCarcassLabel(h: HarvestLog) {
  const barcodeVal = `CT-${h.id}`
  const dateStr    = new Date(h.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const html = `<!DOCTYPE html><html><head>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>
    @page { size: 2.4in auto; margin: 0.08in 0.1in; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; font-size: 8pt; color: #000; margin: 0; padding: 0; width: 2.2in; }
    .header { text-align: center; font-size: 6pt; letter-spacing: 0.14em; text-transform: uppercase; color: #555; margin-bottom: 1px; }
    .divider { border: none; border-top: 0.5pt solid #000; margin: 3px 0; }
    .tag { text-align: center; font-size: 22pt; font-weight: bold; margin: 3px 0; }
    .species { text-align: center; font-size: 10pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.08em; margin-bottom: 2px; }
    .barcode-wrap { text-align: center; margin: 3px 0; }
    .barcode-wrap svg { max-width: 100%; }
    .row { display: flex; justify-content: space-between; font-size: 7.5pt; margin: 1px 0; }
    .lbl { color: #666; }
  </style>
  </head><body>
  <div class="header">Cowboy Meat Co. · Carcass Tag</div>
  <hr class="divider"/>
  <div class="species">${h.species}</div>
  <div class="tag">Tag #${h.carcass_tag || '—'}</div>
  <div class="barcode-wrap"><svg id="bc"></svg></div>
  <hr class="divider"/>
  <div class="row"><span class="lbl">Date:</span><span>${dateStr}</span></div>
  <div class="row"><span class="lbl">Sex:</span><span>${h.sex || '—'}</span></div>
  ${h.hot_carcass_weight_lbs != null ? `<div class="row"><span class="lbl">HCW:</span><span>${h.hot_carcass_weight_lbs} lbs</span></div>` : ''}
  ${h.yield_pct != null ? `<div class="row"><span class="lbl">Yield:</span><span>${h.yield_pct}%</span></div>` : ''}
  <script>
    window.onload = function() {
      JsBarcode("#bc", "${barcodeVal}", {
        format: "CODE128", width: 1.5, height: 38,
        displayValue: true, fontSize: 8, margin: 2, textMargin: 2,
      });
      window.print();
    };
  <\/script>
  </body></html>`
  const w = window.open('', '_blank', 'width=320,height=460')
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
  carcass_tag:            string
  sex:                    string
  live_weight_lbs:        string
  hot_carcass_weight_lbs: string
  intervention_applied:   boolean
  intervention_type:      string
  intervention_temp_f:    string
  final_carcass_temp_f:   string
  ccp_pass:               boolean
  notes:                  string
}

function emptyCarcass(): CarcassRow {
  return {
    carcass_tag: '', sex: '', live_weight_lbs: '', hot_carcass_weight_lbs: '',
    intervention_applied: true, intervention_type: 'Lactic Acid',
    intervention_temp_f: '', final_carcass_temp_f: '', ccp_pass: true, notes: '',
  }
}

function CarcassForm({
  idx, row, species, onChange,
}: {
  idx: number
  row: CarcassRow
  species: string
  onChange: (idx: number, field: keyof CarcassRow, val: string | boolean) => void
}) {
  const sexOpts = SEX_OPTIONS[species] ?? ['Unknown']
  const lw = parseFloat(row.live_weight_lbs)
  const hcw = parseFloat(row.hot_carcass_weight_lbs)
  const yld = (!isNaN(lw) && !isNaN(hcw) && lw > 0) ? ((hcw / lw) * 100).toFixed(1) : '—'

  const f = (field: keyof CarcassRow) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    onChange(idx, field, e.target.type === 'checkbox' ? (e.target as HTMLInputElement).checked : e.target.value)

  return (
    <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
      <div style={{ fontSize: '0.72rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.85rem', fontWeight: 700 }}>
        Head {idx + 1}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
        {/* Tag */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Carcass Tag #</label>
          <input style={INPUT} value={row.carcass_tag} onChange={f('carcass_tag')} placeholder="e.g. 001" />
        </div>

        {/* Sex */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Sex</label>
          <select style={{ ...INPUT }} value={row.sex} onChange={f('sex')}>
            <option value="">Select…</option>
            {sexOpts.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>

        {/* Live weight */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Live Weight (lbs)</label>
          <input type="number" step="0.1" style={INPUT} value={row.live_weight_lbs} onChange={f('live_weight_lbs')} placeholder="e.g. 1240" />
        </div>

        {/* HCW */}
        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Hot Carcass Weight (lbs)</label>
          <input type="number" step="0.1" style={INPUT} value={row.hot_carcass_weight_lbs} onChange={f('hot_carcass_weight_lbs')} placeholder="e.g. 750" />
        </div>
      </div>

      {/* Yield calc */}
      <div style={{ fontSize: '0.8rem', color: C.tan, marginBottom: '1rem', marginTop: '-0.25rem' }}>
        Calculated Yield: <strong style={{ color: C.cream }}>{yld}{yld !== '—' ? '%' : ''}</strong>
      </div>

      {/* CCP divider */}
      <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '0.85rem', marginBottom: '0.85rem' }}>
        <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.75rem' }}>
          CCP — Antimicrobial Intervention
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
          {/* Applied */}
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

          {/* Type */}
          <div style={{ marginBottom: '0.85rem' }}>
            <label style={LABEL}>Type</label>
            <select style={{ ...INPUT }} value={row.intervention_type} onChange={f('intervention_type')} disabled={!row.intervention_applied}>
              <option>Lactic Acid</option>
              <option>Citric Acid</option>
              <option>PAA</option>
              <option>Water</option>
              <option>Other</option>
            </select>
          </div>

          {/* Intervention temp */}
          <div style={{ marginBottom: '0.85rem' }}>
            <label style={LABEL}>Solution Temp (°F)</label>
            <input type="number" step="0.1" style={INPUT} value={row.intervention_temp_f} onChange={f('intervention_temp_f')} placeholder="e.g. 55" disabled={!row.intervention_applied} />
          </div>

          {/* Final carcass temp */}
          <div style={{ marginBottom: '0.85rem' }}>
            <label style={LABEL}>Final Carcass Temp (°F)</label>
            <input type="number" step="0.1" style={INPUT} value={row.final_carcass_temp_f} onChange={f('final_carcass_temp_f')} placeholder="e.g. 90" />
          </div>
        </div>

        {/* CCP Pass/Fail */}
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
    harvest_date:      new Date().toISOString().slice(0, 10),
    inspector_initials: '',
    performed_by:       '',
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

  function selectAppt(a: HarvestAppointment) {
    setSelected(a)
    setSuccess(false)
    const rows = Array.from({ length: a.head_count }, emptyCarcass)
    setCarcasses(rows)
    setHeader(h => ({ ...h, harvest_date: a.harvest_date }))
  }

  function updateCarcass(idx: number, field: keyof CarcassRow, val: string | boolean) {
    setCarcasses(prev => prev.map((r, i) => i === idx ? { ...r, [field]: val } : r))
  }

  const hf = (k: keyof typeof header) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setHeader(p => ({ ...p, [k]: e.target.value }))

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
        carcasses:          carcasses.map(c => ({
          ...c,
          live_weight_lbs:        c.live_weight_lbs ? parseFloat(c.live_weight_lbs) : null,
          hot_carcass_weight_lbs: c.hot_carcass_weight_lbs ? parseFloat(c.hot_carcass_weight_lbs) : null,
          intervention_temp_f:    c.intervention_temp_f ? parseFloat(c.intervention_temp_f) : null,
          final_carcass_temp_f:   c.final_carcass_temp_f ? parseFloat(c.final_carcass_temp_f) : null,
        })),
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
              <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem', marginBottom: '0.2rem' }}>
                {a.species} — {a.head_count} head
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
                    </div>
                    <div style={{ fontSize: '0.75rem', color: C.tan }}>
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

            {/* Header fields */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 1rem', marginBottom: '1rem' }}>
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

            {/* Per-carcass forms */}
            <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '1.25rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.75rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem' }}>
                Carcass Records — {selected.head_count} head
              </div>
              {carcasses.map((row, i) => (
                <CarcassForm
                  key={i}
                  idx={i}
                  row={row}
                  species={selected.species}
                  onChange={updateCarcass}
                />
              ))}
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
