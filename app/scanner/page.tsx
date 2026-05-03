'use client'
import { useEffect, useState, useRef, useCallback } from 'react'
import Link from 'next/link'

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
  const [scanValue,  setScanValue]  = useState('')
  const [flash,      setFlash]      = useState<'ok' | 'bad' | null>(null)
  const [lastItem,   setLastItem]   = useState('')
  const [processing, setProcessing] = useState(false)

  const scanRef       = useRef<HTMLInputElement>(null)
  // Stable refs so event listeners don't go stale
  const activeBoxRef  = useRef<BoxRecord | null>(null)
  const pluMapRef     = useRef<Record<string, string>>({})
  const processingRef = useRef(false)
  const scansRef      = useRef<ScanLine[]>([])
  const startedRef    = useRef(false)

  activeBoxRef.current  = activeBox
  pluMapRef.current     = pluMap
  processingRef.current = processing
  scansRef.current      = scans
  startedRef.current    = started

  // ── Load PLU database once ───────────────────────────────────────────────────
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
      if (/^\d$/.test(e.key)) {
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
    openPrintWindow(closed, snap)
  }

  // ── Print label ───────────────────────────────────────────────────────────────
  function openPrintWindow(box: BoxRecord, labelScans: ScanLine[]) {
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
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${box.customer_name} ${boxLabel}</title>
<style>
@page { size: 4in auto; margin: .15in }
* { box-sizing: border-box; margin: 0; padding: 0 }
body { width: 3.7in; font-family: Arial, sans-serif; color: #000 }
.co { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 9pt; font-weight: bold; text-align: center; letter-spacing: .05em; margin-bottom: 2px }
.cu { font-size: 20pt; font-weight: bold; text-align: center; line-height: 1.1; margin: 4px 0 }
.bn { font-size: 14pt; font-weight: bold; text-align: center; margin-bottom: 2px }
.dt { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 9pt; text-align: center; margin-bottom: 4px }
hr  { border: none; border-top: 1px solid #000; margin: 5px 0 }
.r  { display: flex; justify-content: space-between; font-family: 'Arial Narrow', Arial, sans-serif; font-size: 11pt; padding: 1px 0 }
.ft { font-family: 'Arial Narrow', Arial, sans-serif; font-size: 10pt; font-weight: bold; text-align: center; margin-top: 2px }
</style></head><body>
<div class="co">COWBOY MEAT COMPANY</div>
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

  // ── Derived ───────────────────────────────────────────────────────────────────
  const totalWeight  = scans.reduce((s, sc) => s + (Number(sc.weight_lbs) || 0), 0)
  const isOpen       = activeBox && !activeBox.is_closed
  const closedWeight = boxes.filter(b => b.is_closed).reduce((s, b) => s + (Number(b.total_weight_lbs) || 0), 0)
  const borderColor  = flash === 'ok' ? C.green : flash === 'bad' ? C.red : isOpen ? 'rgba(201,168,130,0.5)' : 'rgba(166,120,90,0.2)'

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
              Floor Scanner
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
          <span style={{ fontSize: '0.72rem', color: C.lightBrown }}>{Object.keys(pluMap).length} PLUs</span>
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
              const v = e.target.value.replace(/\D/g, '')
              setScanValue(v)
              if (v.length === 13) doScan(v)
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && scanValue.length > 0 && scanValue.length < 13) {
                doScan(scanValue)
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
          <div style={{ flexShrink: 0, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
              <span style={{ color: C.cream, fontWeight: 700, fontSize: '1.05rem' }}>
                Box {activeBox.box_number}{activeBox.is_final ? ' ★' : ''}
              </span>
              <span style={{ fontSize: '0.8rem', fontWeight: 700, color: activeBox.is_closed ? C.green : C.tan }}>
                {activeBox.is_closed ? '✓ Closed' : 'Open'}
              </span>
              <span style={{ fontSize: '0.82rem', color: C.lightBrown }}>
                {scans.length} item{scans.length !== 1 ? 's' : ''} · {totalWeight.toFixed(2)} lbs
              </span>
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
        )}

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
