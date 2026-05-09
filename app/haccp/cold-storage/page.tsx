'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { ColdStorageLog } from '@/lib/types'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#EF4444',
  amber:      '#F59E0B',
}
const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.45rem 0.6rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box', textAlign: 'center',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.25rem', textAlign: 'center',
}
const BTN = (bg: string, fg = C.dark): React.CSSProperties => ({
  background: bg, color: fg, border: 'none', borderRadius: 3,
  padding: '0.55rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
})

// Units in display order — coolers ≤45°F, freezers no upper limit shown
const UNITS = [
  { key: 'showcase_freezer_f',   label: 'Showcase\nFreezer',      isFreezer: true  },
  { key: 'showcase_cooler_f',    label: 'Showcase\nCooler',       isFreezer: false },
  { key: 'retail_freezer_f',     label: 'Retail\nFreezer',        isFreezer: true  },
  { key: 'custom_freezer_f',     label: 'Custom\nFreezer',        isFreezer: true  },
  { key: 'new_carcass_cooler_f', label: 'New Carcass\nCooler',    isFreezer: false },
  { key: 'old_carcass_cooler_f', label: 'Old Carcass\nCooler',    isFreezer: false },
] as const

type UnitKey = typeof UNITS[number]['key']

// Flag if a cooler reading is out of spec (>45°F)
function isOutOfSpec(key: UnitKey, val: number | null): boolean {
  if (val === null) return false
  const unit = UNITS.find(u => u.key === key)
  if (!unit) return false
  return !unit.isFreezer && val > 45
}

