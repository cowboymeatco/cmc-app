'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'
import { matchCureTag, type ProcessingInput, type CureTag, type CureTagRoll } from '@/lib/types'
import { isoDate } from '@/lib/dates'

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

// Returns PLU from a Hobart-format barcode even when weight is 0 (box/each products)
function decodePluFromBarcode(barcode: string): string | null {
  if (barcode.length !== 13 || !/^\d{13}$/.test(barcode) || barcode[0] !== '2') return null
  const plu = parseInt(barcode.substring(1, 6), 10)
  return plu > 0 ? String(plu) : null
}

// baker_storage = hauled to the Baker storage locker — out of our freezer but not
// yet in the customer's hands, and accruing a monthly storage fee.
type SessionStatus = 'scanning' | 'value_add' | 'complete' | 'baker_storage' | 'picked_up'

interface SessionWithStats {
  id:             string | null
  customer_name:  string
  session_date:   string
  status:         SessionStatus
  notes:          string
  box_type?:      BoxType | null
  pickup_date?:   string | null
  box_count:      number
  closed_count:   number
  total_weight:   number
  total_cuts:     number
  animals?:       string[]   // carcass input descriptions, e.g. "Beef — Tag 06 (Holdbrook)"
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
  serial_number?:   string
  box_label?:       string | null
  order_id?:        string | null
}

interface RetailOrderItem {
  id: string; plu_number: string | null; item_name: string
  unit: string; qty_ordered: number; qty_filled: number; notes?: string | null
}
interface RetailOrderLite {
  id: string; customer_name: string; due_date: string; status: string
  fulfillment_type?: string; notes?: string | null
  retail_order_items?: RetailOrderItem[]
}

interface ScanLine {
  id:         string
  box_id:     string
  plu_number: string
  item_name:  string
  weight_lbs: number
  quantity:   number
}

// Quarter-aware yield: response from /api/processing/yield when this session
// shares a carcass half (same tag identifier) with other sessions.
interface SharedYield {
  partners:           { customer_name: string; session_date: string; output_lbs: number }[]
  pool_input_lbs:     number
  other_output_lbs:   number
  shared_identifiers: Record<string, string[]>
}

interface LabelFlags { usda_bug: boolean; retail_exempt: boolean; not_for_sale: boolean }
const DEFAULT_FLAGS: LabelFlags = { usda_bug: true, retail_exempt: false, not_for_sale: false }

// A session's compliance/ownership type, picked once up front and sticky for
// every box in it. USDA + CMC print the USDA bug (both inspected, for sale);
// Custom (custom-exempt) prints NOT FOR SALE. Drives the label mark server-side.
type BoxType = 'USDA' | 'Custom' | 'CMC'
const BOX_TYPES: BoxType[] = ['USDA', 'Custom', 'CMC']
// Map a box type onto the two compliance-mark flags, leaving retail_exempt (an
// independent add-on badge) untouched.
function flagsForType(t: BoxType, prev: LabelFlags): LabelFlags {
  return { ...prev, usda_bug: t !== 'Custom', not_for_sale: t === 'Custom' }
}

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

// ── Packout report builder ─────────────────────────────────────────────────────
// One shared builder for both report buttons. Produces a 3-page print report that
// mirrors the Excel workbook: Packout Slip (every package), By Box (items per box),
// and Weight Summary (items totalled across all boxes + a pie chart).
const PIE_COLORS = [
  '#4472C4', '#ED7D31', '#A5A5A5', '#FFC000', '#5B9BD5', '#70AD47', '#264478', '#9E480E',
  '#636363', '#997300', '#255E91', '#43682B', '#698ED0', '#F1975A', '#B7B7B7', '#FFCD33',
  '#7CAFDD', '#8CC168', '#327DC2', '#C6600C',
]

