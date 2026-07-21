'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { HarvestAppointment, HarvestLog, ChillLog, AnimalReceivingLog, CorrectiveAction } from '@/lib/types'
import { setFeedbackContext, clearFeedbackContext } from '@/lib/feedbackTelemetry'
import { isoDate, isoDateTime, addDaysISO } from '@/lib/dates'
import { splitsIntoHalves, WHOLE_WEIGHT_LABEL } from '@/lib/carcass'

type Tab = 'parta' | 'partb' | 'worksheet' | 'harvestlog' | 'chill'

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
    html, body { font-family: Arial, sans-serif; color: #000; width: 2.12in; }
    /* Each label must fill the printable page height (5in − top/bottom margin
       0.28in = 4.72in) so the continuous-roll printer feeds & cuts a SEPARATE
       physical label per half. Without min-height the two halves collapse onto
       one label. break-after: page is the modern alias for page-break-after. */
    .label { min-height: 4.72in; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; }
    .label:last-child { min-height: 0; page-break-after: auto; break-after: auto; }
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
  function makeLabel(side: 'L' | 'R' | 'WHOLE', bcId: string) {
    const whole      = side === 'WHOLE'
    const halfLabel  = side === 'L' ? '◀  L HALF' : 'R HALF  ▶'
    const shortDate  = h.harvest_date.replace(/-/g, '').slice(2)
    // Whole-carcass tags carry no -L/-R side suffix on the barcode.
    const barcodeVal = whole ? `${shortDate}-${h.carcass_tag}` : `${shortDate}-${h.carcass_tag}-${side}`
    const producerHtml = h.producer ? `<div class="producer">${h.producer}</div>` : ''
    const identHtml    = identLine  ? `<div class="ident">${identLine}</div>`      : ''
    const otmHtml      = h.over_30_months ? `<div class="otm">&#9888; Over 30 Months</div>` : ''
    // Split carcasses (beef) highlight average half weight; a whole small-animal
    // carcass highlights its full hot carcass weight instead.
    const avgHtHtml    = !whole && avgHalfWt != null ? `<div class="row hl"><span class="lbl">Avg Half Wt</span><span class="val big">${avgHalfWt.toFixed(1)} lbs</span></div>` : ''
    const wholeWtHtml  =  whole && totalHCW  != null ? `<div class="row hl"><span class="lbl">Carcass Wt</span><span class="val big">${totalHCW} lbs</span></div>` : ''
    const totalHtml    = !whole && totalHCW  != null ? `<div class="row"><span class="lbl">Total HCW</span><span class="val">${totalHCW} lbs</span></div>` : ''
    const yieldHtml    = h.yield_pct  != null ? `<div class="row"><span class="lbl">Yield</span><span class="val">${h.yield_pct}%</span></div>` : ''
    const inspHtml     = h.inspector_initials ? `<div class="row"><span class="lbl">Inspector</span><span class="val">${h.inspector_initials}</span></div>` : ''
    const badgeHtml    = whole ? '' : `<div class="half-badge">${halfLabel}</div>`
    return `<div class="label">
      <div class="header"><div class="co">Cowboy Meat Co.</div><div class="co-sub">Forsyth, Montana &nbsp;&middot;&nbsp; Carcass Tag</div></div>
      ${badgeHtml}<hr/>
      ${producerHtml}<div class="species">${h.species}</div>
      <div class="tagnum">${h.carcass_tag || '—'}</div>
      ${identHtml}
      <div class="bc-wrap"><svg id="${bcId}"></svg></div><hr/>
      <div class="row"><span class="lbl">Date</span><span class="val">${dateStr}</span></div>
      ${avgHtHtml}${wholeWtHtml}${totalHtml}${yieldHtml}${inspHtml}${otmHtml}
      <script>JsBarcode("#${bcId}","${barcodeVal}",{format:"CODE128",width:2.4,height:70,displayValue:true,fontSize:9,margin:10,textMargin:2});<\/script>
    </div>`
  }
  // Split carcasses (beef, sows, boars) get one tag per side; whole-hanging
  // ones (lamb, goat, market hog) get a single tag.
  const isBeef     = splitsIntoHalves(h.species, h.sex)
  const labelsHtml = isBeef
    ? `${makeLabel('L','bc-l')}${makeLabel('R','bc-r')}`
    : makeLabel('WHOLE','bc-w')
  const html = `<!DOCTYPE html><html><head>
  <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
  <style>${css}</style></head><body>
  ${labelsHtml}
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
  earTag:       string
  knockTime:    string
  liveWeight:   string
  harvestOrder: string
  killType:     'USDA' | 'Custom' | ''
  partAComplete: boolean
  expanded:     boolean
  saving:       boolean
  error:        string
}

// ── Small USDA/Custom badge ───────────────────────────────────────────────────
function KillTypeBadge({ killType }: { killType: 'USDA' | 'Custom' | null | undefined }) {
  if (!killType) return null
  const usda = killType === 'USDA'
  return (
    <span style={{
      fontSize: '0.62rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      padding: '1px 6px', borderRadius: 3, whiteSpace: 'nowrap',
      color: usda ? C.green : C.yellow,
      border: `1px solid ${usda ? C.green : C.yellow}66`,
      background: `${usda ? C.green : C.yellow}1A`,
    }}>
      {killType}
    </span>
  )
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
    // Stable, deterministic order so the positional same-tag pairing below is repeatable.
    receiving.sort((a, b) => (a.animal_index ?? 0) - (b.animal_index ?? 0))
    // Stable order so the positional fallback below is deterministic across reloads.
    const apptLogs = allLogs
      .filter(l => l.appointment_id === appt.id)
      .sort((a, b) => (a.created_at ?? '').localeCompare(b.created_at ?? ''))

    // Pair each receiving animal to its harvest row. Tagged animals normally match
    // by ear tag — but tags are NOT guaranteed unique: several untagged animals are
    // often all entered as the same literal (e.g. "NT" for "no tag"), and truly
    // tagless animals (hogs) carry no tag at all. So bucket the harvest rows by ear
    // tag (blank tags share the '' bucket) and consume each bucket positionally in
    // created_at order — a 1:1 animal→row pairing even when many animals share one
    // tag value. Without this, a duplicate tag collapsed every matching animal onto
    // a SINGLE row, so only the last save stuck — e.g. only 1 of 4 same-tag "NT"
    // carcasses recorded its kill type / weights / knock time.
    const logsByTag = new Map<string, HarvestLog[]>()
    apptLogs.forEach(l => {
      const key = l.ear_tag || ''
      const bucket = logsByTag.get(key)
      if (bucket) bucket.push(l); else logsByTag.set(key, [l])
    })
    const tagCursor = new Map<string, number>()

    // Suggest next available harvest order
    const maxOrder = apptLogs.reduce((m, l) => Math.max(m, l.harvest_order ?? 0), 0)
    let nextOrder  = maxOrder + 1

    const built: PartARow[] = receiving.map(animal => {
      const key    = animal.ear_tag || ''
      const cursor = tagCursor.get(key) ?? 0
      const log    = logsByTag.get(key)?.[cursor] ?? null
      tagCursor.set(key, cursor + 1)
      const ord = log?.harvest_order ?? nextOrder++
      return {
        animal,
        logId:        log?.id ?? null,
        earTag:       animal.ear_tag || '',
        knockTime:    log?.knock_time ?? '',
        liveWeight:   log?.live_weight_lbs != null ? String(log.live_weight_lbs) : '',
        harvestOrder: String(ord),
        killType:     log?.kill_type ?? '',
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
      kill_type:         a.killType || null,
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
            kill_type:      a.killType || null,
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

  // Correct an animal's ear tag after harvest. The tag is the pairing key between
  // the receiving record and the harvest record, so BOTH must move together —
  // updating only one would un-pair them on the next reload.
  async function saveEarTag(i: number) {
    const a = rows[i]
    const newTag = a.earTag.trim()
    if (newTag === (a.animal.ear_tag || '')) return   // no change
    upd(i, { saving: true, error: '' })

    // Receiving record first (source of truth for the animal list)…
    const r1 = await fetch('/api/receiving', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'animal', id: a.animal.id, ear_tag: newTag }) })
    const j1 = await r1.json().catch(() => ({}))
    if (j1.error) { upd(i, { saving: false, error: `Tag update failed: ${j1.error}` }); return }

    // …then keep the harvest record's tag in sync (if Part A has been saved).
    if (a.logId) {
      const r2 = await fetch('/api/harvest', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: a.logId, ear_tag: newTag }) })
      const j2 = await r2.json().catch(() => ({}))
      if (j2.error) { upd(i, { saving: false, error: `Tag synced to check-in but not the harvest record: ${j2.error}` }); return }
    }

    // Both records moved together → local pairing stays valid, no reload needed.
    upd(i, { saving: false, animal: { ...a.animal, ear_tag: newTag }, earTag: newTag })
  }

  // Remove a whole animal (e.g. a mis-counted / phantom check-in): deletes its
  // harvest record (if any) and its receiving record, then reloads.
  async function removeAnimal(i: number) {
    const a = rows[i]
    if (!appt) return
    const label = a.animal.ear_tag ? `ET ${a.animal.ear_tag}` : `${a.animal.sex || 'animal'} #${a.harvestOrder || i + 1}`
    if (!window.confirm(
      `Remove ${label} from this ${appt.species} appointment?\n\n` +
      `This permanently deletes its check-in record${a.logId ? ' and its harvest record' : ''}. ` +
      `Use this only for an animal that wasn't actually harvested (e.g. a mis-count). This cannot be undone.`
    )) return

    upd(i, { saving: true, error: '' })
    if (a.logId) {
      const r = await fetch(`/api/harvest?type=log&id=${a.logId}`, { method: 'DELETE' })
      const j = await r.json().catch(() => ({}))
      if (j.error) { upd(i, { saving: false, error: j.error }); return }
    }
    const r2 = await fetch(`/api/receiving?type=animal&id=${a.animal.id}`, { method: 'DELETE' })
    const j2 = await r2.json().catch(() => ({}))
    if (j2.error) { upd(i, { saving: false, error: j2.error }); return }
    await load()
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

      {/* Head-count mismatch warning: receiving rows vs appointment head count */}
      {!loading && rows.length > 0 && appt.head_count !== rows.length && (
        <div style={{ background: 'rgba(217,119,6,0.12)', border: `1px solid ${C.yellow}66`, borderRadius: 4, padding: '0.7rem 1rem', marginBottom: '0.85rem', color: C.yellow, fontSize: '0.85rem', fontWeight: 600, lineHeight: 1.4 }}>
          ⚠ Head-count mismatch: this appointment is booked for <strong>{appt.head_count} head</strong>, but <strong>{rows.length}</strong> {rows.length === 1 ? 'animal was' : 'animals were'} checked in at receiving.{' '}
          {rows.length > appt.head_count
            ? 'If an extra was a mis-count, expand it below and use “Remove animal.” Otherwise update the head count on the Schedule.'
            : 'Check in the missing animal(s) at Receiving, or update the head count on the Schedule.'}
        </div>
      )}

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
              <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.95rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <span>
                  {row.animal.ear_tag ? `ET: ${row.animal.ear_tag}` : 'No Ear Tag'}
                  <span style={{ color: C.lightBrown, fontWeight: 400 }}> · {row.animal.sex}</span>
                </span>
                <KillTypeBadge killType={row.killType || null} />
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
              {/* Ear-tag correction — writes to both the receiving and harvest records */}
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={LABEL}>Ear Tag #</label>
                <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
                  <input style={{ ...INPUT, maxWidth: 220 }} value={row.earTag}
                    onChange={e => upd(i, { earTag: e.target.value })} placeholder="No tag" />
                  <button
                    onClick={() => saveEarTag(i)}
                    disabled={row.saving || row.earTag.trim() === (row.animal.ear_tag || '')}
                    title="Correct this animal's ear tag"
                    style={{ ...BTN('rgba(166,120,90,0.15)', C.tan), border: '1px solid rgba(166,120,90,0.3)',
                      opacity: (row.saving || row.earTag.trim() === (row.animal.ear_tag || '')) ? 0.5 : 1 }}
                  >
                    Update tag
                  </button>
                </div>
              </div>
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
              <div style={{ marginBottom: '0.85rem' }}>
                <label style={LABEL}>Kill Type</label>
                <div style={{ display: 'flex', gap: '0.5rem' }}>
                  {(['USDA', 'Custom'] as const).map(kt => {
                    const active = row.killType === kt
                    const color  = kt === 'USDA' ? C.green : C.yellow
                    return (
                      <button key={kt} type="button"
                        onClick={() => upd(i, { killType: active ? '' : kt })}
                        style={{
                          padding: '0.45rem 1.1rem', borderRadius: 3, cursor: 'pointer', fontWeight: 600, fontSize: '0.85rem',
                          border: active ? `2px solid ${color}` : '1px solid rgba(166,120,90,0.3)',
                          background: active ? `${color}22` : 'rgba(255,255,255,0.04)',
                          color: active ? color : C.lightBrown,
                        }}>
                        {kt}
                      </button>
                    )
                  })}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
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
                <button
                  onClick={() => removeAnimal(i)}
                  disabled={row.saving}
                  title="Remove this animal (mis-count / not harvested)"
                  style={{ background: 'transparent', border: `1px solid ${C.red}55`, color: C.red, borderRadius: 4, padding: '0.5rem 0.85rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', opacity: row.saving ? 0.6 : 1 }}
                >
                  🗑 Remove animal
                </button>
              </div>
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
  whole:       string   // single-weight carcasses (lamb, goat, market hog)
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

// Part B is the day's rail worklist, across all appointments in kill order —
// the crew works the rail in that order regardless of producer. A carcass is
// relevant once Part A assigned it a kill order, and drops off once it's been
// checked into the cooler (initial cooler temp recorded).
function PartBTab({ date }: { date: string }) {
  const [rows, setRows]         = useState<PartBRow[]>([])
  const [loading, setLoading]   = useState(false)
  const [carModal, setCarModal] = useState<{ rowIdx: number; type: 'zero_tolerance' | 'hot_water' } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/harvest?type=log&date=${date}`)
    const all: HarvestLog[] = await res.json().catch(() => [])
    // On the worklist: has a kill order, and NOT (checked into the cooler with
    // Part B finished). A carcass that got its cooler temp before its weights
    // were entered stays visible — otherwise it vanishes from the only place
    // those can be recorded.
    const dayLogs = (Array.isArray(all) ? all : [])
      .filter(l => l.harvest_order != null && !(l.initial_cooler_temp_f != null && l.part_b_complete))
      .sort((a, b) => (a.harvest_order ?? 999) - (b.harvest_order ?? 999))

    setRows(dayLogs.map(log => ({
      log,
      fields: {
        half1:      log.half_1_weight_lbs != null ? String(log.half_1_weight_lbs) : '',
        half2:      log.half_2_weight_lbs != null ? String(log.half_2_weight_lbs) : '',
        // Older single-weight records were typed into a half field before this
        // form knew the difference — read any of the three.
        whole:      (log.hot_carcass_weight_lbs ?? log.half_1_weight_lbs ?? log.half_2_weight_lbs) != null
                      ? String(log.hot_carcass_weight_lbs ?? log.half_1_weight_lbs ?? log.half_2_weight_lbs) : '',
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
  }, [date])

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
    const split = splitsIntoHalves(log.species, log.sex)
    // Whole-hanging carcasses record one weight and no halves; split carcasses
    // record a side each and the API sums them. Yield is derived server-side.
    const h1  = split && fields.half1 ? parseFloat(fields.half1) : null
    const h2  = split && fields.half2 ? parseFloat(fields.half2) : null
    const hcw = split
      ? (h1 != null && h2 != null ? h1 + h2 : h1 ?? h2)
      : (fields.whole ? parseFloat(fields.whole) : null)
    await patch(i, 'weights', {
      carcass_tag:            fields.carcassTag,
      half_1_weight_lbs:      h1,
      half_2_weight_lbs:      h2,
      hot_carcass_weight_lbs: hcw,
    })
  }

  async function saveZT(i: number) {
    const { fields } = rows[i]
    // null is now a valid value to save — it clears a previously-recorded Pass/Fail.
    // Clearing a CCP also drops the row out of "Part B complete".
    const body: Record<string, unknown> = { zero_tolerance_pass: fields.ztPass, zero_tolerance_direct_obs: fields.ztDirect }
    if (fields.ztPass === null) body.part_b_complete = false
    await patch(i, 'zt', body)
    if (fields.ztPass === false) setCarModal({ rowIdx: i, type: 'zero_tolerance' })
  }

  async function saveHW(i: number) {
    const { fields } = rows[i]
    const cleared = fields.hwPass === null
    const hwTemp  = !cleared && fields.hwTemp ? parseFloat(fields.hwTemp) : null
    // Clearing wipes the intervention temp too so the row reads as un-recorded again,
    // and drops the row out of "Part B complete".
    const body: Record<string, unknown> = {
      ccp_pass:             fields.hwPass,
      direct_observation:   fields.hwDirect,
      intervention_temp_f:  cleared ? null : hwTemp,
      intervention_applied: !cleared,
    }
    if (cleared) body.part_b_complete = false
    await patch(i, 'hw', body)
    if (fields.hwPass === false) setCarModal({ rowIdx: i, type: 'hot_water' })
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

  return (
    <div>
      {rows.length > 0 && (
        <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginBottom: '0.65rem' }}>
          {rows.length} carcass{rows.length === 1 ? '' : 'es'} on the rail for this date, in kill order — every producer. Carcasses drop off once Part B is complete and they&apos;re checked into the cooler.
        </div>
      )}
      {loading && <div style={{ color: C.lightBrown, textAlign: 'center', padding: '2rem' }}>Loading carcasses…</div>}
      {!loading && rows.length === 0 && (
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '2rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.88rem' }}>
          Nothing waiting on Part B — a carcass shows here once Part A assigns its kill order, and drops off once it&apos;s checked into the cooler.
        </div>
      )}

      {rows.map((row, i) => {
        // Beef, sows and boars come off the rail in halves; lambs, goats and
        // market hogs hang whole and take a single weight.
        const split = splitsIntoHalves(row.log.species, row.log.sex)
        const h1  = row.fields.half1 ? parseFloat(row.fields.half1) : null
        const h2  = row.fields.half2 ? parseFloat(row.fields.half2) : null
        const whole = row.fields.whole ? parseFloat(row.fields.whole) : null
        const hcw = split
          ? (h1 != null && h2 != null ? (h1 + h2).toFixed(1) : h1 != null ? h1.toFixed(1) : h2 != null ? h2.toFixed(1) : null)
          : (whole != null ? whole.toFixed(1) : null)
        const lw  = row.log.live_weight_lbs
        const yld = lw && hcw ? ((parseFloat(hcw) / lw) * 100).toFixed(1) : null

        const hwStatus = row.log.intervention_temp_f != null ? row.log.ccp_pass : null

        // Un-click support: a Pass/Fail can be deselected back to null. Allow the
        // Save button when a value is selected OR when a previously-saved value is
        // being cleared, so an accidental/wrong entry can actually be undone in the DB.
        const ztClearing = row.fields.ztPass === null && row.log.zero_tolerance_pass !== null
        const hwClearing = row.fields.hwPass === null && row.log.intervention_temp_f  !== null
        const ztCanSave  = row.fields.ztPass !== null || ztClearing
        const hwCanSave  = row.fields.hwPass !== null || hwClearing

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
                <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                  <span>
                    {row.log.producer && <span style={{ color: C.tan }}>{row.log.producer} · </span>}
                    {row.log.ear_tag ? `ET: ${row.log.ear_tag}` : 'No Ear Tag'}
                    {row.log.carcass_tag ? <span style={{ color: C.tan }}> · Tag {row.log.carcass_tag}</span> : null}
                    <span style={{ color: C.lightBrown, fontWeight: 400 }}> · {row.log.sex}</span>
                  </span>
                  <KillTypeBadge killType={row.log.kill_type} />
                </div>
                <div style={{ fontSize: '0.78rem', color: C.lightBrown, marginTop: '0.1rem' }}>
                  {row.log.species}{row.log.breed ? ` · ${row.log.breed}` : ''}
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
                  <div style={{ display: 'grid', gridTemplateColumns: split ? '1fr 1fr 1fr 1fr' : '1fr 1fr 1fr', gap: '0 1rem', marginBottom: '0.75rem' }}>
                    <div>
                      <label style={LABEL}>Carcass Tag #</label>
                      <input style={INPUT} value={row.fields.carcassTag} onChange={e => updField(i, { carcassTag: e.target.value })} placeholder="001" />
                    </div>
                    {split ? (
                      <>
                        <div>
                          <label style={LABEL}>Left Half (lbs)</label>
                          <input type="number" step="0.1" style={INPUT} value={row.fields.half1} onChange={e => updField(i, { half1: e.target.value })} placeholder="0.0" />
                        </div>
                        <div>
                          <label style={LABEL}>Right Half (lbs)</label>
                          <input type="number" step="0.1" style={INPUT} value={row.fields.half2} onChange={e => updField(i, { half2: e.target.value })} placeholder="0.0" />
                        </div>
                      </>
                    ) : (
                      <div>
                        <label style={LABEL}>{WHOLE_WEIGHT_LABEL}</label>
                        <input type="number" step="0.1" style={INPUT} value={row.fields.whole} onChange={e => updField(i, { whole: e.target.value })} placeholder="0.0" />
                      </div>
                    )}
                    <div>
                      <label style={LABEL}>{split ? 'HCW (auto)' : 'Yield'}</label>
                      <div style={{ ...INPUT, color: C.tan, fontWeight: 600, display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
                        {split ? (hcw ? `${hcw} lbs` : '—') : (yld ? `${yld}%` : '—')}
                        {split && yld && <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>({yld}%)</span>}
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
                    <PassFailBtn active={row.fields.ztPass === true}  pass={true}  onClick={() => updField(i, { ztPass: row.fields.ztPass === true  ? null : true  })} />
                    <PassFailBtn active={row.fields.ztPass === false} pass={false} onClick={() => updField(i, { ztPass: row.fields.ztPass === false ? null : false })} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: C.tan, fontSize: '0.85rem', cursor: 'pointer', marginLeft: '0.5rem' }}>
                      <input type="checkbox" checked={row.fields.ztDirect} onChange={e => updField(i, { ztDirect: e.target.checked })} style={{ width: 16, height: 16 }} />
                      Direct Observation
                    </label>
                    <button
                      onClick={() => saveZT(i)}
                      disabled={!ztCanSave || row.saving === 'zt'}
                      style={{ ...BTN(ztClearing ? C.red : C.tan), opacity: (!ztCanSave || row.saving === 'zt') ? 0.5 : 1 }}
                    >
                      {row.saving === 'zt' ? 'Saving…' : ztClearing ? 'Clear ZT' : 'Save ZT'}
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
                    <PassFailBtn active={row.fields.hwPass === true}  pass={true}  onClick={() => updField(i, { hwPass: row.fields.hwPass === true  ? null : true  })} />
                    <PassFailBtn active={row.fields.hwPass === false} pass={false} onClick={() => updField(i, { hwPass: row.fields.hwPass === false ? null : false })} />
                    <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', color: C.tan, fontSize: '0.85rem', cursor: 'pointer', marginLeft: '0.5rem' }}>
                      <input type="checkbox" checked={row.fields.hwDirect} onChange={e => updField(i, { hwDirect: e.target.checked })} style={{ width: 16, height: 16 }} />
                      Direct Observation
                    </label>
                    <button
                      onClick={() => saveHW(i)}
                      disabled={!hwCanSave || row.saving === 'hw'}
                      style={{ ...BTN(hwClearing ? C.red : C.tan), opacity: (!hwCanSave || row.saving === 'hw') ? 0.5 : 1 }}
                    >
                      {row.saving === 'hw' ? 'Saving…' : hwClearing ? 'Clear HW' : 'Save HW'}
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
  const todayStr = isoDate()
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
    setDate(addDaysISO(date, d))
  }

  // Delete a single harvest record (e.g. a leftover duplicate carcass row).
  async function deleteLog(l: HarvestLog) {
    const hasData = l.hot_carcass_weight_lbs != null || l.live_weight_lbs != null || l.part_b_complete || !!l.knock_time
    const warn = hasData ? '\n\n⚠ This record has harvest data entered (weights / CCP / knock time) — make sure it is truly a duplicate before deleting.' : ''
    if (!window.confirm(
      `Delete harvest record #${l.harvest_order ?? '?'} — ${l.species} ${l.sex || ''}${l.ear_tag ? ` (ET ${l.ear_tag})` : ''}?${warn}\n\nThis permanently removes it and cannot be undone.`
    )) return
    const res = await fetch(`/api/harvest?type=log&id=${l.id}`, { method: 'DELETE' })
    const j   = await res.json().catch(() => ({}))
    if (j.error) { alert(`Delete failed: ${j.error}`); return }
    load()
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
                  {['#', 'Tag', 'ET', 'Owner', 'Species', 'Type', 'Sex', 'Breed', 'LW (lbs)', 'L Half', 'R Half', 'HCW (lbs)', 'Yield', 'ZT', 'HW °F', 'Cooler °F', 'Inspector', 'By', ''].map(h => (
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
                    <td style={{ padding: '0.5rem 0.75rem', color: C.cream, whiteSpace: 'nowrap' }}>{l.producer || '—'}</td>
                    <td style={{ padding: '0.5rem 0.75rem', color: C.lightBrown }}>{l.species}</td>
                    <td style={{ padding: '0.5rem 0.75rem' }}>{l.kill_type ? <KillTypeBadge killType={l.kill_type} /> : <span style={{ color: C.lightBrown }}>—</span>}</td>
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
                    <td style={{ padding: '0.5rem 0.4rem', whiteSpace: 'nowrap' }}>
                      <button onClick={() => printCarcassTags(l)} title="Print carcass tag"
                        style={{ background: 'rgba(166,120,90,0.15)', border: '1px solid rgba(166,120,90,0.3)', color: C.tan, borderRadius: 3, padding: '2px 7px', fontSize: '0.7rem', cursor: 'pointer' }}>
                        🏷
                      </button>
                      <button onClick={() => deleteLog(l)} title="Delete this harvest record (duplicate)"
                        style={{ background: 'transparent', border: `1px solid ${C.red}55`, color: C.red, borderRadius: 3, padding: '2px 7px', fontSize: '0.7rem', cursor: 'pointer', marginLeft: 4 }}>
                        🗑
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

// Julian code YYDDD (e.g. 2026-06-02 → "26153"): 2-digit year + day-of-year.
function julianCode(dateISO: string): string {
  const dt        = new Date(dateISO + 'T12:00:00')
  const yearStart = new Date(dt.getFullYear(), 0, 1)
  const dayOfYear = Math.floor((dt.getTime() - yearStart.getTime()) / 86400000) + 1
  return `${String(dt.getFullYear()).slice(-2)}${String(dayOfYear).padStart(3, '0')}`
}

// ══════════════════════════════════════════════════════════════════════════════
// WORKSHEET TAB — printable pre-harvest sheet of every checked-in animal for a day
// ══════════════════════════════════════════════════════════════════════════════
interface WSRow {
  ear_tag: string; sex: string; breed: string; over_30_months: boolean
  // Pre-filled from this animal's harvest record (Part A/B) when one exists, so
  // anything already typed into the app shows on the worksheet instead of a blank.
  killOrder:  number | null
  killType:   'USDA' | 'Custom' | null
  half1:      number | null
  half2:      number | null
  total:      number | null
  carcassTag: string | null
}
interface WSGroup { producer: string; species: string; rows: WSRow[] }

// Brother QL-810W, 2.4in (62mm DK-2205) continuous roll: one tag per label.
// Each .tag fills the printable page height so the printer feeds & cuts a
// SEPARATE label per tag instead of squashing the whole run onto one.
// Shared by both pre-print flows (per-animal and blank).
const TAG_CSS = `
  @page { size: 2.4in 2.5in; margin: 0.1in 0.12in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  html, body { font-family: Arial, sans-serif; color: #000; width: 2.16in; }
  .tag { width: 2.16in; min-height: 2.3in; page-break-after: always; break-after: page; page-break-inside: avoid; break-inside: avoid; display: flex; flex-direction: column; }
  .tag:last-child { min-height: 0; page-break-after: auto; break-after: auto; }
  .co { font-size: 7pt; font-weight: 800; letter-spacing: 0.08em; text-align: center; border-bottom: 0.5pt solid #999; padding-bottom: 2pt; }
  .half { text-align: center; font-size: 11pt; font-weight: 900; letter-spacing: 0.16em; border: 1.5pt solid #000; padding: 2pt 0; margin-top: 3pt; }
  .mid { display: flex; justify-content: space-between; align-items: center; margin-top: 3pt; }
  .jul { line-height: 1.05; }
  .jl { font-size: 6.5pt; letter-spacing: 0.18em; color: #555; }
  .jv { font-size: 17pt; font-weight: 900; }
  .cal { font-size: 7pt; color: #333; }
  .num { font-size: 36pt; font-weight: 900; letter-spacing: 0.02em; line-height: 1; }
  .bcwrap { text-align: center; margin: 3pt 0; }
  .bcwrap svg { max-width: 100%; height: auto; }
  .lines { margin-top: auto; }
  .ln { display: flex; align-items: flex-end; gap: 4pt; font-size: 8pt; margin-top: 4pt; }
  .ln.two { gap: 6pt; }
  .k { color: #555; white-space: nowrap; }
  .w { flex: 1; border-bottom: 0.6pt solid #000; min-height: 12pt; }
  /* Pre-filled value (per-animal tags) — printed, not written in, so it gets a
     light rule instead of a heavy write-on line. */
  .v { flex: 1; min-width: 0; font-size: 8.5pt; font-weight: 700; text-align: right; overflow: hidden; white-space: nowrap; text-overflow: ellipsis; border-bottom: 0.4pt solid #ccc; }
  .otm { font-size: 6.5pt; font-weight: 800; border: 1pt solid #000; padding: 0 2pt; white-space: nowrap; }
`

function WorksheetTab({ date }: { date: string }) {
  const todayStr = isoDate()
  const [d, setD]           = useState(date)
  const [groups, setGroups] = useState<WSGroup[]>([])
  const [loading, setLoad]  = useState(false)
  const [scheduledHead, setScheduledHead] = useState(0)
  const [qty, setQty]       = useState('')   // tags to pre-print (blank → use scheduledHead)
  const [startNum, setStart] = useState('1')
  const [halves, setHalves]  = useState(true) // beef split into sides → one tag per half (2 per head)
  // Pre-print mode. 'animals' prints a tag per checked-in animal with the
  // producer / species / ear tag already filled in and the L+R count decided per
  // head by the split rule; 'blank' is the original numbered write-in run, still
  // needed to print before anyone is checked in.
  const [tagMode, setTagMode] = useState<'animals' | 'blank'>('animals')
  // Animals the crew has UNticked — tracked as exclusions so a newly checked-in
  // animal is selected by default rather than silently left off the run.
  const [skipped, setSkipped] = useState<Set<string>>(new Set())

  const load = useCallback(async () => {
    setLoad(true)
    const [apptsRaw, logsRaw] = await Promise.all([
      fetch(`/api/appointments?date=${d}`).then(r => r.json()).catch(() => []),
      fetch(`/api/harvest?type=log&date=${d}`).then(r => r.json()).catch(() => []),
    ])
    const appts: HarvestAppointment[] = Array.isArray(apptsRaw) ? apptsRaw : []
    const allLogs: HarvestLog[]       = Array.isArray(logsRaw)  ? logsRaw  : []

    // Expected head for the day (for the default tag count): everything booked
    // through in-progress, excluding cancelled/finished/no-show.
    const dayAppts = (Array.isArray(appts) ? appts : [])
      .filter(a => ['Booked', 'InstructionsReceived', 'AnimalIn', 'Processing'].includes(a.status))
    setScheduledHead(dayAppts.reduce((s, a) => s + (a.head_count ?? 1), 0))

    // Default the L+R toggle by species: beef splits into sides (2 tags per head),
    // but a day with only small animals (hog / lamb / goat) defaults to a single
    // tag per head. The crew can still flip the checkbox manually for the day.
    setHalves(dayAppts.length === 0 || dayAppts.some(a => a.species === 'Beef'))

    // Animals that are checked in but not yet finished — i.e. "before they're logged".
    const active = (Array.isArray(appts) ? appts : [])
      .filter(a => a.status === 'AnimalIn' || a.status === 'Processing')

    const built: { group: WSGroup; producer: string; firstIn: number }[] = []
    for (const a of active) {
      const animals: AnimalReceivingLog[] = await fetch(`/api/receiving?type=animal&appointment_id=${a.id}`).then(r => r.json()).catch(() => [])
      const live = (Array.isArray(animals) ? animals : [])
        .filter(an => an.status !== 'no_show')
        .sort((x, y) => (x.animal_index ?? 0) - (y.animal_index ?? 0))
      if (live.length === 0) continue

      // When this appointment's first animal was checked in at Receiving —
      // the ordering key for the worksheet (see sort below).
      const firstIn = Math.min(...live.map(an => {
        const t = Date.parse(an.received_at ?? an.created_at ?? '')
        return isNaN(t) ? Infinity : t
      }))

      // Pair each animal to its harvest record (if Part A/B was already saved)
      // using the same bucket-by-ear-tag positional pairing as the Part A tab,
      // so duplicate/blank tags still pair 1:1.
      const apptLogs = allLogs
        .filter(l => l.appointment_id === a.id)
        .sort((x, y) => (x.created_at ?? '').localeCompare(y.created_at ?? ''))
      const logsByTag = new Map<string, HarvestLog[]>()
      apptLogs.forEach(l => {
        const key = l.ear_tag || ''
        const bucket = logsByTag.get(key)
        if (bucket) bucket.push(l); else logsByTag.set(key, [l])
      })
      const tagCursor = new Map<string, number>()

      const producer = a.source || a.customers?.[0]?.customer_name || 'Unknown'
      built.push({
        producer,
        firstIn,
        group: {
          producer,
          species:  a.species,
          rows: live.map(an => {
            const key    = an.ear_tag || ''
            const cursor = tagCursor.get(key) ?? 0
            const log    = logsByTag.get(key)?.[cursor] ?? null
            tagCursor.set(key, cursor + 1)
            return {
              ear_tag: an.ear_tag || '', sex: an.sex || '', breed: an.breed || '', over_30_months: an.over_30_months,
              killOrder:  log?.harvest_order ?? null,
              killType:   log?.kill_type ?? null,
              half1:      log?.half_1_weight_lbs ?? null,
              half2:      log?.half_2_weight_lbs ?? null,
              total:      log?.hot_carcass_weight_lbs ?? null,
              carcassTag: log?.carcass_tag || null,
            }
          }),
        },
      })
    }

    // Worksheet order = check-in order, so carcass ID numbering is append-only:
    // a late trailer never re-shuffles numbers already written on printed tags.
    // Appointments checked in before the cutover keep the old
    // producer-alphabetical order as a block up front — the morning of
    // 2026-07-20 had tags pre-printed against that ordering.
    const CUTOVER = Date.parse('2026-07-20T13:30:00Z')
    const legacy    = built.filter(e => e.firstIn <  CUTOVER).sort((x, y) => x.producer.localeCompare(y.producer))
    const byCheckIn = built.filter(e => e.firstIn >= CUTOVER).sort((x, y) => x.firstIn - y.firstIn)
    setGroups([...legacy, ...byCheckIn].map(e => e.group))
    setLoad(false)
  }, [d])

  useEffect(() => { load() }, [load])

  // Selections are per-day: moving to another date starts from "print everything".
  useEffect(() => { setSkipped(new Set()) }, [d])

  function shiftDate(n: number) {
    setD(addDaysISO(d, n))
  }

  const totalHead = groups.reduce((s, g) => s + g.rows.length, 0)

  // Every checked-in animal flattened into worksheet (check-in) order, each
  // carrying the carcass ID it will be tagged with — the same numbering
  // printSheet and printKillSheet use, so a printed tag always matches its
  // worksheet row and kill-sheet line.
  const tagStart = parseInt(startNum, 10) || 1
  const flatAnimals = groups
    .flatMap((g, gi) => g.rows.map((r, ri) => ({
      key:      `${gi}:${ri}`,
      producer: g.producer,
      species:  g.species,
      row:      r,
      // Beef, sows and boars split into sides and need an L tag and an R tag;
      // market hogs, lambs and goats hang whole and take a single tag.
      split:    splitsIntoHalves(g.species, r.sex),
    })))
    .map((a, i) => ({ ...a, seq: tagStart + i }))

  const chosen     = flatAnimals.filter(a => !skipped.has(a.key))
  const chosenTags = chosen.reduce((s, a) => s + (a.split ? 2 : 1), 0)

  function toggleAnimal(key: string) {
    setSkipped(prev => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key); else next.add(key)
      return next
    })
  }
  const fmtDate   = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const NAV: React.CSSProperties = { background: 'rgba(166,120,90,0.12)', border: '1px solid rgba(166,120,90,0.3)', color: C.tan, borderRadius: 3, padding: '0.4rem 0.75rem', fontSize: '1rem', cursor: 'pointer', lineHeight: 1 }

  function printSheet() {
    const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
    // Carcass ID counts up across all animals in worksheet (check-in) order,
    // starting at the same "Start at #" as the pre-printed tags, so each
    // worksheet row's ID matches its physical tag number.
    let cid = parseInt(startNum, 10) || 1
    const rowsHtml = groups.map(g => {
      const head = `<tr class="grp"><td colspan="9">${esc(g.producer)} — ${esc(g.species)} · ${g.rows.length} head</td></tr>`
      const body = g.rows.map(r => {
        const cidStr = String(cid).padStart(2, '0'); cid += 1
        // Anything already saved in Part A/B prints pre-filled; untouched fields
        // stay blank for hand-writing at the rail.
        return `<tr>
        <td class="cid">${r.carcassTag ? esc(r.carcassTag) : cidStr}</td>
        <td class="ko">${r.killOrder != null ? `<span class="pre">${r.killOrder}</span>` : ''}</td>
        <td class="kt"><span class="cb">${r.killType === 'Custom' ? '☑' : '☐'} Custom</span><span class="cb">${r.killType === 'USDA' ? '☑' : '☐'} USDA</span></td>
        <td class="id">${r.ear_tag ? esc(r.ear_tag) : '—'}${r.over_30_months ? ' <span class="otm">OTM</span>' : ''}</td>
        <td>${esc(r.sex)}</td>
        <td>${esc(r.breed)}</td>
        <td class="wt">${r.half1 != null ? `<span class="pre">${r.half1}</span>` : ''}</td>
        <td class="wt">${r.half2 != null ? `<span class="pre">${r.half2}</span>` : ''}</td>
        <td class="wt">${r.total != null ? `<span class="pre">${r.total}</span>` : ''}</td>
      </tr>`
      }).join('')
      return head + body
    }).join('')

    const css = `
      @page { size: letter portrait; margin: 0.5in; }
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; color: #000; margin: 0; }
      h1 { font-size: 15pt; margin: 0 0 1pt; letter-spacing: 0.03em; }
      .sub { font-size: 8.5pt; color: #444; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 9pt; }
      .meta { font-size: 9.5pt; margin-bottom: 8pt; }
      table { width: 100%; border-collapse: collapse; font-size: 10pt; }
      th, td { border: 0.75pt solid #000; padding: 5pt 6pt; text-align: left; vertical-align: middle; }
      th { background: #eee; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.05em; }
      td.cid { width: 0.6in; height: 32pt; text-align: center; font-weight: 800; font-size: 12pt; }
      td.ko { width: 0.6in; height: 32pt; }
      td.wt { width: 0.8in; height: 32pt; }
      td.kt { width: 0.9in; padding: 4pt 5pt; }
      td.kt .cb { display: block; font-size: 8pt; white-space: nowrap; line-height: 1.6; }
      td.id { font-weight: 600; }
      .pre { font-weight: 700; font-size: 11pt; }
      tr.grp td { background: #ddd; font-weight: 700; font-size: 10pt; letter-spacing: 0.03em; }
      .otm { color: #bb0000; font-weight: 700; font-size: 7.5pt; border: 1pt solid #bb0000; padding: 0 2pt; margin-left: 2pt; }
      .sig { margin-top: 24pt; font-size: 9pt; }
      .sig span { display: inline-block; border-top: 0.75pt solid #000; padding-top: 2pt; width: 2.4in; margin-right: 0.6in; }
      .empty { text-align: center; padding: 20pt; color: #666; }
    `
    const body = rowsHtml || '<tr><td colspan="9" class="empty">No animals checked in for this date.</td></tr>'
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
      <h1>Cowboy Meat Co. — Harvest Worksheet</h1>
      <div class="sub">Forsyth, Montana</div>
      <div class="meta"><strong>${fmtDate}</strong> &nbsp;·&nbsp; Julian <strong>${julianCode(d)}</strong> &nbsp;·&nbsp; ${totalHead} head &nbsp;·&nbsp; ${groups.length} producer${groups.length === 1 ? '' : 's'}</div>
      <table>
        <thead><tr>
          <th>Carcass ID</th><th>Kill Order</th><th>Kill Type</th><th>Ear Tag / ID</th><th>Sex</th><th>Breed</th>
          <th>L Half (lbs)</th><th>R Half (lbs)</th><th>Total (lbs)</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="sig"><span>Inspector</span><span>Performed By</span></div>
      <script>window.onload=function(){window.print()}<\/script>
    </body></html>`
    const w = window.open('', '_blank', 'width=900,height=760')
    if (w) { w.document.write(html); w.document.close() }
  }

  // Preliminary kill sheet — a flat, ordered run-list to carry to the floor
  // BEFORE the kill. Animals are enumerated in the same order as the worksheet
  // (check-in order), each assigned its Julian-date tag #
  // (<julian>-<seq>) so the sheet's order matches the physical tags. Brand owner
  // shows on every line. Blank weight columns are filled in at the rail.
  function printKillSheet() {
    const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
    const jul   = julianCode(d)
    const start = parseInt(startNum, 10) || 1
    let seq = start
    const flat = groups.flatMap(g => g.rows.map(r => {
      const tag = `${jul}-${String(seq).padStart(2, '0')}`
      seq += 1
      return { tag, seq: seq - 1, producer: g.producer, species: g.species, ...r }
    }))

    const bodyRows = flat.map(r => `<tr>
      <td class="tag">${r.tag}</td>
      <td class="owner">${esc(r.producer)}</td>
      <td class="kt"><span class="cb">${r.killType === 'Custom' ? '☑' : '☐'} Custom</span><span class="cb">${r.killType === 'USDA' ? '☑' : '☐'} USDA</span></td>
      <td>${esc(r.species)}</td>
      <td class="id">${r.ear_tag ? esc(r.ear_tag) : '—'}${r.over_30_months ? ' <span class="otm">OTM</span>' : ''}</td>
      <td>${esc(r.sex)}</td>
      <td>${esc(r.breed)}</td>
      <td class="wt">${r.half1 != null ? `<span class="pre">${r.half1}</span>` : ''}</td>
      <td class="wt">${r.half2 != null ? `<span class="pre">${r.half2}</span>` : ''}</td>
      <td class="wt">${r.total != null ? `<span class="pre">${r.total}</span>` : ''}</td>
    </tr>`).join('')

    const css = `
      @page { size: letter portrait; margin: 0.5in; }
      * { box-sizing: border-box; }
      body { font-family: Arial, sans-serif; color: #000; margin: 0; }
      h1 { font-size: 15pt; margin: 0 0 1pt; letter-spacing: 0.03em; }
      .sub { font-size: 8.5pt; color: #444; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 9pt; }
      .meta { font-size: 9.5pt; margin-bottom: 8pt; }
      table { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
      th, td { border: 0.75pt solid #000; padding: 4pt 6pt; text-align: left; vertical-align: middle; }
      th { background: #eee; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.05em; }
      td.tag { font-weight: 800; font-size: 11pt; white-space: nowrap; }
      td.owner { font-weight: 600; }
      td.id { font-weight: 600; }
      td.wt { width: 0.85in; height: 26pt; }
      td.kt { width: 0.9in; padding: 3pt 5pt; }
      td.kt .cb { display: block; font-size: 8pt; white-space: nowrap; line-height: 1.6; }
      .pre { font-weight: 700; font-size: 10.5pt; }
      .otm { color: #bb0000; font-weight: 700; font-size: 7.5pt; border: 1pt solid #bb0000; padding: 0 2pt; margin-left: 2pt; }
      .sig { margin-top: 24pt; font-size: 9pt; }
      .sig span { display: inline-block; border-top: 0.75pt solid #000; padding-top: 2pt; width: 2.4in; margin-right: 0.6in; }
      .empty { text-align: center; padding: 20pt; color: #666; }
    `
    const body = bodyRows || '<tr><td colspan="10" class="empty">No animals checked in for this date.</td></tr>'
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>
      <h1>Cowboy Meat Co. — Preliminary Kill Sheet</h1>
      <div class="sub">Forsyth, Montana</div>
      <div class="meta"><strong>${fmtDate}</strong> &nbsp;·&nbsp; ${totalHead} head &nbsp;·&nbsp; ${groups.length} producer${groups.length === 1 ? '' : 's'} &nbsp;·&nbsp; Julian ${jul}</div>
      <table>
        <thead><tr>
          <th>Tag #</th><th>Brand Owner</th><th>Kill Type</th><th>Species</th><th>Ear Tag / ID</th><th>Sex</th><th>Breed</th>
          <th>L Half (lbs)</th><th>R Half (lbs)</th><th>Total (lbs)</th>
        </tr></thead>
        <tbody>${body}</tbody>
      </table>
      <div class="sig"><span>Inspector</span><span>Performed By</span></div>
      <script>window.onload=function(){window.print()}<\/script>
    </body></html>`
    const w = window.open('', '_blank', 'width=900,height=760')
    if (w) { w.document.write(html); w.document.close() }
  }

  // Print a tag for each SELECTED checked-in animal. Same physical format as the
  // blank run below, but producer / species / ear tag print instead of being
  // hand-written, and each head's tag count comes from the split rule rather than
  // one day-wide checkbox — so a Sow gets L+R while the market hog behind it gets
  // one, in the same run. Only the weights are left to write in at the rail.
  function printAnimalTags() {
    if (chosen.length === 0) { alert('Pick at least one animal to print tags for.'); return }
    const esc = (s: string) => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))
    const jul     = julianCode(d)
    const calDate = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    const barcodeCalls: string[] = []
    const tags = chosen.map(a => {
      const seq   = String(a.seq).padStart(2, '0')
      const sides: (('L' | 'R') | null)[] = a.split ? ['L', 'R'] : [null]
      const ident = [a.row.ear_tag && `ET ${a.row.ear_tag}`, a.row.sex].filter(Boolean).join(' · ')
      return sides.map(side => {
        const bcId = `bc${a.seq}${side ?? ''}`
        const id   = `${jul}-${seq}${side ? `-${side}` : ''}`
        barcodeCalls.push(`JsBarcode("#${bcId}","${id}",{format:"CODE128",width:1.4,height:30,displayValue:true,fontSize:10,margin:0,textMargin:1});`)
        const halfBand = side ? `<div class="half">${side === 'L' ? '◀  L HALF' : 'R HALF  ▶'}</div>` : ''
        // A side tag takes that half's weight; a whole-hanging animal (market hog,
        // lamb, goat) has ONE carcass weight, not halves — matching Part B, which
        // shows a single WHOLE_WEIGHT_LABEL field for these.
        const wtLines  = side
          ? `<div class="ln"><span class="k">Half Wt</span><span class="w"></span></div>`
          : `<div class="ln"><span class="k">Carcass Wt</span><span class="w"></span></div>`
        return `<div class="tag">
          <div class="co">COWBOY MEAT CO. · FORSYTH, MT</div>
          ${halfBand}
          <div class="mid">
            <div class="jul"><div class="jl">JULIAN</div><div class="jv">${jul}</div><div class="cal">${calDate}</div></div>
            <div class="num">${seq}</div>
          </div>
          <div class="bcwrap"><svg id="${bcId}"></svg></div>
          <div class="lines">
            <div class="ln"><span class="k">Producer</span><span class="v">${esc(a.producer)}</span></div>
            <div class="ln"><span class="k">${esc(a.species)}</span><span class="v">${esc(ident) || '—'}</span>${a.row.over_30_months ? '<span class="otm">OTM</span>' : ''}</div>
            ${wtLines}
          </div>
        </div>`
      }).join('')
    }).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
      <style>${TAG_CSS}</style></head><body>
      ${tags}
      <script>window.onload=function(){${barcodeCalls.join('')}window.print()}<\/script>
    </body></html>`
    const w = window.open('', '_blank', 'width=900,height=820')
    if (w) { w.document.write(html); w.document.close() }
  }

  // Pre-print a sheet of blank tags: Julian date + sequential #, a scannable
  // barcode of "<julian>-<seq>", and blank lines to hand-write producer/weights.
  function printTags() {
    const count = parseInt(qty, 10) || scheduledHead || 0
    const start = parseInt(startNum, 10) || 1
    if (count < 1) { alert('Enter how many tags to print (or schedule/check in animals for this day first).'); return }
    const jul     = julianCode(d)
    const calDate = new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })

    // In halves mode every head gets two tags (L + R side), sharing its number.
    // bcId keeps the SVG element id unique per tag; the barcode value carries the
    // -L / -R suffix so each half scans distinctly.
    const sides: (('L' | 'R') | null)[] = halves ? ['L', 'R'] : [null]
    function makeTag(i: number, side: 'L' | 'R' | null): string {
      const seq      = String(start + i).padStart(2, '0')
      const bcId     = `bc${start + i}${side ?? ''}`
      const halfBand = side ? `<div class="half">${side === 'L' ? '◀  L HALF' : 'R HALF  ▶'}</div>` : ''
      const wtLines  = side
        ? `<div class="ln"><span class="k">Half Wt</span><span class="w"></span></div>`
        : `<div class="ln two"><span class="k">L Half</span><span class="w"></span><span class="k">R Half</span><span class="w"></span></div>
           <div class="ln"><span class="k">Total</span><span class="w"></span></div>`
      return `<div class="tag">
        <div class="co">COWBOY MEAT CO. · FORSYTH, MT</div>
        ${halfBand}
        <div class="mid">
          <div class="jul"><div class="jl">JULIAN</div><div class="jv">${jul}</div><div class="cal">${calDate}</div></div>
          <div class="num">${seq}</div>
        </div>
        <div class="bcwrap"><svg id="${bcId}"></svg></div>
        <div class="lines">
          <div class="ln"><span class="k">Producer</span><span class="w"></span></div>
          <div class="ln"><span class="k">Ear Tag / Sex</span><span class="w"></span></div>
          ${wtLines}
        </div>
      </div>`
    }
    const tags = Array.from({ length: count }, (_, i) => sides.map(s => makeTag(i, s)).join('')).join('')

    const barcodeCalls = Array.from({ length: count }, (_, i) => sides.map(side => {
      const seq  = String(start + i).padStart(2, '0')
      const bcId = `bc${start + i}${side ?? ''}`
      const id   = `${jul}-${seq}${side ? `-${side}` : ''}`
      return `JsBarcode("#${bcId}","${id}",{format:"CODE128",width:1.4,height:30,displayValue:true,fontSize:10,margin:0,textMargin:1});`
    }).join('')).join('')

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
      <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
      <style>${TAG_CSS}</style></head><body>
      ${tags}
      <script>window.onload=function(){${barcodeCalls}window.print()}<\/script>
    </body></html>`
    const w = window.open('', '_blank', 'width=900,height=820')
    if (w) { w.document.write(html); w.document.close() }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      {/* Date nav + print */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
          <button onClick={() => shiftDate(-1)} style={NAV}>‹</button>
          <input type="date" value={d} onChange={e => setD(e.target.value)} style={{ ...INPUT, width: 'auto', padding: '0.4rem 0.75rem' }} />
          <button onClick={() => shiftDate(1)} style={NAV}>›</button>
          <span style={{ color: C.tan, fontSize: '0.9rem', fontWeight: 600, marginLeft: '0.2rem' }}>{fmtDate}</span>
          <span style={{ color: C.lightBrown, fontSize: '0.78rem', fontWeight: 600 }}>· Julian <strong style={{ color: C.tan }}>{julianCode(d)}</strong></span>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {d !== todayStr && <button onClick={() => setD(todayStr)} style={{ ...BTN('rgba(166,120,90,0.12)', C.tan), border: '1px solid rgba(166,120,90,0.3)' }}>Today</button>}
          <button onClick={printKillSheet} disabled={totalHead === 0} style={{ ...BTN('rgba(166,120,90,0.12)', C.tan), border: '1px solid rgba(166,120,90,0.3)', opacity: totalHead === 0 ? 0.5 : 1, cursor: totalHead === 0 ? 'not-allowed' : 'pointer' }} title="Flat run-list ordered by tag #, brand owner per row — carry to the floor before the kill">🖨 Kill Sheet</button>
          <button onClick={printSheet} disabled={totalHead === 0} style={{ ...BTN(C.tan, C.dark), opacity: totalHead === 0 ? 0.5 : 1, cursor: totalHead === 0 ? 'not-allowed' : 'pointer' }}>🖨 Print Worksheet</button>
        </div>
      </div>

      {/* Pre-print tags (interim process before the floor printer is set up) */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, padding: '0.85rem 1rem', display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ color: C.cream, fontWeight: 700, fontSize: '0.9rem' }}>🏷 Print tags</div>
          {/* Mode picker — per-animal needs animals checked in, blank never does. */}
          <div style={{ display: 'flex', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, overflow: 'hidden' }}>
            {([['animals', 'Checked-in animals'], ['blank', 'Blank']] as const).map(([m, label]) => (
              <button
                key={m}
                onClick={() => setTagMode(m)}
                style={{ background: tagMode === m ? C.tan : 'transparent', color: tagMode === m ? C.dark : C.lightBrown, border: 'none', padding: '0.35rem 0.7rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer' }}
              >{label}</button>
            ))}
          </div>
          <span style={{ color: C.lightBrown, fontSize: '0.78rem' }}>Julian <strong style={{ color: C.tan }}>{julianCode(d)}</strong></span>
        </div>

        {tagMode === 'animals' ? (
          <>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
              <div style={{ color: C.lightBrown, fontSize: '0.76rem', minWidth: 0, flex: 1 }}>
                Producer, species &amp; ear tag print on the tag — only weights get written in. Beef, sows &amp; boars get an L and an R tag; market hogs, lambs &amp; goats get one.
                {flatAnimals.length > 0 && <> <strong style={{ color: C.tan }}>{chosen.length} of {flatAnimals.length} animal{flatAnimals.length === 1 ? '' : 's'} → {chosenTags} label{chosenTags === 1 ? '' : 's'}.</strong></>}
              </div>
              {flatAnimals.length > 0 && (
                <button onClick={() => setSkipped(prev => prev.size > 0 ? new Set() : new Set(flatAnimals.map(a => a.key)))} style={{ ...BTN('rgba(166,120,90,0.12)', C.tan), border: '1px solid rgba(166,120,90,0.3)', fontSize: '0.78rem' }}>
                  {skipped.size > 0 ? 'Select all' : 'Clear all'}
                </button>
              )}
              <div>
                <label style={LABEL}>Start at #</label>
                <input type="number" min="1" value={startNum} onChange={e => setStart(e.target.value)} style={{ ...INPUT, width: '5.5rem' }} />
              </div>
              <button onClick={printAnimalTags} disabled={chosen.length === 0} style={{ ...BTN(C.tan, C.dark), opacity: chosen.length === 0 ? 0.5 : 1, cursor: chosen.length === 0 ? 'not-allowed' : 'pointer' }}>🖨 Print Tags</button>
            </div>

            {flatAnimals.length === 0 ? (
              <div style={{ color: C.lightBrown, fontSize: '0.78rem', fontStyle: 'italic' }}>
                Nobody checked in for this date yet — use <strong style={{ color: C.tan }}>Blank</strong> to pre-print a numbered run.
              </div>
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                {flatAnimals.map(a => {
                  const on = !skipped.has(a.key)
                  return (
                    <button
                      key={a.key}
                      onClick={() => toggleAnimal(a.key)}
                      title={`${a.producer} · ${a.species}${a.row.sex ? ` · ${a.row.sex}` : ''} — ${a.split ? '2 tags (L + R)' : '1 tag (hangs whole)'}`}
                      style={{
                        display: 'flex', alignItems: 'center', gap: '0.45rem', textAlign: 'left', cursor: 'pointer',
                        background: on ? 'rgba(166,120,90,0.16)' : 'transparent',
                        border: `1px solid ${on ? 'rgba(166,120,90,0.5)' : 'rgba(166,120,90,0.2)'}`,
                        borderRadius: 3, padding: '0.35rem 0.6rem', opacity: on ? 1 : 0.5,
                      }}
                    >
                      <span style={{ color: on ? C.tan : C.lightBrown, fontWeight: 800, fontSize: '0.85rem', fontVariantNumeric: 'tabular-nums' }}>{String(a.seq).padStart(2, '0')}</span>
                      <span style={{ color: on ? C.cream : C.lightBrown, fontSize: '0.78rem' }}>
                        {a.producer} · {a.species}{a.row.ear_tag ? ` · ${a.row.ear_tag}` : ''}
                      </span>
                      <span style={{ color: C.lightBrown, fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{a.split ? '2 ×' : '1 ×'}</span>
                      {a.row.over_30_months && <span style={{ color: '#e08a8a', fontSize: '0.65rem', fontWeight: 800 }}>OTM</span>}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.6rem', flexWrap: 'wrap' }}>
            <div style={{ color: C.lightBrown, fontSize: '0.76rem', minWidth: 0, flex: 1 }}>
              Julian <strong style={{ color: C.tan }}>{julianCode(d)}</strong> + sequential #, with a scannable barcode. Hand-write producer &amp; weights.
              {(() => { const heads = (parseInt(qty, 10) || scheduledHead || 0); const labels = heads * (halves ? 2 : 1); return heads > 0 ? <> <strong style={{ color: C.tan }}>{heads} head → {labels} label{labels === 1 ? '' : 's'}{halves ? ' (L + R)' : ''}.</strong></> : null })()}
            </div>
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', cursor: 'pointer', color: halves ? C.cream : C.lightBrown, fontSize: '0.82rem', fontWeight: 600, paddingBottom: '0.5rem' }} title="Beef carcasses split into two sides — print an L tag and an R tag for each head">
              <input type="checkbox" checked={halves} onChange={e => setHalves(e.target.checked)} style={{ width: 16, height: 16, accentColor: C.tan, cursor: 'pointer' }} />
              2 per head (L + R)
            </label>
            <div>
              <label style={LABEL}>How many head</label>
              <input type="number" min="1" value={qty} onChange={e => setQty(e.target.value)} placeholder={String(scheduledHead || '')} style={{ ...INPUT, width: '6.5rem' }} />
            </div>
            <div>
              <label style={LABEL}>Start at #</label>
              <input type="number" min="1" value={startNum} onChange={e => setStart(e.target.value)} style={{ ...INPUT, width: '5.5rem' }} />
            </div>
            <button onClick={printTags} style={BTN(C.tan, C.dark)}>🖨 Print Tags</button>
          </div>
        )}
      </div>

      <div style={{ color: C.lightBrown, fontSize: '0.8rem' }}>
        Every animal checked in for this date, across all producers. The blank Kill Order / L&nbsp;Half / R&nbsp;Half / Total columns are for writing weights at the rail before logging in Part&nbsp;A/B.
      </div>

      {loading && <div style={{ color: C.lightBrown, textAlign: 'center', padding: '2rem' }}>Loading…</div>}

      {!loading && totalHead === 0 && (
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '2rem', textAlign: 'center', color: C.lightBrown }}>
          No animals checked in for this date. Check animals in via Receiving first.
        </div>
      )}

      {!loading && totalHead > 0 && (
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.84rem' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid rgba(166,120,90,0.3)' }}>
                {['Carcass ID', 'Kill Order', 'Kill Type', 'Ear Tag / ID', 'Sex', 'Breed', 'L Half', 'R Half', 'Total'].map(h => (
                  <th key={h} style={{ padding: '0.6rem 0.75rem', color: C.lightBrown, fontWeight: 600, textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em', whiteSpace: 'nowrap' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {(() => { let off = parseInt(startNum, 10) || 1; return groups.map((g, gi) => { const startId = off; off += g.rows.length; return <FragmentGroup key={gi} group={g} startId={startId} /> }) })()}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// One producer block: a header row + its animal rows (blank weight cells to write on)
function FragmentGroup({ group, startId }: { group: WSGroup; startId: number }) {
  const blank = <span style={{ color: 'rgba(166,120,90,0.35)' }}>—</span>
  return (
    <>
      <tr style={{ background: 'rgba(166,120,90,0.14)' }}>
        <td colSpan={9} style={{ padding: '0.45rem 0.75rem', color: C.cream, fontWeight: 700, fontSize: '0.82rem', letterSpacing: '0.02em' }}>
          {group.producer} <span style={{ color: C.tan, fontWeight: 400 }}>· {group.species} · {group.rows.length} head</span>
        </td>
      </tr>
      {group.rows.map((r, i) => (
        <tr key={i} style={{ borderBottom: '1px solid rgba(166,120,90,0.1)' }}>
          <td style={{ padding: '0.5rem 0.75rem', color: C.tan, fontWeight: 800, fontFamily: 'monospace' }}>{r.carcassTag || String(startId + i).padStart(2, '0')}</td>
          <td style={{ padding: '0.5rem 0.75rem', color: C.cream, fontWeight: 600 }}>{r.killOrder ?? blank}</td>
          {r.killType
            ? <td style={{ padding: '0.5rem 0.75rem' }}><KillTypeBadge killType={r.killType} /></td>
            : <td style={{ padding: '0.5rem 0.75rem', color: 'rgba(166,120,90,0.45)', fontSize: '0.72rem', whiteSpace: 'nowrap' }}>☐ Custom &nbsp;☐ USDA</td>}
          <td style={{ padding: '0.5rem 0.75rem', color: C.cream, fontWeight: 600 }}>
            {r.ear_tag || 'No Ear Tag'}
            {r.over_30_months && <span style={{ color: C.red, fontSize: '0.65rem', fontWeight: 700, border: `1px solid ${C.red}`, borderRadius: 2, padding: '0 3px', marginLeft: 4 }}>OTM</span>}
          </td>
          <td style={{ padding: '0.5rem 0.75rem', color: C.cream }}>{r.sex || blank}</td>
          <td style={{ padding: '0.5rem 0.75rem', color: C.lightBrown }}>{r.breed || blank}</td>
          <td style={{ padding: '0.5rem 0.75rem', color: C.cream }}>{r.half1 ?? blank}</td>
          <td style={{ padding: '0.5rem 0.75rem', color: C.cream }}>{r.half2 ?? blank}</td>
          <td style={{ padding: '0.5rem 0.75rem', color: C.cream, fontWeight: 600 }}>{r.total ?? blank}</td>
        </tr>
      ))}
    </>
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
  const [form, setForm] = useState({ checked_at: isoDateTime(), carcass_temp_f: '', cooler_temp_f: '', checked_by: '', notes: '' })

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
      // checked_at is a datetime-local wall-time string; the column is
      // timestamptz, so convert to a real instant or Postgres reads it as UTC
      // and every chill check displays 6-7 hours early.
      body: JSON.stringify({ type: 'chill', harvest_log_id: selected.id, carcass_tag: selected.carcass_tag, checked_at: new Date(form.checked_at).toISOString(), carcass_temp_f: form.carcass_temp_f ? parseFloat(form.carcass_temp_f) : null, cooler_temp_f: form.cooler_temp_f ? parseFloat(form.cooler_temp_f) : null, checked_by: form.checked_by, notes: form.notes }),
    })
    const hrs = parseFloat(hoursAgo(selected.created_at))
    const temp = parseFloat(form.carcass_temp_f)
    if (!isNaN(temp) && temp <= 40 && hrs >= 24) {
      await fetch('/api/harvest', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'log', id: selected.id, status: 'complete' }) })
    }
    setSaving(false)
    setSelected(null)
    setForm({ checked_at: isoDateTime(), carcass_temp_f: '', cooler_temp_f: '', checked_by: '', notes: '' })
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
  const todayStr = isoDate()
  const [tab, setTab]             = useState<Tab>('parta')
  const [harvestDate, setDate]    = useState(todayStr)
  const [appointments, setAppts]  = useState<HarvestAppointment[]>([])
  const [selectedAppt, setSelAppt] = useState<HarvestAppointment | null>(null)
  const [loadingAppts, setLoadingAppts] = useState(false)
  // appointment_id → # of animals with Part A saved, for the ✓ markers on the
  // appointment chips. Refreshed on tab switch so it stays current after saves.
  const [partADone, setPartADone] = useState<Record<string, number>>({})

  const loadAppts = useCallback(async () => {
    setLoadingAppts(true)
    const [res, logRes] = await Promise.all([
      fetch(`/api/appointments?date=${harvestDate}`),
      fetch(`/api/harvest?type=log&date=${harvestDate}`),
    ])
    const data: HarvestAppointment[] = await res.json().catch(() => [])
    const logs: HarvestLog[]         = await logRes.json().catch(() => [])
    const done: Record<string, number> = {}
    ;(Array.isArray(logs) ? logs : []).forEach(l => {
      if (l.part_a_complete && l.appointment_id) done[l.appointment_id] = (done[l.appointment_id] ?? 0) + 1
    })
    setPartADone(done)
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
  }, [harvestDate, tab]) // eslint-disable-line react-hooks/exhaustive-deps -- tab included to refresh the ✓ markers after Part A saves

  useEffect(() => { loadAppts() }, [loadAppts])

  // Register harvest state for the feedback widget, so a bug report from this
  // page arrives knowing the date / tab / appointment the user was on.
  useEffect(() => {
    setFeedbackContext({
      harvest_date:    harvestDate,
      tab,
      appointment:     selectedAppt ? `${selectedAppt.source || '—'} · ${selectedAppt.species} · ${selectedAppt.head_count} head` : null,
      appointment_id:  selectedAppt?.id ?? null,
    })
    return () => clearFeedbackContext(['harvest_date', 'tab', 'appointment', 'appointment_id'])
  }, [harvestDate, tab, selectedAppt])

  function shiftDate(d: number) {
    setDate(addDaysISO(harvestDate, d))
  }

  // Part B covers the whole day (all appointments), so only Part A scopes to an
  // appointment; both share the header date picker.
  const showApptBar    = tab === 'parta'
  const showDatePicker = tab === 'parta' || tab === 'partb'

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
        {showDatePicker && (
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
            ['worksheet',  '📝 Worksheet'],
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
              {appointments.map(a => {
                const done = partADone[a.id] ?? 0
                return (
                  <button key={a.id} onClick={() => setSelAppt(a)} style={{
                    padding: '0.3rem 0.85rem', borderRadius: 3, fontSize: '0.83rem', fontWeight: 600, cursor: 'pointer',
                    background: selectedAppt?.id === a.id ? C.medBrown : 'rgba(166,120,90,0.1)',
                    border: selectedAppt?.id === a.id ? `1px solid ${C.lightBrown}` : '1px solid rgba(166,120,90,0.3)',
                    color: selectedAppt?.id === a.id ? C.cream : C.tan,
                  }}>
                    {a.species} — {a.head_count} head
                    {a.source && <span style={{ fontWeight: 400, opacity: 0.8 }}> · {a.source}</span>}
                    {done >= a.head_count && done > 0
                      ? <span style={{ color: C.green, fontWeight: 700 }}> ✓</span>
                      : done > 0
                        ? <span style={{ color: C.yellow, fontWeight: 700 }}> {done}/{a.head_count}</span>
                        : null}
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}

      {/* ── Main content ── */}
      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1320px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', overflow: 'auto' }}>
        {tab === 'parta'      && <PartATab      date={harvestDate} appt={selectedAppt} />}
        {tab === 'partb'      && <PartBTab      date={harvestDate} />}
        {tab === 'worksheet'  && <WorksheetTab  date={harvestDate} />}
        {tab === 'harvestlog' && <HarvestLogTab />}
        {tab === 'chill'      && <ChillTab />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
