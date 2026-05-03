'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import type { ProcessingInput } from '@/lib/types'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
}

// ── PLU → species detection ───────────────────────────────────────────────────
function detectSpecies(plu: string): string {
  const n = parseInt(plu)
  if (isNaN(n)) return ''
  if (n >= 413000)             return 'Wholesale'
  if (n >= 9000 && n <= 11999) return 'Cheese'
  if (n >= 8000 && n <= 8999)  return 'Wild Game'
  if (n >= 4000 && n <= 7999)  return 'Processed'
  if (n >= 3000 && n <= 3999)  return 'Goat'
  if (n >= 2000 && n <= 2999)  return 'Lamb'
  if (n >= 1000 && n <= 1999)  return 'Pork'
  if (n >= 100  && n <= 999)   return 'Beef'
  return ''
}

// ── Barcode decode ─────────────────────────────────────────────────────────────
// Hobart EAN-13 weight-embedded format:
//   [0]     = '2' (weight-embedded prefix)
//   [1–5]   = PLU number (zero-padded, 5 digits)
//   [6]     = flag digit (always '0' on Hobart lb config)
//   [7–11]  = weight in hundredths of a pound  (÷ 100)
//   [12]    = EAN-13 check digit (ignored)
// Example: 2 00114 0 00069 9  →  PLU=114, Weight=0.69 lbs
function decodeBarcode(barcode: string): { plu: string; weightLbs: number } | null {
  if (barcode.length !== 13) return null
  if (!/^\d{13}$/.test(barcode)) return null
  if (barcode[0] !== '2') return null
  const plu    = parseInt(barcode.substring(1, 6), 10)
  const weight = parseInt(barcode.substring(7, 12), 10) / 100
  if (plu <= 0 || weight <= 0) return null
  return { plu: String(plu), weightLbs: weight }
}

interface SessionWithStats {
  id:             string | null
  customer_name:  string
  session_date:   string
  status:         'scanning' | 'value_add' | 'complete'
  notes:          string
  box_count:      number
  closed_count:   number
  total_weight:   number
  total_cuts:     number
}

interface BoxRecord {
  id:               string
  customer_name:    string
  pack_date:        string
  box_number:       number
  is_closed:        boolean
  is_final:         boolean
  total_weight_lbs: number
  total_cuts:       number
}

interface ScanLine {
  id:         string
  box_id:     string
  plu_number: string
  item_name:  string
  weight_lbs: number
  quantity:   number
}

interface LabelFlags { usda_bug: boolean; retail_exempt: boolean; not_for_sale: boolean }
const DEFAULT_FLAGS: LabelFlags = { usda_bug: true, retail_exempt: false, not_for_sale: false }

const LBL: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.3rem',
}
const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4,
  padding: '0.75rem', color: C.cream, fontSize: '1.1rem',
  outline: 'none', boxSizing: 'border-box',
}

