'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { HarvestAppointment, HarvestLog, ChillLog, AnimalReceivingLog, CorrectiveAction } from '@/lib/types'

type Tab = 'parta' | 'partb' | 'harvestlog' | 'chill'

// ── Colour palette ─────────────────────────────────────────────────────────────
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

// ── Helper: convert 'HH:MM' → '10:14 AM' ────────────────────────────────────
function fmt12(t: string | null | undefined) {
  if (!t) return '—'
  const [h, m] = t.split(':').map(Number)
  const period = h >= 12 ? 'PM' : 'AM'
  return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${period}`
}

// ── Helper: temp → colour ─────────────────────────────────────────────────────
function tempColor(t: number | null) {
  if (t === null) return C.lightBrown
  if (t <= 40) return C.green
  if (t <= 50) return C.yellow
  return C.red
}

// ── Carcass tag print (2.4" × 5" Brother DK continuous, Code 128) ─────────────
function printCarcassTags(h: HarvestLog) {
  const dateStr   = new Date(h.harvest_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const totalHCW  = h.hot_carcass_weight_lbs
  const avgHalfWt = totalHCW != null ? (totalHCW / 2) : null
  const identParts = [h.ear_tag ? `ET: ${h.ear_tag}` : null, h.sex || null, h.breed || null].filter(Boolean)
  const identLine  = identParts.join('  ·  ')

  const css = `
    @page { size: 2.4in 5in; margin: 0.18in 0.14in 0.1in; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; color: #000; width: 2.12in; }
    .label { page-break-after: always; }
    .label:last-child { page-break-after: auto; }
    .header { text-align: center; margin-bottom: 4pt; }
    .co { font-size: 10pt; font-weight: 900; letter-spacing: 0.18em; text-transform: uppercase; line-height: 1.1; }
    .co-sub { font-size: 6.5pt; letter-spacing: 0.2em; text-transform: uppercase; color: #444; margin-top: 1pt; }
    hr { border: none; border-top: 0.75pt solid #000; margin: 4pt 0; }
    .half-badge { text-align: center; font-size: 11pt; font-weight: 900; letter-spacing: 0.22em; text-transform: uppercase; border: 2pt solid #000; padding: 3pt 0; margin: 3pt 0; }
    .producer { text-align: center; font-size: 10.5pt; font-weight: 700; line-height: 1.15; margin-bottom: 1pt; }
    .species  { text-align: center; font-size: 9pt; font-weight: 600; text-transform: uppercase; letter-spacing: 0.1em; color: #333; }
    .tagnum   { text-align: center; font-size: 52pt; font-weight: 900; line-height: 1.0; letter-spacing: 0.02em; margin: 2pt 0; }
    .ident    { text-align: center; font-size: 7.5pt; color: #333; letter-spacing: 0.03em; margin-bottom: 2pt; }
    .bc-wrap  { text-align: center; margin: 4pt 0; padding: 0 2pt; }
    .bc-wrap svg { max-width: 100%; display: block; margin: 0 auto; }
    .row { display: flex; justify-content: space-between; align-items: baseline; font-size: 8.5pt; padding: 2pt 0; border-bottom: 0.3pt solid #eee; }
    .row:last-child { border-bottom: none; }
    .row.hl { font-size: 10.5pt; font-weight: 700; padding: 3pt 0; }
    .lbl { color: #555; }
    .val { font-weight: 600; color: #000; }
    .val.big { font-size: 12pt; }
    .otm { margin-top: 5pt; text-align: center; font-size: 8.5pt; font-weight: 700; color: #bb0000; border: 2pt solid #bb0000; padding: 3pt 0; letter-spacing: 0.14em; text-transform: uppercase; }
  `
  function makeLabel(side: 'L' | 'R', bcId: string) {
    const halfLabel  = side === 'L' ? '◀  L HALF' : 'R HALF  ▶'
    const shortDate  = h.harvest_date.replace(/-/g, '').slice(2)
    const barcodeVal = `${shortDate}-${h.carcass_tag}-${side}`
    const producerHtml = h.producer ? `<div class="producer">${h.producer}</div>` : ''
    const identHtml    = identLine  ? `<div class="ident">${identLine}</div>`      : ''
    const otmHtml      = h.over_30_months ? `<div class="otm">&#9888; Over 30 Months</div>` : ''
    const avgHtHtml    = avgHalfWt != null ? `<div class="row hl"><span class="lbl">Avg Half Wt</span><span class="val big">${avgHalfWt.toFixed(1)} lbs</span></div>` : ''
    const totalHtml    = totalHCW  != null ? `<div class="row"><span class="lbl">Total HCW</span><span class="val">${totalHCW} lbs</span></div>` : ''
    const yieldHtml    = h.yield_pct  != null ? `<div class="row"><span class="lbl">Yield</span><span class="val">${h.yield_pct}%</span></div>` : ''
    const inspHtml     = h.inspector_initials ? `<div class="row"><span class="lbl">Inspector</span><span class="val">${h.inspector_initials}</span></div>` : ''
    return `<div class="label">
      <div class="header"><div class="co">Cowboy Meat Co.</div><div class="co-sub">Forsyth, Montana &nbsp;&middot;&nbsp; Carcass Tag</div></div>
      <div class="half-badge">${halfLabel}</div><hr/>
      ${producerHtml}<div class="species">${h.species}</div>
      <div class="tagnum">${h.carcass_tag || '—'}</div>
      ${identHtml}
      <div class="bc-wrap"><svg id="${bcId}"></svg></div><hr/>
      <div class="row"><span class="lbl">Date</span><span class="val">${dateStr}</span></div>
      ${avgHtHtml}${totalHtml}${yieldHtml}${inspHtml}${otmHtml}
      <script>JsBarcode("#${bcId}","${barcodeVal}",{format:"CODE128",width:2.4,height:70,displayValue:true,fontSize:9,margin:10,textMargin:2});<\/script>
    </div>`
  }
  const html = `<!DOCTYPE html><html><head>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>${css}</style></head><body>
  ${makeLabel('L','bc-l')}${makeLabel('R','bc-r')}
  <script>window.onload=function(){window.print()};<\/script>
  </body></html>`
  const w = window.open('', '_blank', 'width=300,height=580')
  if (w) { w.document.write(html); w.document.close() }
}

// ── Shared small components ────────────────────────────────────────────────────
function StatusDot({ pass, label }: { pass: boolean | null | undefined; label: string }) {
  const color = (pass === null || pass === undefined) ? 'rgba(166,120,90,0.4)' : pass ? C.green : C.red
  return (
    <span title={label} style={{ fontSize: '0.65rem', color, lineHeight: 1 }}>
      {(pass === null || pass === undefined) ? '○' : '●'}
    </span>
  )
}

function PassFailBtn({ active, pass, onClick }: { active: boolean; pass: boolean; onClick: () => void }) {
  const color = pass ? C.green : C.red
  return (
    <button onClick={onClick} style={{
      padding: '0.45rem 1rem', borderRadius: 3, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
      border: active ? `2px solid ${color}` : '1px solid rgba(166,120,90,0.3)',
      background: active ? `${color}22` : 'rgba(255,255,255,0.04)',
      color: active ? color : C.lightBrown,
    }}>
      {pass ? '✓ Pass' : '✗ Fail'}
    </button>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CAR MODAL
// ══════════════════════════════════════════════════════════════════════════════
function CARModal({ type, harvestLogId, harvestDate, onClose, onSaved }: {
  type:          'zero_tolerance' | 'hot_water'
  harvestLogId:  string
  harvestDate:   string
  onClose:       () => void
  onSaved:       (car: CorrectiveAction) => void
}) {
  const [saving, setSaving] = useState(false)
  const [err, setErr]       = useState('')
  const [form, setForm]     = useState({ monitor_initials: '', action_1: '', action_2: '', action_3: '', action_4: '', root_cause: '' })

  const typeLabel  = type === 'zero_tolerance' ? 'Zero Tolerance' : 'Hot Water CCP'
  const regulation = type === 'zero_tolerance'
    ? '9 CFR 416.15(b) — Direct Product Contamination'
    : '9 CFR 417.3(a) — Deviation from Critical Limit'

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  async function submit() {
    setSaving(true); setErr('')
    const res = await fetch('/api/corrective-actions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        harvest_log_id:   harvestLogId,
        harvest_date:     harvestDate,
        type,
        monitor_initials: form.monitor_initials || null,
        action_1:         form.action_1 || null,
        action_2:         form.action_2 || null,
        action_3:         form.action_3 || null,
        action_4:         form.action_4 || null,
        root_cause:       form.root_cause || null,
      }),
    })
    const json = await res.json()
    setSaving(false)
    if (json.error) { setErr(json.error); return }
    onSaved(json)
  }

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.82)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <div style={{ background: '#1F0E06', border: '2px solid rgba(229,62,62,0.6)', borderRadius: 6, padding: '1.5rem', maxWidth: 540, width: '100%', maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
          <div>
            <div style={{ color: C.red, fontWeight: 700, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>⚠ Corrective Action Required</div>
            <div style={{ color: C.tan, fontSize: '0.8rem', marginTop: '0.2rem' }}>{typeLabel} — {regulation}</div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '1.3rem', cursor: 'pointer', padding: '0 0.2rem' }}>✕</button>
        </div>

        <div style={{ background: 'rgba(229,62,62,0.08)', border: '1px solid rgba(229,62,62,0.25)', borderRadius: 3, padding: '0.65rem 0.85rem', marginBottom: '1.25rem', fontSize: '0.8rem', color: C.tan, lineHeight: 1.55 }}>
          A <strong style={{ color: C.cream }}>Corrective Action Report (CAR)</strong> must be filed any time a CCP critical limit is not met. Document the actions taken below.
        </div>

        {err && <div style={{ background: 'rgba(229,62,62,0.12)', border: '1px solid rgba(229,62,62,0.4)', borderRadius: 3, padding: '0.55rem 0.75rem', color: C.red, fontSize: '0.82rem', marginBottom: '0.85rem' }}>{err}</div>}

        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Monitor Initials *</label>
          <input style={INPUT} value={form.monitor_initials} onChange={f('monitor_initials')} placeholder="e.g. CB" />
        </div>
        {(['action_1','action_2','action_3','action_4'] as const).map((k, i) => (
          <div key={k} style={{ marginBottom: '0.85rem' }}>
            <label style={LABEL}>Corrective Action {i + 1}</label>
            <input style={INPUT} value={form[k]} onChange={f(k)} placeholder={
              i === 0 ? 'Action taken to regain control of the process…'
              : i === 1 ? 'Disposition of affected product…'
              : i === 2 ? 'Preventive measures to avoid recurrence…'
              : 'Additional notes…'
            } />
          </div>
        ))}
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={LABEL}>Root Cause</label>
          <input style={INPUT} value={form.root_cause} onChange={f('root_cause')} placeholder="What caused this deviation?" />
        </div>

        <div style={{ display: 'flex', gap: '0.75rem' }}>
          <button
            onClick={submit}
            disabled={saving || !form.monitor_initials}
            style={{ ...BTN(C.red, C.cream), flex: 1, opacity: (saving || !form.monitor_initials) ? 0.6 : 1 }}
          >
            {saving ? 'Filing CAR…' : 'File Corrective Action Report'}
          </button>
          <button onClick={onClose} style={{ ...BTN('rgba(166,120,90,0.12)', C.tan), border: '1px solid rgba(166,120,90,0.3)' }}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PART A — QUICK TAP LIST
// ══════════════════════════════════════════════════════════════════════════════
interface PartARow {
  animal:       AnimalReceivingLog
  logId:        string | null
  knockTime:    string
  liveWeight:   string
  harvestOrder: string
  partAComplete: boolean
  expanded:     boolean
  saving:       boolean
  error:        string
}

function PartATab({ date, appt }: { date: string; appt: HarvestAppointment | null }) {
  const [rows, setRows]         = useState<PartARow[]>([])
  const [loading, setLoading]   = useState(false)
  const [inspInitials, setInsp] = useState('')
  const [performedBy, setPerf]  = useState('')

  const load = useCallback(async () => {
    if (!appt) return
    setLoading(true)
    const [recRes, logRes] = await Promise.all([
      fetch(`/api/receiving?type=animal&appointment_id=${appt.id}`),
      fetch(`/api/harvest?type=log&date=${date}`),
    ])
    const receiving: AnimalReceivingLog[] = await recRes.json().catch(() => [])
    const allLogs: HarvestLog[]           = await logRes.json().catch(() => [])
    const apptLogs = allLogs.filter(l => l.appointment_id === appt.id)

    const logByTag = new Map<string, HarvestLog>()
    apptLogs.forEach(l => { if (l.ear_tag) logByTag.set(l.ear_tag, l) })

    // Suggest next available harvest order
    const maxOrder = apptLogs.reduce((m, l) => Math.max(m, l.harvest_order ?? 0), 0)
    let nextOrder  = maxOrder + 1

    const built: PartARow[] = receiving.map(animal => {
      const log = animal.ear_tag ? (logByTag.get(animal.ear_tag) ?? null) : null
      const ord = log?.harvest_order ?? nextOrder++
      return {
        animal,
        logId:        log?.id ?? null,
        knockTime:    log?.knock_time ?? '',
        liveWeight:   log?.live_weight_lbs != null ? String(log.live_weight_lbs) : '',
        harvestOrder: String(ord),
        partAComplete: log?.part_a_complete ?? false,
        expanded:     false,
        saving:       false,
        error:        '',
      }
    })

    // Pre-fill inspector/performed_by from any existing record
    if (apptLogs.length > 0 && !inspInitials) setInsp(apptLogs[0].inspector_initials ?? '')
    if (apptLogs.length > 0 && !performedBy)  setPerf(apptLogs[0].performed_by ?? '')

    setRows(built)
    setLoading(false)
  }, [appt, date]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { load() }, [load])

  const upd = (i: number, ch: Partial<PartARow>) =>
    setRows(p => p.map((r, j) => j === i ? { ...r, ...ch } : r))

  const toggle = (i: number) =>
    setRows(p => p.map((r, j) => j === i ? { ...r, expanded: !r.expanded } : { ...r, expanded: false }))

  async function save(i: number) {
    const a = rows[i]
    if (!appt) return
    upd(i, { saving: true, error: '' })

    const knockTime  = a.knockTime || null
    const liveWt     = a.liveWeight ? parseFloat(a.liveWeight) : null
    const order      = a.harvestOrder ? parseInt(a.harvestOrder, 10) : null

    const patch = {
      knock_time:        knockTime,
      live_weight_lbs:   liveWt,
      harvest_order:     order,
      part_a_complete:   true,
      inspector_initials: inspInitials,
      performed_by:      performedBy,
    }

    if (a.logId) {
      const res  = await fetch('/api/harvest', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.logId, ...patch }) })
      const json = await res.json()
      if (json.error) { upd(i, { saving: false, error: json.error }); return }
    } else {
      const res  = await fetch('/api/harvest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type:               'log',
          appointment_id:     appt.id,
          harvest_date:       date,
          species:            appt.species,
          inspector_initials: inspInitials,
          performed_by:       performedBy,
          producer:           appt.source ?? '',
          carcasses: [{
            ear_tag:        a.animal.ear_tag,
            sex:            a.animal.sex,
            breed:          a.animal.breed,
            over_30_months: a.animal.over_30_months,
            carcass_tag:    '',
            knock_time:     knockTime,
            live_weight_lbs: liveWt,
            harvest_order:  order,
            part_a_complete: true,
          }],
        }),
      })
      const json = await res.json()
      if (json.error) { upd(i, { saving: false, error: json.error }); return }
      const created = Array.isArray(json) ? json[0] : json
      upd(i, { logId: created?.id ?? null })
    }

    upd(i, { saving: false, partAComplete: true, expanded: false })
  }

  if (!appt) {
    return (
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '3rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.9rem' }}>
        Select an appointment above to start logging
      </div>
    )
  }

  const done = rows.filter(r => r.partAComplete).length

  return (
    <div>
      {/* Header: inspector + performed by */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '0.85rem' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
          <div>
            <label style={LABEL}>Inspector Initials</label>
            <input style={INPUT} value={inspInitials} onChange={e => setInsp(e.target.value)} placeholder="e.g. JD" />
          </div>
          <div>
            <label style={LABEL}>Performed By</label>
            <input style={INPUT} value={performedBy} onChange={e => setPerf(e.target.value)} placeholder="Name" />
          </div>
        </div>
        {rows.length > 0 && (
          <div style={{ marginTop: '0.65rem', fontSize: '0.85rem', color: done === rows.length ? C.green : C.tan, fontWeight: 600 }}>
            {done} / {rows.length} animals logged in Part A
          </div>
        )}
      </div>

      {loading && <div style={{ color: C.lightBrown, textAlign: 'center', padding: '2rem' }}>Loading animals…</div>}
      {!loading && rows.length === 0 && (
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '2rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.88rem' }}>
          No animals found in the receiving log for this appointment.
        </div>
      )}

      {rows.map((row, i) => (
        <div key={row.animal.id} style={{
          background: C.dark,
          border: `1px solid ${row.partAComplete ? 'rgba(76,175,80,0.35)' : 'rgba(166,120,90,0.25)'}`,
          borderRadius: 4, marginBottom: '0.5rem', overflow: 'hidden',
        }}>
          {/* Row header */}
          <div onClick={() => toggle(i)} style={{ padding: '0.85rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            {/* Order circle */}
            <div style={{
              width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
              background: row.partAComplete ? C.green : 'rgba(166,120,90,0.18)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: row.partAComplete ? C.dark : C.tan, fontWeight: 700, fontSize: '0.9rem',
            }}>
              {row.harvestOrder || '—'}
            </div>

            {/* Photo thumb */}
            {row.animal.photo_url && (
              <img src={row.animal.photo_url} alt="" style={{ width: 46, height: 46, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }} />
            )}

            {/* Animal info */}
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.95rem' }}>
                {row.animal.ear_tag ? `ET: ${row.animal.ear_tag}` : 'No Ear Tag'}
                <span style={{ color: C.lightBrown, fontWeight: 400 }}> · {row.animal.sex}</span>
              </div>
              <div style={{ color: C.lightBrown, fontSize: '0.78rem', marginTop: '0.1rem' }}>
                {row.animal.breed}
                {row.partAComplete && row.knockTime && <span style={{ color: C.tan, marginLeft: '0.5rem' }}>⏰ {fmt12(row.knockTime)}</span>}
                {row.partAComplete && row.liveWeight && <span style={{ color: C.tan, marginLeft: '0.5rem' }}>⚖ {row.liveWeight} lbs</span>}
              </div>
            </div>

            {/* Status + chevron */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexShrink: 0 }}>
              {row.partAComplete && <span style={{ color: C.green, fontSize: '1.1rem' }}>✓</span>}
              <span style={{ color: C.lightBrown }}>{row.expanded ? '▲' : '▼'}</span>
            </div>
          </div>

          {/* Expanded form */}
          {row.expanded && (
            <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', padding: '1rem 1.25rem', background: 'rgba(255,255,255,0.02)' }}>
              {row.error && (
                <div style={{ background: 'rgba(229,62,62,0.12)', border: '1px solid rgba(229,62,62,0.35)', borderRadius: 3, padding: '0.55rem 0.75rem', color: C.red, fontSize: '0.82rem', marginBottom: '0.75rem' }}>
                  {row.error}
                </div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0 1rem', marginBottom: '0.85rem' }}>
                <div>
                  <label style={LABEL}>Harvest Order</label>
                  <input type="number" min="1" style={INPUT} value={row.harvestOrder}
                    onChange={e => upd(i, { harvestOrder: e.target.value })} />
                </div>
                <div>
                  <label style={LABEL}>Knock Time</label>
                  <input type="time" style={INPUT} value={row.knockTime}
                    onChange={e => upd(i, { knockTime: e.target.value })} />
                </div>
                <div>
                  <label style={LABEL}>Live Weight (lbs)</label>
                  <input type="number" step="1" style={INPUT} value={row.liveWeight}
                    onChange={e => upd(i, { liveWeight: e.target.value })} placeholder="e.g. 1245" />
                </div>
              </div>
              <button
                onClick={() => save(i)}
                disabled={row.saving}
                style={{
                  ...BTN(row.partAComplete ? 'rgba(76,175,80,0.18)' : C.tan, row.partAComplete ? C.green : C.dark),
                  border: row.partAComplete ? '1px solid rgba(76,175,80,0.4)' : 'none',
                  opacity: row.saving ? 0.6 : 1,
                }}
              >
                {row.saving ? 'Saving…' : row.partAComplete ? '✓ Update' : 'Save Part A'}
              </button>
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PART B — CARCASS WEIGHTS & CCPs
// ══════════════════════════════════════════════════════════════════════════════
interface PartBFields {
  half1:       string
  half2:       string
  ztPass:      boolean | null
  ztDirect:    boolean
  hwPass:      boolean | null
  hwTemp:      string
  hwDirect:    boolean
  coolerTemp:  string
  carcassTag:  string
  notes:       string
}

interface PartBRow {
  log:         HarvestLog
  fields:      PartBFields
  expanded:    boolean
  saving:      string | null   // which field group is saving
}

function PartBTab({ date, appt }: { date: string; appt: HarvestAppointment | null }) {
  const [rows, setRows]         = useState<PartBRow[]>([])
  const [loading, setLoading]   = useState(false)
  const [carModal, setCarModal] = useState<{ rowIdx: number; type: 'zero_tolerance' | 'hot_water' } | null>(null)

  const load = useCallback(async () => {
    if (!appt) return
    setLoading(true)
    const res = await fetch(`/api/harvest?type=log&date=${date}`)
    const all: HarvestLog[] = await res.json().catch(() => [])
    const apptLogs = all
      .filter(l => l.appointment_id === appt.id)
      .sort((a, b) => (a.harvest_order ?? 999) - (b.harvest_order ?? 999))

    setRows(apptLogs.map(log => ({
      log,
      fields: {
        half1:      log.half_1_weight_lbs != null ? String(log.half_1_weight_lbs) : '',
        half2:      log.half_2_weight_lbs != null ? String(log.half_2_weight_lbs) : '',
        ztPass:     log.zero_tolerance_pass ?? null,
        ztDirect:   log.zero_tolerance_direct_obs ?? false,
        hwPass:     log.intervention_temp_f != null ? log.ccp_pass : null,
        hwTemp:     log.intervention_temp_f != null ? String(log.intervention_temp_f) : '',
        hwDirect:   log.direct_observation ?? false,
        coolerTemp: log.initial_cooler_temp_f != null ? String(log.initial_cooler_temp_f) : '',
        carcassTag: log.carcass_tag ?? '',
        notes:      log.notes ?? '',
      },
      expanded: false,
      saving:   null,
    })))
    setLoading(false)
  }, [appt, date])

  useEffect(() => { load() }, [load])

  const updRow   = (i: number, ch: Partial<PartBRow>)   => setRows(p => p.map((r, j) => j === i ? { ...r, ...ch } : r))
  const updField = (i: number, ch: Partial<PartBFields>) => setRows(p => p.map((r, j) => j === i ? { ...r, fields: { ...r.fields, ...ch } } : r))

  async function patch(i: number, savingKey: string, body: Record<string, unknown>) {
    updRow(i, { saving: savingKey })
    const res  = await fetch('/api/harvest', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: rows[i].log.id, ...body }) })
    const json = await res.json()
    if (!json.error) updRow(i, { log: { ...rows[i].log, ...json }, saving: null })
    else updRow(i, { saving: null })
  }

  async function saveWeights(i: number) {
    const { fields, log } = rows[i]
    const h1  = fields.half1 ? parseFloat(fields.half1) : null
    const h2  = fields.half2 ? parseFloat(fields.half2) : null
    const hcw = h1 != null && h2 != null ? h1 + h2 : h1 ?? h2
    const lw  = log.live_weight_lbs
    const yld = lw && hcw ? Math.round((hcw / lw) * 1000) / 10 : null
    await patch(i, 'weights', {
      carcass_tag:            fields.carcassTag,
      half_1_weight_lbs:      h1,
      half_2_weight_lbs:      h2,
      hot_carcass_weight_lbs: hcw,
      yield_pct:              yld,
    })
  }

  async function saveZT(i: number) {
    const { fields } = rows[i]
    if (fields.ztPass === null) return
    await patch(i, 'zt', { zero_tolerance_pass: fields.ztPass, zero_tolerance_direct_obs: fields.ztDirect })
    if (!fields.ztPass) setCarModal({ rowIdx: i, type: 'zero_tolerance' })
  }

  async function saveHW(i: number) {
    const { fields } = rows[i]
    if (fields.hwPass === null) return
    const hwTemp = fields.hwTemp ? parseFloat(fields.hwTemp) : null
    await patch(i, 'hw', { ccp_pass: fields.hwPass, direct_observation: fields.hwDirect, intervention_temp_f: hwTemp, intervention_applied: true })
    if (!fields.hwPass) setCarModal({ rowIdx: i, type: 'hot_water' })
  }

  async function saveCooler(i: number) {
    const { fields, log } = rows[i]
    const ct = fields.coolerTemp ? parseFloat(fields.coolerTemp) : null
    await patch(i, 'cooler', { initial_cooler_temp_f: ct, notes: fields.notes })
    // Mark Part B complete if all key fields are now set
    const updLog = rows[i].log
    if (ct != null && updLog.hot_carcass_weight_lbs != null && updLog.zero_tolerance_pass !== null && updLog.intervention_temp_f != null) {
      await fetch('/api/harvest', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: updLog.id, part_b_complete: true }) })
    }
  }

  if (!appt) {
    return (
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '3rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.9rem' }}>
        Select an appointment above to log carcass data
      </div>
    )
  }

  return (
    <div>
      {loading && <div style={{ color: C.lightBrown, textAlign: 'center', padding: '2rem' }}>Loading carcasses…</div>}
      {!loading && rows.length === 0 && (
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '2rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.88rem' }}>
          No records yet — complete Part A first to create carcass records.
        </div>
      )}

      {rows.map((row, i) => {
        const h1  = row.fields.half1 ? parseFloat(row.fields.half1) : null
        const h2  = row.fields.half2 ? parseFloat(row.fields.half2) : null
        const hcw = h1 != null && h2 != null ? (h1 + h2).toFixed(1) : h1 != null ? h1.toFixed(1) : h2 != null ? h2.toFixed(1) : null
        const lw  = row.log.live_weight_lbs
        const yld = lw && hcw ? ((parseFloat(hcw) / lw) * 100).toFixed(1) : null

        const hwStatus = row.log.intervention_temp_f != null ? row.log.ccp_pass : null

        return (
          <div key={row.log.id} style={{
            background: C.dark,
            border: `1px solid ${row.log.part_b_complete ? 'rgba(76,175,80,0.35)' : 'rgba(166,120,90,0.25)'}`,
            borderRadius: 4, marginBottom: '0.5rem', overflow: 'hidden',
          }}>
            {/* Row header */}
            <div
              onClick={() => setRows(p => p.map((r, j) => j === i ? { ...r, expanded: !r.expanded } : { ...r, expanded: false }))}
              style={{ padding: '0.85rem 1.25rem', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.85rem' }}
            >
              <div style={{
                width: 36, height: 36, borderRadius: '50%', flexShrink: 0,
                background: row.log.part_b_complete ? C.green : 'rgba(166,120,90,0.18)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: row.log.part_b_complete ? C.dark : C.tan, fontWeight: 700, fontSize: '0.9rem',
              }}>
                {row.log.harvest_order ?? '—'}
              </div>

              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>
                  {row.log.ear_tag ? `ET: ${row.log.ear_tag}` : 'No Ear Tag'}
                  {row.log.carcass_tag ? <span style={{ color: C.tan }}> · Tag {row.log.carcass_tag}</span> : null}
                  <span style={{ color: C.lightBrown, fontWeight: 400 }}> · {row.log.sex}</span>
                </div>
                <div style={{ fontSize: '0.78rem', color: C.lightBrown, marginTop: '0.1rem' }}>
                  {row.log.breed}
                  {row.log.knock_time && <span style={{ marginLeft: '0.5rem' }}>⏰ {fmt12(row.log.knock_time)}</span>}
                  {row.log.hot_carcass_weight_lbs != null && <span style={{ color: C.tan, marginLeft: '0.5rem' }}>HCW: {row.log.hot_carcass_weight_lbs} lbs</span>}
                </div>
              </div>

              {/* Status dots: ⚖ ZT HW ❄ */}
              <div style={{ display: 'flex', gap: '0.3rem', flexShrink: 0 }} title="Weights · ZT · HW · Cooler">
                <StatusDot pass={row.log.hot_carcass_weight_lbs != null ? true : undefined} label="Weights" />
                <StatusDot pass={row.log.zero_tolerance_pass ?? undefined} label="Zero Tolerance" />
                <StatusDot pass={hwStatus ?? undefined} label="Hot Water" />
                <StatusDot pass={row.log.initial_cooler_temp_f != null ? true : undefined} label="Cooler Temp" />
              </div>

              <span style={{ color: C.lightBrown, flexShrink: 0 }}>{row.expanded ? '▲' : '▼'}</span>
            </div>

            {/* Expanded panel */}
            {row.expanded && (
              <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', background: 'rgba(255,255,255,0.02)' }}>

                {/* ── Weights ── */}
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.12)' }}>
                  <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.65rem' }}>⚖ Carcass Weights</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: '0 1rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={LABEL}>Carcass Tag #</label>
                      <input style={INPUT} value={row.fields.carcassTag} onChange={e => updField(i, { carcassTag: e.target.value })} placeholder="001" />
                    </div>
                    <div>
                      <label style={LABEL}>Left Half (lbs)</label>
                      <input type="number" step="0.1" style={INPUT} value={row.fields.half1} onChange={e => updField(i, { half1: e.target.value })} placeholder="0.0" />
                    </div>
                    <div>
                      <label style={LABEL}>Right Half (lbs)</label>
                      <input type="number" step="0.1" style={INPUT} value={row.fields.half2} onChange={e => updField(i, { half2: e.target.value })} placeholder="0.0" />
                    </div>
                    <div>
                      <label style={LABEL}>HCW (auto)</label>
                      <div style={{ ...INPUT, color: C.tan, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        {hcw ? `${hcw} lbs` : '—'}
                        {yld && <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>({yld}%)</span>}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                    <button onClick={() => saveWeights(i)} disabled={row.saving === 'weights'} style={{ ...BTN(C.tan), opacity: row.saving === 'weights' ? 0.6 : 1 }}>
                      {row.saving === 'weights' ? 'Saving…' : 'Save Weights'}
                    </button>
                    {row.log.hot_carcass_weight_lbs != null && row.log.carcass_tag && (
                      <button onClick={() => printCarcassTags(row.log)} style={{ ...BTN('rgba(166,120,90,0.15)', C.tan), border: '1px solid rgba(166,120,90,0.3)' }}>
                        🏷 Print Tags
                      </button>
                    )}
                  </div>
                </div>

                {/* ── Zero Tolerance ── */}
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.12)' }}>
                  <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.65rem' }}>
                    Zero Tolerance CCP
                    {row.log.zero_tolerance_pass !== null && (
                      <span style={{ marginLeft: '0.5rem', color: row.log.zero_tolerance_pass ? C.green : C.red, fontWeight: 700 }}>
                        — {row.log.zero_tolerance_pass ? 'PASS' : 'FAIL'}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    <PassFailBtn active={row.fields.ztPass === true}  pass={true}  onClick={() => updField(i, { ztPass: true  })} />
                    <PassFailBtn active={row.fields.ztPass === false} pass={false} onClick={() => updField(i, { ztPass: false })} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: C.tan, fontSize: '0.85rem', cursor: 'pointer', marginLeft: '0.5rem' }}>
                      <input type="checkbox" checked={row.fields.ztDirect} onChange={e => updField(i, { ztDirect: e.target.checked })} style={{ width: 16, height: 16 }} />
                      Direct Observation
                    </label>
                    <button
                      onClick={() => saveZT(i)}
                      disabled={row.fields.ztPass === null || row.saving === 'zt'}
                      style={{ ...BTN(C.tan), opacity: (row.fields.ztPass === null || row.saving === 'zt') ? 0.5 : 1 }}
                    >
                      {row.saving === 'zt' ? 'Saving…' : 'Save ZT'}
                    </button>
                  </div>
                </div>

                {/* ── Hot Water ── */}
                <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.12)' }}>
                  <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.65rem' }}>
                    Hot Water Intervention CCP
                    {hwStatus !== null && (
                      <span style={{ marginLeft: '0.5rem', color: hwStatus ? C.green : C.red, fontWeight: 700 }}>
                        — {hwStatus ? 'PASS' : 'FAIL'}
                      </span>
                    )}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '160px 1fr', gap: '0 1rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={LABEL}>Solution Temp (°F)</label>
                      <input type="number" step="0.5" style={INPUT} value={row.fields.hwTemp} onChange={e => updField(i, { hwTemp: e.target.value })} placeholder="e.g. 180" />
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                    <PassFailBtn active={row.fields.hwPass === true}  pass={true}  onClick={() => updField(i, { hwPass: true  })} />
                    <PassFailBtn active={row.fields.hwPass === false} pass={false} onClick={() => updField(i, { hwPass: false })} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: C.tan, fontSize: '0.85rem', cursor: 'pointer', marginLeft: '0.5rem' }}>
                      <input type="checkbox" checked={row.fields.hwDirect} onChange={e => updField(i, { hwDirect: e.target.checked })} style={{ width: 16, height: 16 }} />
                      Direct Observation
                    </label>
                    <button
                      onClick={() => saveHW(i)}
                      disabled={row.fields.hwPass === null || row.saving === 'hw'}
                      style={{ ...BTN(C.tan), opacity: (row.fields.hwPass === null || row.saving === 'hw') ? 0.5 : 1 }}
                    >
                      {row.saving === 'hw' ? 'Saving…' : 'Save HW'}
                    </button>
                  </div>
                </div>

                {/* ── Initial Cooler Temp ── */}
                <div style={{ padding: '1rem 1.25rem' }}>
                  <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.65rem' }}>❄ Initial Cooler</div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={LABEL}>Cooler Temp (°F)</label>
                      <input type="number" step="0.5" style={INPUT} value={row.fields.coolerTemp} onChange={e => updField(i, { coolerTemp: e.target.value })} placeholder="e.g. 36" />
                    </div>
                    <div>
                      <label style={LABEL}>Notes</label>
                      <input style={INPUT} value={row.fields.notes} onChange={e => updField(i, { notes: e.target.value })} placeholder="Optional" />
                    </div>
                  </div>
                  <button onClick={() => saveCooler(i)} disabled={row.saving === 'cooler'} style={{ ...BTN(C.tan), opacity: row.saving === 'cooler' ? 0.6 : 1 }}>
                    {row.saving === 'cooler' ? 'Saving…' : 'Save Cooler'}
                  </button>
                </div>
              </div>
            )}
          </div>
        )
      })}

      {/* CAR Modal */}
      {carModal && (
        <CARModal
          type={carModal.type}
          harvestLogId={rows[carModal.rowIdx].log.id}
          harvestDate={date}
          onClose={() => setCarModal(null)}
          onSaved={() => setCarModal(null)}
        />
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// HARVEST LOG TAB  (combined kill sheet view + CAR log)
// ══════════════════════════════════════════════════════════════════════════════
const SEX_ORDER: Record<string, string[]> = {
  Beef: ['Steer', 'Heifer', 'Bull', 'Cow'],
  Hog:  ['Barrow', 'Gilt', 'Boar', 'Sow'],
  Lamb: ['Wether', 'Ewe', 'Ram'],
  Goat: ['Wether', 'Doe', 'Buck'],
}
const SPECIES_ORDER = ['Beef', 'Hog', 'Lamb', 'Goat']

function HarvestLogTab() {
  const todayStr = new Date().toISOString().slice(0, 10)
  const [date, setDate]     = useState(todayStr)
  const [logs, setLogs]     = useState<HarvestLog[]>([])
  const [cars, setCars]     = useState<CorrectiveAction[]>([])
  const [loading, setLoad]  = useState(false)

  const load = useCallback(async () => {
    setLoad(true)
    const [hRes, cRes] = await Promise.all([
      fetch(`/api/harvest?type=log&date=${date}`),
      fetch(`/api/corrective-actions?date=${date}`),
    ])
    const hl: HarvestLog[]       = await hRes.json().catch(() => [])
    const cl: CorrectiveAction[] = await cRes.json().catch(() => [])
    setLogs(Array.isArray(hl) ? [...hl].sort((a, b) => (a.harvest_order ?? 999) - (b.harvest_order ?? 999)) : [])
    setCars(Array.isArray(cl) ? cl : [])
    setLoad(false)
  }, [date])

  useEffect(() => { load() }, [load])

  function shiftDate(d: number) {
    const dt = new Date(date + 'T12:00:00'); dt.setDate(dt.getDate() + d)
    setDate(dt.toISOString().slice(0, 10))
  }

  // Summary stats
  const totalHead = logs.length
  const totalHCW  = logs.reduce((s, l) => s + (l.hot_carcass_weight_lbs ?? 0), 0)
  const totalLW   = logs.reduce((s, l) => s + (l.live_weight_lbs ?? 0), 0)
  const yldLogs   = logs.filter(l => l.yield_pct != null)
  const avgDress  = yldLogs.length > 0 ? yldLogs.reduce((s, l) => s + (l.yield_pct ?? 0), 0) / yldLogs.length : null

  // By class
  const byClass = logs.reduce<Record<string, { count: number; hcw: number }>>((acc, l) => {
    const key = `${l.species}:${l.sex || 'Unknown'}`
    if (!acc[key]) acc[key] = { count: 0, hcw: 0 }
    acc[key].count++
    acc[key].hcw += l.hot_carcass_weight_lbs ?? 0
    return acc
  }, {})
  const speciesPresent = [...new Set(logs.map(l => l.species))].sort((a, b) => SPECIES_ORDER.indexOf(a) - SPECIES_ORDER.indexOf(b))

  const fmtDate = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const NAV: React.CSSProperties = { background: 'rgba(166,120,90,0.12)', border: '1px solid rgba(166,120,90,0.3)', color: C.tan, borderRadius: 3, padding: '0.4rem 0.75rem', fontSize: '1rem', cursor: 'pointer', lineHeight: 1 }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Date nav */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <button onClick={() => shiftDate(-1)} style={NAV}>‹</button>
          <input type="date" value={date} onChange={e => setDate(e.target.value)} style={{ ...INPUT, width: 'auto', padding: '0.4rem 0.75rem' }} />
          <button onClick={() => shiftDate(1)} style={NAV}>›</button>
          <span style={{ color: C.tan, fontSize: '0.9rem', fontWeight: 600, marginLeft: '0.2rem' }}>{fmtDate}</span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {date !== todayStr && <button onClick={() => setDate(todayStr)} style={{ ...BTN('rgba(166,120,90,0.12)', C.tan), border: '1px solid rgba(166,120,90,0.3)' }}>Today</button>}
          <button onClick={() => window.print()} style={{ ...BTN('rgba(166,120,90,0.12)', C.tan), border: '1px solid rgba(166,120,90,0.3)' }}>🖨 Print</button>
        </div>
      </div>

      {loading && <div style={{ color: C.lightBrown, textAlign: 'center', padding: '1.5rem' }}>Loading…</div>}

      {!loading && logs.length === 0 && (
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '2rem', textAlign: 'center', color: C.lightBrown }}>
          No harvest records for this date
        </div>
      )}

      {logs.length > 0 && (
        <>
          {/* Summary */}
          <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1rem 1.5rem' }}>
            <div style={{ display: 'flex', gap: '2rem', flexWrap: 'wrap', marginBottom: speciesPresent.length > 0 ? '0.85rem' : 0 }}>
              {[
                ['Head', String(totalHead)],
                ['Total Live Wt', totalLW > 0 ? `${totalLW.toLocaleString()} lbs` : '—'],
                ['Total HCW', totalHCW > 0 ? `${totalHCW.toLocaleString()} lbs` : '—'],
                ['Avg Dress', avgDress != null ? `${avgDress.toFixed(1)}%` : '—'],
                ['CARs Filed', String(cars.length)],
              ].map(([lbl, val]) => (
                <div key={lbl}>
                  <div style={{ fontSize: '0.69rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.15rem' }}>{lbl}</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 700, color: lbl === 'CARs Filed' && cars.length > 0 ? C.red : C.cream }}>{val}</div>
                </div>
              ))}
            </div>

            {/* By-class breakdown */}
            {speciesPresent.length > 0 && (
              <div style={{ borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '0.75rem', display: 'flex', flexWrap: 'wrap', gap: '1.5rem' }}>
                {speciesPresent.map(sp => {
                  const sexOpts = SEX_ORDER[sp] ?? []
                  const entries = sexOpts.map(sex => ({ sex, d: byClass[`${sp}:${sex}`] ?? null })).filter(e => e.d != null)
                  if (entries.length === 0) return null
                  return (
                    <div key={sp}>
                      <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>{sp}</div>
                      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
                        {entries.map(({ sex, d }) => d && (
                          <div key={sex} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.18)', borderRadius: 3, padding: '0.3rem 0.65rem' }}>
                            <span style={{ color: C.tan, fontWeight: 600, fontSize: '0.82rem' }}>{sex}: {d.count}</span>
                            {d.hcw > 0 && <span style={{ color: C.lightBrown, fontSize: '0.75rem', marginLeft: '0.35rem' }}>{d.hcw.toLocaleString()} lbs</span>}
                          </div>
                        ))}
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>

          {/* Harvest table */}
          <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.83rem' }}>
              <thead>
                <tr style={{ borderBottom: '2px solid rgba(166,120,90,0.3)' }}>
                  {['#', 'Tag', 'ET', 'Species', 'Sex', 'Breed', 'LW (lbs)', 'L Half', 'R Half', 'HCW (lbs)', 'Yield', 'ZT', 'HW °F', 'Cooler °F', 'Inspector', 'By', ''].map(h => (
                    <th key={h} style={{ padding: '0.6rem 0.75rem', color: C.lightBrown, fontWeight: 600, textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {logs.map((l, i) => (
                  <tr key={l.id} style={{ borderBottom: '1px solid rgba(166,120,90,0.1)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.015)' }}>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.lightBrown }}>{l.harvest_order ?? i + 1}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.cream, fontWeight: 600 }}>{l.carcass_tag || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.tan }}>{l.ear_tag || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.lightBrown }}>{l.species}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.cream }}>{l.sex || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.lightBrown }}>{l.breed || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.cream }}>{l.live_weight_lbs ?? '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.cream }}>{l.half_1_weight_lbs ?? '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.cream }}>{l.half_2_weight_lbs ?? '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.cream, fontWeight: 600 }}>{l.hot_carcass_weight_lbs ?? '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.tan }}>{l.yield_pct != null ? `${l.yield_pct}%` : '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>
                      {l.zero_tolerance_pass === null || l.zero_tolerance_pass === undefined ? <span style={{ color: C.lightBrown }}>—</span>
                        : l.zero_tolerance_pass ? <span style={{ color: C.green }}>✓</span>
                        : <span style={{ color: C.red }}>✗</span>}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', color: l.ccp_pass ? C.green : C.red }}>
                      {l.intervention_temp_f != null ? `${l.intervention_temp_f}°` : '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', color: l.initial_cooler_temp_f != null ? C.blue : C.lightBrown }}>
                      {l.initial_cooler_temp_f != null ? `${l.initial_cooler_temp_f}°` : '—'}
                    </td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.lightBrown }}>{l.inspector_initials || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.lightBrown }}>{l.performed_by || '—'}</td>
                    <td style={{ padding: '0.5rem 0.4rem' }}>
                      <button onClick={() => printCarcassTags(l)} title="Print carcass tag"
                        style={{ background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.3)', color: C.tan, borderRadius: 3, padding: '2px 7px', fontSize: '0.7rem', cursor: 'pointer' }}>
                        🏷
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* CAR Log */}
          {cars.length > 0 && (
            <div style={{ background: C.dark, border: '1px solid rgba(229,62,62,0.4)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid rgba(229,62,62,0.2)', fontSize: '0.72rem', color: C.red, textTransform: 'uppercase', letterSpacing: '0.1em', fontWeight: 700 }}>
                ⚠ Corrective Action Reports — {cars.length}
              </div>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem' }}>
                  <thead>
                    <tr style={{ borderBottom: '1px solid rgba(229,62,62,0.2)' }}>
                      {['CAR #', 'Type', 'Monitor', 'Action 1', 'Action 2', 'Root Cause', 'Completed'].map(h => (
                        <th key={h} style={{ padding: '0.55rem 0.85rem', color: C.lightBrown, fontWeight: 600, textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {cars.map(car => (
                      <tr key={car.id} style={{ borderBottom: '1px solid rgba(166,120,90,0.08)' }}>
                        <td style={{ padding: '0.45rem 0.85rem', color: C.cream, fontWeight: 700 }}>{car.car_number}</td>
                        <td style={{ padding: '0.45rem 0.85rem', color: car.type === 'zero_tolerance' ? C.orange : C.blue, fontWeight: 600 }}>
                          {car.type === 'zero_tolerance' ? 'Zero Tolerance' : 'Hot Water'}
                        </td>
                        <td style={{ padding: '0.45rem 0.85rem', color: C.tan }}>{car.monitor_initials ?? '—'}</td>
                        <td style={{ padding: '0.45rem 0.85rem', color: C.lightBrown, maxWidth: 220 }}>{car.action_1 ?? '—'}</td>
                        <td style={{ padding: '0.45rem 0.85rem', color: C.lightBrown, maxWidth: 220 }}>{car.action_2 ?? '—'}</td>
                        <td style={{ padding: '0.45rem 0.85rem', color: C.lightBrown }}>{car.root_cause ?? '—'}</td>
                        <td style={{ padding: '0.45rem 0.85rem', color: car.completion_date ? C.green : C.yellow }}>
                          {car.completion_date ?? 'Pending'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CHILL LOG TAB
// ══════════════════════════════════════════════════════════════════════════════
function ChillTab() {
  const [carcasses, setCarcasses] = useState<HarvestLog[]>([])
  const [chillLogs, setChillLogs] = useState<ChillLog[]>([])
  const [selected, setSelected]   = useState<HarvestLog | null>(null)
  const [saving, setSaving]       = useState(false)
  const [form, setForm] = useState({ checked_at: new Date().toISOString().slice(0, 16), carcass_temp_f: '', cooler_temp_f: '', checked_by: '', notes: '' })

  const load = useCallback(async () => {
    const [cRes, lRes] = await Promise.all([fetch('/api/harvest?type=log'), fetch('/api/harvest?type=chill')])
    const c: HarvestLog[] = await cRes.json().catch(() => [])
    const l: ChillLog[]   = await lRes.json().catch(() => [])
    setCarcasses(c.filter(h => h.status === 'chilling'))
    setChillLogs(l)
  }, [])

  useEffect(() => { load() }, [load])

  function hoursAgo(ds: string) { return ((Date.now() - new Date(ds).getTime()) / 3600000).toFixed(1) }
  function latestTemp(id: string): number | null { return chillLogs.filter(l => l.harvest_log_id === id)[0]?.carcass_temp_f ?? null }
  function deadline(h: HarvestLog) { const t = new Date(h.created_at); t.setHours(t.getHours() + (h.species === 'Hog' ? 24 : 48)); return t }
  function deadlineColor(h: HarvestLog) {
    const dl = deadline(h), lt = latestTemp(h.id)
    if (lt !== null && lt <= 40) return C.green
    const hrs = (dl.getTime() - Date.now()) / 3600000
    return hrs < 4 ? C.red : hrs < 12 ? C.orange : C.tan
  }
  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleAddReading() {
    if (!selected) return
    setSaving(true)
    await fetch('/api/harvest', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'chill', harvest_log_id: selected.id, carcass_tag: selected.carcass_tag, checked_at: form.checked_at, carcass_temp_f: form.carcass_temp_f ? parseFloat(form.carcass_temp_f) : null, cooler_temp_f: form.cooler_temp_f ? parseFloat(form.cooler_temp_f) : null, checked_by: form.checked_by, notes: form.notes }),
    })
    const hrs = parseFloat(hoursAgo(selected.created_at))
    const temp = parseFloat(form.carcass_temp_f)
    if (!isNaN(temp) && temp <= 40 && hrs >= 24) {
      await fetch('/api/harvest', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'log', id: selected.id, status: 'complete' }) })
    }
    setSaving(false)
    setSelected(null)
    setForm({ checked_at: new Date().toISOString().slice(0, 16), carcass_temp_f: '', cooler_temp_f: '', checked_by: '', notes: '' })
    load()
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '360px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — chilling list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
          Chilling ({carcasses.length})
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {carcasses.length === 0 && <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>No carcasses chilling</p>}
          {carcasses.map(h => {
            const lt = latestTemp(h.id), hrs = hoursAgo(h.created_at), dl = deadline(h)
            const dlStr = dl.toLocaleTimeString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' } as Intl.DateTimeFormatOptions)
            return (
              <div key={h.id} onClick={() => setSelected(h)} style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.12)', cursor: 'pointer', background: selected?.id === h.id ? 'rgba(166,120,90,0.12)' : 'transparent', transition: 'background 0.15s' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>{h.species} — Tag {h.carcass_tag || '—'}</div>
                    <div style={{ fontSize: '0.78rem', color: C.tan, marginTop: '0.15rem' }}>
                      {hrs} hrs in cooler{h.hot_carcass_weight_lbs ? ` · ${h.hot_carcass_weight_lbs} lbs HCW` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '1.1rem', fontWeight: 700, color: tempColor(lt) }}>{lt !== null ? `${lt}°F` : '—'}</div>
                    <div style={{ fontSize: '0.7rem', color: C.lightBrown }}>latest</div>
                  </div>
                </div>
                <div style={{ fontSize: '0.73rem', color: deadlineColor(h), marginTop: '0.4rem' }}>⏱ Deadline: {dlStr}</div>
              </div>
            )
          })}
        </div>
      </div>

      {/* Right — add reading */}
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
                {hoursAgo(selected.created_at)} hrs in cooler{selected.hot_carcass_weight_lbs ? ` · ${selected.hot_carcass_weight_lbs} lbs HCW` : ''}{selected.sex ? ` · ${selected.sex}` : ''}
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

            {/* History */}
            {chillLogs.filter(l => l.harvest_log_id === selected.id).length > 0 && (
              <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '1rem' }}>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Temperature History</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {chillLogs.filter(l => l.harvest_log_id === selected.id).map(l => (
                    <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0.6rem 0.85rem', background: 'rgba(255,255,255,0.04)', borderRadius: 3 }}>
                      <div>
                        <span style={{ color: tempColor(l.carcass_temp_f), fontWeight: 700, fontSize: '1rem', marginRight: '0.75rem' }}>{l.carcass_temp_f}°F</span>
                        {l.cooler_temp_f != null && <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>Cooler: {l.cooler_temp_f}°F</span>}
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.8rem', color: C.tan }}>{new Date(l.checked_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
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
// MAIN PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function HarvestPage() {
  const todayStr = new Date().toISOString().slice(0, 10)
  const [tab, setTab]             = useState<Tab>('parta')
  const [harvestDate, setDate]    = useState(todayStr)
  const [appointments, setAppts]  = useState<HarvestAppointment[]>([])
  const [selectedAppt, setSelAppt] = useState<HarvestAppointment | null>(null)
  const [loadingAppts, setLoadingAppts] = useState(false)

  const loadAppts = useCallback(async () => {
    setLoadingAppts(true)
    const res  = await fetch(`/api/appointments?date=${harvestDate}`)
    const data: HarvestAppointment[] = await res.json().catch(() => [])
    const active = data.filter(a => ['AnimalIn', 'Processing', 'Complete'].includes(a.status))
    setAppts(active)
    // Auto-select if only one; keep selection if still valid
    if (active.length === 1) {
      setSelAppt(active[0])
    } else if (active.length > 1) {
      setSelAppt(prev => active.find(a => a.id === prev?.id) ?? active[0])
    } else {
      setSelAppt(null)
    }
    setLoadingAppts(false)
  }, [harvestDate])

  useEffect(() => { loadAppts() }, [loadAppts])

  function shiftDate(d: number) {
    const dt = new Date(harvestDate + 'T12:00:00'); dt.setDate(dt.getDate() + d)
    setDate(dt.toISOString().slice(0, 10))
  }

  const showApptBar = tab === 'parta' || tab === 'partb'

  const NAV: React.CSSProperties = { background: 'rgba(166,120,90,0.12)', border: '1px solid rgba(166,120,90,0.3)', color: C.tan, borderRadius: 3, padding: '0.35rem 0.7rem', fontSize: '1rem', cursor: 'pointer', lineHeight: 1 }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      {/* ── Header ── */}
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: '1rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Harvest</h1>
        </div>

        {/* Date picker (Part A / Part B only) */}
        {showApptBar && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem' }}>
            <button onClick={() => shiftDate(-1)} style={NAV}>‹</button>
            <input type="date" value={harvestDate} onChange={e => setDate(e.target.value)} style={{ ...INPUT, width: 'auto', padding: '0.3rem 0.6rem', fontSize: '0.85rem' }} />
            <button onClick={() => shiftDate(1)} style={NAV}>›</button>
            {harvestDate !== todayStr && (
              <button onClick={() => setDate(todayStr)} style={{ ...NAV, fontSize: '0.74rem', padding: '0.35rem 0.6rem' }}>Today</button>
            )}
          </div>
        )}

        {/* Tab bar */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', flexShrink: 0 }}>
          {([
            ['parta',      '📋 Part A'],
            ['partb',      '⚖ Part B'],
            ['harvestlog', '📊 Harvest Log'],
            ['chill',      '🌡️ Chill Log'],
          ] as [Tab, string][]).map(([t, lbl]) => (
            <button key={t} onClick={() => setTab(t)} style={{
              padding: '0.45rem 1.1rem', border: 'none', cursor: 'pointer', fontSize: '0.82rem', fontWeight: 600,
              background: tab === t ? C.medBrown : 'transparent',
              color: tab === t ? C.cream : C.lightBrown,
              letterSpacing: '0.03em', transition: 'background 0.15s',
            }}>
              {lbl}
            </button>
          ))}
        </div>
      </header>

      {/* ── Appointment selector bar ── */}
      {showApptBar && (
        <div style={{ background: 'rgba(0,0,0,0.25)', borderBottom: '1px solid rgba(166,120,90,0.15)', padding: '0.55rem 2rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', flexShrink: 0 }}>
          {loadingAppts ? (
            <span style={{ color: C.lightBrown, fontSize: '0.82rem' }}>Loading…</span>
          ) : appointments.length === 0 ? (
            <span style={{ color: C.lightBrown, fontSize: '0.82rem' }}>No animals checked in for {harvestDate} — check in via Receiving first.</span>
          ) : (
            <>
              <span style={{ color: C.lightBrown, fontSize: '0.72rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>Appointment:</span>
              {appointments.map(a => (
                <button key={a.id} onClick={() => setSelAppt(a)} style={{
                  padding: '0.3rem 0.85rem', borderRadius: 3, fontSize: '0.83rem', fontWeight: 600, cursor: 'pointer',
                  background: selectedAppt?.id === a.id ? C.medBrown : 'rgba(166,120,90,0.1)',
                  border: selectedAppt?.id === a.id ? `1px solid ${C.lightBrown}` : '1px solid rgba(166,120,90,0.3)',
                  color: selectedAppt?.id === a.id ? C.cream : C.tan,
                }}>
                  {a.species} — {a.head_count} head
                  {a.source && <span style={{ fontWeight: 400, opacity: 0.8 }}> · {a.source}</span>}
                </button>
              ))}
            </>
          )}
        </div>
      )}

      {/* ── Main content ── */}
      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1320px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {tab === 'parta'      && <PartATab      date={harvestDate} appt={selectedAppt} />}
        {tab === 'partb'      && <PartBTab      date={harvestDate} appt={selectedAppt} />}
        {tab === 'harvestlog' && <HarvestLogTab />}
        {tab === 'chill'      && <ChillTab />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
