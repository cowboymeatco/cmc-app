'use client'
import { useState, useCallback, useEffect } from 'react'
import Link from 'next/link'
import { HarvestAppointment, AnimalReceivingLog, HarvestLog, ChillLog, BoxReceivingLog } from '@/lib/types'
import { isoDate, addDaysISO, mondayOfISO } from '@/lib/dates'
import { printReceivingLog } from '@/lib/haccpReceivingLog'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  amber:      '#F59E0B',
}

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box',
}
const BTN = (bg: string, fg = C.dark): React.CSSProperties => ({
  background: bg, color: fg, border: 'none', borderRadius: 3,
  padding: '0.55rem 1.2rem', fontSize: '0.85rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})

interface HACCPData {
  appointments: HarvestAppointment[]
  animalLogs:   AnimalReceivingLog[]
  harvestLogs:  HarvestLog[]
  chillLogs:    ChillLog[]
}

// ── Shared header block HTML ──────────────────────────────────────────────────
function docHeader(docName: string, pageNum: number, totalPages: number) {
  return `
    <table class="hdr">
      <tr><td colspan="4" class="co">Cowboy Meat Co.</td></tr>
      <tr>
        <td><strong>Document Name</strong></td>
        <td><strong>APPROVED BY</strong></td>
        <td><strong>Current Version</strong></td>
        <td><strong>PAGE</strong></td>
      </tr>
      <tr>
        <td><em>${docName}</em></td>
        <td><em>HACCP Team</em></td>
        <td><em>02.15.24</em></td>
        <td><em>${pageNum} of ${totalPages}</em></td>
      </tr>
    </table>`
}

const HDR_CSS = `
  @page { size: letter; margin: 0.65in 0.6in; }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: Arial, sans-serif; font-size: 9.5pt; color: #000; }
  table.hdr { width: 100%; border-collapse: collapse; margin-bottom: 10pt; }
  table.hdr td { border: 1px solid #000; padding: 3px 7px; text-align: center; }
  table.hdr .co { font-weight: bold; font-size: 11pt; }
  h2 { font-size: 13pt; font-weight: bold; margin-bottom: 6pt; }
  .subtitle { font-size: 9pt; font-weight: normal; }
  table.data { width: 100%; border-collapse: collapse; font-size: 8pt; }
  table.data th { border: 1px solid #000; padding: 3px 4px; text-align: center; font-size: 7.5pt; background: #f0f0f0; line-height: 1.3; vertical-align: middle; }
  table.data td { border: 1px solid #000; padding: 3px 5px; height: 28pt; vertical-align: middle; }
  .page { page-break-inside: avoid; }
  .pb { page-break-before: always; }`

function openPrint(html: string) {
  const w = window.open('', '_blank', 'width=860,height=1100')
  if (w) { w.document.write(html); w.document.close() }
}

// ── Form 2 — Antemortem Pen Card ──────────────────────────────────────────────
function printAntemortem(data: HACCPData, date: string) {
  const fmtDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const fmtTime = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
  }
  const sexAbbr = (sex: string) => {
    const m: Record<string, string> = { Steer: 'Str.', Heifer: 'Hfr.', Cow: 'Cow', Bull: 'Bull',
      Barrow: 'Brrw.', Gilt: 'Gilt', Sow: 'Sow', Boar: 'Boar',
      Wether: 'Weth.', Ewe: 'Ewe', Ram: 'Ram', Doe: 'Doe', Buck: 'Buck' }
    return m[sex] ?? sex
  }

  // Group animal logs by appointment
  const byAppt: Record<string, AnimalReceivingLog[]> = {}
  for (const a of data.animalLogs) {
    if (!byAppt[a.appointment_id]) byAppt[a.appointment_id] = []
    byAppt[a.appointment_id].push(a)
  }

  // Build rows (one per appointment)
  const rows = data.appointments.map(appt => {
    const animals = byAppt[appt.id] ?? []
    const active  = animals.filter(a => !a.notes?.includes('no-show'))
    const headCount = active.length > 0 ? active.length : appt.head_count

    // Sex breakdown summary
    const sexCounts: Record<string, number> = {}
    for (const a of active) {
      const s = sexAbbr(a.sex || 'Unknown')
      sexCounts[s] = (sexCounts[s] ?? 0) + 1
    }
    const desc = Object.entries(sexCounts).map(([s, n]) => `${n} ${s}`).join(', ')
      || appt.species

    // Earliest received_at = antemortem time
    const times = active.map(a => a.received_at).filter(Boolean).sort()
    const amTime = times[0] ? fmtTime(times[0]) : ''

    return { headCount, desc, owner: appt.source ?? '', amTime }
  })

  // Pad to at least 10 rows per page
  const ROWS_PER_PAGE = 10
  const pages: (typeof rows[0] | null)[][] = []
  for (let i = 0; i < Math.max(rows.length, 1); i += ROWS_PER_PAGE) {
    const chunk: (typeof rows[0] | null)[] = rows.slice(i, i + ROWS_PER_PAGE)
    while (chunk.length < ROWS_PER_PAGE) chunk.push(null)
    pages.push(chunk)
  }

  const pageHTML = (chunk: (typeof rows[0] | null)[], pNum: number, pTotal: number) => `
    <div class="${pNum > 1 ? 'pb' : ''}">
      ${docHeader('Antemortem Pen Card', pNum, pTotal)}
      <h2>Live Animal Receiving Log
        <span style="font-size:10pt;font-weight:normal;margin-left:2in">
          <strong>Harvest Date:</strong> ${fmtDate(date)}
        </span>
        <span style="font-size:10pt;font-weight:normal;float:right">
          Page ${pNum} of ${pTotal}
        </span>
      </h2>
      <table class="data" style="margin-top:8pt">
        <thead>
          <tr>
            <th style="width:7%">Number<br>of Head</th>
            <th style="width:6%">Pen #</th>
            <th style="width:18%">Description<br>(Cows, bulls, strs, hfrs)</th>
            <th style="width:28%">Owner</th>
            <th style="width:22%">Address<br>(City / State)</th>
            <th style="width:10%">Antemortem<br>Time</th>
            <th style="width:9%">Inspector</th>
          </tr>
        </thead>
        <tbody>
          ${chunk.map(r => `
            <tr>
              <td style="text-align:center">${r ? r.headCount : ''}</td>
              <td></td>
              <td>${r ? r.desc : ''}</td>
              <td>${r ? r.owner : ''}</td>
              <td></td>
              <td style="text-align:center">${r ? r.amTime : ''}</td>
              <td></td>
            </tr>`).join('')}
        </tbody>
      </table>
    </div>`

  openPrint(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Antemortem Pen Card — ${fmtDate(date)}</title>
    <style>${HDR_CSS}</style></head><body>
    ${pages.map((ch, i) => pageHTML(ch, i + 1, pages.length)).join('')}
    <script>window.onload=function(){window.print()}<\/script>
    </body></html>`)
}

// ── Form 5 — Carcass Kill Log ─────────────────────────────────────────────────
function printKillLog(data: HACCPData, date: string) {
  const fmtDate = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: 'numeric' })

  const sexAbbr = (sex: string) => {
    const m: Record<string, string> = { Steer: 'Str.', Heifer: 'Hfr.', Cow: 'Cow', Bull: 'Bull',
      Barrow: 'Brrw.', Gilt: 'Gilt', Sow: 'Sow', Boar: 'Boar',
      Wether: 'Weth.', Ewe: 'Ewe', Ram: 'Ram', Doe: 'Doe', Buck: 'Buck' }
    return m[sex] ?? sex
  }

  const CHK = '&#10003;'  // ✓
  const ROWS_PER_PAGE = 20
  const logs = data.harvestLogs

  const pages: (HarvestLog | null)[][] = []
  for (let i = 0; i < Math.max(logs.length, 1); i += ROWS_PER_PAGE) {
    const chunk: (HarvestLog | null)[] = logs.slice(i, i + ROWS_PER_PAGE)
    while (chunk.length < ROWS_PER_PAGE) chunk.push(null)
    pages.push(chunk)
  }

  const pageHTML = (chunk: (HarvestLog | null)[], pNum: number, pTotal: number, offset: number) => `
    <div class="${pNum > 1 ? 'pb' : ''}">
      ${docHeader('Carcass Kill Log', pNum, pTotal)}
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:8pt">
        <h2>Carcass Kill Log</h2>
      </div>
      <div style="display:flex;justify-content:space-between;margin-bottom:6pt;font-size:9pt">
        <span><strong>DATE / LOT #:</strong> ${fmtDate(date)}</span>
        <span>Page ${pNum} of ${pTotal}</span>
      </div>
      <table class="data">
        <thead>
          <tr>
            <th rowspan="2" style="width:5%">Carcass #</th>
            <th rowspan="2" style="width:8%">Animal<br>(cow, bull,<br>str, hfr.)</th>
            <th rowspan="2" style="width:9%">Ear Tag #</th>
            <th colspan="3" style="width:18%">Carcass Wt.</th>
            <th rowspan="2" style="width:17%">Owner</th>
            <th rowspan="2" style="width:6%">Not<br>For<br>Sale</th>
            <th colspan="3" style="width:37%">Beef Only — Check One Column</th>
          </tr>
          <tr>
            <th style="width:6%">Side 1</th>
            <th style="width:6%">Side 2</th>
            <th style="width:6%">Total</th>
            <th style="width:10%">Birth Records<br>Provided<br>(-30 mo.)</th>
            <th colspan="2" style="width:27%">Dentition</th>
          </tr>
          <tr>
            <th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th><th></th>
            <th style="width:13%">30 mo. or more</th>
            <th style="width:14%">Less than 30 mo.</th>
          </tr>
        </thead>
        <tbody>
          ${chunk.map((h, i) => {
            const num = h ? offset + i + 1 : ''
            const isBeef = h?.species === 'Beef' || (!h?.species && true)
            const over30 = h?.over_30_months
            return `
              <tr>
                <td style="text-align:center;font-weight:bold">${num}</td>
                <td style="text-align:center">${h ? sexAbbr(h.sex) : ''}</td>
                <td style="text-align:center">${h ? (h.ear_tag ?? '') : ''}</td>
                <td></td>
                <td></td>
                <td style="text-align:center">${h && h.hot_carcass_weight_lbs != null ? h.hot_carcass_weight_lbs : ''}</td>
                <td>${h ? (h.producer ?? '') : ''}</td>
                <td></td>
                <td style="text-align:center">${h && isBeef && !over30 ? CHK : ''}</td>
                <td style="text-align:center">${h && isBeef && over30  ? CHK : ''}</td>
                <td style="text-align:center">${h && isBeef && !over30 ? CHK : ''}</td>
              </tr>`
          }).join('')}
        </tbody>
      </table>
    </div>`

  openPrint(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Carcass Kill Log — ${fmtDate(date)}</title>
    <style>${HDR_CSS}
      table.data td { height: 24pt; }
    </style></head><body>
    ${pages.map((ch, i) => pageHTML(ch, i + 1, pages.length, i * ROWS_PER_PAGE)).join('')}
    <script>window.onload=function(){window.print()}<\/script>
    </body></html>`)
}

// ── Form 6b — Carcass Chilling Monitoring Form ────────────────────────────────
function printChillingForm(data: HACCPData, date: string) {
  const fmtDate = (iso: string) => {
    const d = new Date(iso)
    return d.toLocaleDateString('en-US', { month: 'numeric', day: 'numeric', year: '2-digit' })
  }
  const fmtTime = (iso: string) =>
    new Date(iso).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })

  const chills = data.chillLogs
  const ROWS_PER_PAGE = 11   // each entry = 3 sub-rows; ~11 entries per page

  const pages: (ChillLog | null)[][] = []
  for (let i = 0; i < Math.max(chills.length, 1); i += ROWS_PER_PAGE) {
    const chunk: (ChillLog | null)[] = chills.slice(i, i + ROWS_PER_PAGE)
    while (chunk.length < ROWS_PER_PAGE) chunk.push(null)
    pages.push(chunk)
  }

  // Each chill entry renders as 3 sub-rows (Zone 1 data-filled, Zone 2/3 blank)
  const entryRows = (c: ChillLog | null) => {
    const zones = ['Zone 1', 'Zone 2', 'Zone 3']
    return zones.map((zone, zi) => `
      <tr>
        ${zi === 0 ? `<td rowspan="3">${c ? fmtDate(c.checked_at) : ''}</td>` : ''}
        ${zi === 0 ? `<td rowspan="3">${c ? fmtTime(c.checked_at) : ''}</td>` : ''}
        ${zi === 0 ? `<td rowspan="3" style="text-align:center">${c && c.cooler_temp_f != null ? c.cooler_temp_f + '°F' : ''}</td>` : ''}
        ${zi === 0 ? `<td rowspan="3" style="text-align:center">${c ? (c.carcass_tag ?? '') : ''}</td>` : ''}
        ${zi === 0 ? `<td rowspan="3" style="text-align:center">${c && c.carcass_temp_f != null ? c.carcass_temp_f + '°F' : ''}</td>` : ''}
        <td style="text-align:center;font-size:7.5pt;color:#555">${zone}</td>
        ${zi === 0 ? `<td rowspan="3" style="text-align:center">${c ? (c.checked_by ?? '') : ''}</td>` : ''}
      </tr>`).join('')
  }

  const pageHTML = (chunk: (ChillLog | null)[], pNum: number, pTotal: number) => `
    <div class="${pNum > 1 ? 'pb' : ''}">
      ${docHeader('Carcass Chilling Monitoring Form', pNum, pTotal)}
      <h2 style="text-align:center">Carcass Chilling Monitoring Form</h2>
      <table style="width:100%;border-collapse:collapse;margin:6pt 0 4pt;font-size:8pt">
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:3px 8px;text-align:center;font-weight:bold">
            Carcass Surface Temperature &le; 40&deg;F &nbsp;&nbsp;
            Zone 1 = North &nbsp; Zone 2 = Center &nbsp; Zone 3 = South
          </td>
        </tr>
        <tr>
          <td colspan="3" style="border:1px solid #000;padding:3px 8px;text-align:center">
            <strong>Frequency:</strong> 1–3 carcasses in the Drip Cooler within 24 hours of Harvest
            &nbsp;&nbsp; <strong>Harvest Date:</strong> ${new Date(date + 'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})}
          </td>
        </tr>
      </table>
      <table class="data">
        <thead>
          <tr>
            <th style="width:9%">Date</th>
            <th style="width:8%">Time</th>
            <th style="width:11%">Chill Cooler<br>Temperature</th>
            <th style="width:10%">Carcass #</th>
            <th style="width:11%">Surface<br>Temperature</th>
            <th style="width:14%">Location in<br>Cooler</th>
            <th style="width:11%">Monitor&apos;s<br>Initials</th>
          </tr>
        </thead>
        <tbody>
          ${chunk.map(c => entryRows(c)).join('')}
        </tbody>
      </table>
      ${pNum === pTotal ? '<div style="border:1px solid #000;margin-top:10pt;padding:7pt 9pt;font-size:8pt"><strong>Corrective Actions if necessary are documented on a Corrective Action Report</strong><br>Temperatures are in Degrees Fahrenheit</div>' : ''}
    </div>`

  openPrint(`<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>Carcass Chilling Form — ${date}</title>
    <style>${HDR_CSS}
      table.data td { height: 18pt; }
    </style></head><body>
    ${pages.map((ch, i) => pageHTML(ch, i + 1, pages.length)).join('')}
    <script>window.onload=function(){window.print()}<\/script>
    </body></html>`)
}