function esc(s: string): string {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function fmtDue(iso: string): string {
  if (!iso) return '—'
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

function buildPackoutHTML(
  customer: string,
  dateISO: string,
  sortedBoxes: BoxRecord[],
  allScans: (ScanLine & { boxNum: number })[],
): string {
  const dateStr   = new Date(dateISO + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  const grandLbs  = allScans.reduce((t, sc) => t + (Number(sc.weight_lbs) || 0), 0)
  const grandPkgs = allScans.length
  const boxCount  = sortedBoxes.length

  // ── Page 1: Packout Slip — every individual package ──
  const lineRows = allScans.map((sc, i) => `
      <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
        <td class="num">${i + 1}</td>
        <td>${esc(sc.item_name || `PLU ${sc.plu_number}`)}</td>
        <td class="num mono">${esc(sc.plu_number)}</td>
        <td class="num mono">${(Number(sc.weight_lbs) || 0).toFixed(2)}</td>
        <td class="num">${sc.boxNum}</td>
      </tr>`).join('')

  // ── Page 2: By Box — items aggregated within each box ──
  const byBox = sortedBoxes.map(box => {
    const boxScans = allScans.filter(sc => sc.boxNum === box.box_number)
    const agg: Record<string, { weight: number; pieces: number }> = {}
    for (const sc of boxScans) {
      const key = sc.item_name || `PLU ${sc.plu_number}`
      if (!agg[key]) agg[key] = { weight: 0, pieces: 0 }
      agg[key].weight += Number(sc.weight_lbs) || 0
      agg[key].pieces += sc.quantity ?? 1
    }
    const rows   = Object.entries(agg).sort((a, b) => b[1].weight - a[1].weight)
    const boxLbs = boxScans.reduce((t, sc) => t + (Number(sc.weight_lbs) || 0), 0)
    const boxPcs = boxScans.reduce((t, sc) => t + (sc.quantity ?? 1), 0)
    const itemRows = rows.map(([name, v]) => `
        <tr>
          <td>${esc(name)}</td>
          <td class="num">${v.pieces}</td>
          <td class="num mono">${v.weight.toFixed(2)}</td>
        </tr>`).join('')
    return `
    <div class="box-block">
      <div class="box-head">Box ${box.box_number}${box.is_final ? ' ★' : ''}${box.box_label ? ` &nbsp;—&nbsp; ${esc(box.box_label)}` : ''}</div>
      <table>
        <thead><tr><th>Item Name</th><th class="num"># Pieces</th><th class="num">Weight (lbs)</th></tr></thead>
        <tbody>${itemRows}
        <tr class="subtotal"><td>Box ${box.box_number} total</td><td class="num">${boxPcs}</td><td class="num mono">${boxLbs.toFixed(2)}</td></tr>
        </tbody>
      </table>
    </div>`
  }).join('')

  // ── Page 3: Weight Summary — items totalled across all boxes + pie chart ──
  const summaryMap: Record<string, { weight: number; pieces: number }> = {}
  for (const sc of allScans) {
    const key = sc.item_name || `PLU ${sc.plu_number}`
    if (!summaryMap[key]) summaryMap[key] = { weight: 0, pieces: 0 }
    summaryMap[key].weight += Number(sc.weight_lbs) || 0
    summaryMap[key].pieces += sc.quantity ?? 1
  }
  const summary       = Object.entries(summaryMap).sort((a, b) => b[1].weight - a[1].weight)
  const summaryTotal  = summary.reduce((t, [, v]) => t + v.weight, 0) || 1
  const summaryPieces = summary.reduce((t, [, v]) => t + v.pieces, 0)

  const summaryRows = summary.map(([name, v], i) => `
      <tr class="${i % 2 === 0 ? 'even' : 'odd'}">
        <td><span class="swatch" style="background:${PIE_COLORS[i % PIE_COLORS.length]}"></span>${esc(name)}</td>
        <td class="num mono">${v.weight.toFixed(2)}</td>
        <td class="num">${v.pieces}</td>
        <td class="num">${((v.weight / summaryTotal) * 100).toFixed(1)}%</td>
      </tr>`).join('')

  // Hand-drawn SVG pie (no charting dependency) — slices start at 12 o'clock.
  const cx = 150, cy = 150, r = 130
  let angle = -Math.PI / 2
  let slices = ''
  let labels = ''
  summary.forEach(([, v], i) => {
    const frac  = v.weight / summaryTotal
    const start = angle
    const end   = angle + frac * Math.PI * 2
    angle = end
    const color = PIE_COLORS[i % PIE_COLORS.length]
    if (summary.length === 1) {
      slices += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${color}"/>`
    } else {
      const large = end - start > Math.PI ? 1 : 0
      const x1 = cx + r * Math.cos(start), y1 = cy + r * Math.sin(start)
      const x2 = cx + r * Math.cos(end),   y2 = cy + r * Math.sin(end)
      slices += `<path d="M ${cx} ${cy} L ${x1.toFixed(2)} ${y1.toFixed(2)} A ${r} ${r} 0 ${large} 1 ${x2.toFixed(2)} ${y2.toFixed(2)} Z" fill="${color}" stroke="#fff" stroke-width="1.5"/>`
    }
    if (frac >= 0.03) {
      const mid = (start + end) / 2
      const lx  = cx + r * 0.62 * Math.cos(mid)
      const ly  = cy + r * 0.62 * Math.sin(mid)
      labels += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" font-size="12" font-weight="bold" fill="#fff">${(frac * 100).toFixed(0)}%</text>`
    }
  })
  const pieSvg = `<svg width="300" height="300" viewBox="0 0 300 300" xmlns="http://www.w3.org/2000/svg">${slices}${labels}</svg>`

  return `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>CMC Packout — ${esc(customer)} — ${dateISO}</title>
<style>
  @page { size: letter portrait; margin: 0.75in }
  * { box-sizing: border-box; margin: 0; padding: 0 }
  body { font-family: Arial, sans-serif; color: #000; font-size: 10pt }
  .page { page-break-after: always }
  .page:last-child { page-break-after: auto }
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
  .section-title { font-size: 12pt; font-weight: bold; letter-spacing: 0.1em; text-transform: uppercase }
  .box-block { margin-bottom: 16px; page-break-inside: avoid }
  .box-head { font-size: 10.5pt; font-weight: bold; margin-bottom: 4px }
  tr.subtotal td { border-top: 1pt solid #999; font-weight: bold }
  .swatch { display: inline-block; width: 9px; height: 9px; margin-right: 6px; border: 0.5pt solid #999; vertical-align: middle }
  .summary-wrap { display: flex; gap: 24px; align-items: flex-start; margin-top: 12px }
  .pie-box { flex-shrink: 0; text-align: center }
  .pie-cap { font-size: 9.5pt; font-weight: bold; margin-bottom: 6px }
  .summary-table { flex: 1 }
</style></head><body>

<div class="page">
  <div class="hdr">
    <div class="company">Cowboy Meat Company</div>
    <div class="sub">Forsyth, Montana &nbsp;·&nbsp; cowboymeats.com</div>
    <div class="title">Packout Slip</div>
  </div>
  <div class="cust">
    <span><strong>Customer:</strong> &nbsp;${esc(customer)}</span>
    <span><strong>Date:</strong> &nbsp;${dateStr}</span>
  </div>
  <table>
    <thead><tr><th class="num">#</th><th>Item Name</th><th class="num">PLU</th><th class="num">Weight (lbs)</th><th class="num">Box #</th></tr></thead>
    <tbody>${lineRows}
      <tr class="total-row"><td colspan="3">TOTAL &nbsp;—&nbsp; ${grandPkgs} item${grandPkgs !== 1 ? 's' : ''}</td><td class="num mono">${grandLbs.toFixed(2)}</td><td></td></tr>
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
</div>

<div class="page">
  <div class="hdr"><div class="company">Cowboy Meat Company</div><div class="title">By Box</div></div>
  <div class="cust"><span><strong>Customer:</strong> &nbsp;${esc(customer)}</span><span><strong>Date:</strong> &nbsp;${dateStr}</span></div>
  ${byBox}
</div>

<div class="page">
  <div class="hdr"><div class="company">Cowboy Meat Company</div><div class="title">Weight Summary</div></div>
  <div class="cust"><span><strong>Customer:</strong> &nbsp;${esc(customer)}</span><span><strong>Date:</strong> &nbsp;${dateStr}</span></div>
  <div class="summary-wrap">
    <div class="pie-box">
      <div class="pie-cap">Weight Distribution — ${esc(customer)}</div>
      ${pieSvg}
    </div>
    <div class="summary-table">
      <table>
        <thead><tr><th>Item Name</th><th class="num">Total Weight (lbs)</th><th class="num"># of Pieces</th><th class="num">%</th></tr></thead>
        <tbody>${summaryRows}
          <tr class="total-row"><td>TOTAL</td><td class="num mono">${grandLbs.toFixed(2)}</td><td class="num">${summaryPieces}</td><td class="num">100%</td></tr>
        </tbody>
      </table>
    </div>
  </div>
</div>

<script>window.onload = () => window.print()</script>
</body></html>`
}

export default function ScannerPage() {
  // ── PLU cache ────────────────────────────────────────────────────────────────
  const [pluMap,    setPluMap]    = useState<Record<string, string>>({})
  // Deleted PLUs still resident on the Hobart (imports merge — deletions never
  // propagate to the scale), kept so a scan resolves to a name + warning
  // instead of "Unknown Item".
  const [retiredPluMap, setRetiredPluMap] = useState<Record<string, string>>({})
  const [pluLoaded, setPluLoaded] = useState(false)

  // ── Session ──────────────────────────────────────────────────────────────────
  const [customer, setCustomer] = useState('')
  const [date,     setDate]     = useState(isoDate())
  const [started,  setStarted]  = useState(false)
  // Inline rename of the open session's customer (header)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft,   setNameDraft]   = useState('')
  const [renameBusy,  setRenameBusy]  = useState(false)

  // ── Boxes / scans ────────────────────────────────────────────────────────────
  const [boxes,     setBoxes]     = useState<BoxRecord[]>([])
  const [activeBox, setActiveBox] = useState<BoxRecord | null>(null)
  const [scans,     setScans]     = useState<ScanLine[]>([])   // newest first

  // ── Retail orders (to tie a box back to an order) ────────────────────────────
  const [orders,          setOrders]          = useState<RetailOrderLite[]>([])
  const [showOrderPicker, setShowOrderPicker] = useState(false)
  const loadOrders = useCallback(async () => {
    try {
      const res  = await fetch('/api/orders')
      const data = await res.json()
      // Open orders only — anything not yet fulfilled can still be packed against.
      setOrders(Array.isArray(data) ? (data as RetailOrderLite[]).filter(o => o.status !== 'fulfilled') : [])
    } catch { setOrders([]) }
  }, [])

  // ── Scan input ───────────────────────────────────────────────────────────────
  const [scanValue,   setScanValue]   = useState('')
  const [flash,       setFlash]       = useState<'ok' | 'warn' | 'bad' | null>(null)
  const [lastItem,    setLastItem]    = useState('')
  const [lastKind,    setLastKind]    = useState<'ok' | 'warn' | 'bad'>('ok')   // icon/color for lastItem after the flash fades
  const [processing,  setProcessing]  = useState(false)
  const [labelFlags,  setLabelFlags]  = useState<LabelFlags>(DEFAULT_FLAGS)
  // Session box type — declared up front, sticky for every box in the session.
  const [boxType,     setBoxType]     = useState<BoxType>('USDA')

  // ── Inputs ───────────────────────────────────────────────────────────────────
  const [inputs,       setInputs]       = useState<ProcessingInput[]>([])
  const [showInputs,   setShowInputs]   = useState(false)
  const [newInputDesc,  setNewInputDesc]  = useState('')
  const [newInputWt,    setNewInputWt]    = useState('')
  const [newInputNotes, setNewInputNotes] = useState('')
  const [newInputType,  setNewInputType]  = useState<'raw' | 'premade' | 'carcass'>('raw')
  const [addingInput,   setAddingInput]   = useState(false)

  // ── Weight entry modal (box products with no embedded weight) ────────────────
  const [weightModal, setWeightModal] = useState<{ plu: string; itemName: string } | null>(null)
  const [weightEntry, setWeightEntry] = useState('')
  const weightInputRef = useRef<HTMLInputElement>(null)

  // ── Cure tag intake ──────────────────────────────────────────────────────────
  // Numbered tamper seals zip-tied to hams/bacons headed to the cure cooler.
  // A scanned seal number opens the product picker; the piece leaves with the
  // customer's name riding on the tag. Registered rolls (the printed number
  // ranges) are what make a bare digit string recognizable as a seal.
  const [cureRolls,   setCureRolls]   = useState<CureTagRoll[]>([])
  const [cureModal,   setCureModal]   = useState<{ tagNumber: string; existing: CureTag | null } | null>(null)
  const [cureWeight,  setCureWeight]  = useState('')
  const [cureSaving,  setCureSaving]  = useState(false)

  // ── Session management ─────────────────────────────────��──────────────────────
  const [sessions,         setSessions]         = useState<SessionWithStats[]>([])
  const [sessionsLoading,  setSessionsLoading]  = useState(true)
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [currentStatus,    setCurrentStatus]    = useState<SessionStatus>('scanning')
  const [showNewForm,      setShowNewForm]      = useState(false)
  const [showAllFreezer,   setShowAllFreezer]   = useState(false)
  const [showAllBaker,     setShowAllBaker]     = useState(false)
  const [showAllPickedUp,  setShowAllPickedUp]  = useState(false)
  const [sessionQuery,     setSessionQuery]     = useState('')
  const [statusFilter,     setStatusFilter]     = useState<SessionStatus | 'all'>('all')
  const [sharedYield,      setSharedYield]      = useState<SharedYield | null>(null)
  const [mergeSource,      setMergeSource]      = useState<SessionWithStats | null>(null)
  const [mergeBusy,        setMergeBusy]        = useState(false)

  // ── Box reassignment (right-click a box tab) ─────────────────────────────────
  const [boxMenu,          setBoxMenu]          = useState<{ box: BoxRecord; x: number; y: number } | null>(null)
  const [reassignBox,      setReassignBox]      = useState<BoxRecord | null>(null)
  const [reassignBusy,     setReassignBusy]     = useState(false)
  const [reassignNewName,  setReassignNewName]  = useState('')

  // ── Repack (move cuts between boxes) ─────────────────────────────────────────
  const [repackBox,        setRepackBox]        = useState<BoxRecord | null>(null)
  const [repackScans,      setRepackScans]      = useState<ScanLine[]>([])
  const [repackPicked,     setRepackPicked]     = useState<Set<string>>(new Set())
  const [repackTarget,     setRepackTarget]     = useState<string>('new')   // box id, or 'new'
  const [repackBusy,       setRepackBusy]       = useState(false)

  const scanRef       = useRef<HTMLInputElement>(null)
  // Stable refs so event listeners don't go stale
  const activeBoxRef  = useRef<BoxRecord | null>(null)
  const pluMapRef     = useRef<Record<string, string>>({})
  const retiredPluRef = useRef<Record<string, string>>({})
  const processingRef = useRef(false)
  const scansRef      = useRef<ScanLine[]>([])
  const startedRef    = useRef(false)
  const inputsRef     = useRef<ProcessingInput[]>([])
  const cureRollsRef  = useRef<CureTagRoll[]>([])

  activeBoxRef.current  = activeBox
  pluMapRef.current     = pluMap
  retiredPluRef.current = retiredPluMap
  processingRef.current = processing
  scansRef.current      = scans
  startedRef.current    = started
  inputsRef.current     = inputs
  cureRollsRef.current  = cureRolls

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
  useEffect(() => { loadOrders() }, [loadOrders])

  // Registered seal rolls — loaded once; no rolls registered means no digit
  // string ever reads as a cure tag, so nothing changes until seals arrive.
  useEffect(() => {
    fetch('/api/cure-tags/rolls')
      .then(r => r.json())
      .then(d => { if (Array.isArray(d)) setCureRolls(d) })
      .catch(() => {})
  }, [])

  // ── Quarter-aware yield ───────────────────────────────────────────────────────
  // When a carcass half in this session's inputs is also scanned in another
  // session (two customers splitting a half into quarters), the per-session
  // yield double-counts the half. This pulls the pool so we can judge the
  // half against everything pulling from it.
  const loadSharedYield = useCallback(async (cust: string, dt: string) => {
    try {
      const res = await fetch(`/api/processing/yield?customer_name=${encodeURIComponent(cust)}&session_date=${dt}`)
      const d   = await res.json()
      setSharedYield(d?.shared ? d as SharedYield : null)
    } catch { setSharedYield(null) }
  }, [])

  useEffect(() => {
    fetch('/api/processing')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          const map: Record<string, string> = {}
          const retired: Record<string, string> = {}
          for (const item of data as { plu_number?: string; item_name?: string; active?: boolean }[]) {
            if (!item.plu_number) continue
            if (item.active === false) retired[String(item.plu_number)] = item.item_name ?? ''
            else map[String(item.plu_number)] = item.item_name ?? ''
          }
          setPluMap(map)
          setRetiredPluMap(retired)
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
    const box = activeBoxRef.current
    if (!box || box.is_closed) return

    setFlash(null)

    const decoded = decodeBarcode(raw)
    if (!decoded) {
      // Check if it's a Hobart-format barcode with a valid PLU but no weight (box/each product)
      const plu = decodePluFromBarcode(raw)
      if (plu) {
        const itemName = pluMapRef.current[plu] ?? retiredPluRef.current[plu] ?? `PLU ${plu}`
        setWeightModal({ plu, itemName })
        setWeightEntry('')
        setTimeout(() => weightInputRef.current?.focus(), 80)
      } else {
        setFlash('bad')
        setLastKind('bad')
        setLastItem('Not a weight barcode')
        setTimeout(() => setFlash(null), 1800)
        scanRef.current?.focus()
      }
      return
    }

    const { plu, weightLbs } = decoded
    const retiredName = retiredPluRef.current[plu]
    const itemName = pluMapRef.current[plu] ?? retiredName ?? `Unknown Item (PLU ${plu})`

    processingRef.current = true
    setProcessing(true)

    try {
      const res  = await fetch('/api/boxes/scans', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ box_id: box.id, plu_number: plu, item_name: itemName, weight_lbs: weightLbs, quantity: 1 }),
      })
      if (!res.ok) throw new Error(await res.text())
      const scan: ScanLine = await res.json()
      setScans(prev => [scan, ...prev])
      if (retiredName || !pluMapRef.current[plu]) {
        // Scan is saved (the meat is in the box), but this PLU was deleted from
        // the app — the scale should no longer have it.
        setLastKind('warn')
        setLastItem(`${itemName}  ·  ${weightLbs.toFixed(2)} lb  —  DELETED PLU ${plu}: remove it from the scale`)
        setFlash('warn')
        setTimeout(() => setFlash(null), 4000)
      } else {
        setLastKind('ok')
        setLastItem(`${itemName}  ·  ${weightLbs.toFixed(2)} lb`)
        setFlash('ok')
        setTimeout(() => setFlash(null), 2000)
      }
    } catch {
      setFlash('bad')
      setLastKind('bad')
      setLastItem('Save failed — retry')
    } finally {
      setProcessing(false)
      processingRef.current = false
      scanRef.current?.focus()
    }
  }, [])

  // ── Scan queue ─────────────────────────────────────────────────────────────────
  // Scan guns fire faster than a save round-trip. Complete barcodes are queued and
  // saved one at a time, so a scan arriving mid-save is never dropped or left
  // sitting in the scan bar.
  const scanQueueRef = useRef<string[]>([])
  const pumpingRef   = useRef(false)

  const pumpScanQueue = useCallback(async () => {
    if (pumpingRef.current) return
    pumpingRef.current = true
    try {
      while (scanQueueRef.current.length > 0) {
        const code = scanQueueRef.current.shift()!
        await doScan(code)
      }
    } finally {
      pumpingRef.current = false
    }
  }, [doScan])

  // Consume complete 13-digit barcodes from the scan bar however the digits got
  // there (typed into the input, or appended by the global key redirect while a
  // save was in flight). Anything past 13 digits stays in the bar as the start of
  // the next scan.
  useEffect(() => {
    if (!/^\d{13}/.test(scanValue)) return
    const code = scanValue.slice(0, 13)
    setScanValue(scanValue.slice(13))
    scanQueueRef.current.push(code)
    pumpScanQueue()
  }, [scanValue, pumpScanQueue])

  // ── Session record helpers ───────────────────────────────────────────────────
  async function upsertSession(custName: string, sessDate: string, status = 'scanning', bt?: BoxType): Promise<string | null> {
    try {
      const res  = await fetch('/api/processing/sessions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        // Only send box_type when starting fresh — reopens omit it so a type set
        // earlier is preserved (the API drops null/undefined on upsert).
        body: JSON.stringify({ customer_name: custName, session_date: sessDate, status, ...(bt ? { box_type: bt } : {}) }),
      })
      const data = await res.json()
      return data.id ?? null
    } catch { return null }
  }

  // Change the open session's box type: sticky on the record + reflected in the
  // print flags so the on-screen chips match what will print.
  async function applyBoxType(t: BoxType) {
    setBoxType(t)
    setLabelFlags(f => flagsForType(t, f))
    if (!customer) return
    await fetch('/api/processing/sessions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: customer, session_date: date, box_type: t }),
    })
  }

  async function updateSessionStatus(status: SessionStatus) {
    setCurrentStatus(status)
    await fetch('/api/processing/sessions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: customer, session_date: date, status }),
    })
  }

  // Schedule (or clear) the customer pickup date for a finished order — shows on
  // the master calendar Pickup lane so we know who's collecting when.
  async function setPickupDate(s: SessionWithStats, pickup_date: string) {
    const next = pickup_date || null
    setSessions(prev => prev.map(x =>
      x.customer_name === s.customer_name && x.session_date === s.session_date ? { ...x, pickup_date: next } : x
    ))
    await fetch('/api/processing/sessions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: s.customer_name, session_date: s.session_date, pickup_date: next }),
    })
  }

  async function quickStatus(s: SessionWithStats, status: SessionStatus) {
    await fetch('/api/processing/sessions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: s.customer_name, session_date: s.session_date, status }),
    })
    setSessions(prev => prev.map(x =>
      x.customer_name === s.customer_name && x.session_date === s.session_date ? { ...x, status } : x
    ))
  }

  // ── Merge two sessions ────────────────────────────────────────────────────────
  // Moves every box (and its scans + inputs) from src into tgt, renumbering after
  // the target's highest box, then removes the empty src session.
  async function mergeSessions(src: SessionWithStats, tgt: SessionWithStats) {
    const boxWord = src.box_count === 1 ? 'box' : 'boxes'
    const ok = window.confirm(
      `Merge "${src.customer_name}" (${src.session_date}) into "${tgt.customer_name}" (${tgt.session_date})?\n\n` +
      `Its ${src.box_count} ${boxWord} will move into the target session and be renumbered after the target's boxes. This cannot be undone.`
    )
    if (!ok) return
    setMergeBusy(true)
    try {
      const res = await fetch('/api/processing/sessions/merge', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: { customer_name: src.customer_name, session_date: src.session_date },
          target: { customer_name: tgt.customer_name, session_date: tgt.session_date },
        }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }))
        window.alert(`Merge failed: ${d.error ?? res.statusText}`)
      }
    } catch {
      window.alert('Merge failed — network error')
    } finally {
      setMergeBusy(false)
      setMergeSource(null)
      loadSessions()
    }
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
    const html = buildPackoutHTML(s.customer_name, s.session_date, sortedBoxes, allScans)
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
  }

  // ── Start session + auto-create Box 1 ────────────────────────────────────────
  async function startSession() {
    const cust = customer.trim()
    if (!cust || !pluLoaded) return
    // Normalize the state too — a trailing space typed in the form would
    // otherwise split every later box/input onto a different session key.
    setCustomer(cust)
    setStarted(true)
    const res = await fetch('/api/boxes', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ customer_name: cust, pack_date: date, box_number: 1, is_final: false }),
    })
    const box: BoxRecord = await res.json()
    setBoxes([box])
    setActiveBox(box)
    setScans([])
    setCurrentStatus('scanning')
    setLabelFlags(flagsForType(boxType, DEFAULT_FLAGS))
    const sid = await upsertSession(cust, date, 'scanning', boxType)
    setCurrentSessionId(sid)
    setSharedYield(null)
    fetch(`/api/processing/inputs?customer_name=${encodeURIComponent(cust)}&session_date=${date}`)
      .then(r => r.json())
      .then((data: unknown) => { if (Array.isArray(data)) setInputs(data as ProcessingInput[]) })
      .catch(() => {})
    loadSharedYield(cust, date)
  }

  // ── Reopen an existing session ───────────────────────────────────────────────
  async function startSessionFromExisting(cust: string, dt: string) {
    if (!pluLoaded) return
    const existing = sessions.find(s => s.customer_name === cust && s.session_date === dt)
    const existingStatus = existing?.status ?? 'scanning'
    const existingType   = (existing?.box_type as BoxType) ?? 'USDA'
    setCustomer(cust)
    setDate(dt)
    setStarted(true)
    setCurrentStatus(existingStatus)
    setBoxType(existingType)
    setLabelFlags(flagsForType(existingType, DEFAULT_FLAGS))
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
    setSharedYield(null)
    fetch(`/api/processing/inputs?customer_name=${encodeURIComponent(cust)}&session_date=${dt}`)
      .then(r => r.json())
      .then((d: unknown) => { if (Array.isArray(d)) setInputs(d as ProcessingInput[]) })
      .catch(() => {})
    loadSharedYield(cust, dt)
  }

  // ── Rename the open session's customer ───────────────────────────────────────
  // Re-keys this session's boxes/inputs/record to the new name (same date), then
  // re-points the open view at the new key. Boxes carry the name, so we reload.
  async function renameCustomer() {
    const next = nameDraft.trim()
    setEditingName(false)
    if (!next || next === customer) { setNameDraft(customer); return }
    const prev = customer
    setRenameBusy(true)
    try {
      const res = await fetch('/api/processing/sessions/rename', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_date: date, old_name: prev, new_name: next }),
      })
      if (!res.ok) {
        const d = await res.json().catch(() => ({} as { error?: string }))
        window.alert(`Rename failed: ${d.error ?? res.statusText}`)
        setNameDraft(prev)
        return
      }
      // Re-point the open view at the new key
      setCustomer(next)
      const bRes = await fetch(`/api/boxes?customer_name=${encodeURIComponent(next)}&date=${date}`)
      const loaded: BoxRecord[] = await bRes.json().catch(() => [])
      const sorted = [...loaded].sort((a, b) => a.box_number - b.box_number)
      setBoxes(sorted)
      const openBox = sorted.find(b => b.id === activeBox?.id) ?? sorted.find(b => !b.is_closed) ?? sorted[sorted.length - 1] ?? null
      setActiveBox(openBox)
      fetch(`/api/processing/inputs?customer_name=${encodeURIComponent(next)}&session_date=${date}`)
        .then(r => r.json())
        .then((d: unknown) => { if (Array.isArray(d)) setInputs(d as ProcessingInput[]) })
        .catch(() => {})
      loadSharedYield(next, date)
    } catch {
      window.alert('Rename failed — network error')
      setNameDraft(prev)
    } finally {
      setRenameBusy(false)
    }
  }

  // ── Start a scanning session straight from an in-progress retail order ───────
  // Opens (or creates) a session for the order's customer with Box 1 pre-linked to
  // the order, so Jill's built order populates right into the scanner.
  async function startSessionFromOrder(order: RetailOrderLite) {
    if (!pluLoaded) return
    const cust = order.customer_name
    const dt   = isoDate()   // pack date = today
    const storedType = sessions.find(s => s.customer_name === cust && s.session_date === dt)?.box_type as BoxType | null | undefined
    const uiType = storedType ?? 'USDA'
    setCustomer(cust)
    setDate(dt)
    setStarted(true)
    setCurrentStatus('scanning')
    setBoxType(uiType)
    setLabelFlags(flagsForType(uiType, DEFAULT_FLAGS))
    // Pass through only a stored type — never force USDA onto a session that may
    // already be tagged Custom/CMC in a list we haven't refreshed.
    const sid = await upsertSession(cust, dt, 'scanning', storedType ?? undefined)
    setCurrentSessionId(sid)

    // Reuse an existing session's boxes for this customer+date if any, else make Box 1.
    const res = await fetch(`/api/boxes?customer_name=${encodeURIComponent(cust)}&date=${dt}`)
    let sorted = ([...(await res.json().catch(() => []))] as BoxRecord[]).sort((a, b) => a.box_number - b.box_number)
    if (sorted.length === 0) {
      const cr = await fetch('/api/boxes', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ customer_name: cust, pack_date: dt, box_number: 1, is_final: false, order_id: order.id, box_label: cust }),
      })
      sorted = [await cr.json() as BoxRecord]
    } else if (!sorted.some(b => b.order_id === order.id)) {
      // Boxes already exist but none linked yet → link the first open one.
      const target = sorted.find(b => !b.is_closed) ?? sorted[0]
      await fetch('/api/boxes', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ id: target.id, order_id: order.id, box_label: (target.box_label?.trim() || cust) }),
      })
      sorted = sorted.map(b => b.id === target.id ? { ...b, order_id: order.id, box_label: (target.box_label?.trim() || cust) } : b)
    }
    setBoxes(sorted)
    const openBox = sorted.find(b => !b.is_closed) ?? sorted[sorted.length - 1] ?? null
    setActiveBox(openBox)
    if (openBox) {
      const scanRes  = await fetch(`/api/boxes/scans?box_id=${openBox.id}`)
      const scanData = await scanRes.json().catch(() => [])
      setScans(Array.isArray(scanData) ? ([...scanData] as ScanLine[]).reverse() : [])
    } else {
      setScans([])
    }
    loadOrders()
    setSharedYield(null)
    fetch(`/api/processing/inputs?customer_name=${encodeURIComponent(cust)}&session_date=${dt}`)
      .then(r => r.json())
      .then((d: unknown) => { if (Array.isArray(d)) setInputs(d as ProcessingInput[]) })
      .catch(() => {})
    loadSharedYield(cust, dt)
  }

  // ── Add new box ───────────────────────────────────────────────────────────────
  async function addBox(isFinal: boolean) {
    if (!customer) return
    const nextNum = boxes.length > 0 ? Math.max(...boxes.map(b => b.box_number)) + 1 : 1
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

  // ── Set a per-box recipient label (for retail orders scanned under one session) ─
  async function saveBoxLabel(box: BoxRecord, value: string) {
    const trimmed = value.trim()
    const next    = trimmed || null
    if ((box.box_label ?? null) === next) return
    // Optimistic update so the field + tab reflect it immediately
    setBoxes(prev => prev.map(b => b.id === box.id ? { ...b, box_label: next } : b))
    setActiveBox(prev => prev && prev.id === box.id ? { ...prev, box_label: next } : prev)
    await fetch('/api/boxes', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: box.id, box_label: next }),
    })
  }

  // ── Tie a box to a retail order ──────────────────────────────────────────────
  async function linkOrder(box: BoxRecord, order: RetailOrderLite) {
    setShowOrderPicker(false)
    // Auto-fill the box recipient from the order if it's still blank.
    const nextLabel = (box.box_label && box.box_label.trim()) ? box.box_label : order.customer_name
    setBoxes(prev => prev.map(b => b.id === box.id ? { ...b, order_id: order.id, box_label: nextLabel } : b))
    setActiveBox(prev => prev && prev.id === box.id ? { ...prev, order_id: order.id, box_label: nextLabel } : prev)
    await fetch('/api/boxes', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: box.id, order_id: order.id, box_label: nextLabel }),
    })
  }
  async function unlinkOrder(box: BoxRecord) {
    setBoxes(prev => prev.map(b => b.id === box.id ? { ...b, order_id: null } : b))
    setActiveBox(prev => prev && prev.id === box.id ? { ...prev, order_id: null } : prev)
    await fetch('/api/boxes', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id: box.id, order_id: null }),
    })
  }
  const linkedOrder = activeBox?.order_id ? orders.find(o => o.id === activeBox.order_id) ?? null : null

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
  // `format` forces a layout; left off, the label route decides — a box headed
  // to value add prints the WIP tag instead of the finished box label.
  function openPrintWindow(box: BoxRecord, _labelScans: ScanLine[], flags: LabelFlags = labelFlags, format?: 'std' | 'wip') {
    const p = new URLSearchParams({ box_id: box.id })
    if (!flags.usda_bug)     p.set('usda',   '0')
    if (flags.retail_exempt) p.set('exempt', '1')
    if (flags.not_for_sale)  p.set('nfs',    '1')
    if (format)              p.set('format', format)
    window.open(`/api/boxes/label?${p}`, '_blank')
  }

  // Mirrors the label route's auto-recognition so the scanner can say up front
  // which tag is about to come out of the printer.
  const WIP_RE = /\b(wip|work in progress|value ?add)\b/i
  const boxPrintsWIP = (box: BoxRecord | null) =>
    !!box && (WIP_RE.test(box.box_label || '') || currentStatus === 'value_add')

  // ── Remove a scan ─────────────────────────────────────────────────────────────
  async function removeScan(id: string) {
    await fetch(`/api/boxes/scans?id=${id}`, { method: 'DELETE' })
    setScans(prev => prev.filter(s => s.id !== id))
  }

  // ── Delete a box (and all its scans) ─────────────────────────────────────────
  async function deleteBox(box: BoxRecord) {
    const msg = box.is_closed
      ? `Delete Box ${box.box_number}? This will permanently remove it and all ${box.total_cuts} scans.`
      : `Delete Box ${box.box_number} and all its scans?`
    if (!window.confirm(msg)) return
    await fetch(`/api/boxes?id=${box.id}`, { method: 'DELETE' })
    const remaining = boxes.filter(b => b.id !== box.id)
    setBoxes(remaining)
    if (activeBox?.id === box.id) {
      const next = remaining[remaining.length - 1] ?? null
      setActiveBox(next)
      if (next) {
        const res  = await fetch(`/api/boxes/scans?box_id=${next.id}`)
        const data = await res.json()
        setScans(Array.isArray(data) ? ([...data] as ScanLine[]).reverse() : [])
      } else {
        setScans([])
      }
    }
  }

  // ── Reassign a box to another session ────────────────────────────────────────
  // Moves the box (scans follow via box_id) to the target session, renumbered
  // after the target's boxes, then auto-prints a fresh label with the new info.
  async function reassignBoxTo(box: BoxRecord, tgtCust: string, tgtDate: string) {
    setReassignBusy(true)
    try {
      const res = await fetch('/api/boxes/reassign', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ box_id: box.id, target: { customer_name: tgtCust, session_date: tgtDate } }),
      })
      const data = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        window.alert(`Reassign failed: ${(data as { error?: string }).error ?? res.statusText}`)
        return
      }
      const moved = data as BoxRecord
      const remaining = boxes.filter(b => b.id !== box.id)
      setBoxes(remaining)
      if (activeBox?.id === box.id) {
        const next = remaining[remaining.length - 1] ?? null
        setActiveBox(next)
        if (next) {
          const r = await fetch(`/api/boxes/scans?box_id=${next.id}`)
          const d = await r.json().catch(() => [])
          setScans(Array.isArray(d) ? ([...d] as ScanLine[]).reverse() : [])
        } else {
          setScans([])
        }
      }
      setLastKind('ok')
      setLastItem(`Box moved to ${tgtCust} — now Box ${moved.box_number} · printing new label`)
      setFlash('ok')
      setTimeout(() => setFlash(null), 2500)
      openPrintWindow(moved, [], labelFlags)   // label route re-reads the box, so it prints the new session info
      loadSessions()
    } catch {
      window.alert('Reassign failed — network error')
    } finally {
      setReassignBusy(false)
      setReassignBox(null)
      setReassignNewName('')
      scanRef.current?.focus()
    }
  }

  // ── Repack: move cuts out of a box ───────────────────────────────────────────
  // The fix for "this got scanned into the wrong box". The cuts are MOVED, not
  // re-scanned, so the weight is never counted twice — see /api/boxes/repack.
  async function openRepack(box: BoxRecord) {
    setRepackBox(box)
    setRepackPicked(new Set())
    setRepackTarget('new')
    setRepackScans([])
    const res  = await fetch(`/api/boxes/scans?box_id=${box.id}`)
    const data = await res.json().catch(() => [])
    setRepackScans(Array.isArray(data) ? ([...data] as ScanLine[]).reverse() : [])
  }

  async function doRepack() {
    const box = repackBox
    if (!box || repackPicked.size === 0) return
    setRepackBusy(true)
    try {
      const res = await fetch('/api/boxes/repack', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scan_ids: Array.from(repackPicked),
          target: repackTarget === 'new' ? { new_box: true } : { box_id: repackTarget },
        }),
      })
      const data = await res.json().catch(() => ({} as { error?: string }))
      if (!res.ok) {
        window.alert(`Repack failed: ${(data as { error?: string }).error ?? res.statusText}`)
        return
      }
      const result = data as {
        moved: number; moved_lbs: number; target_box_id: string
        boxes: BoxRecord[]; relabel: string[]; emptied: string[]
      }

      // Fold the recomputed boxes back in, and pick up a newly created one.
      const byId = new Map(result.boxes.map(b => [b.id, b]))
      setBoxes(prev => {
        const merged = prev.map(b => byId.get(b.id) ?? b)
        const known  = new Set(merged.map(b => b.id))
        const added  = result.boxes.filter(b => !known.has(b.id))
        return [...merged, ...added].sort((a, b) => a.box_number - b.box_number)
      })
      const stillActive = byId.get(activeBoxRef.current?.id ?? '')
      if (stillActive) setActiveBox(stillActive)
      // Refresh the visible scan list if it was one of the boxes touched.
      const openId = activeBoxRef.current?.id
      if (openId && byId.has(openId)) {
        const r = await fetch(`/api/boxes/scans?box_id=${openId}`)
        const d = await r.json().catch(() => [])
        setScans(Array.isArray(d) ? ([...d] as ScanLine[]).reverse() : [])
      }

      const target = result.boxes.find(b => b.id === result.target_box_id)
      setLastKind('ok')
      setLastItem(`Moved ${result.moved} cut${result.moved !== 1 ? 's' : ''} · ${result.moved_lbs.toFixed(2)} lb → Box ${target?.box_number ?? '?'}`)
      setFlash('ok')
      setTimeout(() => setFlash(null), 3000)

      // A closed box's printed label states a weight and a cut count. Repacking
      // just changed those, so the old label is wrong and has to be replaced.
      for (const id of result.relabel) {
        const b = result.boxes.find(x => x.id === id)
        if (b) openPrintWindow(b, [], labelFlags)
      }
      if (result.emptied.length > 0) {
        const nums = result.emptied
          .map(id => result.boxes.find(b => b.id === id)?.box_number)
          .filter(Boolean).join(', ')
        window.alert(`Box ${nums} is now empty. Select it and use 🗑 Delete if it isn't going to be used.`)
      }
      loadSessions()
    } catch {
      window.alert('Repack failed — network error')
    } finally {
      setRepackBusy(false)
      setRepackBox(null)
      setRepackPicked(new Set())
      scanRef.current?.focus()
    }
  }

  // ── Submit weight for a box product (no weight-embedded barcode) ─────────────
  async function submitWeightEntry() {
    if (!weightModal) return
    const box = activeBoxRef.current
    if (!box || box.is_closed) return
    const weightLbs = parseFloat(weightEntry)
    if (!weightLbs || weightLbs <= 0) return

    const { plu, itemName } = weightModal
    setWeightModal(null)
    setWeightEntry('')
    processingRef.current = true
    setProcessing(true)

    try {
      const res = await fetch('/api/boxes/scans', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ box_id: box.id, plu_number: plu, item_name: itemName, weight_lbs: weightLbs, quantity: 1 }),
      })
      if (!res.ok) throw new Error(await res.text())
      const scan: ScanLine = await res.json()
      setScans(prev => [scan, ...prev])
      if (!pluMapRef.current[plu]) {
        setLastKind('warn')
        setLastItem(`${itemName}  ·  ${weightLbs.toFixed(2)} lb  —  DELETED PLU ${plu}: remove it from the scale`)
        setFlash('warn')
        setTimeout(() => setFlash(null), 4000)
      } else {
        setLastKind('ok')
        setLastItem(`${itemName}  ·  ${weightLbs.toFixed(2)} lb`)
        setFlash('ok')
        setTimeout(() => setFlash(null), 2000)
      }
    } catch {
      setFlash('bad')
      setLastKind('bad')
      setLastItem('Save failed — retry')
    } finally {
      setProcessing(false)
      processingRef.current = false
      scanRef.current?.focus()
    }
  }

  // ── Cure tag: open picker / save ─────────────────────────────────────────────
  // Seals are single-use, so a rescan of a used number shows whose piece it is
  // (that's how the smokehouse identifies a tag) instead of re-recording it.
  async function openCureModal(tagNumber: string) {
    setScanValue('')
    setCureWeight('')
    let existing: CureTag | null = null
    try {
      const res = await fetch(`/api/cure-tags?tag=${encodeURIComponent(tagNumber)}`)
      existing = await res.json()
    } catch { existing = null }
    setCureModal({ tagNumber, existing })
  }

  async function saveCureTag(product: string) {
    if (!cureModal || cureSaving) return
    setCureSaving(true)
    try {
      const res = await fetch('/api/cure-tags', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          tag_number:    cureModal.tagNumber,
          product,
          customer_name: customer,
          session_date:  date,
          weight_lbs:    cureWeight ? parseFloat(cureWeight) : null,
        }),
      })
      const row: CureTag = await res.json()
      if (res.status === 409) {
        setLastKind('warn')
        setLastItem(`🏷 Tag ${cureModal.tagNumber} already used — ${row.product} · ${row.customer_name}`)
        setFlash('warn')
        setTimeout(() => setFlash(null), 4000)
      } else if (!res.ok) {
        throw new Error()
      } else {
        setLastKind('ok')
        setLastItem(`🏷 Tag ${row.tag_number} · ${row.product} → Curing · ${row.customer_name}`)
        setFlash('ok')
        setTimeout(() => setFlash(null), 2500)
      }
      setCureModal(null)
    } catch {
      setFlash('bad')
      setLastKind('bad')
      setLastItem('Cure tag save failed — rescan the seal')
    } finally {
      setCureSaving(false)
      scanRef.current?.focus()
    }
  }

  // ── Add input from CMC box scan or carcass tag scan ──────────────────────────
  async function addInput(identifier: string) {
    const isCarcass = /^CT-/.test(identifier) || /^\d{5,6}-\w+(-[LR])?$/i.test(identifier)
    setScanValue('')
    setFlash('ok')
    setLastKind('ok')
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
      loadSharedYield(customer, date)
      // Show what the scan resolved to (weight, producer, cooler pull)
      const resolved = inp.description || identifier
      const wt = inp.weight_lbs != null ? `  ·  ${Number(inp.weight_lbs).toFixed(1)} lb` : ''
      setLastItem(`${isCarcass ? '🐄' : '📦'} ${resolved}${wt}${inp.cooler_pulled ? '  ·  ✓ pulled from cooler' : ''}`)
    } catch {
      setFlash('bad')
      setLastKind('bad')
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
          notes:         newInputNotes.trim() || null,
        }),
      })
      const inp: ProcessingInput = await res.json()
      setInputs(prev => [...prev, inp])
      setNewInputDesc('')
      setNewInputWt('')
      setNewInputNotes('')
      loadSharedYield(customer, date)
    } catch {}
    finally { setAddingInput(false) }
  }

  // ── Remove an input ───────────────────────────────────────────────────────────
  async function removeInput(id: string) {
    await fetch(`/api/processing/inputs?id=${id}`, { method: 'DELETE' })
    setInputs(prev => prev.filter(i => i.id !== id))
    loadSharedYield(customer, date)
  }

  // ── Split / chub tool ─────────────────────────────────────────────────────────
  const [splitModal, setSplitModal] = useState<{ scan: ScanLine } | null>(null)
  const [splitCount, setSplitCount] = useState(2)
  const [splitting,  setSplitting]  = useState(false)

  async function doSplit(scan: ScanLine, count: number) {
    if (count < 2) return
    setSplitting(true)
    const baseWeight = Math.round((scan.weight_lbs / count) * 100) / 100
    const lastWeight = Math.round((scan.weight_lbs - baseWeight * (count - 1)) * 100) / 100

    // Remove the original case scan
    await fetch(`/api/boxes/scans?id=${scan.id}`, { method: 'DELETE' })

    // Insert N individual package scans
    for (let i = 0; i < count; i++) {
      const w = i === count - 1 ? lastWeight : baseWeight
      await fetch('/api/boxes/scans', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ box_id: scan.box_id, plu_number: scan.plu_number, item_name: scan.item_name, weight_lbs: w, quantity: 1 }),
      })
    }

    // Re-fetch to get proper order from DB
    if (activeBoxRef.current) {
      const res  = await fetch(`/api/boxes/scans?box_id=${activeBoxRef.current.id}`)
      const data = await res.json().catch(() => [])
      setScans(Array.isArray(data) ? ([...data] as ScanLine[]).reverse() : [])
    }
    setLastKind('ok')
    setLastItem(`Split ${scan.item_name} into ${count} × ${baseWeight.toFixed(2)} lb`)
    setFlash('ok')
    setTimeout(() => setFlash(null), 2500)
    setSplitting(false)
    setSplitModal(null)
    setSplitCount(2)
    scanRef.current?.focus()
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

    const html = buildPackoutHTML(customer, date, sortedBoxes, allScans)
    const win = window.open('', '_blank')
    if (win) { win.document.write(html); win.document.close() }
    setReportLoading(false)
  }

  // ── Derived ───────────────────────────────────────────────────────────────────
  const totalWeight    = scans.reduce((s, sc) => s + (Number(sc.weight_lbs) || 0), 0)
  const isOpen         = activeBox && !activeBox.is_closed
  const closedWeight   = boxes.filter(b => b.is_closed).reduce((s, b) => s + (Number(b.total_weight_lbs) || 0), 0)
  const borderColor    = flash === 'ok' ? C.green : flash === 'warn' ? C.yellow : flash === 'bad' ? C.red : isOpen ? 'rgba(201,168,130,0.5)' : 'rgba(166,120,90,0.2)'
  const totalInputLbs  = inputs.reduce((s, i) => s + (Number(i.weight_lbs) || 0), 0)
  // A closed active box is already inside closedWeight — adding its scans
  // again would double-count it in the yield.
  const totalOutputLbs = closedWeight + (isOpen ? totalWeight : 0)
  const yieldPct       = totalInputLbs > 0 ? (totalOutputLbs / totalInputLbs) * 100 : 0
  const yieldColor     = yieldPct >= 80 ? C.green : yieldPct >= 65 ? C.yellow : C.red
  // When a half is shared across sessions (quarters), judge the pool instead:
  // all sessions' output against the deduped input weight.
  const sharedActive   = sharedYield !== null && sharedYield.pool_input_lbs > 0
  const poolYieldPct   = sharedActive ? ((totalOutputLbs + sharedYield.other_output_lbs) / sharedYield.pool_input_lbs) * 100 : 0
  const poolYieldColor = poolYieldPct >= 80 ? C.green : poolYieldPct >= 65 ? C.yellow : C.red
  const partnerNames   = sharedActive ? Array.from(new Set(sharedYield.partners.map(p => p.customer_name))).join(', ') : ''
  // More than one thing was scanned in (e.g. a CMC session with four carcass
  // sides). The yield then spans all of them — it is NOT one case's yield — so
  // it gets labelled "combined" and the per-input breakdown is shown, not hidden
  // behind the collapse (Charlie, 2026-07-29).
  const multiInput     = inputs.length > 1

  // ══════════════════════════════════════════════════════════════════════════════
  // SETUP SCREEN
  // ══════════════════════════════════════════════════════════════════════════════
  if (!started) {
    // Look-up: match the customer, the pack date, or any carcass hanging on the
    // session ("Beef — Tag 06 (Holdbrook)"), so a producer or tag finds it too.
    const sq        = sessionQuery.trim().toLowerCase()
    const searching = sq.length > 0
    const inScope   = sessions.filter(s =>
      !sq || [s.customer_name, s.session_date, ...(s.animals ?? [])].some(v => v?.toLowerCase().includes(sq)))
    const pick = (st: SessionStatus) =>
      inScope.filter(s => s.status === st && (statusFilter === 'all' || statusFilter === st))

    const scanning  = pick('scanning')
    const valueAdd  = pick('value_add')
    // Complete = boxed up and in the freezer awaiting pickup. Oldest first —
    // they've been waiting the longest.
    const freezer   = pick('complete')
      .sort((a, b) => a.session_date.localeCompare(b.session_date))
    // Baker Storage = delivered to the locker in Baker, still ours to track.
    // Oldest first — these are the ones racking up storage fees.
    const bakerStorage = pick('baker_storage')
      .sort((a, b) => a.session_date.localeCompare(b.session_date))
    const pickedUp  = pick('picked_up')
    const shownCount = scanning.length + valueAdd.length + freezer.length + bakerStorage.length + pickedUp.length
    // Retail orders Jill marked "In Progress" — ready to pack/scan straight in.
    // A search narrows these too, so a lookup isn't buried under unrelated orders.
    const inProgressOrders = orders.filter(o =>
      o.status === 'in_progress' && (!sq || o.customer_name.toLowerCase().includes(sq)))

    const STATUS_RAIL = [
      { value: 'all' as const,           label: 'All',           dot: '',   color: C.cream },
      { value: 'scanning' as const,      label: 'Scanning',      dot: '●',  color: C.yellow },
      { value: 'value_add' as const,     label: 'Value Add',     dot: '◆',  color: '#E8883A' },
      { value: 'complete' as const,      label: 'Freezer',       dot: '🧊', color: '#7CAFDD' },
      { value: 'baker_storage' as const, label: 'Baker Storage', dot: '🚚', color: C.tan },
      { value: 'picked_up' as const,     label: 'Picked Up',     dot: '✓',  color: C.green },
    ]
    const railCount = (v: SessionStatus | 'all') =>
      v === 'all' ? inScope.length : inScope.filter(s => s.status === v).length

    const STATUS_CFG = {
      scanning:  { label: 'Scanning',   color: C.yellow,        dot: '●' },
      value_add: { label: 'Value Add',  color: '#E8883A',       dot: '◆' },
      complete:  { label: 'In Freezer', color: '#7CAFDD',       dot: '🧊' },
      baker_storage: { label: 'Baker Storage', color: C.tan,    dot: '🚚' },
      picked_up: { label: 'Picked Up',  color: C.green,         dot: '✓' },
    }

    function SessionCard({ s }: { s: SessionWithStats }) {
      const dateStr = new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      const cfg = STATUS_CFG[s.status]
      // Days waiting — in our freezer, or on the shelf in Baker (where it bills monthly)
      const waitingDays = s.status === 'complete' || s.status === 'baker_storage'
        ? Math.max(0, Math.floor((Date.now() - new Date(s.session_date + 'T12:00:00').getTime()) / 86400000))
        : null
      const btnBase: React.CSSProperties = { borderRadius: 3, padding: '0.3rem 0.75rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }
      const isMergeSource = mergeSource !== null
        && mergeSource.customer_name === s.customer_name && mergeSource.session_date === s.session_date
      return (
        <div style={{ background: 'rgba(255,255,255,0.03)', border: isMergeSource ? `1px solid ${C.yellow}` : '1px solid rgba(166,120,90,0.2)', borderRadius: 6, padding: '0.9rem 1.1rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
            <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.95rem' }}>{s.customer_name}</span>
            <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>{dateStr}</span>
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.75rem', marginBottom: (s.animals?.length ?? 0) > 0 ? '0.25rem' : '0.7rem' }}>
            {s.box_count} box{s.box_count !== 1 ? 'es' : ''}
            {s.closed_count > 0 && ` · ${s.closed_count} closed`}
            {s.total_weight > 0 && ` · ${s.total_weight.toFixed(1)} lbs`}
            {waitingDays !== null && (
              <span style={{ color: waitingDays >= 14 ? C.yellow : (s.status === 'baker_storage' ? C.tan : '#7CAFDD'), fontWeight: 600 }}>
                {s.status === 'baker_storage'
                  ? ` · 🚚 ${waitingDays === 0 ? 'today' : `${waitingDays}d in Baker`}`
                  : ` · 🧊 ${waitingDays === 0 ? 'today' : `${waitingDays}d in freezer`}`}
              </span>
            )}
          </div>
          {(s.animals?.length ?? 0) > 0 && (
            <div style={{ color: C.tan, fontSize: '0.72rem', marginBottom: '0.7rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              title={s.animals!.join('\n')}>
              🐄 {s.animals!.join(' · ')}
            </div>
          )}
          {mergeSource ? (
            // Merge mode: only merge-relevant buttons, so a stray tap can't open a session
            <div style={{ display: 'flex', gap: '0.35rem', flexWrap: 'wrap' }}>
              {isMergeSource ? (
                <button onClick={() => setMergeSource(null)}
                  style={{ ...btnBase, background: 'transparent', border: `1px solid ${C.yellow}`, color: C.yellow }}>
                  ✕ Cancel Merge
                </button>
              ) : (
                <button disabled={mergeBusy} onClick={() => mergeSessions(mergeSource, s)}
                  style={{ ...btnBase, background: C.tan, color: C.dark, border: 'none', opacity: mergeBusy ? 0.5 : 1 }}>
                  ⇄ Merge Into This
                </button>
              )}
            </div>
          ) : (
          <>
          {(s.status === 'complete' || s.status === 'baker_storage') && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', marginBottom: '0.6rem' }}>
              <span style={{ fontSize: '0.72rem', color: s.pickup_date ? C.green : C.lightBrown, whiteSpace: 'nowrap' }}>📅 Pickup:</span>
              <input type="date" value={s.pickup_date ?? ''} onChange={e => setPickupDate(s, e.target.value)}
                style={{ background: 'rgba(255,255,255,0.05)', border: `1px solid ${s.pickup_date ? 'rgba(76,175,80,0.5)' : 'rgba(166,120,90,0.3)'}`, borderRadius: 3, padding: '0.2rem 0.4rem', color: C.cream, fontSize: '0.75rem', colorScheme: 'dark' }} />
              {s.pickup_date && <span style={{ fontSize: '0.7rem', color: C.green }}>✓ set</span>}
            </div>
          )}
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
            {s.status === 'scanning' && (
              <button onClick={() => quickStatus(s, 'complete')}
                style={{ ...btnBase, background: 'transparent', border: `1px solid rgba(76,175,80,0.5)`, color: C.green }}>
                ✓ Complete
              </button>
            )}
            {s.status === 'value_add' && (
              <button onClick={() => quickStatus(s, 'complete')}
                style={{ ...btnBase, background: 'transparent', border: `1px solid rgba(76,175,80,0.5)`, color: C.green }}>
                ✓ Complete
              </button>
            )}
            {s.status === 'complete' && (
              <button onClick={() => quickStatus(s, 'picked_up')}
                style={{ ...btnBase, background: C.green, color: C.dark, border: 'none' }}>
                📦 Picked Up
              </button>
            )}
            {s.status === 'complete' && (
              <button onClick={() => quickStatus(s, 'baker_storage')}
                style={{ ...btnBase, background: 'transparent', border: `1px solid ${C.tan}`, color: C.tan }}>
                🚚 Baker Storage
              </button>
            )}
            {s.status === 'complete' && (
              <button onClick={() => quickStatus(s, 'scanning')}
                style={{ ...btnBase, background: 'transparent', border: '1px solid rgba(166,120,90,0.3)', color: C.lightBrown }}>
                ↩ Reopen
              </button>
            )}
            {s.status === 'baker_storage' && (
              <button onClick={() => quickStatus(s, 'picked_up')}
                style={{ ...btnBase, background: C.green, color: C.dark, border: 'none' }}>
                📦 Picked Up
              </button>
            )}
            {(s.status === 'picked_up' || s.status === 'baker_storage') && (
              <button onClick={() => quickStatus(s, 'complete')}
                style={{ ...btnBase, background: 'transparent', border: '1px solid rgba(124,175,221,0.4)', color: '#7CAFDD' }}>
                🧊 Back to Freezer
              </button>
            )}
            <button onClick={() => generatePackoutForSession(s)}
              style={{ ...btnBase, background: 'transparent', border: '1px solid rgba(166,120,90,0.25)', color: C.lightBrown }}>
              📋 Packout
            </button>
            <button onClick={() => setMergeSource(s)} title="Move this session's boxes into another session"
              style={{ ...btnBase, background: 'transparent', border: '1px solid rgba(166,120,90,0.25)', color: C.lightBrown }}>
              ⇄ Merge
            </button>
          </div>
          </>
          )}
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
          <button onClick={() => { setCustomer(''); setBoxType('USDA'); setShowNewForm(true) }} style={{ background: C.tan, color: C.dark, border: 'none', borderRadius: 4, padding: '0.5rem 1.1rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em' }}>
            + New Session
          </button>
        </div>

        {/* Sessions */}
        <div style={{ flex: 1, padding: '1.5rem', maxWidth: 1160, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
          {/* Merge mode banner */}
          {mergeSource && (
            <div style={{ marginBottom: '1.25rem', background: 'rgba(217,119,6,0.1)', border: `1px solid ${C.yellow}`, borderRadius: 8, padding: '0.85rem 1.1rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
              <span style={{ color: C.cream, fontSize: '0.88rem' }}>
                {mergeBusy ? '⟳ Merging…' : <>⇄ Merging <strong>{mergeSource.customer_name}</strong> ({mergeSource.session_date}) — pick the session to move its boxes into</>}
              </span>
              <button onClick={() => setMergeSource(null)} disabled={mergeBusy}
                style={{ background: 'transparent', border: `1px solid ${C.yellow}`, color: C.yellow, borderRadius: 3, padding: '0.3rem 0.8rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          )}

          {/* Look up a session — customer, pack date, producer or tag */}
          <div style={{ position: 'relative', marginBottom: '1.25rem' }}>
            <span style={{ position: 'absolute', left: '0.75rem', top: '50%', transform: 'translateY(-50%)', fontSize: '1rem', opacity: 0.6 }}>🔍</span>
            <input
              value={sessionQuery}
              onChange={e => setSessionQuery(e.target.value)}
              placeholder="Find a session — customer, date, producer or tag…"
              style={{ ...INPUT, fontSize: '0.95rem', padding: '0.7rem 2.5rem' }}
            />
            {searching && (
              <button onClick={() => setSessionQuery('')} title="Clear"
                style={{ position: 'absolute', right: '0.5rem', top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: C.lightBrown, fontSize: '1.1rem', cursor: 'pointer', padding: '0 0.35rem' }}>
                ✕
              </button>
            )}
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.5rem', alignItems: 'flex-start' }}>

            {/* Status rail */}
            <aside style={{ flex: '0 1 175px', minWidth: 155 }}>
              <div style={{ ...LBL, marginBottom: '0.45rem' }}>Status</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                {STATUS_RAIL.map(r => {
                  const active = statusFilter === r.value
                  const n = railCount(r.value)
                  return (
                    <button key={r.value} onClick={() => setStatusFilter(r.value)}
                      style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '0.5rem',
                        width: '100%', textAlign: 'left', padding: '0.45rem 0.6rem', borderRadius: 4,
                        border: `1px solid ${active ? 'rgba(166,120,90,0.5)' : 'transparent'}`,
                        background: active ? 'rgba(255,255,255,0.06)' : 'transparent',
                        color: active ? r.color : C.lightBrown,
                        fontWeight: active ? 700 : 400, fontSize: '0.82rem', cursor: 'pointer',
                        opacity: n === 0 && !active ? 0.4 : 1,
                      } as React.CSSProperties}>
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.dot && <span style={{ color: r.color, marginRight: '0.4rem' }}>{r.dot}</span>}{r.label}
                      </span>
                      <span style={{ fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>{n}</span>
                    </button>
                  )
                })}
              </div>
            </aside>

            {/* Sessions — basis kept low so the rail stays beside the cards on a
                tablet in portrait rather than stacking on top of them */}
            <div style={{ flex: '1 1 380px', minWidth: 0 }}>
          {/* Ready to Pack — retail orders Jill marked In Progress, one click to scan */}
          {inProgressOrders.length > 0 && (
            <div style={{ marginBottom: '1.75rem', background: 'rgba(76,175,80,0.06)', border: '1px solid rgba(76,175,80,0.3)', borderRadius: 8, padding: '1rem 1.1rem' }}>
              <div style={{ fontSize: '0.65rem', color: C.green, textTransform: 'uppercase', letterSpacing: '0.14em', fontWeight: 700, marginBottom: '0.75rem' }}>
                📋 Ready to Pack — In-Progress Retail Orders ({inProgressOrders.length})
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(255px, 1fr))', gap: '0.65rem' }}>
                {inProgressOrders.map(o => {
                  const items   = o.retail_order_items ?? []
                  const preview = items.slice(0, 3).map(it => it.item_name).join(', ')
                  return (
                    <div key={o.id} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(76,175,80,0.3)', borderRadius: 6, padding: '0.9rem 1.1rem' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.25rem' }}>
                        <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.95rem' }}>{o.customer_name}</span>
                        <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>due {fmtDue(o.due_date)}</span>
                      </div>
                      <div style={{ color: C.lightBrown, fontSize: '0.75rem', marginBottom: '0.7rem', minHeight: '1rem' }}>
                        {items.length} item{items.length !== 1 ? 's' : ''}{preview ? ` · ${preview}${items.length > 3 ? '…' : ''}` : ''}
                      </div>
                      <button disabled={!pluLoaded} onClick={() => startSessionFromOrder(o)}
                        style={{ background: C.green, color: C.dark, border: 'none', borderRadius: 3, padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 700, cursor: pluLoaded ? 'pointer' : 'not-allowed', opacity: pluLoaded ? 1 : 0.5 }}>
                        → Scan this order
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )}
          {sessionsLoading ? (
            <div style={{ textAlign: 'center', color: C.lightBrown, padding: '3rem', fontSize: '0.9rem' }}>Loading sessions…</div>
          ) : sessions.length === 0 ? (
            inProgressOrders.length > 0 ? null : (
            <div style={{ textAlign: 'center', color: C.lightBrown, padding: '4rem 2rem' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.75rem' }}>🔍</div>
              <div style={{ fontSize: '0.95rem', marginBottom: '1.25rem' }}>No sessions yet</div>
              <button onClick={() => { setCustomer(''); setBoxType('USDA'); setShowNewForm(true) }} style={{ background: C.tan, color: C.dark, border: 'none', borderRadius: 4, padding: '0.65rem 1.5rem', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer' }}>
                Start First Session
              </button>
            </div>
            )
          ) : shownCount === 0 ? (
            <div style={{ textAlign: 'center', color: C.lightBrown, padding: '3rem 2rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>🔍</div>
              <div style={{ fontSize: '0.9rem' }}>
                No session matches{searching && <> “<span style={{ color: C.cream }}>{sessionQuery.trim()}</span>”</>}
                {statusFilter !== 'all' && ' in this status'}.
              </div>
              <button onClick={() => { setSessionQuery(''); setStatusFilter('all') }}
                style={{ marginTop: '1rem', background: 'transparent', border: `1px solid ${C.tan}`, color: C.tan, borderRadius: 4, padding: '0.45rem 1.1rem', fontSize: '0.82rem', cursor: 'pointer' }}>
                Clear search &amp; filters
              </button>
            </div>
          ) : (
            <>
              {/* A search should surface every hit, not hide one behind "Show all 46" */}
              <Section title="● Scanning"       color={C.yellow}  items={scanning} />
              <Section title="◆ Value Add Queue" color="#E8883A"   items={valueAdd} />
              <Section title="🧊 Freezer — Ready for Pickup" color="#7CAFDD" items={freezer} showAll={showAllFreezer || searching} onToggle={() => setShowAllFreezer(p => !p)} />
              <Section title="🚚 Baker Storage"  color={C.tan}     items={bakerStorage} showAll={showAllBaker || searching} onToggle={() => setShowAllBaker(p => !p)} />
              <Section title="✓ Picked Up"       color={C.green}   items={pickedUp} showAll={showAllPickedUp || searching} onToggle={() => setShowAllPickedUp(p => !p)} />
            </>
          )}

            </div>
          </div>
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
              <div style={{ marginBottom: '1rem' }}>
                <label style={LBL}>Box Type</label>
                <div style={{ display: 'flex', gap: '0.4rem' }}>
                  {BOX_TYPES.map(t => (
                    <button key={t} type="button" onClick={() => setBoxType(t)}
                      style={{
                        flex: 1, padding: '0.6rem 0.4rem', borderRadius: 4, cursor: 'pointer',
                        background: boxType === t ? C.tan : 'rgba(255,255,255,0.05)',
                        border: `1px solid ${boxType === t ? C.tan : 'rgba(166,120,90,0.35)'}`,
                        color: boxType === t ? C.dark : C.lightBrown,
                        fontSize: '0.85rem', fontWeight: boxType === t ? 700 : 500,
                      }}>
                      {t}
                    </button>
                  ))}
                </div>
                <div style={{ fontSize: '0.66rem', color: C.lightBrown, marginTop: '0.4rem', lineHeight: 1.35 }}>
                  {boxType === 'Custom'
                    ? 'Custom-exempt — labels print NOT FOR SALE.'
                    : `${boxType} — labels print the USDA mark of inspection.`}
                </div>
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
          {editingName ? (
            <input
              autoFocus
              value={nameDraft}
              onChange={e => setNameDraft(e.target.value)}
              onBlur={renameCustomer}
              onKeyDown={e => {
                if (e.key === 'Enter') renameCustomer()
                else if (e.key === 'Escape') { setEditingName(false); setNameDraft(customer) }
              }}
              style={{ background: C.dark, color: C.cream, fontWeight: 700, fontSize: '1rem', border: `1px solid ${C.tan}`, borderRadius: 4, padding: '0.15rem 0.4rem', width: `${Math.max(8, nameDraft.length + 1)}ch`, outline: 'none' }}
            />
          ) : (
            <button
              onClick={() => { setNameDraft(customer); setEditingName(true) }}
              title="Click to rename this session's customer"
              disabled={renameBusy}
              style={{ background: 'none', border: 'none', color: C.cream, fontWeight: 700, fontSize: '1rem', cursor: 'pointer', padding: 0, display: 'inline-flex', alignItems: 'center', gap: '0.3rem', opacity: renameBusy ? 0.5 : 1 }}
            >
              {customer}
              <span style={{ color: C.lightBrown, fontSize: '0.7rem', fontWeight: 400 }}>{renameBusy ? '⟳' : '✎'}</span>
            </button>
          )}
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
            <>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7CAFDD', background: 'rgba(124,175,221,0.12)', borderRadius: 99, padding: '2px 8px' }}>🧊 In Freezer</span>
              <button onClick={() => updateSessionStatus('picked_up')}
                style={{ background: 'transparent', border: `1px solid rgba(76,175,80,0.4)`, color: C.green, borderRadius: 3, padding: '0.2rem 0.6rem', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>
                📦 Picked Up
              </button>
              <button onClick={() => updateSessionStatus('baker_storage')}
                style={{ background: 'transparent', border: `1px solid ${C.tan}`, color: C.tan, borderRadius: 3, padding: '0.2rem 0.6rem', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>
                🚚 Baker Storage
              </button>
            </>
          )}
          {currentStatus === 'baker_storage' && (
            <>
              <span style={{ fontSize: '0.72rem', fontWeight: 700, color: C.tan, background: 'rgba(201,168,130,0.12)', borderRadius: 99, padding: '2px 8px' }}>🚚 Baker Storage</span>
              <button onClick={() => updateSessionStatus('picked_up')}
                style={{ background: 'transparent', border: `1px solid rgba(76,175,80,0.4)`, color: C.green, borderRadius: 3, padding: '0.2rem 0.6rem', fontSize: '0.72rem', cursor: 'pointer', fontWeight: 600 }}>
                📦 Picked Up
              </button>
            </>
          )}
          {currentStatus === 'picked_up' && (
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: C.green, background: 'rgba(76,175,80,0.1)', borderRadius: 99, padding: '2px 8px' }}>✓ Picked Up</span>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          {sharedActive ? (
            <span title={`Combined across sessions sharing this carcass: ${partnerNames}`}
              style={{ fontSize: '0.78rem', fontWeight: 700, color: poolYieldColor, fontFamily: 'monospace' }}>
              ⋈ {poolYieldPct.toFixed(1)}% combined yield
            </span>
          ) : totalInputLbs > 0 && totalOutputLbs > 0 && (
            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: yieldColor, fontFamily: 'monospace' }}>
              {yieldPct.toFixed(1)}% {multiInput ? `combined (${inputs.length} in)` : 'yield'}
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
            onContextMenu={e => { e.preventDefault(); setBoxMenu({ box, x: e.clientX, y: e.clientY }) }}
            title="Right-click to repack or reassign this box"
            style={{
              padding: '0.35rem 0.9rem', borderRadius: 3, cursor: 'pointer',
              fontSize: '0.85rem', fontWeight: 700, whiteSpace: 'nowrap',
              border: activeBox?.id === box.id ? 'none' : '1px solid rgba(166,120,90,0.25)',
              background: activeBox?.id === box.id ? C.tan : 'transparent',
              color: activeBox?.id === box.id ? C.dark : (box.is_closed ? C.green : C.tan),
            }}
          >
            Box {box.box_number}{box.is_final ? ' ★' : ''}{box.box_label ? ` · ${box.box_label}` : ''} {box.is_closed ? '✓' : '●'}
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
            {flash === 'ok' ? '✓' : flash === 'warn' || flash === 'bad' ? '⚠' : processing ? '⟳' : '🔍'}
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
              // Carcass half tag complete (YYDDD-TAG-SIDE or YYMMDD-TAG-SIDE)
              if (/^\d{5,6}-\w+-[LR]$/i.test(raw)) { addInput(raw.toUpperCase()); return }
              // Partial CMC/CT prefix or carcass tag building up — don't strip
              if (/^(CMC|CT)/i.test(raw) || /^\d{5,6}-[\w-]*$/.test(raw)) { setScanValue(raw); return }
              // Cure seal complete — seals print with leading zeros, so a full-length
              // in-range code starting '0' can't be a Hobart EAN prefix (those start '2')
              if (raw.startsWith('0') && matchCureTag(raw, cureRollsRef.current)) { openCureModal(raw); return }
              // Hobart EAN-13: digits only — the scan-queue effect fires once 13 arrive
              setScanValue(raw.replace(/\D/g, ''))
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && scanValue.length > 0 && scanValue.length < 13) {
                if (/^CMC-\d{8}-\d{3}$/.test(scanValue)) addInput(scanValue)
                else if (/^CT-[0-9a-f-]{36}$/.test(scanValue)) addInput(scanValue)
                else if (/^\d{5,6}-\w+(-[LR])?$/i.test(scanValue)) addInput(scanValue.toUpperCase())
                else if (matchCureTag(scanValue, cureRollsRef.current)) openCureModal(scanValue)
                else { const v = scanValue; setScanValue(''); doScan(v) }
              }
            }}
            disabled={!isOpen}
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
            <span style={{ fontSize: '1.05rem', fontWeight: 700, color: lastKind === 'bad' ? C.red : lastKind === 'warn' ? C.yellow : C.green }}>
              {lastKind === 'ok' ? '✓ ' : '⚠ '}{lastItem}
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
                  onClick={() => deleteBox(activeBox)}
                  title="Delete this box and all its scans"
                  style={{ background: 'rgba(180,40,40,0.12)', border: '1px solid rgba(180,40,40,0.4)', borderRadius: 3, padding: '0.4rem 0.75rem', color: '#e05555', fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  🗑 Delete
                </button>
                <button
                  onClick={() => openPrintWindow(activeBox, scans)}
                  title={boxPrintsWIP(activeBox)
                    ? 'This box is headed to value add — prints the WIP tag'
                    : 'Prints the finished box label'}
                  style={{ background: 'transparent', border: `1px solid ${C.tan}`, borderRadius: 3, padding: '0.4rem 0.9rem', color: C.tan, fontSize: '0.82rem', cursor: 'pointer', fontWeight: 600 }}
                >
                  {boxPrintsWIP(activeBox) ? '🏷 Print WIP Tag' : '🖨 Print Label'}
                </button>
                {/* Auto-recognition is a guess about intent — always leave a way
                    to print the other one without renaming the box. */}
                <button
                  onClick={() => openPrintWindow(activeBox, scans, labelFlags, boxPrintsWIP(activeBox) ? 'std' : 'wip')}
                  title={boxPrintsWIP(activeBox)
                    ? 'Print the finished box label instead'
                    : 'Print this box as a WIP tag for value add'}
                  style={{ background: 'transparent', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, padding: '0.4rem 0.75rem', color: C.lightBrown, fontSize: '0.78rem', cursor: 'pointer' }}
                >
                  {boxPrintsWIP(activeBox) ? '🖨 Box label' : '🏷 WIP'}
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
            {/* Per-box recipient name + retail-order link */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '0.5rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.65rem', color: 'rgba(166,120,90,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', flexShrink: 0 }}>For:</span>
              <input
                key={activeBox.id}
                defaultValue={activeBox.box_label ?? ''}
                onBlur={e => saveBoxLabel(activeBox, e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { (e.target as HTMLInputElement).blur() } }}
                placeholder="Box recipient / retail customer (optional) — prints on label"
                style={{ flex: 1, minWidth: 200, maxWidth: 380, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 3, padding: '0.3rem 0.55rem', color: C.cream, fontSize: '0.82rem', outline: 'none' }}
              />
              {linkedOrder ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', background: 'rgba(76,175,80,0.12)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 3, padding: '0.25rem 0.5rem' }}>
                  <span style={{ color: C.green, fontSize: '0.8rem', fontWeight: 700 }}>📋 {linkedOrder.customer_name}</span>
                  <span style={{ color: C.lightBrown, fontSize: '0.72rem' }}>due {fmtDue(linkedOrder.due_date)}</span>
                  <button onClick={() => unlinkOrder(activeBox)} title="Unlink order" style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, padding: 0 }}>✕</button>
                </div>
              ) : (
                <button onClick={() => { loadOrders(); setShowOrderPicker(true) }} style={{ background: 'rgba(201,168,130,0.12)', border: '1px solid rgba(201,168,130,0.4)', borderRadius: 3, padding: '0.3rem 0.7rem', color: C.tan, fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>📋 Link retail order</button>
              )}
            </div>
            {/* What the linked customer ordered — a packing reference */}
            {linkedOrder && (linkedOrder.retail_order_items?.length ?? 0) > 0 && (
              <div style={{ marginBottom: '0.5rem', background: 'rgba(76,175,80,0.06)', border: '1px solid rgba(76,175,80,0.2)', borderRadius: 4, padding: '0.4rem 0.6rem' }}>
                <div style={{ fontSize: '0.64rem', color: C.green, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 700, marginBottom: '0.3rem' }}>📋 {linkedOrder.customer_name} ordered</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 0.9rem' }}>
                  {linkedOrder.retail_order_items!.map(it => (
                    <span key={it.id} style={{ fontSize: '0.78rem', color: C.cream }}>
                      <strong style={{ color: C.tan }}>{it.qty_ordered}{it.unit === 'LB' ? ' lb' : '×'}</strong> {it.item_name}
                      {it.notes ? <span style={{ color: C.lightBrown }}> ({it.notes})</span> : null}
                    </span>
                  ))}
                </div>
              </div>
            )}
            {/* Box type + label flags row */}
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', flexWrap: 'wrap' }}>
              <span style={{ fontSize: '0.65rem', color: 'rgba(166,120,90,0.5)', textTransform: 'uppercase', letterSpacing: '0.1em', marginRight: '0.2rem' }}>Type:</span>
              {/* Box type — sticky per session, drives the compliance mark on every box */}
              {BOX_TYPES.map(t => (
                <button
                  key={t}
                  onClick={() => applyBoxType(t)}
                  title={t === 'Custom' ? 'Custom-exempt — prints NOT FOR SALE' : `${t} — prints the USDA mark`}
                  style={{
                    background: boxType === t ? 'rgba(201,168,130,0.28)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${boxType === t ? 'rgba(201,168,130,0.6)' : 'rgba(166,120,90,0.2)'}`,
                    borderRadius: 3, padding: '0.2rem 0.7rem',
                    color: boxType === t ? C.cream : C.lightBrown,
                    fontSize: '0.72rem', cursor: 'pointer', fontWeight: boxType === t ? 700 : 400,
                  }}
                >
                  {boxType === t ? '✓ ' : ''}{t}
                </button>
              ))}
              {/* Retail Exempt — independent add-on badge, orthogonal to box type */}
              <button
                onClick={() => setLabelFlags(f => ({ ...f, retail_exempt: !f.retail_exempt }))}
                style={{
                  background: labelFlags.retail_exempt ? 'rgba(201,168,130,0.2)' : 'rgba(255,255,255,0.03)',
                  border: `1px solid ${labelFlags.retail_exempt ? 'rgba(201,168,130,0.45)' : 'rgba(166,120,90,0.2)'}`,
                  borderRadius: 3, padding: '0.2rem 0.6rem', marginLeft: '0.5rem',
                  color: labelFlags.retail_exempt ? C.cream : C.lightBrown,
                  fontSize: '0.72rem', cursor: 'pointer', fontWeight: labelFlags.retail_exempt ? 700 : 400,
                }}
              >
                {labelFlags.retail_exempt ? '✓ ' : ''}Retail Exempt
              </button>
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
                {!sharedActive && (
                  <span title={multiInput ? `Combined across all ${inputs.length} inputs scanned in — not one case on its own` : undefined} style={{
                    fontSize: '0.74rem', fontWeight: 700, borderRadius: 3, padding: '0.1rem 0.45rem', flexShrink: 0,
                    background: yieldPct >= 80 ? 'rgba(76,175,80,0.18)' : yieldPct >= 65 ? 'rgba(217,119,6,0.18)' : 'rgba(229,62,62,0.18)',
                    color: yieldColor,
                  }}>
                    {yieldPct.toFixed(1)}% {multiInput ? 'combined' : 'yield'}
                  </span>
                )}
              </>
            )}
            {sharedActive && (
              <>
                <span title={`Half shared with ${partnerNames} — yield is judged against everything pulling from it:\n(${totalOutputLbs.toFixed(1)} + ${sharedYield.other_output_lbs.toFixed(1)} lbs out) ÷ ${sharedYield.pool_input_lbs.toFixed(1)} lbs in`}
                  style={{
                    fontSize: '0.74rem', fontWeight: 700, borderRadius: 3, padding: '0.1rem 0.45rem', flexShrink: 0,
                    background: poolYieldPct >= 80 ? 'rgba(76,175,80,0.18)' : poolYieldPct >= 65 ? 'rgba(217,119,6,0.18)' : 'rgba(229,62,62,0.18)',
                    color: poolYieldColor,
                  }}>
                  ⋈ {poolYieldPct.toFixed(1)}% combined
                </span>
                <span style={{ fontSize: '0.7rem', color: C.lightBrown, flexShrink: 0 }}>
                  shared w/ {partnerNames}
                </span>
              </>
            )}
            <span style={{ marginLeft: 'auto', fontSize: '0.68rem', color: C.lightBrown }}>{showInputs ? '▲' : '▼'}</span>
          </div>

          {/* When several things were scanned in, list them right under the header
              even while collapsed, so it's plain that the yield above is those N
              inputs combined — not the one case (Charlie, 2026-07-29). */}
          {!showInputs && multiInput && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.3rem', padding: '0.35rem 0.2rem 0.1rem' }}>
              {inputs.map(inp => (
                <span key={inp.id} style={{
                  fontSize: '0.7rem', color: C.tan, background: 'rgba(0,0,0,0.25)',
                  border: '1px solid rgba(166,120,90,0.18)', borderRadius: 3, padding: '0.12rem 0.4rem',
                }}>
                  {inp.input_type === 'premade' ? '📦' : inp.input_type === 'carcass' ? '🐄' : '🥩'}{' '}
                  {inp.box_identifier || inp.description || '—'}
                  {inp.weight_lbs != null && <span style={{ color: C.lightBrown, fontFamily: 'monospace' }}> · {Number(inp.weight_lbs).toFixed(1)}lb</span>}
                </span>
              ))}
            </div>
          )}

          {showInputs && (
            <div style={{ background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(166,120,90,0.18)', borderTop: 'none', borderRadius: '0 0 4px 4px', padding: '0.55rem 0.65rem' }}>

              {/* Quick-add form */}
              <div style={{ marginBottom: '0.5rem', display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
                {/* Row 1: desc + weight + type */}
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <input
                    placeholder="Description (or scan a barcode)"
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
                </div>
                {/* Row 2: notes + add button */}
                <div style={{ display: 'flex', gap: '0.35rem' }}>
                  <input
                    placeholder="Notes — e.g. grind coarse, keep roasts separate, mix with pork…"
                    value={newInputNotes}
                    onChange={e => setNewInputNotes(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addManualInput() }}
                    style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, padding: '0.32rem 0.5rem', color: C.cream, fontSize: '0.82rem', outline: 'none' }}
                  />
                  <button
                    onClick={addManualInput}
                    disabled={addingInput || (!newInputDesc.trim() && !newInputWt)}
                    style={{ background: (!newInputDesc.trim() && !newInputWt) ? C.medBrown : C.tan, border: 'none', borderRadius: 3, padding: '0.32rem 0.85rem', color: C.dark, fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer', opacity: addingInput ? 0.6 : 1, flexShrink: 0 }}
                  >
                    + Add
                  </button>
                </div>
              </div>

              {/* Input list */}
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {inputs.length === 0 ? (
                  <div style={{ textAlign: 'center', color: 'rgba(166,120,90,0.4)', fontSize: '0.78rem', padding: '0.65rem', fontStyle: 'italic' }}>
                    No inputs yet — scan a carcass tag or CMC box label, or add manually
                  </div>
                ) : inputs.map((inp, idx) => (
                  <div key={inp.id} style={{ padding: '0.4rem 0.2rem', borderBottom: '1px solid rgba(166,120,90,0.08)' }}>
                    <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem' }}>
                      {/* # + emoji */}
                      <span style={{ fontSize: '0.7rem', color: C.lightBrown, flexShrink: 0, minWidth: 18 }}>
                        {idx + 1}.
                      </span>
                      <span style={{ fontSize: '0.78rem', flexShrink: 0 }}>
                        {inp.input_type === 'premade' ? '📦' : inp.input_type === 'carcass' ? '🐄' : '🥩'}
                      </span>
                      {/* Description */}
                      <span style={{ flex: 1, color: C.cream, fontSize: '0.84rem', fontWeight: 600 }}>
                        {inp.description || inp.box_identifier || '—'}
                      </span>
                      {/* Weight */}
                      {inp.weight_lbs != null && (
                        <span style={{ color: C.tan, fontSize: '0.82rem', fontFamily: 'monospace', flexShrink: 0 }}>
                          {Number(inp.weight_lbs).toFixed(1)} lb
                        </span>
                      )}
                      {/* Remove */}
                      <button
                        onClick={() => removeInput(inp.id)}
                        style={{ background: 'none', border: 'none', color: 'rgba(166,120,90,0.35)', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, padding: '0 0.1rem', flexShrink: 0 }}
                      >×</button>
                    </div>
                    {/* Notes line */}
                    {inp.notes && (
                      <div style={{ marginLeft: 36, marginTop: '0.15rem', fontSize: '0.76rem', color: C.lightBrown, fontStyle: 'italic' }}>
                        {inp.notes}
                      </div>
                    )}
                    {/* Barcode identifier (small, secondary) */}
                    {inp.box_identifier && (
                      <div style={{ marginLeft: 36, marginTop: '0.1rem', fontSize: '0.66rem', color: 'rgba(166,120,90,0.45)', fontFamily: 'monospace' }}>
                        {inp.box_identifier}
                        {(sharedYield?.shared_identifiers[inp.box_identifier]?.length ?? 0) > 0 && (
                          <span style={{ color: '#7CAFDD', marginLeft: 8, fontFamily: 'inherit' }}>
                            ⋈ shared w/ {sharedYield!.shared_identifiers[inp.box_identifier].join(', ')}
                          </span>
                        )}
                      </div>
                    )}
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
                  <>
                    <button
                      onClick={() => { setSplitModal({ scan }); setSplitCount(2) }}
                      title="Split into packages"
                      style={{ background: 'none', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 3, color: C.lightBrown, cursor: 'pointer', fontSize: '0.78rem', lineHeight: 1, padding: '0.15rem 0.4rem', fontWeight: 700 }}
                    >÷</button>
                    <button
                      onClick={() => {
                        if (window.confirm(`Remove ${scan.item_name} (${Number(scan.weight_lbs).toFixed(2)} lb)?`)) {
                          removeScan(scan.id)
                        }
                      }}
                      style={{ background: 'rgba(180,40,40,0.15)', border: '1px solid rgba(180,40,40,0.5)', borderRadius: 4, color: '#e05555', cursor: 'pointer', fontSize: '1rem', lineHeight: 1, padding: '0.25rem 0.55rem', fontWeight: 700 }}
                      title="Remove this scan"
                    >×</button>
                  </>
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

      {/* ── Box right-click menu ── */}
      {boxMenu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 250 }}
          onClick={() => setBoxMenu(null)}
          onContextMenu={e => { e.preventDefault(); setBoxMenu(null) }}>
          <div style={{ position: 'fixed', top: Math.min(boxMenu.y, window.innerHeight - 60), left: Math.min(boxMenu.x, window.innerWidth - 240), background: C.darkBrown, border: '1px solid rgba(166,120,90,0.45)', borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,0.6)', overflow: 'hidden' }}>
            <button
              onClick={e => { e.stopPropagation(); const b = boxMenu.box; setBoxMenu(null); openRepack(b) }}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: C.cream, padding: '0.7rem 1.1rem', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ⇱ Repack Box {boxMenu.box.box_number} — move cuts to another box…
            </button>
            <div style={{ height: 1, background: 'rgba(166,120,90,0.25)' }} />
            <button
              onClick={e => { e.stopPropagation(); const b = boxMenu.box; setBoxMenu(null); setReassignBox(b); setReassignNewName(''); loadSessions() }}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', color: C.cream, padding: '0.7rem 1.1rem', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' }}>
              ⇄ Reassign Box {boxMenu.box.box_number} to another session…
            </button>
          </div>
        </div>
      )}

      {/* ── Reassign box modal ── */}
      {reassignBox && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}
          onClick={() => { if (!reassignBusy) { setReassignBox(null); setReassignNewName('') } }}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 8, padding: '1.5rem', width: '100%', maxWidth: 470, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.35rem' }}>
              <div style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Reassign Box {reassignBox.box_number}
              </div>
              <button onClick={() => { setReassignBox(null); setReassignNewName('') }} disabled={reassignBusy}
                style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <div style={{ color: C.lightBrown, fontSize: '0.8rem', marginBottom: '1rem' }}>
              {reassignBusy ? '⟳ Moving box…' : 'Its scans move with it, and a new label prints with the new session info.'}
            </div>

            {/* New session — who is this case for? */}
            <div style={{ display: 'flex', gap: '0.4rem', marginBottom: '1rem' }}>
              <input
                value={reassignNewName}
                onChange={e => setReassignNewName(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter' && reassignNewName.trim() && !reassignBusy) reassignBoxTo(reassignBox, reassignNewName.trim(), date) }}
                placeholder="New session — who is this case for?"
                disabled={reassignBusy}
                style={{ flex: 1, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, padding: '0.55rem 0.7rem', color: C.cream, fontSize: '0.9rem', outline: 'none' }}
              />
              <button
                onClick={() => reassignBoxTo(reassignBox, reassignNewName.trim(), date)}
                disabled={reassignBusy || !reassignNewName.trim()}
                style={{ background: reassignNewName.trim() ? C.tan : C.medBrown, color: C.dark, border: 'none', borderRadius: 4, padding: '0.55rem 1rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', opacity: reassignBusy ? 0.6 : 1, flexShrink: 0 }}>
                + New
              </button>
            </div>

            {/* Existing open sessions */}
            <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.5rem' }}>
              Or pick an open session
            </div>
            {(() => {
              const open = sessions.filter(s =>
                s.status !== 'complete' && !(s.customer_name === customer && s.session_date === date))
              return open.length === 0 ? (
                <div style={{ color: C.lightBrown, fontSize: '0.85rem', textAlign: 'center', padding: '1.5rem 1rem', fontStyle: 'italic' }}>
                  No other open sessions — type a name above to start one.
                </div>
              ) : (
                <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {open.map(s => (
                    <button key={`${s.customer_name}|${s.session_date}`}
                      onClick={() => reassignBoxTo(reassignBox, s.customer_name, s.session_date)}
                      disabled={reassignBusy}
                      style={{ textAlign: 'left', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 6, padding: '0.65rem 0.9rem', cursor: 'pointer', opacity: reassignBusy ? 0.5 : 1 }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.92rem' }}>{s.customer_name}</span>
                        <span style={{ color: C.lightBrown, fontSize: '0.74rem', flexShrink: 0 }}>{s.session_date}</span>
                      </div>
                      <div style={{ color: C.lightBrown, fontSize: '0.74rem', marginTop: '0.15rem' }}>
                        {s.status === 'value_add' ? '◆ Value Add · ' : ''}{s.box_count} box{s.box_count !== 1 ? 'es' : ''}
                        {s.total_weight > 0 && ` · ${s.total_weight.toFixed(1)} lbs`}
                      </div>
                    </button>
                  ))}
                </div>
              )
            })()}
          </div>
        </div>
      )}

      {/* ── Retail order picker ── */}
      {showOrderPicker && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }} onClick={() => setShowOrderPicker(false)}>
          <div onClick={e => e.stopPropagation()} style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 8, padding: '1.5rem', width: '100%', maxWidth: 470, maxHeight: '80vh', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem' }}>
              <div style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                Tie Box {activeBox?.box_number} to a retail order
              </div>
              <button onClick={() => setShowOrderPicker(false)} style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            {orders.length === 0 ? (
              <div style={{ color: C.lightBrown, fontSize: '0.85rem', textAlign: 'center', padding: '2rem 1rem', lineHeight: 1.6 }}>
                No open retail orders.<br />Create one on the <Link href="/orders" style={{ color: C.tan }}>Orders page</Link> first.
              </div>
            ) : (
              <div style={{ overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                {orders.map(o => {
                  const items = o.retail_order_items ?? []
                  const preview = items.slice(0, 3).map(it => it.item_name).join(', ')
                  return (
                    <button key={o.id} onClick={() => activeBox && linkOrder(activeBox, o)}
                      style={{ textAlign: 'left', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 6, padding: '0.7rem 0.9rem', cursor: 'pointer' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '0.5rem' }}>
                        <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.95rem' }}>{o.customer_name}</span>
                        <span style={{ color: C.lightBrown, fontSize: '0.74rem', flexShrink: 0 }}>due {fmtDue(o.due_date)}</span>
                      </div>
                      <div style={{ color: C.lightBrown, fontSize: '0.76rem', marginTop: '0.2rem' }}>
                        {items.length} item{items.length !== 1 ? 's' : ''}{preview ? ` · ${preview}${items.length > 3 ? '…' : ''}` : ''}
                      </div>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Weight entry modal (box / each products) ── */}
      {weightModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 8, padding: '2rem', width: '100%', maxWidth: 340 }}>
            <div style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1.25rem' }}>
              Enter Box Weight
            </div>
            <div style={{ color: C.cream, fontWeight: 700, fontSize: '1rem', marginBottom: '0.3rem' }}>
              {weightModal.itemName}
            </div>
            <div style={{ color: C.lightBrown, fontSize: '0.82rem', marginBottom: '1.5rem', fontFamily: 'monospace' }}>
              PLU {weightModal.plu}
            </div>
            <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.65rem' }}>
              Weight (lbs)
            </div>
            <input
              ref={weightInputRef}
              type="number"
              step="0.01"
              min="0.01"
              value={weightEntry}
              onChange={e => setWeightEntry(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') submitWeightEntry() }}
              style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4, padding: '0.75rem', color: C.cream, fontSize: '1.6rem', fontFamily: 'monospace', outline: 'none', marginBottom: '1.5rem', boxSizing: 'border-box' }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '0.6rem' }}>
              <button
                onClick={() => { setWeightModal(null); setWeightEntry(''); scanRef.current?.focus() }}
                style={{ flex: 1, background: 'transparent', border: '1px solid rgba(166,120,90,0.3)', color: C.lightBrown, borderRadius: 4, padding: '0.75rem', fontSize: '0.9rem', cursor: 'pointer' }}
              >
                Cancel
              </button>
              <button
                onClick={submitWeightEntry}
                disabled={!weightEntry || parseFloat(weightEntry) <= 0}
                style={{ flex: 2, background: C.tan, color: C.dark, border: 'none', borderRadius: 4, padding: '0.75rem', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer' }}
              >
                ✓ Record
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cure tag modal (seal scanned — pick what the tag is riding on) ── */}
      {cureModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
          <div style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 8, padding: '2rem', width: '100%', maxWidth: 380 }}>
            <div style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.5rem' }}>
              🏷 Cure Tag {cureModal.tagNumber}
            </div>

            {cureModal.existing ? (
              // Seal already in use — identify, don't re-record
              <>
                <div style={{ color: C.yellow, fontWeight: 700, fontSize: '0.85rem', marginBottom: '1rem' }}>
                  Already tagged — this seal is in use
                </div>
                <div style={{ color: C.cream, fontWeight: 700, fontSize: '1.15rem', marginBottom: '0.3rem' }}>
                  {cureModal.existing.product} · {cureModal.existing.customer_name}
                </div>
                <div style={{ color: C.lightBrown, fontSize: '0.85rem', marginBottom: '1.5rem' }}>
                  Tagged {cureModal.existing.session_date ?? cureModal.existing.created_at.slice(0, 10)}
                  {cureModal.existing.weight_lbs != null ? `  ·  ${Number(cureModal.existing.weight_lbs).toFixed(2)} lb` : ''}
                  {'  ·  '}{cureModal.existing.status === 'done' ? '✓ Done' : 'In cure'}
                </div>
                <button
                  onClick={() => { setCureModal(null); scanRef.current?.focus() }}
                  style={{ width: '100%', background: C.tan, color: C.dark, border: 'none', borderRadius: 4, padding: '0.75rem', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer' }}
                >
                  Close
                </button>
              </>
            ) : (
              <>
                <div style={{ color: C.lightBrown, fontSize: '0.85rem', marginBottom: '1.25rem' }}>
                  Going to cure for <strong style={{ color: C.cream }}>{customer}</strong>
                </div>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.65rem' }}>
                  Weight (lbs) — optional
                </div>
                <input
                  type="number" step="0.01" min="0.01"
                  value={cureWeight}
                  onChange={e => setCureWeight(e.target.value)}
                  placeholder="—"
                  style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4, padding: '0.6rem 0.75rem', color: C.cream, fontSize: '1.2rem', fontFamily: 'monospace', outline: 'none', marginBottom: '1.25rem', boxSizing: 'border-box' }}
                />
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.65rem' }}>
                  Tap what the tag is on — saves right away
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.5rem', marginBottom: '1.25rem' }}>
                  {['Ham', 'Bacon', 'Shoulder Bacon', 'Hocks', 'Jowl', 'Other'].map(p => (
                    <button
                      key={p}
                      disabled={cureSaving}
                      onClick={() => saveCureTag(p)}
                      style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.4)', color: C.cream, borderRadius: 4, padding: '0.85rem 0.5rem', fontSize: '0.95rem', fontWeight: 700, cursor: cureSaving ? 'default' : 'pointer', opacity: cureSaving ? 0.5 : 1 }}
                    >
                      {p}
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => { setCureModal(null); scanRef.current?.focus() }}
                  style={{ width: '100%', background: 'transparent', border: '1px solid rgba(166,120,90,0.3)', color: C.lightBrown, borderRadius: 4, padding: '0.7rem', fontSize: '0.9rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Split / chub modal ── */}
      {/* ── Repack modal — move cuts out of a box without re-scanning them ── */}
      {repackBox && (() => {
        const pickedLbs = repackScans
          .filter(s => repackPicked.has(s.id))
          .reduce((sum, s) => sum + (Number(s.weight_lbs) || 0), 0)
        const allPicked = repackScans.length > 0 && repackPicked.size === repackScans.length
        const others    = boxes.filter(b => b.id !== repackBox.id)
        const tgtBox    = repackTarget === 'new' ? null : others.find(b => b.id === repackTarget)
        // Reprinting is the honest consequence: a closed box's label states a
        // weight and cut count that this move is about to change.
        const willReprint = [repackBox, ...(tgtBox ? [tgtBox] : [])].filter(b => b.is_closed)
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200, padding: '1rem' }}
            onClick={() => { if (!repackBusy) setRepackBox(null) }}>
            <div onClick={e => e.stopPropagation()} style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 8, padding: '1.5rem', width: '100%', maxWidth: 560, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }}>

              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.3rem' }}>
                <div style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                  Repack Box {repackBox.box_number}
                </div>
                <button onClick={() => setRepackBox(null)} disabled={repackBusy}
                  style={{ background: 'none', border: 'none', color: C.lightBrown, fontSize: '1.4rem', cursor: 'pointer', lineHeight: 1 }}>×</button>
              </div>
              <div style={{ color: C.lightBrown, fontSize: '0.78rem', marginBottom: '1rem', lineHeight: 1.45 }}>
                Pick the cuts that belong somewhere else. They are <strong style={{ color: C.tan }}>moved</strong>, not re-scanned,
                so the weight is never counted twice.
              </div>

              {/* Select cuts */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.45rem' }}>
                <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                  Cuts to move
                </div>
                <button
                  onClick={() => setRepackPicked(allPicked ? new Set() : new Set(repackScans.map(s => s.id)))}
                  style={{ background: 'none', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, color: C.lightBrown, fontSize: '0.72rem', padding: '0.2rem 0.55rem', cursor: 'pointer' }}>
                  {allPicked ? 'Clear all' : 'Select all'}
                </button>
              </div>
              <div style={{ flex: 1, overflowY: 'auto', minHeight: 100, maxHeight: 260, background: 'rgba(0,0,0,0.25)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 4, marginBottom: '1rem' }}>
                {repackScans.length === 0 ? (
                  <div style={{ padding: '1.5rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.85rem', fontStyle: 'italic' }}>
                    This box has no cuts in it.
                  </div>
                ) : repackScans.map(s => {
                  const on = repackPicked.has(s.id)
                  return (
                    <label key={s.id}
                      style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', padding: '0.5rem 0.85rem', borderBottom: '1px solid rgba(166,120,90,0.08)', cursor: 'pointer', background: on ? 'rgba(201,168,130,0.10)' : 'transparent' }}>
                      <input
                        type="checkbox" checked={on}
                        onChange={() => setRepackPicked(prev => {
                          const next = new Set(prev)
                          if (next.has(s.id)) next.delete(s.id); else next.add(s.id)
                          return next
                        })}
                        style={{ width: 17, height: 17, accentColor: C.tan, cursor: 'pointer', flexShrink: 0 }}
                      />
                      <span style={{ color: C.cream, fontSize: '0.88rem', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.item_name || `PLU ${s.plu_number}`}
                      </span>
                      <span style={{ color: C.lightBrown, fontSize: '0.7rem', fontFamily: 'monospace', flexShrink: 0 }}>PLU {s.plu_number}</span>
                      <span style={{ color: C.tan, fontSize: '0.85rem', fontFamily: 'monospace', fontWeight: 700, flexShrink: 0, minWidth: 64, textAlign: 'right' }}>
                        {Number(s.weight_lbs).toFixed(2)} lb
                      </span>
                    </label>
                  )
                })}
              </div>

              {/* Destination */}
              <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.45rem' }}>
                Move them into
              </div>
              <select
                value={repackTarget}
                onChange={e => setRepackTarget(e.target.value)}
                style={{ width: '100%', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4, padding: '0.6rem', color: C.cream, fontSize: '0.9rem', outline: 'none', marginBottom: '0.85rem' }}
              >
                <option value="new">+ A new box in this session</option>
                {others.map(b => (
                  <option key={b.id} value={b.id}>
                    Box {b.box_number}{b.is_final ? ' ★' : ''}{b.box_label ? ` · ${b.box_label}` : ''}{b.is_closed ? ' (closed)' : ''}
                  </option>
                ))}
              </select>

              {/* What is about to happen */}
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.65rem 0.9rem', marginBottom: '1rem', fontFamily: 'monospace', fontSize: '0.88rem', fontWeight: 700, color: repackPicked.size > 0 ? C.tan : C.lightBrown }}>
                → {repackPicked.size} cut{repackPicked.size !== 1 ? 's' : ''} · {pickedLbs.toFixed(2)} lb
                {' '}into {repackTarget === 'new' ? 'a new box' : `Box ${tgtBox?.box_number}`}
              </div>
              {willReprint.length > 0 && repackPicked.size > 0 && (
                <div style={{ color: C.yellow, fontSize: '0.75rem', marginBottom: '1rem', lineHeight: 1.4 }}>
                  ⚠ Box {willReprint.map(b => b.box_number).join(' and ')} {willReprint.length > 1 ? 'are' : 'is'} closed —
                  a corrected label will print. Replace the one on the box.
                </div>
              )}

              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button
                  onClick={() => setRepackBox(null)} disabled={repackBusy}
                  style={{ flex: 1, background: 'transparent', border: '1px solid rgba(166,120,90,0.3)', color: C.lightBrown, borderRadius: 4, padding: '0.75rem', fontSize: '0.9rem', cursor: 'pointer' }}>
                  Cancel
                </button>
                <button
                  onClick={doRepack}
                  disabled={repackBusy || repackPicked.size === 0}
                  style={{ flex: 2, background: repackPicked.size === 0 ? C.medBrown : C.tan, color: C.dark, border: 'none', borderRadius: 4, padding: '0.75rem', fontSize: '0.9rem', fontWeight: 700, cursor: repackPicked.size === 0 ? 'not-allowed' : 'pointer', opacity: repackBusy ? 0.7 : 1 }}>
                  {repackBusy ? '⟳ Moving…' : '⇱ Move cuts'}
                </button>
              </div>

            </div>
          </div>
        )
      })()}

      {splitModal && (() => {
        const { scan } = splitModal
        const each     = splitCount > 0 ? Math.round((scan.weight_lbs / splitCount) * 100) / 100 : 0
        return (
          <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.8)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200 }}>
            <div style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 8, padding: '2rem', width: '100%', maxWidth: 340 }}>

              {/* Title */}
              <div style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '1.25rem' }}>
                Split Into Packages
              </div>

              {/* Item info */}
              <div style={{ color: C.cream, fontWeight: 700, fontSize: '1rem', marginBottom: '0.3rem' }}>
                {scan.item_name || `PLU ${scan.plu_number}`}
              </div>
              <div style={{ color: C.lightBrown, fontSize: '0.85rem', marginBottom: '1.5rem', fontFamily: 'monospace' }}>
                Total case weight: {Number(scan.weight_lbs).toFixed(2)} lbs
              </div>

              {/* Count label */}
              <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.65rem' }}>
                Number of packages / chubs in case
              </div>

              {/* +/- counter */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
                <button
                  onClick={() => setSplitCount(n => Math.max(2, n - 1))}
                  style={{ width: 44, height: 44, borderRadius: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)', color: C.cream, fontSize: '1.4rem', fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}
                >−</button>
                <input
                  type="number" min={2}
                  value={splitCount}
                  onChange={e => setSplitCount(Math.max(2, parseInt(e.target.value) || 2))}
                  style={{ width: 72, textAlign: 'center', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4, padding: '0.5rem', color: C.cream, fontSize: '1.3rem', fontFamily: 'monospace', outline: 'none' }}
                />
                <button
                  onClick={() => setSplitCount(n => n + 1)}
                  style={{ width: 44, height: 44, borderRadius: 4, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)', color: C.cream, fontSize: '1.4rem', fontWeight: 700, cursor: 'pointer', lineHeight: 1 }}
                >+</button>
              </div>

              {/* Live preview */}
              <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1.5rem', fontFamily: 'monospace', fontSize: '1rem', fontWeight: 700, color: C.tan }}>
                → {splitCount} × {each.toFixed(2)} lbs each
              </div>

              {/* Buttons */}
              <div style={{ display: 'flex', gap: '0.6rem' }}>
                <button
                  onClick={() => { setSplitModal(null); setSplitCount(2); scanRef.current?.focus() }}
                  style={{ flex: 1, background: 'transparent', border: '1px solid rgba(166,120,90,0.3)', color: C.lightBrown, borderRadius: 4, padding: '0.75rem', fontSize: '0.9rem', cursor: 'pointer' }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => doSplit(scan, splitCount)}
                  disabled={splitting || splitCount < 2}
                  style={{ flex: 2, background: splitting ? C.medBrown : C.tan, color: C.dark, border: 'none', borderRadius: 4, padding: '0.75rem', fontSize: '0.9rem', fontWeight: 700, cursor: 'pointer', opacity: splitting ? 0.7 : 1 }}
                >
                  {splitting ? '⟳ Splitting…' : `÷ Split into ${splitCount}`}
                </button>
              </div>

            </div>
          </div>
        )
      })()}

    </div>
  )
}
