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

  // ── Recent sessions (for setup screen) ───────────────────────────────────────
  const [recentSessions, setRecentSessions] = useState<{ customer: string; date: string; boxCount: number; closed: number }[]>([])

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

  // ── Load PLU database + recent sessions once ────────────────────────────────
  useEffect(() => {
    fetch('/api/boxes?recent=1')
      .then(r => r.json())
      .then((data: unknown) => {
        if (!Array.isArray(data)) return
        const boxes = data as BoxRecord[]
        // Group by customer_name + pack_date, most recent first
        const map = new Map<string, { customer: string; date: string; boxCount: number; closed: number }>()
        for (const b of boxes) {
          const key = `${b.customer_name}|${b.pack_date}`
          if (!map.has(key)) map.set(key, { customer: b.customer_name, date: b.pack_date, boxCount: 0, closed: 0 })
          const s = map.get(key)!
          s.boxCount++
          if (b.is_closed) s.closed++
        }
        setRecentSessions([...map.values()].slice(0, 8))
      })
      .catch(() => {})
  }, [])

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
    // Load any inputs already logged for this customer/date
    fetch(`/api/processing/inputs?customer_name=${encodeURIComponent(customer.trim())}&session_date=${date}`)
      .then(r => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setInputs(data as ProcessingInput[]) })
      .catch(() => {})
  }

  // ── Reopen an existing session ───────────────────────────────────────────────
  async function startSessionFromExisting(cust: string, dt: string) {
    if (!pluLoaded) return
    setCustomer(cust)
    setDate(dt)
    setStarted(true)
    const res = await fetch(`/api/boxes?customer_name=${encodeURIComponent(cust)}&date=${dt}`)
    const loadedBoxes: BoxRecord[] = await res.json().catch(() => [])
    const sorted = [...loadedBoxes].sort((a, b) => a.box_number - b.box_number)
    setBoxes(sorted)
    // Active box: first open one, else last box
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
    // Fetch all scans for every box in this session
    const allScans: ScanLine[] = []
    for (const box of boxes) {
      const res  = await fetch(`/api/boxes/scans?box_id=${box.id}`)
      const data = await res.json().catch(() => [])
      if (Array.isArray(data)) allScans.push(...(data as ScanLine[]))
    }

    // Group by item name
    const grouped: Record<string, { plu: string; count: number; weight: number }> = {}
    for (const scan of allScans) {
      const key = scan.item_name || `PLU ${scan.plu_number}`
      if (!grouped[key]) grouped[key] = { plu: scan.plu_number, count: 0, weight: 0 }
      grouped[key].count  += scan.quantity ?? 1
      grouped[key].weight += Number(scan.weight_lbs) || 0
    }

    const allItems  = Object.entries(grouped).sort((a, b) => b[1].weight - a[1].weight)
    const grandLbs  = allItems.reduce((s, [, v]) => s + v.weight, 0)
    const grandPkgs = allItems.reduce((s, [, v]) => s + v.count, 0)

    // Group items by detected species
    const speciesOrder = ['Beef', 'Pork', 'Lamb', 'Goat', 'Wild Game', 'Processed', 'Cheese', 'Wholesale', 'Other']
    const spGroups: Record<string, typeof allItems> = {}
    for (const item of allItems) {
      const sp = detectSpecies(item[1].plu) || 'Other'
      if (!spGroups[sp]) spGroups[sp] = []
      spGroups[sp].push(item)
    }

    // Build species table rows
    const speciesHTML = speciesOrder
      .filter(sp => spGroups[sp]?.length)
      .map(sp => {
        const spItems = spGroups[sp]
        const spLbs   = spItems.reduce((s, [, v]) => s + v.weight, 0)
        const spPkgs  = spItems.reduce((s, [, v]) => s + v.count, 0)
        const pct     = grandLbs > 0 ? (spLbs / grandLbs * 100).toFixed(1) : '0.0'
        const rows = spItems.map(([name, v]) => `
          <tr class="item">
            <td class="name">${name}</td>
            <td class="num">${v.count}</td>
            <td class="num">${v.weight.toFixed(2)}</td>
            <td class="num">${grandLbs > 0 ? (v.weight / grandLbs * 100).toFixed(1) : '0.0'}%</td>
          </tr>`).join('')
        return `
          <tr class="sp-hdr"><td colspan="4">${sp.toUpperCase()}</td></tr>
          ${rows}
          <tr class="sp-sub">
            <td>Subtotal</td>
            <td class="num">${spPkgs}</td>
            <td class="num">${spLbs.toFixed(2)}</td>
            <td class="num">${pct}%</td>
          </tr>`
      }).join('')

    // Box summary rows
    const boxRows = boxes.map(b => `
      <tr>
        <td>Box ${b.box_number}${b.is_final ? ' ★' : ''}</td>
        <td class="num">${b.is_closed ? '✓ Closed' : 'Open'}</td>
        <td class="num">${b.total_cuts != null ? b.total_cuts : '—'}</td>
        <td class="num">${b.total_weight_lbs ? Number(b.total_weight_lbs).toFixed(2) : '—'}</td>
      </tr>`).join('')

    // Inputs section
    const inputLbs = inputs.reduce((s, i) => s + (Number(i.weight_lbs) || 0), 0)
    const yieldCalc = inputLbs > 0 ? (grandLbs / inputLbs * 100).toFixed(1) : null
    const inputsHTML = inputLbs > 0 ? `
      <div class="yield-bar">
        <div>
          <span class="meta-label">Input Weight</span>
          <strong>${inputLbs.toFixed(2)} lbs</strong>
          <span style="margin-left:12px;color:#555;font-size:9pt">${inputs.map(i => i.description || i.box_identifier || 'item').join(', ')}</span>
        </div>
        <div style="text-align:right">
          <span class="meta-label">Packaged</span>
          <strong>${grandLbs.toFixed(2)} lbs</strong>
          <span style="margin-left:12px"><strong>Yield: ${yieldCalc}%</strong></span>
        </div>
      </div>` : ''

    const dateStr = new Date(date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8">
<title>Cut-Out Report — ${customer} — ${date}</title>
<style>
  @page { size: letter portrait; margin: 0.75in }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: Arial, sans-serif; color: #000; font-size: 10pt }
  .hdr { text-align: center; border-bottom: 2pt solid #000; padding-bottom: 10px; margin-bottom: 12px }
  .company { font-size: 15pt; font-weight: bold; letter-spacing: 0.08em; text-transform: uppercase }
  .title { font-size: 11pt; letter-spacing: 0.14em; text-transform: uppercase; margin-top: 3px; color: #333 }
  .meta { display: flex; justify-content: space-between; margin: 10px 0 4px; font-size: 9.5pt }
  .meta-block { }
  .meta-label { font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.1em; color: #666; display: block; margin-bottom: 1px }
  .meta-val { font-weight: bold; font-size: 12pt }
  .yield-bar { background: #f4f4f4; border: 1px solid #ccc; border-radius: 3px; padding: 7px 12px; margin: 10px 0; display: flex; justify-content: space-between; align-items: center; font-size: 10pt }
  .sec-title { font-size: 8pt; font-weight: bold; text-transform: uppercase; letter-spacing: 0.12em; color: #555; margin: 14px 0 5px; border-bottom: 1px solid #ccc; padding-bottom: 3px }
  table { width: 100%; border-collapse: collapse; font-size: 9.5pt }
  th { font-size: 8pt; text-transform: uppercase; letter-spacing: 0.08em; border-bottom: 1.5pt solid #000; padding: 4px 6px; text-align: left }
  th.num, td.num { text-align: right }
  tr.sp-hdr td { background: #ebebeb; font-weight: bold; font-size: 8.5pt; padding: 4px 6px; letter-spacing: 0.06em }
  tr.item td { padding: 3px 6px; border-bottom: 1px solid #eee }
  tr.item td.name { padding-left: 18px }
  tr.sp-sub td { padding: 3px 6px; font-style: italic; border-top: 1px solid #bbb; border-bottom: 1.5pt solid #000; color: #444 }
  .grand { display: flex; justify-content: space-between; font-size: 13pt; font-weight: bold; border-top: 2pt solid #000; padding-top: 7px; margin: 4px 0 16px }
  .box-tbl td { padding: 3px 6px; border-bottom: 1px solid #eee; font-size: 9pt }
  .footer { margin-top: 24px; font-size: 7.5pt; color: #888; text-align: center; border-top: 1px solid #ddd; padding-top: 8px }
</style></head><body>

<div class="hdr">
  <div class="company">Cowboy Meat Company</div>
  <div class="title">Cut-Out Report</div>
</div>

<div class="meta">
  <div class="meta-block">
    <span class="meta-label">Customer</span>
    <span class="meta-val">${customer}</span>
  </div>
  <div class="meta-block" style="text-align:center">
    <span class="meta-label">Pack Date</span>
    <span class="meta-val">${dateStr}</span>
  </div>
  <div class="meta-block" style="text-align:right">
    <span class="meta-label">Total Packaged</span>
    <span class="meta-val">${grandLbs.toFixed(2)} lbs</span>
  </div>
</div>

${inputsHTML}

<div class="sec-title">Cut-Out Breakdown</div>
<table>
  <thead>
    <tr>
      <th>Item</th>
      <th class="num">Pkgs</th>
      <th class="num">Weight (lbs)</th>
      <th class="num">% of Total</th>
    </tr>
  </thead>
  <tbody>${speciesHTML}</tbody>
</table>

<div class="grand">
  <span>${grandPkgs} packages total</span>
  <span>${grandLbs.toFixed(2)} lbs</span>
</div>

<div class="sec-title">Box Summary</div>
<table class="box-tbl">
  <thead>
    <tr>
      <th>Box</th>
      <th class="num">Status</th>
      <th class="num">Cuts</th>
      <th class="num">Weight (lbs)</th>
    </tr>
  </thead>
  <tbody>${boxRows}</tbody>
</table>

<div class="footer">
  Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660<br>
  Generated ${new Date().toLocaleString('en-US')}
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
    return (
      <div style={{ minHeight: '100dvh', background: C.dark, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
        <div style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 8, padding: '2.5rem', width: '100%', maxWidth: 400 }}>

          <div style={{ textAlign: 'center', marginBottom: '2rem' }}>
            <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🔍</div>
            <h1 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.4rem', textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 0.5rem' }}>
              Processing Scanner
            </h1>
            <div style={{ fontSize: '0.78rem', color: pluLoaded ? C.green : C.yellow, fontWeight: 600 }}>
              {pluLoaded
                ? `✓ ${Object.keys(pluMap).length} PLUs loaded`
                : '⟳ Loading PLU database…'}
            </div>
          </div>

          <div style={{ marginBottom: '1rem' }}>
            <label style={LBL}>Customer</label>
            <input
              autoFocus
              style={INPUT}
              value={customer}
              onChange={e => setCustomer(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && customer.trim() && pluLoaded) startSession() }}
              placeholder="Customer name"
            />
          </div>

          <div style={{ marginBottom: '1.75rem' }}>
            <label style={LBL}>Pack Date</label>
            <input
              type="date"
              style={{ ...INPUT, fontSize: '1rem' }}
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>

          <button
            onClick={startSession}
            disabled={!customer.trim() || !pluLoaded}
            style={{
              width: '100%', background: customer.trim() && pluLoaded ? C.tan : C.medBrown,
              color: C.dark, border: 'none', borderRadius: 4, padding: '0.9rem',
              fontSize: '1rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
              cursor: customer.trim() && pluLoaded ? 'pointer' : 'not-allowed',
              opacity: customer.trim() && pluLoaded ? 1 : 0.6,
            }}
          >
            Start Scanning
          </button>

          {/* Recent sessions */}
          {recentSessions.length > 0 && (
            <div style={{ marginTop: '1.5rem', borderTop: '1px solid rgba(166,120,90,0.2)', paddingTop: '1.25rem' }}>
              <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.6rem' }}>
                Reopen Recent Session
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
                {recentSessions.map(s => (
                  <button
                    key={`${s.customer}|${s.date}`}
                    onClick={() => startSessionFromExisting(s.customer, s.date)}
                    disabled={!pluLoaded}
                    style={{
                      background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.22)',
                      borderRadius: 4, padding: '0.55rem 0.85rem', cursor: 'pointer',
                      display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                      opacity: pluLoaded ? 1 : 0.5,
                    }}
                  >
                    <div style={{ textAlign: 'left' }}>
                      <div style={{ color: C.cream, fontSize: '0.88rem', fontWeight: 600 }}>{s.customer}</div>
                      <div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>
                        {new Date(s.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right', fontSize: '0.72rem', color: s.closed === s.boxCount && s.boxCount > 0 ? C.green : C.tan }}>
                      <div>{s.boxCount} box{s.boxCount !== 1 ? 'es' : ''}</div>
                      <div>{s.closed}/{s.boxCount} closed</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div style={{ marginTop: '1.5rem', textAlign: 'center' }}>
            <Link href="/processing" style={{ color: C.lightBrown, fontSize: '0.8rem', textDecoration: 'none' }}>
              ← Back to Processing
            </Link>
          </div>
        </div>
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
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '0.85rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.1em' }}>CMC Scanner</span>
          <span style={{ color: C.cream, fontWeight: 700, fontSize: '1rem' }}>{customer}</span>
          <span style={{ color: C.lightBrown, fontSize: '0.82rem' }}>{date}</span>
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
              {reportLoading ? '⟳ Building…' : '📋 Cut-Out Report'}
            </button>
          )}
          <Link href="/processing" style={{ color: C.lightBrown, fontSize: '0.78rem', textDecoration: 'none' }}>Processing ›</Link>
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