// ── HACCP Hub Page ────────────────────────────────────────────────────────────
export default function HACCPPage() {
  const today = isoDate()
  const [date,    setDate]    = useState(today)
  const [data,    setData]    = useState<HACCPData | null>(null)
  const [loading, setLoading] = useState(false)
  const [loaded,  setLoaded]  = useState(false)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    const res = await fetch(`/api/haccp?date=${d}`)
    const json = await res.json().catch(() => null)
    setData(json)
    setLoaded(true)
    setLoading(false)
  }, [])

  const fmtDateLong = (d: string) =>
    new Date(d + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, fontSize: '0.82rem', textDecoration: 'none' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
          <div>
            <span style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
              HACCP Compliance
            </span>
            <span style={{ fontSize: '0.72rem', color: C.lightBrown, marginLeft: '0.75rem' }}>
              Forms &amp; Reports
            </span>
          </div>
        </div>
      </header>

      <main style={{ flex: 1, padding: '2rem', maxWidth: '1100px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Plan & Programs — the written documents behind everything below */}
        <Link href="/haccp/documents" style={{ textDecoration: 'none' }}>
          <div style={{
            background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
            borderLeft: `4px solid ${C.green}`, borderRadius: 4,
            padding: '1rem 1.25rem', marginBottom: '1.5rem',
            display: 'flex', alignItems: 'center', gap: '1rem', cursor: 'pointer',
          }}>
            <span style={{ fontSize: '1.3rem' }}>📚</span>
            <div style={{ flex: 1 }}>
              <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                HACCP Plan &amp; Programs
              </div>
              <div style={{ fontSize: '0.77rem', color: C.lightBrown, marginTop: '0.2rem' }}>
                Upload and keep the written plan, hazard analysis, prerequisite programs, SSOPs and blank forms — the library an inspector portal reads from
              </div>
            </div>
            <span style={{ color: C.green, fontSize: '0.8rem', fontWeight: 600 }}>Open →</span>
          </div>
        </Link>

        {/* Date selector */}
        <div style={{
          background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4,
          padding: '1.25rem 1.5rem', marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
        }}>
          <div>
            <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>
              Kill Day Date
            </div>
            <input
              type="date"
              value={date}
              onChange={e => { setDate(e.target.value); setLoaded(false) }}
              style={{ ...INPUT, width: 180 }}
            />
          </div>
          <button
            onClick={() => load(date)}
            disabled={loading}
            style={{ ...BTN(C.tan), marginTop: '1.1rem' }}
          >
            {loading ? 'Loading…' : 'Load Data'}
          </button>
          {loaded && data && (
            <div style={{ marginTop: '1.1rem', fontSize: '0.82rem', color: C.lightBrown }}>
              {fmtDateLong(date)} &nbsp;·&nbsp;
              <span style={{ color: data.appointments.length > 0 ? C.tan : 'rgba(166,120,90,0.4)' }}>
                {data.appointments.length} appt{data.appointments.length !== 1 ? 's' : ''}
              </span>
              &nbsp;·&nbsp;
              <span style={{ color: data.harvestLogs.length > 0 ? C.tan : 'rgba(166,120,90,0.4)' }}>
                {data.harvestLogs.length} carcass{data.harvestLogs.length !== 1 ? 'es' : ''}
              </span>
              &nbsp;·&nbsp;
              <span style={{ color: data.chillLogs.length > 0 ? C.tan : 'rgba(166,120,90,0.4)' }}>
                {data.chillLogs.length} chill reading{data.chillLogs.length !== 1 ? 's' : ''}
              </span>
            </div>
          )}
        </div>

        {/* ── Kill Day Reports ─────────────────────────────────────────────── */}
        <div style={{ marginBottom: '0.5rem' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '0.85rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>
            Kill Day Reports
          </h2>
          <p style={{ fontSize: '0.75rem', color: 'rgba(166,120,90,0.6)', margin: '0.2rem 0 0.85rem' }}>
            Auto-populated from your harvest and receiving data
          </p>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>

          {/* Form 2 */}
          <FormCard
            number="2"
            title="Antemortem Pen Card"
            subtitle="Live Animal Receiving Log"
            desc="Owner, head count, description, and antemortem time for each pen received on kill day."
            frequency="Each kill day"
            count={loaded && data ? data.appointments.length : null}
            countLabel="appointments"
            color="#60A5FA"
            disabled={!loaded || !data}
            onGenerate={() => data && printAntemortem(data, date)}
          />

          {/* Form 5 */}
          <FormCard
            number="5"
            title="Carcass Kill Log"
            subtitle="Carcass weights · Age classification"
            desc="Ear tag, sex, hot carcass weight, owner, and over/under 30-month classification per carcass."
            frequency="Each kill day"
            count={loaded && data ? data.harvestLogs.length : null}
            countLabel="carcasses"
            color="#A78BFA"
            disabled={!loaded || !data}
            onGenerate={() => data && printKillLog(data, date)}
          />

          {/* Form 6b */}
          <FormCard
            number="6b"
            title="Carcass Chilling"
            subtitle="Surface temp · Cooler temp · Zone"
            desc="Post-harvest chill readings — cooler temp, carcass surface temp by zone. Typically logged the day after kill."
            frequency="Day after harvest"
            count={loaded && data ? data.chillLogs.length : null}
            countLabel="readings"
            color="#4CAF50"
            disabled={!loaded || !data}
            onGenerate={() => data && printChillingForm(data, date)}
          />
        </div>

        {/* ── Coming Soon ──────────────────────────────────────────────────── */}
        <div style={{ marginBottom: '0.5rem' }}>
          <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '0.85rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', margin: 0 }}>
            Daily Forms <span style={{ fontFamily: 'Arial, sans-serif', fontWeight: 'normal', fontSize: '0.72rem', color: 'rgba(166,120,90,0.5)', letterSpacing: '0.04em', textTransform: 'none', marginLeft: '0.5rem' }}>· Coming soon</span>
          </h2>
          <p style={{ fontSize: '0.75rem', color: 'rgba(166,120,90,0.5)', margin: '0.2rem 0 0.85rem' }}>
            Digital fill-in forms that store to the database and generate HACCP-format PDFs
          </p>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '1rem', marginBottom: '2rem' }}>
          {/* Form 1 — Live. Filled in on /receiving (Box Product tab); printed here for the binder. */}
          <ReceivingLogCard />

          {/* Form 6c — Live */}
          <Link href="/haccp/cold-storage" style={{ textDecoration: 'none' }}>
            <div style={{
              background: C.dark, border: '1px solid rgba(166,120,90,0.2)',
              borderLeft: `4px solid ${C.amber}`, borderRadius: 4,
              padding: '1.1rem 1.25rem', cursor: 'pointer', height: '100%', boxSizing: 'border-box',
            }}>
              <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>
                Form 6c &nbsp;·&nbsp; Daily
              </div>
              <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                Cold Storage Temp Log
              </div>
              <div style={{ fontSize: '0.77rem', color: C.tan, marginBottom: '0.35rem' }}>
                Showcase · Retail · Custom · Carcass coolers
              </div>
              <div style={{ fontSize: '0.75rem', color: C.lightBrown, lineHeight: 1.4 }}>
                Daily temps for all 6 storage units. Out-of-spec readings flagged in red. Generates HACCP-format PDF for any date range.
              </div>
              <div style={{ marginTop: '0.85rem', fontSize: '0.78rem', color: C.amber, fontWeight: 600 }}>Open →</div>
            </div>
          </Link>

          {/* HTSS Wet Bulb Calculator — Live */}
          <Link href="/haccp/htss" style={{ textDecoration: 'none' }}>
            <div style={{
              background: C.dark, border: '1px solid rgba(166,120,90,0.2)',
              borderLeft: `4px solid #F87171`, borderRadius: 4,
              padding: '1.1rem 1.25rem', cursor: 'pointer', height: '100%', boxSizing: 'border-box',
            }}>
              <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>
                Form 14a &nbsp;·&nbsp; Weekly DO
              </div>
              <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                HTSS Wet Bulb Calc
              </div>
              <div style={{ fontSize: '0.77rem', color: C.tan, marginBottom: '0.35rem' }}>
                CCP 2B · Alt-3 · Beef Jerky
              </div>
              <div style={{ fontSize: '0.75rem', color: C.lightBrown, lineHeight: 1.4 }}>
                Calculate wet bulb from dry bulb + RH. Check WB ≥ 125°F and RH ≥ 30% critical limits. Upload smokehouse CSV for full phase-by-phase compliance analysis.
              </div>
              <div style={{ marginTop: '0.85rem', fontSize: '0.78rem', color: '#F87171', fontWeight: 600 }}>Open →</div>
            </div>
          </Link>

          {/* Form 3 — Coming soon */}
          {[
            { num: '3',  title: 'Humane Handling',        desc: '17-item kill day checklist',   freq: 'Each kill day' },
            { num: '6a', title: 'SSOP Monitoring',        desc: 'Pre-Op / Op sanitation check', freq: 'Daily' },
          ].map(f => (
            <div key={f.num} style={{
              background: C.dark, border: '1px solid rgba(166,120,90,0.15)',
              borderLeft: '4px solid rgba(166,120,90,0.2)', borderRadius: 4,
              padding: '1.1rem 1.25rem', opacity: 0.5,
            }}>
              <div style={{ fontSize: '0.65rem', color: 'rgba(166,120,90,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>
                Form {f.num} &nbsp;·&nbsp; {f.freq}
              </div>
              <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
                {f.title}
              </div>
              <div style={{ fontSize: '0.77rem', color: C.lightBrown }}>{f.desc}</div>
              <div style={{ marginTop: '0.85rem', fontSize: '0.75rem', color: 'rgba(166,120,90,0.4)', fontStyle: 'italic' }}>Coming soon</div>
            </div>
          ))}
        </div>

      </main>

      <footer style={{
        background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)',
        padding: '0.5rem 2rem', textAlign: 'center',
        fontSize: '0.72rem', color: 'var(--light-brown)',
      }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660 · jill@cowboymeats.com
      </footer>
    </div>
  )
}

// ── Form card component ───────────────────────────────────────────────────────
function FormCard({ number, title, subtitle, desc, frequency, count, countLabel, color, disabled, onGenerate }: {
  number:     string
  title:      string
  subtitle:   string
  desc:       string
  frequency:  string
  count:      number | null
  countLabel: string
  color:      string
  disabled:   boolean
  onGenerate: () => void
}) {
  const hasData = count !== null && count > 0
  return (
    <div style={{
      background: C.dark,
      border: '1px solid rgba(166,120,90,0.2)',
      borderLeft: `4px solid ${color}`,
      borderRadius: 4,
      padding: '1.1rem 1.25rem',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>
        Form {number} &nbsp;·&nbsp; {frequency}
      </div>
      <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '0.95rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.2rem' }}>
        {title}
      </div>
      <div style={{ fontSize: '0.77rem', color: C.tan, marginBottom: '0.35rem' }}>{subtitle}</div>
      <div style={{ fontSize: '0.75rem', color: C.lightBrown, flex: 1, lineHeight: 1.45 }}>{desc}</div>

      {/* Record count */}
      {count !== null && (
        <div style={{
          margin: '0.85rem 0',
          padding: '0.4rem 0.75rem',
          background: hasData ? `${color}18` : 'rgba(255,255,255,0.03)',
          border: `1px solid ${hasData ? color + '44' : 'rgba(166,120,90,0.15)'}`,
          borderRadius: 3,
          fontSize: '0.8rem',
          color: hasData ? color : 'rgba(166,120,90,0.4)',
          display: 'inline-block',
        }}>
          {hasData ? `${count} ${countLabel}` : `No ${countLabel} for this date`}
        </div>
      )}
      {count === null && <div style={{ height: '2rem' }} />}

      <button
        onClick={onGenerate}
        disabled={disabled || !hasData}
        style={{
          ...BTN(hasData && !disabled ? C.tan : 'rgba(166,120,90,0.15)', hasData && !disabled ? C.dark : 'rgba(166,120,90,0.35)'),
          width: '100%',
          opacity: disabled ? 0.5 : 1,
          marginTop: count !== null ? 0 : '0.85rem',
        }}
      >
        {disabled ? 'Load data first' : hasData ? '🖨 Generate PDF' : 'No data'}
      </button>
    </div>
  )
}

// ── Form 1 — Receiving Program Log ────────────────────────────────────────────
// The log itself is written on /receiving as boxes come in the door (vendor,
// lot/invoice, temp, initials). This card only picks a date range and prints
// the HACCP-format sheet, so the binder can be built from here alongside the
// kill-day forms instead of walking back to the receiving screen.
function ReceivingLogCard() {
  const [logs,  setLogs]  = useState<BoxReceivingLog[] | null>(null)
  const [range, setRange] = useState(() => {
    const mon = mondayOfISO(isoDate())
    return { start: mon, end: addDaysISO(mon, 6) }
  })

  useEffect(() => {
    fetch('/api/receiving?type=box')
      .then(r => r.json())
      .then(d => setLogs(Array.isArray(d) ? d : []))
      .catch(() => setLogs([]))
  }, [])

  const inRange = (logs ?? [])
    .filter(l => l.received_at >= range.start && l.received_at <= range.end)
    .sort((a, b) => a.received_at.localeCompare(b.received_at))
  const n = inRange.length
  const color = '#FBBF24'

  return (
    <div style={{
      background: C.dark, border: '1px solid rgba(166,120,90,0.2)',
      borderLeft: `4px solid ${color}`, borderRadius: 4,
      padding: '1.1rem 1.25rem', height: '100%', boxSizing: 'border-box',
      display: 'flex', flexDirection: 'column',
    }}>
      <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.25rem' }}>
        Form 1 &nbsp;·&nbsp; Each occurrence
      </div>
      <div style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '0.9rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: '0.35rem' }}>
        Receiving Log
      </div>
      <div style={{ fontSize: '0.77rem', color: C.tan, marginBottom: '0.35rem' }}>
        Meat · Ingredients · Chemicals · Packaging
      </div>
      <div style={{ fontSize: '0.75rem', color: C.lightBrown, lineHeight: 1.4, flex: 1 }}>
        Logged on the Receiving page as product comes in. Prints the HACCP sheet for any date range.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', margin: '0.75rem 0 0.5rem' }}>
        <input type="date" value={range.start} style={{ ...INPUT, padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
          onChange={e => setRange(p => ({ ...p, start: e.target.value }))} />
        <input type="date" value={range.end} style={{ ...INPUT, padding: '0.35rem 0.5rem', fontSize: '0.8rem' }}
          onChange={e => setRange(p => ({ ...p, end: e.target.value }))} />
      </div>
      <div style={{ fontSize: '0.78rem', color: logs === null ? 'rgba(166,120,90,0.5)' : n > 0 ? color : 'rgba(166,120,90,0.4)', marginBottom: '0.6rem' }}>
        {logs === null ? 'Loading…' : n > 0 ? `${n} entr${n !== 1 ? 'ies' : 'y'} · ${Math.ceil(n / 10)} page${Math.ceil(n / 10) !== 1 ? 's' : ''}` : 'No entries in this range'}
      </div>
      <button
        onClick={() => printReceivingLog(inRange, range.start, range.end)}
        disabled={n === 0}
        style={{ ...BTN(n > 0 ? C.tan : 'rgba(166,120,90,0.15)', n > 0 ? C.dark : 'rgba(166,120,90,0.35)'), width: '100%' }}
      >
        {n > 0 ? '🖨 Generate PDF' : 'No data'}
      </button>
    </div>
  )
}