// ── HACCP Report Generator ────────────────────────────────────────────────────
function printColdStorageReport(logs: ColdStorageLog[], start: string, end: string) {
  const fmtDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
  const fmtT = (v: number | null) => v != null ? `${v}°F` : ''
  const flag  = (key: UnitKey, v: number | null) =>
    isOutOfSpec(key, v) ? ` style="background:#fff0f0;color:#c00;font-weight:bold"` : ''

  const sorted = [...logs].sort((a, b) => a.recorded_date.localeCompare(b.recorded_date))

  const rows = sorted.map(log => `
    <tr>
      <td>${fmtDate(log.recorded_date)}</td>
      <td${flag('showcase_freezer_f',   log.showcase_freezer_f)}>${fmtT(log.showcase_freezer_f)}</td>
      <td${flag('showcase_cooler_f',    log.showcase_cooler_f)}>${fmtT(log.showcase_cooler_f)}</td>
      <td${flag('retail_freezer_f',     log.retail_freezer_f)}>${fmtT(log.retail_freezer_f)}</td>
      <td${flag('custom_freezer_f',     log.custom_freezer_f)}>${fmtT(log.custom_freezer_f)}</td>
      <td${flag('new_carcass_cooler_f', log.new_carcass_cooler_f)}>${fmtT(log.new_carcass_cooler_f)}</td>
      <td${flag('old_carcass_cooler_f', log.old_carcass_cooler_f)}>${fmtT(log.old_carcass_cooler_f)}</td>
      <td style="text-align:center">${log.initials}</td>
    </tr>`).join('')

  // Pad to fill page — minimum 20 rows visible
  const blankRows = Math.max(0, 20 - sorted.length)
  const blanks = Array(blankRows).fill(0).map(() =>
    `<tr>${Array(8).fill('<td>&nbsp;</td>').join('')}</tr>`).join('')

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
  <title>Cold Storage Temp Log ${fmtDate(start)} – ${fmtDate(end)}</title>
  <style>
    @page { size: letter landscape; margin: 0.6in 0.55in; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #000; }
    table.hdr { width: 100%; border-collapse: collapse; margin-bottom: 10pt; }
    table.hdr td { border: 1px solid #000; padding: 3px 7px; text-align: center; }
    table.hdr .co { font-weight: bold; font-size: 11pt; }
    .title-row { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 4pt; }
    h2 { font-size: 13pt; font-weight: bold; }
    .meta { font-size: 8.5pt; color: #444; }
    table.data { width: 100%; border-collapse: collapse; font-size: 9pt; }
    table.data th { border: 1px solid #000; padding: 4px 6px; text-align: center; background: #f0f0f0; font-size: 8.5pt; line-height: 1.3; }
    table.data td { border: 1px solid #000; padding: 4px 6px; height: 22pt; text-align: center; vertical-align: middle; }
    .limit { font-size: 7.5pt; color: #555; font-weight: normal; }
  </style>
  </head><body>
  <table class="hdr">
    <tr><td colspan="4" class="co">Cowboy Meat Co.</td></tr>
    <tr>
      <td><strong>Document Name</strong></td>
      <td><strong>APPROVED BY</strong></td>
      <td><strong>Current Version</strong></td>
      <td><strong>PAGE</strong></td>
    </tr>
    <tr>
      <td><em>Cold Storage Temperature Log</em></td>
      <td><em>HACCP Team</em></td>
      <td><em>02.15.24</em></td>
      <td><em>1 of 1</em></td>
    </tr>
  </table>

  <div class="title-row">
    <h2>Cold Storage Temperature Log
      <span class="limit">&nbsp; Time / Temperature (&deg;F.) &nbsp;&middot;&nbsp; Frequency: Daily &nbsp;&middot;&nbsp; Limit: 45&deg;F or less (coolers)</span>
    </h2>
    <span class="meta">Period: ${fmtDate(start)} &ndash; ${fmtDate(end)}</span>
  </div>

  <table class="data">
    <thead>
      <tr>
        <th style="width:11%">Date</th>
        <th style="width:12%">Showcase<br>Freezer</th>
        <th style="width:12%">Showcase<br>Cooler<br><span class="limit">(&le;45&deg;F)</span></th>
        <th style="width:12%">Retail<br>Freezer</th>
        <th style="width:12%">Custom<br>Freezer</th>
        <th style="width:14%">New Carcass<br>Cooler<br><span class="limit">(&le;45&deg;F)</span></th>
        <th style="width:14%">Old Carcass<br>Cooler<br><span class="limit">(&le;45&deg;F)</span></th>
        <th style="width:13%">Initials</th>
      </tr>
    </thead>
    <tbody>
      ${rows}${blanks}
    </tbody>
  </table>
  <script>window.onload=function(){window.print()}<\/script>
  </body></html>`

  const w = window.open('', '_blank', 'width=1000,height=700')
  if (w) { w.document.write(html); w.document.close() }
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ColdStoragePage() {
  const today = new Date().toISOString().slice(0, 10)
  const nowTime = new Date().toTimeString().slice(0, 5)  // HH:MM

  const emptyForm = () => ({
    recorded_date:        today,
    recorded_time:        nowTime,
    showcase_freezer_f:   '',
    showcase_cooler_f:    '',
    retail_freezer_f:     '',
    custom_freezer_f:     '',
    new_carcass_cooler_f: '',
    old_carcass_cooler_f: '',
    initials:             '',
    notes:                '',
  })

  const [form,        setForm]        = useState(emptyForm)
  const [logs,        setLogs]        = useState<ColdStorageLog[]>([])
  const [saving,      setSaving]      = useState(false)
  const [success,     setSuccess]     = useState(false)
  const [reportModal, setReportModal] = useState(false)
  const [rStart,      setRStart]      = useState(() => {
    // Default to current week Mon
    const d = new Date(); const day = d.getDay()
    const diff = day === 0 ? -6 : 1 - day
    const m = new Date(d); m.setDate(d.getDate() + diff)
    return m.toISOString().slice(0, 10)
  })
  const [rEnd, setREnd] = useState(today)

  const load = useCallback(async () => {
    // Load last 60 days
    const start = new Date(); start.setDate(start.getDate() - 60)
    const s = start.toISOString().slice(0, 10)
    const res = await fetch(`/api/cold-storage?start=${s}`)
    setLogs(await res.json().catch(() => []))
  }, [])

  useEffect(() => { load() }, [load])

  const f = (k: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  async function handleSave() {
    setSaving(true)
    const body: Record<string, unknown> = {
      recorded_date: form.recorded_date,
      recorded_time: form.recorded_time || null,
      initials:      form.initials,
      notes:         form.notes,
    }
    for (const u of UNITS) {
      body[u.key] = form[u.key] !== '' ? parseFloat(form[u.key] as string) : null
    }
    await fetch('/api/cold-storage', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    setSaving(false); setSuccess(true)
    setForm(emptyForm()); load()
    setTimeout(() => setSuccess(false), 3500)
  }

  async function handleDelete(id: string) {
    if (!confirm('Delete this reading?')) return
    await fetch(`/api/cold-storage?id=${id}`, { method: 'DELETE' })
    load()
  }

  const fmtDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })

  const tempColor = (key: UnitKey, val: number | null) => {
    if (val === null) return C.lightBrown
    return isOutOfSpec(key, val) ? C.red : C.green
  }

  // Report range logs
  const reportLogs = logs.filter(l => l.recorded_date >= rStart && l.recorded_date <= rEnd)

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/haccp" style={{ color: C.lightBrown, fontSize: '0.82rem', textDecoration: 'none' }}>← HACCP</Link>
          <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Cold Storage Temp Log
          </span>
          <span style={{ fontSize: '0.72rem', color: C.lightBrown }}>Form 6c · Daily</span>
        </div>
        <button
          onClick={() => setReportModal(true)}
          style={{ ...BTN('rgba(245,158,11,0.15)', C.amber), border: '1px solid rgba(245,158,11,0.35)', fontSize: '0.8rem', padding: '0.4rem 0.9rem' }}
        >
          📋 HACCP Report
        </button>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1100px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Entry form */}
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.25rem 1.5rem', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '1rem' }}>
            Log Temperatures
          </div>

          {success && (
            <div style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 3, padding: '0.6rem 1rem', marginBottom: '1rem', color: C.green, fontSize: '0.85rem' }}>
              ✓ Reading saved
            </div>
          )}

          {/* Date + time + initials row */}
          <div style={{ display: 'grid', gridTemplateColumns: '160px 130px 1fr 160px', gap: '0 1rem', marginBottom: '1rem' }}>
            <div>
              <label style={LABEL}>Date</label>
              <input type="date" style={{ ...INPUT, textAlign: 'left' }} value={form.recorded_date} onChange={f('recorded_date')} />
            </div>
            <div>
              <label style={LABEL}>Time</label>
              <input type="time" style={INPUT} value={form.recorded_time} onChange={f('recorded_time')} />
            </div>
            <div />
            <div>
              <label style={LABEL}>Initials</label>
              <input type="text" placeholder="e.g. JH" style={INPUT} value={form.initials} onChange={f('initials')} />
            </div>
          </div>

          {/* 6 temp inputs */}
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '0 0.75rem', marginBottom: '1rem' }}>
            {UNITS.map(u => (
              <div key={u.key}>
                <label style={LABEL}>{u.label.replace('\n', ' ')}</label>
                <div style={{ position: 'relative' }}>
                  <input
                    type="number" step="0.1" placeholder="—"
                    style={{
                      ...INPUT,
                      borderColor: form[u.key] !== '' && isOutOfSpec(u.key, parseFloat(form[u.key] as string))
                        ? 'rgba(239,68,68,0.6)'
                        : 'rgba(166,120,90,0.35)',
                    }}
                    value={form[u.key] as string}
                    onChange={f(u.key)}
                  />
                  {!u.isFreezer && (
                    <span style={{ position: 'absolute', right: '0.4rem', top: '50%', transform: 'translateY(-50%)', fontSize: '0.65rem', color: 'rgba(166,120,90,0.4)', pointerEvents: 'none' }}>
                      ≤45
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Notes + Save */}
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end' }}>
            <div style={{ flex: 1 }}>
              <label style={{ ...LABEL, textAlign: 'left' }}>Notes (optional)</label>
              <input type="text" placeholder="Any issues or corrective actions…" style={{ ...INPUT, textAlign: 'left' }}
                value={form.notes} onChange={f('notes')} />
            </div>
            <button
              style={{ ...BTN(C.tan), flexShrink: 0, paddingLeft: '1.75rem', paddingRight: '1.75rem' }}
              onClick={handleSave}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </div>

        {/* Log */}
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
          {/* Log header */}
          <div style={{ padding: '0.65rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', display: 'flex', gap: '1rem', alignItems: 'center' }}>
            <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
              Recent Readings ({logs.length})
            </span>
            <span style={{ fontSize: '0.72rem', color: 'rgba(166,120,90,0.45)' }}>Last 60 days</span>
          </div>

          {/* Column headers */}
          <div style={{
            display: 'grid',
            gridTemplateColumns: '100px 100px repeat(6, 1fr) 70px 24px',
            gap: '0 0.5rem', padding: '0.4rem 1.25rem',
            borderBottom: '1px solid rgba(166,120,90,0.15)',
          }}>
            {['Date', 'Time', 'Showc. Frzr', 'Showc. Clr', 'Retail Frzr', 'Custom Frzr', 'New Carc. Clr', 'Old Carc. Clr', 'By', ''].map((h, i) => (
              <span key={i} style={{ fontSize: '0.65rem', color: 'rgba(166,120,90,0.5)', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: i >= 2 && i <= 7 ? 'center' : 'left' }}>
                {h}
              </span>
            ))}
          </div>

          {logs.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>
              No readings yet — save the first one above.
            </p>
          )}

          {logs.map(log => {
            const hasOut = UNITS.some(u => isOutOfSpec(u.key, log[u.key] as number | null))
            return (
              <div key={log.id} style={{
                display: 'grid',
                gridTemplateColumns: '100px 100px repeat(6, 1fr) 70px 24px',
                gap: '0 0.5rem', padding: '0.6rem 1.25rem',
                borderBottom: '1px solid rgba(166,120,90,0.08)',
                background: hasOut ? 'rgba(239,68,68,0.04)' : undefined,
                alignItems: 'center',
              }}>
                <span style={{ fontSize: '0.82rem', color: C.tan }}>{fmtDate(log.recorded_date)}</span>
                <span style={{ fontSize: '0.8rem', color: C.lightBrown }}>
                  {log.recorded_time ? log.recorded_time.slice(0, 5) : '—'}
                </span>
                {UNITS.map(u => {
                  const val = log[u.key] as number | null
                  return (
                    <span key={u.key} style={{ fontSize: '0.85rem', fontWeight: 600, color: tempColor(u.key, val), textAlign: 'center' }}>
                      {val != null ? `${val}°` : <span style={{ color: 'rgba(166,120,90,0.25)' }}>—</span>}
                    </span>
                  )
                })}
                <span style={{ fontSize: '0.78rem', color: C.lightBrown }}>{log.initials}</span>
                <button
                  onClick={() => handleDelete(log.id)}
                  style={{ background: 'none', border: 'none', color: 'rgba(166,120,90,0.3)', cursor: 'pointer', fontSize: '0.8rem', padding: 0 }}
                  title="Delete"
                >×</button>
              </div>
            )
          })}
        </div>
      </main>

      {/* Report Modal */}
      {reportModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setReportModal(false)}>
          <div style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 6, padding: '1.75rem 2rem', width: 360 }}
            onClick={e => e.stopPropagation()}>
            <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.07em', margin: '0 0 0.25rem' }}>
              HACCP Report — Form 6c
            </h3>
            <p style={{ color: C.lightBrown, fontSize: '0.78rem', margin: '0 0 1.25rem' }}>
              Generates a print-ready Cold Storage Temperature Log for the selected date range.
            </p>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem', marginBottom: '0.85rem' }}>
              <div>
                <label style={{ ...LABEL, textAlign: 'left' }}>From</label>
                <input type="date" style={{ ...INPUT, textAlign: 'left' }} value={rStart} onChange={e => setRStart(e.target.value)} />
              </div>
              <div>
                <label style={{ ...LABEL, textAlign: 'left' }}>To</label>
                <input type="date" style={{ ...INPUT, textAlign: 'left' }} value={rEnd} onChange={e => setREnd(e.target.value)} />
              </div>
            </div>
            <p style={{ color: C.tan, fontSize: '0.8rem', marginBottom: '1.25rem' }}>
              {reportLogs.length} reading{reportLogs.length !== 1 ? 's' : ''} in range
              {reportLogs.some(l => UNITS.some(u => isOutOfSpec(u.key, l[u.key] as number | null))) && (
                <span style={{ color: C.red, marginLeft: '0.5rem' }}>⚠ out-of-spec readings present</span>
              )}
            </p>
            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button style={{ ...BTN(C.amber), flex: 1 }}
                onClick={() => { printColdStorageReport(reportLogs, rStart, rEnd); setReportModal(false) }}>
                Print / Save PDF
              </button>
              <button style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }}
                onClick={() => setReportModal(false)}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--light-brown)' }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660 · info@cowboymeats.com
      </footer>
    </div>
  )
}