export default function ScannerPage() {
  // ── PLU cache ────────────────────────────────────────────────────────────────
  const [pluMap,    setPluMap]    = useState<Record<string, string>>({})
  const [pluLoaded, setPluLoaded] = useState(false)

  // ── Session ──────────────────────────────────────────────────────────────────
  const [customer, setCustomer] = useState('')
  const [date,     setDate]     = useState(new Date().toISOString().slice(0, 10))
  const [started,  setStarted]  = useState(false)

  // ── Boxes / scans ────────────────────────────────────────────────────────────
  const [boxes,     setBoxes]     = useState<BoxRecord[]>([])
  const [activeBox, setActiveBox] = useState<BoxRecord | null>(null)
  const [scans,     setScans]     = useState<ScanLine[]>([])   // newest first

  // ── Scan input ───────────────────────────────────────────────────────────────
  const [scanValue,   setScanValue]   = useState('')
  const [flash,       setFlash]       = useState<'ok' | 'bad' | null>(null)
  const [lastItem,    setLastItem]    = useState('')
  const [processing,  setProcessing]  = useState(false)
  const [labelFlags,  setLabelFlags]  = useState<LabelFlags>(DEFAULT_FLAGS)

  // ── Inputs ───────────────────────────────────────────────────────────────────
  const [inputs,       setInputs]       = useState<ProcessingInput[]>([])
  const [showInputs,   setShowInputs]   = useState(false)
  const [newInputDesc, setNewInputDesc] = useState('')
  const [newInputWt,   setNewInputWt]   = useState('')
  const [newInputType, setNewInputType] = useState<'raw' | 'premade' | 'carcass'>('raw')
  const [addingInput,  setAddingInput]  = useState(false)

  // ── Session management ─────────────────────────────────��──────────────────────
  const [sessions,         setSessions]         = useState<SessionWithStats[]>([])
  const [sessionsLoading,  setSessionsLoading]  = useState(true)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentStatus,    setCurrentStatus]    = useState<'scanning' | 'value_add' | 'complete'>('scanning')
  const [showNewForm,      setShowNewForm]      = useState(false)
  const [showAllComplete,  setShowAllComplete]  = useState(false)

  const scanRef       = useRef<HTMLInputElement>(null)
  // Stable refs so event listeners don't go stale
  const activeBoxRef  = useRef<BoxRecord | null>(null)
  const pluMapRef     = useRef<Record<string, string>>({})
  const processingRef = useRef(false)
  const scansRef      = useRef<ScanLine[]>([])
  const startedRef    = useRef(false)
  const inputsRef     = useRef<ProcessingInput[]>([])

  activeBoxRef.current  = activeBox
  pluMapRef.current     = pluMap
  processingRef.current = processing
  scansRef.current      = scans
  startedRef.current    = started
  inputsRef.current     = inputs

  // ── Load sessions list ───────────────────────────────────────────────────���───
  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res  = await fetch('/api/processing/sessions')
      const data = await res.json()
      setSessions(Array.isArray(data) ? data as SessionWithStats[] : [])
    } catch { setSessions([]) }
    setSessionsLoading(false)
  }, [])

  useEffect(() => { loadSessions() }, [loadSessions])

  useEffect(() => {
    fetch('/api/processing?active=true')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const map: Record<string, string> = {}
          for (const item of data as { plu_number?: string; item_name?: string }[]) {
            if (item.plu_number) map[String(item.plu_number)] = item.item_name ?? ''
          }
          setPluMap(map)
        }
      })
      .catch(() => {})
      .finally(() => setPluLoaded(true))
  }, [])

  // ── Global key redirect: digits → scan input ─────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!startedRef.current) return
      const box = activeBoxRef.current
      if (!box || box.is_closed) return
      const target = e.target as HTMLElement
      if (target === scanRef.current) return
      if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return
      if (/^[\dA-Za-z-]$/.test(e.key)) {
        e.preventDefault()
        scanRef.current?.focus()
        setScanValue(prev => prev + e.key)
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])  // intentionally empty — uses refs

  // ── Auto-focus scan input when box opens ─────────────────────────────────────
  useEffect(() => {
    if (started && activeBox && !activeBox.is_closed) {
      setTimeout(() => scanRef.current?.focus(), 80)
    }
  }, [started, activeBox])

  // ── Process a scan ────────────────────────────────────────────────────────────
  const doScan = useCallback(async (raw: string) => {
    if (processingRef.current) return
    const box = activeBoxRef.current
    if (!box || box.is_closed) return

    setScanValue('')
    setFlash(null)

    const decoded = decodeBarcode(raw)
    if (!decoded) {
      setFlash('bad')
      setLastItem('Not a weight barcode')
      setTimeout(() => setFlash(null), 1800)
      scanRef.current?.focus()
      return
    }

    const { plu, weightLbs } = decoded
    const itemName = pluMapRef.current[plu] ?? `Unknown Item (PLU ${plu})`

    processingRef.current = true
    setProcessing(true)

    try {
      const res  = await fetch('/api/boxes/scans', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ box_id: box.id, plu_number: plu, item_name: itemName, weight_lbs: weightLbs, quantity: 1 }),
      })
      const scan: ScanLine = await res.json()
      setScans(prev => [scan, ...prev])
      setLastItem(`${itemName}  ·  ${weightLbs.toFixed(2)} lb`)
      setFlash('ok')
      setTimeout(() => setFlash(null), 2000)
    } catch {
      setFlash('bad')
      setLastItem('Save failed — retry')
    } finally {
      setProcessing(false)
      processingRef.current = false
      scanRef.current?.focus()
    }
  }, [])

  // ── Session record helpers ───────────────────────────────────────────────────
  async function upsertSession(custName: string, sessDate: string, status = 'scanning'): Promise<string | null> {
    try {
      const res  = await fetch('/api/processing/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ customer_name: custName, session_date: sessDate, status }),
      })
      const data = await res.json()
      return data.id ?? null
    } catch { return null }
  }

  async function updateSessionStatus(status: 'scanning' | 'value_add' | 'complete') {
    setCurrentStatus(status)
    await fetch('/api/processing/sessions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: customer, session_date: date, status }),
    })
  }

  async function quickStatus(s: SessionWithStats, status: 'scanning' | 'value_add' | 'complete') {
    await fetch('/api/processing/sessions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: s.customer_name, session_date: s.session_date, status }),
    })
    setSessions(prev => prev.map(x =>
      x.customer_name === s.customer_name && x.session_date === s.session_date ? { ...x, status } : x
    ))
  }

  async function generatePackoutForSession(s: SessionWithStats) {
    const res = await fetch(`/api/boxes?customer_name=${encodeURIComponent(s.customer_name)}&date=${s.session_date}`)
    const sessionBoxes: BoxRecord[] = await res.json().catch(() => [])
    const sortedBoxes = [...sessionBoxes].sort((a, b) => a.box_number - b.box_number)
    const allScans: (ScanLine & { boxNum: number })[] = []
    for (const box of sortedBoxes) {
      const r  = await fetch(`/api/boxes/scans?box_id=${box.id}`)
      const d  = await r.json().catch(() => [])
      if (Array.isArray(d)) for (const sc of d as ScanLine[]) allScans.push({ ...sc, boxNum: box.box_number })
    }
    const grandLbs  = allScans.reduce((t, sc) => t + (Number(sc.weight_lbs) || 0), 0)
    const grandPkgs = allScans.length
    const boxCount  = sortedBoxes.length
    const lineRows  = allScans.map((sc, i) => `
      <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
        <td class="num">${i + 1}</td>
        <td>${sc.item_name || `PLU ${sc.plu_number}`}</td>
        <td class="num mono">${sc.plu_number}</td>
        <td class="num mono">${Number(sc.weight_lbs).toFixed(2)}</td>
        <td class="num">${sc.boxNum}</td>
      </tr>`).join('')
    const dateStr = new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>CMC Packout — ${s.customer_name} — ${s.session_date}</title>
<style>
  @page{size:letter portrait;margin:.75in}*{box-sizing:border-box;margin:0;padding:0}
  body{font-family:Arial,sans-serif;color:#000;font-size:10pt}
  .hdr{text-align:center;margin-bottom:14px}.company{font-size:16pt;font-weight:bold;letter-spacing:.06em;text-transform:uppercase}
  .sub{font-size:10pt;color:#555;margin-top:1px}.title{font-size:13pt;font-weight:bold;letter-spacing:.14em;text-transform:uppercase;margin-top:8px;border-top:2pt solid #000;border-bottom:2pt solid #000;padding:5px 0}
  .cust{display:flex;justify-content:space-between;margin:10px 0 12px;font-size:10.5pt}
  table{width:100%;border-collapse:collapse;font-size:9.5pt}
  th{font-size:8pt;text-transform:uppercase;letter-spacing:.08em;border-bottom:1.5pt solid #000;padding:5px 6px;text-align:left}
  th.num,td.num{text-align:right}td{padding:3.5px 6px}
  tr.even{background:#fff}tr.odd{background:#f7f7f7}.mono{font-family:'Courier New',monospace}
  .total-row td{border-top:1.5pt solid #000;font-weight:bold;padding:5px 6px;font-size:10.5pt}
  .box-line{margin-top:8px;font-size:9.5pt;color:#444}
  .ack{margin-top:28px;border-top:1px solid #ccc;padding-top:12px}
  .ack-title{font-weight:bold;font-size:10pt;margin-bottom:10px}
  .sig-grid{display:grid;grid-template-columns:1fr 1fr;gap:18px 30px;margin-top:6px}
  .sig-line{border-bottom:1px solid #000;padding-top:22px;font-size:9pt;color:#555}
</style></head><body>
<div class="hdr"><div class="company">Cowboy Meat Company</div><div class="sub">Forsyth, Montana · cowboymeats.com</div><div class="title">Packout Slip</div></div>
<div class="cust"><span><strong>Customer:</strong> &nbsp;${s.customer_name}</span><span><strong>Date:</strong> &nbsp;${dateStr}</span></div>
<table><thead><tr><th class="num">#</th><th>Item Name</th><th class="num">PLU</th><th class="num">Weight (lbs)</th><th class="num">Box #</th></tr></thead>
<tbody>${lineRows}
<tr class="total-row"><td colspan="3">TOTAL &nbsp;—&nbsp; ${grandPkgs} item${grandPkgs !== 1 ? 's' : ''}</td><td class="num mono">${grandLbs.toFixed(2)}</td><td></td></tr>
</tbody></table>
<div class="box-line">${boxCount} box${boxCount !== 1 ? 'es' : ''} total</div>
<div class="ack"><div class="ack-title">Customer Acknowledgement &nbsp;—&nbsp; I confirm receipt of all products listed above.</div>
<div class="sig-grid"><div class="sig-line">Signature</div><div class="sig-line">Date</div><div class="sig-line">Print Name</div><div class="sig-line">Phone</div></div></div>
<script>window.onload=()=>window.print()</script></body></html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  // ── Start session + auto-create Box 1 ────────────────────────────────────────
  async function startSession() {
    if (!customer.trim() || !pluLoaded) return
    setStarted(true)
    const res = await fetch('/api/boxes', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ customer_name: customer.trim(), pack_date: date, box_number: 1, is_final: false }),
    })
    const box: BoxRecord = await res.json()
    setBoxes([box])
    setActiveBox(box)
    setScans([])
    setCurrentStatus('scanning')
    const sid = await upsertSession(customer.trim(), date, 'scanning')
    setCurrentSessionId(sid)
    fetch(`/api/processing/inputs?customer_name=${encodeURIComponent(customer.trim())}&session_date=${date}`)
      .then(r => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setInputs(data as ProcessingInput[]) })
      .catch(() => {})
  }

  // ── Reopen an existing session ───────────────────────────────────────────────
  async function startSessionFromExisting(cust: string, dt: string) {
    if (!pluLoaded) return
    const existing = sessions.find(s => s.customer_name === cust && s.session_date === dt)
    const existingStatus = existing?.status ?? 'scanning'
    setCustomer(cust)
    setDate(dt)
    setStarted(true)
    setCurrentStatus(existingStatus)
    const sid = await upsertSession(cust, dt, existingStatus)
    setCurrentSessionId(sid)
    const res = await fetch(`/api/boxes?customer_name=${encodeURIComponent(cust)}&date=${dt}`)
    const loadedBoxes: BoxRecord[] = await res.json().catch(() => [])
    const sorted = [...loadedBoxes].sort((a, b) => a.box_number - b.box_number)
    setBoxes(sorted)
    const openBox = sorted.find(b => !b.is_closed) ?? sorted[sorted.length - 1] ?? null
    setActiveBox(openBox)
    if (openBox) {
      const scanRes  = await fetch(`/api/boxes/scans?box_id=${openBox.id}`)
      const scanData = await scanRes.json().catch(() => [])
      setScans(Array.isArray(scanData) ? ([...scanData] as ScanLine[]).reverse() : [])
    }
    fetch(`/api/processing/inputs?customer_name=${encodeURIComponent(cust)}&session_date=${dt}`)
      .then(r => r.json())
      .then((d: unknown) => { if (Array.isArray(d)) setInputs(d as ProcessingInput[]) })
      .catch(() => {})
  }

  // ── Add new box ───────────────────────────────────────────────────────────────
  async function addBox(isFinal: boolean) {
    if (!customer) return
    const nextNum = boxes.length + 1
    const res = await fetch('/api/boxes', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ customer_name: customer, pack_date: date, box_number: nextNum, is_final: isFinal }),
    })
    const box: BoxRecord = await res.json()
    setBoxes(prev => [...prev, box])
    setScans([])
    setActiveBox(box)
  }

  // ── Switch active box (loads its scans) ──────────────────────────────────────
  async function switchBox(box: BoxRecord) {
    setActiveBox(box)
    const res  = await fetch(`/api/boxes/scans?box_id=${box.id}`)
    const data = await res.json()
    setScans(Array.isArray(data) ? ([...data] as ScanLine[]).reverse() : [])
  }

  // ── Toggle is_final on active box ────────────────────────────────────────────
  async function toggleFinal() {
    const box = activeBox
    if (!box) return
    const newVal = !box.is_final
    await fetch('/api/boxes', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: box.id, is_final: newVal }),
    })
    const updated = { ...box, is_final: newVal }
    setBoxes(prev => prev.map(b => b.id === box.id ? updated : b))
    setActiveBox(updated)
  }

  // ── Close box + auto-print label ─────────────────────────────────────────────
  async function closeBox() {
    const box = activeBox
    if (!box || box.is_closed) return
    const snap        = scansRef.current
    const totalWeight = snap.reduce((s, sc) => s + (Number(sc.weight_lbs) || 0), 0)
    const totalCuts   = snap.length
    await fetch('/api/boxes', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: box.id, is_closed: true, total_weight_lbs: totalWeight, total_cuts: totalCuts }),
    })
    const closed = { ...box, is_closed: true, total_weight_lbs: totalWeight, total_cuts: totalCuts }
    setBoxes(prev => prev.map(b => b.id === box.id ? closed : b))
    setActiveBox(closed)
    openPrintWindow(closed, snap, labelFlags)
  }

  // ── Print label ───────────────────────────────────────────────────────────────
  function openPrintWindow(box: BoxRecord, labelScans: ScanLine[], flags: LabelFlags = labelFlags) {
    const grouped: Record<string, { count: number; weight: number }> = {}
    ;[...labelScans].reverse().forEach(s => {
      const k = s.item_name || `PLU ${s.plu_number}`
      if (!grouped[k]) grouped[k] = { count: 0, weight: 0 }
      grouped[k].count  += s.quantity ?? 1
      grouped[k].weight += Number(s.weight_lbs) || 0
    })
    const items       = Object.entries(grouped).sort((a, b) => b[1].weight - a[1].weight)
    const totalWeight = items.reduce((s, [, v]) => s + v.weight, 0)
    const totalCuts   = items.reduce((s, [, v]) => s + v.count, 0)
    const boxLabel    = `Box ${box.box_number}${box.is_final ? ' ★' : ''}`
    const dateStr     = new Date(box.pack_date + 'T12:00:00').toLocaleDateString('en-US', { month: '2-digit', day: '2-digit', year: 'numeric' })
    const rows        = items.map(([name, v]) =>
      `<div class="r"><span><b>(${v.count})</b> ${name}</span><span>${v.weight.toFixed(2)} lb</span></div>`
    ).join('')
    const usdaHTML    = flags.usda_bug
      ? `<div class="usda"><div style="font-size:7pt;font-weight:bold;letter-spacing:.08em">USDA</div><div style="font-size:5.5pt;letter-spacing:.04em">INSPECTED &amp; PASSED</div></div>`
      : ''
    const exemptHTML  = flags.retail_exempt ? `<div class="badge">RETAIL EXEMPT</div>` : ''
    const nfsHTML     = flags.not_for_sale   ? `<div class="nfs">★ NOT FOR SALE ★</div>` : ''

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${box.customer_name} ${boxLabel}</title>
<style>
@page { size: 4in auto; margin: .15in }
* { box-sizing: border-box; margin: 0; padding: 0 }
body { width: 3.7in; font-family: Arial, sans-serif; color: #000 }
.top { display: flex; justify-content: space-between; align-items: flex-start }
.co  { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 9pt; font-weight: bold; text-align: center; letter-spacing: .05em; margin-bottom: 2px; flex: 1 }
.usda{ border: 1.5px solid #000; border-radius: 50%; padding: 3px 5px; text-align: center; line-height: 1.25; flex-shrink: 0 }
.cu  { font-size: 20pt; font-weight: bold; text-align: center; line-height: 1.1; margin: 4px 0 }
.bn  { font-size: 14pt; font-weight: bold; text-align: center; margin-bottom: 2px }
.dt  { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 9pt; text-align: center; margin-bottom: 4px }
hr   { border: none; border-top: 1px solid #000; margin: 5px 0 }
.r   { display: flex; justify-content: space-between; font-family: 'Arial Narrow', Arial, sans-serif; font-size: 11pt; padding: 1px 0 }
.ft  { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10pt; font-weight: bold; text-align: center; margin-top: 2px }
.badge { text-align: center; font-size: 7.5pt; font-weight: bold; border: 1px solid #000; border-radius: 2px; padding: 1px 4px; display: inline-block; margin: 2px auto; letter-spacing: .06em }
.nfs   { text-align: center; font-size: 9pt; font-weight: bold; letter-spacing: .1em; margin: 3px 0 }
</style></head><body>
<div class="top"><div style="flex:1;text-align:center"><div class="co">COWBOY MEAT COMPANY</div></div>${usdaHTML}</div>
${nfsHTML}
${exemptHTML ? `<div style="text-align:center">${exemptHTML}</div>` : ''}
<div class="cu">${box.customer_name.toUpperCase()}</div>
<div class="bn">${boxLabel}</div>
<div class="dt">${dateStr}</div>
<hr>${rows}<hr>
<div class="ft">${totalCuts} cut${totalCuts !== 1 ? 's' : ''} | ${totalWeight.toFixed(2)} lbs total</div>
<script>window.onload = () => window.print()</script>
</body></html>`
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  // ── Remove a scan ─────────────────────────────────────────────────────────────
  async function removeScan(id: string) {
    await fetch(`/api/boxes/scans?id=${id}`, { method: 'DELETE' })
    setScans(prev => prev.filter(s => s.id !== id))
  }

  // ── Add input from CMC box scan or carcass tag scan ──────────────────────────
  async function addInput(identifier: string) {
    const isCarcass = /^CT-/.test(identifier)
    setScanValue('')
    setFlash('ok')
    setLastItem(isCarcass ? `🐄 Carcass tag: ${identifier}` : `📦 Box: ${identifier}`)
    setTimeout(() => setFlash(null), 2000)
    try {
      const res = await fetch('/api/processing/inputs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          session_date:   date,
          customer_name:  customer,
          pack_date:      date,
          box_identifier: identifier,
          input_type:     isCarcass ? 'carcass' : 'raw',
          source_type:    isCarcass ? 'general' : 'received_box',
        }),
      })
      const inp: ProcessingInput = await res.json()
      setInputs(prev => [...prev, inp])
      setShowInputs(true)
    } catch {
      setFlash('bad')
      setLastItem('Input save failed')
    } finally {
      scanRef.current?.focus()
    }
  }

  // ── Add manual input ──────────────────────────────────────────────────────────
  async function addManualInput() {
    if (!newInputDesc.trim() && !newInputWt) return
    setAddingInput(true)
    try {
      const res = await fetch('/api/processing/inputs', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          session_date:  date,
          customer_name: customer,
          pack_date:     date,
          description:   newInputDesc.trim() || 'Manual input',
          weight_lbs:    newInputWt ? parseFloat(newInputWt) : null,
          input_type:    newInputType,
          source_type:   'general',
        }),
      })
      const inp: ProcessingInput = await res.json()
      setInputs(prev => [...prev, inp])
      setNewInputDesc('')
      setNewInputWt('')
    } catch {}
    finally { setAddingInput(false) }
  }

  // ── Remove an input ───────────────────────────────────────────────────────────
  async function removeInput(id: string) {
    await fetch(`/api/processing/inputs?id=${id}`, { method: 'DELETE' })
    setInputs(prev => prev.filter(i => i.id !== id))
  }

  // ── Cut-Out Report ────────────────────────────────────────────────────────────
  const [reportLoading, setReportLoading] = useState(false)

  async function generateCutoutReport() {
    setReportLoading(true)
    // Fetch all scans for every box, in box-number order
    const sortedBoxes = [...boxes].sort((a, b) => a.box_number - b.box_number)
    const allScans: (ScanLine & { boxNum: number })[] = []
    for (const box of sortedBoxes) {
      const res  = await fetch(`/api/boxes/scans?box_id=${box.id}`)
      const data = await res.json().catch(() => [])
      if (Array.isArray(data)) {
        for (const s of data as ScanLine[]) {
          allScans.push({ ...s, boxNum: box.box_number })
        }
      }
    }

    const grandLbs  = allScans.reduce((s, sc) => s + (Number(sc.weight_lbs) || 0), 0)
    const grandPkgs = allScans.length
    const boxCount  = sortedBoxes.length

    // Line item rows — every individual scan
    const lineRows = allScans.map((sc, i) => `
      <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
        <td class="num">${i + 1}</td>
        <td>${sc.item_name || `PLU ${sc.plu_number}`}</td>
        <td class="num mono">${sc.plu_number}</td>
        <td class="num mono">${Number(sc.weight_lbs).toFixed(2)}</td>
        <td class="num">${sc.boxNum}</td>
      </tr>`).join('')

    const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>CMC Packout — ${customer} — ${date}</title>
<style>
  @page { size: letter portrait; margin: 0.75in }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: Arial, sans-serif; color: #000; font-size: 10pt }
  .hdr { text-align: center; margin-bottom: 14px }
  .company { font-size: 16pt; font-weight: bold; letter-spacing: 0.06em; text-transform: uppercase }
  .sub { font-size: 10pt; color: #555; margin-top: 1px }
  .title { font-size: 13pt; font-weight: bold; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 8px; border-top: 2pt solid #000; border-bottom: 2pt solid #000; padding: 5px 0 }
  .cust { display: flex; justify-content: space-between; margin: 10px 0 12px; font-size: 10.5pt }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt }
  th { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1.5pt solid #000; padding: 5px 6px; text-align: left }
  th.num, td.num { text-align: right }
  td { padding: 3.5px 6px }
  tr.even { background: #fff }
  tr.odd  { background: #f7f7f7 }
  .mono { font-family: 'Courier New', monospace }
  .total-row td { border-top: 1.5pt solid #000; font-weight: bold; padding: 5px 6px; font-size: 10.5pt }
  .box-line { margin-top: 8px; font-size: 9.5pt; color: #444 }
  .ack { margin-top: 28px; border-top: 1px solid #ccc; padding-top: 12px }
  .ack-title { font-weight: bold; font-size: 10pt; margin-bottom: 10px }
  .sig-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 18px 30px; margin-top: 6px }
  .sig-line { border-bottom: 1px solid #000; padding-top: 22px; font-size: 9pt; color: #555 }
</style></head><body>

<div class="hdr">
  <div class="company">Cowboy Meat Company</div>
  <div class="sub">Forsyth, Montana &nbsp;·&nbsp; cowboymeats.com</div>
  <div class="title">Packout Slip</div>
</div>

<div class="cust">
  <span><strong>Customer:</strong> &nbsp;${customer}</span>
  <span><strong>Date:</strong> &nbsp;${dateStr}</span>
</div>

<table>
  <thead>
    <tr>
      <th class="num">#</th>
      <th>Item Name</th>
      <th class="num">PLU</th>
      <th class="num">Weight (lbs)</th>
      <th class="num">Box #</th>
    </tr>
  </thead>
  <tbody>
    ${lineRows}
    <tr class="total-row">
      <td colspan="3">TOTAL &nbsp;—&nbsp; ${grandPkgs} item${grandPkgs !== 1 ? 's' : ''}</td>
      <td class="num mono">${grandLbs.toFixed(2)}</td>
      <td></td>
    </tr>
  </tbody>
</table>

<div class="box-line">${boxCount} box${boxCount !== 1 ? 'es' : ''} total</div>

<div class="ack">
  <div class="ack-title">Customer Acknowledgement &nbsp;—&nbsp; I confirm receipt of all products listed above.</div>
  <div class="sig-grid">
    <div class="sig-line">Signature</div>
    <div class="sig-line">Date</div>
    <div class="sig-line">Print Name</div>
    <div class="sig-line">Phone</div>
  </div>
</div>

<script>window.onload = () => window.print()</script>
</body></html>`

    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
    setReportLoading(false)
  }

  // ── Derived ───────────────────────────────────────────────────────────────────
  const totalWeight    = scans.reduce((s, sc) => s + (Number(sc.weight_lbs) || 0), 0)
  const isOpen         = activeBox && !activeBox.is_closed
  const closedWeight   = boxes.filter(b => b.is_closed).reduce((s, b) => s + (Number(b.total_weight_lbs) || 0), 0)
  const borderColor    = flash === 'ok' ? C.green : flash === 'bad' ? C.red : isOpen ? 'rgba(201,168,130,0.5)' : 'rgba(166,120,90,0.2)'
  const totalInputLbs  = inputs.reduce((s, i) => s + (Number(i.weight_lbs) || 0), 0)
  const totalOutputLbs = closedWeight + totalWeight
  const yieldPct       = totalInputLbs > 0 ? (totalOutputLbs / totalInputLbs) * 100 : 0
  const yieldColor     = yieldPct >= 80 ? C.green : yieldPct >= 65 ? C.yellow : C.red

  // ══════════════════════════════════════════════════════════════════════════════
  // SETUP SCREEN
  // ══════════════════════════════════════════════════════════════════════════════
  if (!started) {
    const scanning  = sessions.filter(s => s.status === 'scanning')
    const valueAdd  = sessions.filter(s => s.status === 'value_add')
    const complete  = sessions.filter(s => s.status === 'complete')

    const STATUS_CFG = {
      scanning:  { label: 'Scanning',   color: C.yellow,        dot: '●' },
      value_add: { label: 'Value Add',  color: '#E8883A',       dot: '◆' },
      complete:  { label: 'Complete',   color: C.green,         dot: '✓' },
    }

    function SessionCard({ s }: { s: SessionWithStats }) {
      const dateStr = new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const cfg = STATUS_CFG[s.status]
      const btnBase: React.CSSProperties = { borderRadius: 3, padding: '0.3rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }
      return (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 6, padding: '0.9rem 1.1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
            <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.95rem' }}>{s.customer_name}</span>
            <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>{dateStr}</span>
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.75rem', marginBottom: '0.7rem' }}>
            {s.box_count} box{s.box_count !== 1 ? 'es' : ''}
            {s.closed_count > 0 && ` · ${s.closed_count} closed`}
            {s.total_weight > 0 && ` · ${s.total_weight.toFixed(1)} lbs`}
          </div>
          <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
            {(s.status === 'scanning' || s.status === 'value_add') && (
              <button disabled={!pluLoaded} onClick={() => startSessionFromExisting(s.customer_name, s.session_date)}
                style={{ ...btnBase, background: C.tan, color: C.dark, border: 'none', opacity: pluLoaded ? 1 : 0.5 }}>
                → Open
              </button>
            )}
            {s.status === 'scanning' && (
              <button onClick={() => quickStatus(s, 'value_add')}
                style={{ ...btnBase, background: 'transparent', border: '1px solid rgba(232,136,58,0.5)', color: '#E8883A' }}>
                → Value Add
              </button>
            )}
            {s.status === 'value_add' && (
              <button onClick={() => quickStatus(s, 'complete')}
                style={{ ...btnBase, background: 'transparent', border: `1px solid rgba(76,175,80,0.5)`, color: C.green }}>
                ✓ Complete
              </button>
            )}
            {s.status === 'complete' && (
              <button onClick={() => quickStatus(s, 'scanning')}
                style={{ ...btnBase, background: 'transparent', border: '1px solid rgba(166,120,90,0.3)', color: C.lightBrown }}>
                ↩ Reopen
              </button>
            )}
            <button onClick={() => generatePackoutForSession(s)}
              style={{ ...btnBase, background: 'transparent', border: '1px solid rgba(166,120,90,0.25)', color: C.lightBrown }}>
              📋 Packout
            </button>
          </div>
        </div>
      )
    }

    function Section({ title, color, items, showAll, onToggle }: {
      title: string; color: string; items: SessionWithStats[]; showAll?: boolean; onToggle?: () => void
    }) {
      if (items.length === 0) return null
      const visible = showAll !== undefined ? (showAll ? items : items.slice(0, 6)) : items
      return (
        <div style={{ marginBottom: '1.75rem' }}>
          <div style={{ fontSize: '0.65rem', color, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700, marginBottom: '0.65rem' }}>
            {title} ({items.length})
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))', gap: '0.65rem' }}>
            {visible.map(s => <SessionCard key={`${s.customer_name}|${s.session_date}`} s={s} />)}
          </div>
          {onToggle && items.length > 6 && (
            <button onClick={onToggle} style={{ marginTop: '0.5rem', background: 'none', border: 'none', color: C.lightBrown, fontSize: '0.75rem', cursor: 'pointer', textDecoration: 'underline' }}>
              {showAll ? 'Show less' : `Show all ${items.length}`}
            </button>
          )}
        </div>
      )
    }

    return (
      <div style={{ minHeight: '100dvh', background: C.dark, display: 'flex', flexDirection: 'column' }}>
        {/* Header */}
        <div style={{ background: C.darkBrown, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0.75rem 1.5rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <Link href="/processing" style={{ color: C.lightBrown, fontSize: '0.8rem', textDecoration: 'none' }}>← Processing</Link>
            <span style={{ color: 'rgba(166,120,90,0.35)' }}>|</span>
            <span style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Processing Scanner</span>
            <span style={{ fontSize: '0.72rem', color: pluLoaded ? C.green : C.yellow, fontWeight: 600 }}>
              {pluLoaded ? `✓ ${Object.keys(pluMap).length} PLUs` : '⟳ Loading…'}
            </span>
          </div>
          <button onClick={() => setShowNewForm(true)} style={{ background: C.tan, color: C.dark, border: 'none', borderRadius: 4, padding: '0.5rem 1.1rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>
            + New Session
          </button>
        </div>

        {/* Sessions */}
        <div style={{ flex: 1, padding: '1.5rem', maxWidth: 920, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {sessionsLoading ? (
            <div style={{ textAlign: 'center', color: C.lightBrown, padding: '3rem', fontSize: '0.9rem' }}>Loading sessions…</div>
          ) : sessions.length === 0 ? (
            <div style={{ textAlign: 'center', color: C.lightBrown, padding: '4rem 2rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔍</div>
              <div style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>No sessions yet</div>
              <button onClick={() => setShowNewForm(true)} style={{ background: C.tan, color: C.dark, border: 'none', borderRadius: 4, padding: '0.65rem 1.5rem', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer' }}>
                Start First Session
              </button>
            </div>
          ) : (
            <>
              <Section title="● Scanning"       color={C.yellow}  items={scanning} />
              <Section title="◆ Value Add Queue" color="#E8883A"   items={valueAdd} />
              <Section title="✓ Complete"        color={C.green}   items={complete} showAll={showAllComplete} onToggle={() => setShowAllComplete(p => !p)} />
            </>
          )}
        </div>

        {/* New Session modal */}
        {showNewForm && (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 100 }}>
            <div style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.35)', borderRadius: 8, padding: '2rem', width: '100%', maxWidth: 360 }}>
              <h2 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.1rem', textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 1.5rem' }}>New Session</h2>
              <div style={{ marginBottom: '1rem' }}>
                <label style={LBL}>Customer</label>
                <input autoFocus style={INPUT} value={customer} onChange={e => setCustomer(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && customer.trim() && pluLoaded) { setShowNewForm(false); startSession() } }}
                  placeholder="Customer name" />
              </div>
              <div style={{ marginBottom: '1.5rem' }}>
                <label style={LBL}>Pack Date</label>
                <input type="date" style={{ ...INPUT, fontSize: '1rem' }} value={date} onChange={e => setDate(e.target.value)} />
              </div>
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button onClick={() => setShowNewForm(false)} style={{ flex: 1, background: 'transparent', border: '1px solid rgba(166,120,90,0.3)', color: C.lightBrown, borderRadius: 4, padding: '0.75rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button onClick={() => { setShowNewForm(false); startSession() }} disabled={!customer.trim() || !pluLoaded}
                  style={{ flex: 2, background: customer.trim() && pluLoaded ? C.tan : C.medBrown, color: C.dark, border: 'none', borderRadius: 4, padding: '0.75rem', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', opacity: customer.trim() && pluLoaded ? 1 : 0.6 }}>
                  Start Scanning
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    )
  }

  // ══════════════════════════════════════════════════════════════════════════════
  // SCANNER SCREEN
  // ══════════════════════════════════════════════════════════════════════════════
  return (
    <div style={{ height: '100dvh', background: C.dark, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

      {/* ── Header ── */}
      <div style={{
        background: C.darkBrown, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0.6rem 1.25rem', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <button onClick={() => { setStarted(false); loadSessions() }} style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '0.8rem', cursor: 'pointer', padding: 0 }}>
            ← Sessions
          </button>
          <span style={{ color: 'rgba(166,120,90,0.35)' }}>|</span>
          <span style={{ color: C.cream, fontWeight: 700, fontSize: '1rem' }}>{customer}</span>
          <span style={{ color: C.lightBrown, fontSize: '0.82rem' }}>{date}</span>
          {/* Status badge + quick-change */}
          {currentStatus === 'scanning' && (
            <button onClick={() => updateSessionStatus('value_add')}
              style={{ background: 'transparent', border: '1px solid rgba(232,136,58,0.4)', color: '#E8883A', borderRadius: 3, padding: '0.2rem 0.6rem', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>
              → Value Add
            </button>
          )}
          {currentStatus === 'value_add' && (
            <>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#E8883A', background: 'rgba(232,136,58,0.12)', borderRadius: 99, padding: '2px 8px' }}>◆ Value Add</span>
              <button onClick={() => updateSessionStatus('complete')}
                style={{ background: 'transparent', border: `1px solid rgba(76,175,80,0.4)`, color: C.green, borderRadius: 3, padding: '0.2rem 0.6rem', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>
                ✓ Complete
              </button>
            </>
          )}
          {currentStatus === 'complete' && (
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: C.green, background: 'rgba(76,175,80,0.1)', borderRadius: 99, padding: '2px 8px' }}>✓ Complete</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {totalInputLbs > 0 && totalOutputLbs > 0 && (
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: yieldColor, fontFamily: 'monospace' }}>
              {yieldPct.toFixed(1)}% yield
            </span>
          )}
          <span style={{ fontSize: '0.72rem', color: C.lightBrown }}>{Object.keys(pluMap).length} PLUs</span>
          {boxes.length > 0 && (
            <button
              onClick={generateCutoutReport}
              disabled={reportLoading}
              style={{
                background: 'rgba(201,168,130,0.15)', border: '1px solid rgba(201,168,130,0.35)',
                borderRadius: 3, padding: '0.3rem 0.75rem', color: C.tan,
                fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
              }}
            >
              {reportLoading ? '⟳ Building…' : '📋 Packout Slip'}
            </button>
          )}
          <Link href="/processing" style={{ color: C.lightBrown, fontSize: '0.75rem', textDecoration: 'none', opacity: 0.6 }}>PLU Browser ›</Link>
        </div>
      </div>

      {/* ── Box tabs ── */}
      <div style={{
        background: 'rgba(0,0,0,0.3)', borderBottom: '1px solid rgba(166,120,90,0.2)',
        padding: '0.45rem 1.25rem', display: 'flex', alignItems: 'center',
        gap: '0.4rem', flexShrink: 0, overflowX: 'auto',
      }}>
        {boxes.map(box => (
          <button
            key={box.id}
            onClick={() => switchBox(box)}
            style={{
              padding: '0.35rem 0.9rem', borderRadius: 3, cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap',
              border: activeBox?.id === box.id ? 'none' : '1px solid rgba(166,120,90,0.25)',
              background: activeBox?.id === box.id ? C.tan : 'transparent',
              color: activeBox?.id === box.id ? C.dark : (box.is_closed ? C.green : C.tan),
            }}
          >
            Box {box.box_number}{box.is_final ? ' ★' : ''} {box.is_closed ? '✓' : '●'}
          </button>
        ))}
        <div style={{ width: 1, height: 18, background: 'rgba(166,120,90,0.25)', margin: '0 0.3rem', flexShrink: 0 }} />
        <button onClick={() => addBox(false)} style={{ padding: '0.35rem 0.85rem', border: `1px solid ${C.tan}`, borderRadius: 3, background: 'transparent', color: C.tan, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap' }}>
          + Box
        </button>
        <button onClick={() => addBox(true)} style={{ padding: '0.35rem 0.85rem', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, background: 'transparent', color: C.lightBrown, fontSize: '0.78rem', cursor: 'pointer', whiteSpace: 'nowrap' }} title="Add final box (prints ★ on label)">
          + Final ★
        </button>
      </div>

      {/* ── Main content ── */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: '1rem 1.5rem', gap: '0.85rem', overflow: 'hidden', minHeight: 0 }}>

        {/* Scan input */}
        <div
          onClick={() => scanRef.current?.focus()}
          style={{
            flexShrink: 0, background: 'rgba(255,255,255,0.04)',
            border: `2px solid ${borderColor}`, borderRadius: 6,
            padding: '0.85rem 1.25rem', display: 'flex', alignItems: 'center',
            gap: '1rem', cursor: 'text', transition: 'border-color 0.25s',
          }}
        >
          <span style={{ fontSize: '1.6rem', flexShrink: 0, lineHeight: 1 }}>
            {flash === 'ok' ? '✓' : flash === 'bad' ? '⚠' : processing ? '⟳' : '🔍'}
          </span>
          <input
            ref={scanRef}
            value={scanValue}
            onChange={e => {
              const raw = e.target.value
              // CMC box identifier complete (CMC-YYYYMMDD-NNN = 16 chars)
              if (/^CMC-\d{8}-\d{3}$/.test(raw)) { addInput(raw); return }
              // Carcass tag complete (CT-{uuid} = "CT-" + 36 char UUID = 39 chars)
              if (/^CT-[0-9a-f-]{36}$/.test(raw)) { addInput(raw); return }
              // Partial CMC or CT prefix — let it build up, don't strip
              if (/^(CMC|CT)/i.test(raw)) { setScanValue(raw); return }
              // Hobart EAN-13: digits only
              const v = raw.replace(/\D/g, '')
              setScanValue(v)
              if (v.length === 13) doScan(v)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && scanValue.length > 0 && scanValue.length < 13) {
                if (/^CMC-\d{8}-\d{3}$/.test(scanValue)) addInput(scanValue)
                else if (/^CT-[0-9a-f-]{36}$/.test(scanValue)) addInput(scanValue)
                else doScan(scanValue)
              }
            }}
            disabled={!isOpen || processing}
            placeholder={
              !activeBox            ? 'Select or create a box above'
              : activeBox.is_closed ? 'Box closed — add a new box to continue'
              : 'Scan barcode…'
            }
            style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: C.cream, fontSize: '1.55rem', fontFamily: 'monospace', letterSpacing: '0.15em',
            }}
          />
          {scanValue && (
            <button onClick={e => { e.stopPropagation(); setScanValue('') }} style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', fontSize: '1.3rem', lineHeight: 1 }}>×</button>
          )}
        </div>

        {/* Feedback line */}
        <div style={{ flexShrink: 0, minHeight: '1.9rem', textAlign: 'center' }}>
          {lastItem && (
            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: flash === 'bad' ? C.red : C.green }}>
              {flash === 'ok' ? '✓ ' : '⚠ '}{lastItem}
            </span>
          )}
        </div>

        {/* Box bar */}
        {activeBox && (
          <div style={{ flexShrink: 0 }}>
            {/* Top row: box info + actions */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
                <span style={{ color: C.cream, fontWeight: 700, fontSize: '1.05rem' }}>
                  Box {activeBox.box_number}{activeBox.is_final ? ' ★' : ''}
                </span>
                <span style={{ fontSize: '0.8rem', fontWeight: 700, color: activeBox.is_closed ? C.green : C.tan }}>
                  {activeBox.is_closed ? '✓ Closed' : 'Open'}
                </span>
                <span style={{ fontSize: '0.82rem', color: C.lightBrown }}>
                  {scans.length} item{scans.length !== 1 ? 's' : ''} · {totalWeight.toFixed(2)} lbs
                </span>
                {/* Final toggle */}
                <button
                  onClick={toggleFinal}
                  title={activeBox.is_final ? 'Remove final marker' : 'Mark as final box'}
                  style={{
                    background: activeBox.is_final ? 'rgba(201,168,130,0.2)' : 'transparent',
                    border: `1px solid ${activeBox.is_final ? 'rgba(201,168,130,0.5)' : 'rgba(166,120,90,0.25)'}`,
                    borderRadius: 3, padding: '0.2rem 0.6rem',
                    color: activeBox.is_final ? C.tan : C.lightBrown,
                    fontSize: '0.75rem', cursor: 'pointer', fontWeight: activeBox.is_final ? 700 : 400,
                  }}
                >
                  {activeBox.is_final ? '★ Final' : '☆ Final'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: '0.5rem' }}>
                <button
                  onClick={() => openPrintWindow(activeBox, scans)}
                  style={{ background: 'transparent', border: `1px solid ${C.tan}`, borderRadius: 3, padding: '0.4rem 0.9rem', color: C.tan, fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  🖨 Print Label
                </button>
                {isOpen && (
                  <button
                    onClick={closeBox}
                    style={{ background: C.green, border: 'none', borderRadius: 3, padding: '0.4rem 1.1rem', color: C.dark, fontSize: '0.85rem', cursor: 'pointer', fontWeight: 700 }}
                  >
                    ✓ Close Box
                  </button>
                )}
              </div>
            </div>
            {/* Label flags row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
              <span style={{ fontSize: '0.65rem', color: 'rgba(166,120,90,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: '0.2rem' }}>Label:</span>
              {([
                { k: 'usda_bug'      as keyof LabelFlags, label: 'USDA Bug'      },
                { k: 'retail_exempt' as keyof LabelFlags, label: 'Retail Exempt' },
                { k: 'not_for_sale'  as keyof LabelFlags, label: 'Not For Sale'  },
              ] as { k: keyof LabelFlags; label: string }[]).map(({ k, label }) => (
                <button
                  key={k}
                  onClick={() => setLabelFlags(f => ({ ...f, [k]: !f[k] }))}
                  style={{
                    background: labelFlags[k] ? 'rgba(201,168,130,0.2)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${labelFlags[k] ? 'rgba(201,168,130,0.45)' : 'rgba(166,120,90,0.2)'}`,
                    borderRadius: 3, padding: '0.2rem 0.6rem',
                    color: labelFlags[k] ? C.cream : C.lightBrown,
                    fontSize: '0.72rem', cursor: 'pointer', fontWeight: labelFlags[k] ? 700 : 400,
                  }}
                >
                  {labelFlags[k] ? '✓ ' : ''}{label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* ── Inputs panel ── */}
        <div style={{ flexShrink: 0 }}>
          <div
            onClick={() => setShowInputs(p => !p)}
            style={{
              display: 'flex', alignItems: 'center', gap: '0.6rem',
              padding: '0.4rem 0.75rem', borderRadius: showInputs ? '4px 4px 0 0' : 4,
              cursor: 'pointer', userSelect: 'none',
              background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(166,120,90,0.18)',
            }}
          >
            <span style={{ fontSize: '0.75rem', color: C.lightBrown, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', flexShrink: 0 }}>
              📦 Inputs
            </span>
            <span style={{ fontSize: '0.78rem', color: C.cream }}>
              {inputs.length} item{inputs.length !== 1 ? 's' : ''}
              {totalInputLbs > 0 && <> · {totalInputLbs.toFixed(2)} lbs in</>}
            </span>
            {totalInputLbs > 0 && totalOutputLbs > 0 && (
              <>
                <span style={{ fontSize: '0.68rem', color: 'rgba(166,120,90,0.35)' }}>→</span>
                <span style={{ fontSize: '0.78rem', color: C.cream }}>{totalOutputLbs.toFixed(2)} lbs out</span>
                <span style={{
                  fontSize: '0.74rem', fontWeight: 700, borderRadius: 3, padding: '0.1rem 0.45rem', flexShrink: 0,
                  background: yieldPct >= 80 ? 'rgba(76,175,80,0.18)' : yieldPct >= 65 ? 'rgba(217,119,6,0.18)' : 'rgba(229,62,62,0.18)',
                  color: yieldColor,
                }}>
                  {yieldPct.toFixed(1)}% yield
                </span>
              </>
            )}
            <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: C.lightBrown }}>{showInputs ? '▲' : '▼'}</span>
          </div>

          {showInputs && (
            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(166,120,90,0.18)', borderTop: 'none', borderRadius: '0 0 4px 4px', padding: '0.5rem 0.6rem' }}>
              {/* Quick-add row */}
              <div style={{ display: 'flex', gap: '0.35rem', marginBottom: '0.45rem' }}>
                <input
                  placeholder="Description"
                  value={newInputDesc}
                  onChange={e => setNewInputDesc(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') addManualInput() }}
                  style={{ flex: 2, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, padding: '0.32rem 0.5rem', color: C.cream, fontSize: '0.82rem', outline: 'none' }}
                />
                <input
                  type="number"
                  placeholder="Lbs"
                  value={newInputWt}
                  onChange={e => setNewInputWt(e.target.value)}
                  style={{ width: 68, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, padding: '0.32rem 0.4rem', color: C.cream, fontSize: '0.82rem', outline: 'none' }}
                />
                <select
                  value={newInputType}
                  onChange={e => setNewInputType(e.target.value as 'raw' | 'premade' | 'carcass')}
                  style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, padding: '0.32rem 0.35rem', color: C.cream, fontSize: '0.78rem', outline: 'none' }}
                >
                  <option value="raw">Raw</option>
                  <option value="premade">Premade</option>
                  <option value="carcass">Carcass</option>
                </select>
                <button
                  onClick={addManualInput}
                  disabled={addingInput || (!newInputDesc.trim() && !newInputWt)}
                  style={{ background: (!newInputDesc.trim() && !newInputWt) ? C.medBrown : C.tan, border: 'none', borderRadius: 3, padding: '0.32rem 0.7rem', color: C.dark, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', opacity: addingInput ? 0.6 : 1 }}
                >
                  + Add
                </button>
              </div>
              {/* Input list */}
              <div style={{ maxHeight: 150, overflowY: 'auto' }}>
                {inputs.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'rgba(166,120,90,0.4)', fontSize: '0.78rem', padding: '0.65rem', fontStyle: 'italic' }}>
                    No inputs yet — scan a CMC box label or add manually
                  </div>
                ) : inputs.map(inp => (
                  <div key={inp.id} style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', padding: '0.28rem 0.15rem', borderBottom: '1px solid rgba(166,120,90,0.07)' }}>
                    <span style={{ fontSize: '0.78rem', flexShrink: 0 }}>
                      {inp.input_type === 'premade' ? '📦' : inp.input_type === 'carcass' ? '🐄' : '🥩'}
                    </span>
                    <span style={{ flex: 1, color: C.cream, fontSize: '0.82rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {inp.description || inp.box_identifier || '—'}
                    </span>
                    {inp.box_identifier && (
                      <span style={{ fontSize: '0.68rem', color: C.lightBrown, fontFamily: 'monospace', flexShrink: 0 }}>{inp.box_identifier}</span>
                    )}
                    {inp.weight_lbs != null && (
                      <span style={{ color: C.tan, fontSize: '0.82rem', fontFamily: 'monospace', flexShrink: 0 }}>{Number(inp.weight_lbs).toFixed(2)} lb</span>
                    )}
                    <button
                      onClick={() => removeInput(inp.id)}
                      style={{ background: 'none', border: 'none', color: 'rgba(166,120,90,0.35)', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, padding: '0 0.15rem', flexShrink: 0 }}
                    >×</button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Scan list */}
        <div style={{ flex: 1, overflowY: 'auto', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(166,120,90,0.12)', borderRadius: 4, minHeight: 0 }}>
          {scans.length === 0 ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: C.lightBrown, fontSize: '0.88rem', fontStyle: 'italic', padding: '2rem', textAlign: 'center' }}>
              {activeBox?.is_closed ? 'Box is closed' : isOpen ? 'Ready — start scanning' : 'Select a box above'}
            </div>
          ) : scans.map((scan, i) => (
            <div
              key={scan.id}
              style={{
                padding: '0.75rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.08)',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                background: i === 0 && flash === 'ok' ? 'rgba(76,175,80,0.07)' : 'transparent',
                transition: 'background 0.5s',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', minWidth: 0 }}>
                <span style={{ color: 'rgba(166,120,90,0.4)', fontSize: '0.72rem', fontFamily: 'monospace', flexShrink: 0, minWidth: 24, textAlign: 'right' }}>
                  {scans.length - i}
                </span>
                <span style={{ color: C.cream, fontSize: '0.95rem', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {scan.item_name || `PLU ${scan.plu_number}`}
                </span>
                <span style={{ color: C.lightBrown, fontSize: '0.75rem', fontFamily: 'monospace', flexShrink: 0 }}>
                  PLU {scan.plu_number}
                </span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexShrink: 0 }}>
                <span style={{ color: C.tan, fontWeight: 700, fontFamily: 'monospace', fontSize: '0.95rem' }}>
                  {Number(scan.weight_lbs).toFixed(2)} lb
                </span>
                {!activeBox?.is_closed && (
                  <button
                    onClick={() => removeScan(scan.id)}
                    style={{ background: 'none', border: 'none', color: 'rgba(166,120,90,0.4)', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0 0.2rem' }}
                    title="Remove"
                  >×</button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>
            {boxes.filter(b => b.is_closed).length} box{boxes.filter(b => b.is_closed).length !== 1 ? 'es' : ''} closed · {closedWeight.toFixed(2)} lbs sealed
          </span>
          <span style={{ color: C.cream, fontWeight: 700, fontSize: '1.15rem', fontFamily: 'monospace' }}>
            {totalWeight.toFixed(2)} lbs
          </span>
        </div>

      </div>
    </div>
  )
}
