'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { DeliveryScan } from '@/lib/types'
import { isoDateTime } from '@/lib/dates'

type Tab = 'new' | 'log' | 'baker'
type LogFilter = 'all' | 'pending' | 'reviewed'
type Destination = 'customer' | 'baker_storage'

// A processing session as the scanner reports it — enough to put it on a run.
interface SessionLite {
  customer_name: string
  session_date:  string
  status:        string
  box_count:     number
  total_weight:  number
}

const DEST_CFG: Record<Destination, { label: string; short: string; icon: string; color: string }> = {
  customer:      { label: 'To Customer',   short: 'Customer', icon: '🏠', color: '#4CAF50' },
  baker_storage: { label: 'Baker Storage', short: 'Baker',    icon: '🚚', color: '#C9A882' },
}

function daysSince(sessionDate: string): number {
  return Math.max(0, Math.floor((Date.now() - new Date(sessionDate + 'T12:00:00').getTime()) / 86400000))
}

const sessionKey = (s: { customer_name: string; session_date: string }) => `${s.customer_name}|${s.session_date}`

// ── Barcode type detection ────────────────────────────────────────────────────
type BarcodeType = 'ean13' | 'carcass' | 'cmc_box' | 'unknown'

function identifyBarcode(raw: string): BarcodeType {
  if (/^\d{13}$/.test(raw) && raw[0] === '2') return 'ean13'
  if (/^CT-[0-9a-f-]{36}$/i.test(raw))        return 'carcass'
  if (/^CMC-\d{8}-\d{3}$/.test(raw))          return 'cmc_box'
  return 'unknown'
}

// ── EAN-13 weight-embedded decode ─────────────────────────────────────────────
// [0]='2', [1–5]=PLU, [6]=flag, [7–11]=weight in hundredths lb ÷100, [12]=check
function decodeBarcode(barcode: string): { plu: string; weightLbs: number } | null {
  if (barcode.length !== 13 || barcode[0] !== '2') return null
  if (!/^\d{13}$/.test(barcode)) return null
  const plu    = parseInt(barcode.substring(1, 6), 10)
  const weight = parseInt(barcode.substring(7, 12), 10) / 100
  if (plu <= 0 || weight <= 0) return null
  return { plu: String(plu), weightLbs: weight }
}

// ── Human-readable label for any barcode type ─────────────────────────────────
function barcodeLabel(barcode: string, pluMap: Record<string, string>): { icon: string; primary: string; secondary?: string } {
  const type = identifyBarcode(barcode)
  if (type === 'ean13') {
    const dec = decodeBarcode(barcode)
    if (dec) {
      const name = pluMap[dec.plu] ?? `PLU ${dec.plu}`
      return { icon: '🥩', primary: name, secondary: `${dec.weightLbs.toFixed(2)} lb` }
    }
  }
  if (type === 'carcass') {
    // CT-{uuid} — show short tag
    const short = barcode.slice(0, 11) + '…'
    return { icon: '🐄', primary: 'Carcass', secondary: short }
  }
  if (type === 'cmc_box') {
    // CMC-20260411-001 → Box #1 · Apr 11
    const parts = barcode.match(/^CMC-(\d{4})(\d{2})(\d{2})-(\d+)$/)
    if (parts) {
      const dt  = new Date(`${parts[1]}-${parts[2]}-${parts[3]}T12:00:00`).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
      const num = parseInt(parts[4], 10)
      return { icon: '📦', primary: `Box #${num}`, secondary: dt }
    }
    return { icon: '📦', primary: 'CMC Box', secondary: barcode }
  }
  return { icon: '◻', primary: barcode }
}

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

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, [string, string]> = {
    pending:  [C.yellow, C.dark],
    reviewed: [C.green,  C.dark],
  }
  const [bg, fg] = map[status] ?? [C.medBrown, C.cream]
  return (
    <span style={{ background: bg, color: fg, fontSize: '0.7rem', fontWeight: 700, borderRadius: 99, padding: '2px 10px', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
      {status}
    </span>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW DELIVERY TAB
// ══════════════════════════════════════════════════════════════════════════════
function NewDeliveryTab({ onSaved, pluMap }: { onSaved: () => void; pluMap: Record<string, string> }) {
  const barcodeInputRef = useRef<HTMLInputElement>(null)
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState('')

  const [destination, setDestination] = useState<Destination>('customer')
  const [sessions, setSessions] = useState<SessionLite[]>([])
  const [picked, setPicked] = useState<string[]>([])

  const [form, setForm] = useState({
    delivered_at: isoDateTime(),
    driver:       '',
    customer:     '',
    notes:        '',
  })
  const [barcodes, setBarcodes] = useState<{ barcode: string; scannedAt: string }[]>([])
  const [barcodeInput, setBarcodeInput] = useState('')
  const [lastAdded, setLastAdded] = useState('')

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  // Everything sitting in the freezer is loadable; a Baker run can also be
  // hauling something back out of the locker to its owner.
  useEffect(() => {
    fetch('/api/processing/sessions')
      .then(r => r.json())
      .then((data: unknown) => {
        if (!Array.isArray(data)) return
        setSessions((data as SessionLite[]).filter(s => s.status === 'complete' || s.status === 'baker_storage'))
      })
      .catch(() => {})
  }, [])

  const loadable = sessions
    .filter(s => destination === 'baker_storage' ? s.status === 'complete' : true)
    .sort((a, b) => a.session_date.localeCompare(b.session_date))

  const pickedSessions = sessions.filter(s => picked.includes(sessionKey(s)))

  function togglePick(s: SessionLite) {
    const key = sessionKey(s)
    setPicked(prev => prev.includes(key) ? prev.filter(k => k !== key) : [...prev, key])
  }

  // One picked session names the run; several make it a multi-stop haul.
  const derivedCustomer = form.customer.trim()
    || (pickedSessions.length === 1 ? pickedSessions[0].customer_name : '')
    || (pickedSessions.length > 1 ? `${pickedSessions.length} customers` : '')

  const canSave = !!form.driver.trim() && !!derivedCustomer

  function addBarcode(raw: string) {
    const val = raw.trim()
    if (!val) return
    if (barcodes.some(b => b.barcode === val)) {
      // Duplicate — flash warning
      setLastAdded(`⚠ Duplicate: ${val}`)
      setBarcodeInput('')
      setTimeout(() => setLastAdded(''), 2500)
      return
    }
    const entry = { barcode: val, scannedAt: new Date().toISOString() }
    setBarcodes(prev => [...prev, entry])
    setBarcodeInput('')
    setLastAdded(`✓ Added: ${val}`)
    setTimeout(() => setLastAdded(''), 2000)
    barcodeInputRef.current?.focus()
  }

  function removeBarcode(idx: number) {
    setBarcodes(prev => prev.filter((_, i) => i !== idx))
  }

  async function handleSubmit() {
    if (!canSave) return
    setSaving(true)
    const res = await fetch('/api/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      // delivered_at is a datetime-local wall-time string — store a real
      // instant so it sorts consistently with API-defaulted UTC rows.
      body: JSON.stringify({
        ...form,
        customer:     derivedCustomer,
        delivered_at: new Date(form.delivered_at).toISOString(),
        barcodes,
        destination,
        session_refs: pickedSessions.map(s => ({ customer_name: s.customer_name, session_date: s.session_date })),
      }),
    })
    const saved = await res.json().catch(() => null)
    setSaving(false)
    if (!res.ok) {
      setSuccess(`⚠ Save failed — ${saved?.error ?? 'try again'}`)
      setTimeout(() => setSuccess(''), 6000)
      return
    }
    const moved = saved?.sessions_updated ?? 0
    setSuccess(moved > 0
      ? `✓ Delivery saved — ${moved} session${moved !== 1 ? 's' : ''} moved to ${DEST_CFG[destination].label}`
      : '✓ Delivery saved')
    setForm({ delivered_at: isoDateTime(), driver: '', customer: '', notes: '' })
    setBarcodes([])
    setPicked([])
    // Picked sessions have changed status — refresh so they leave the list
    fetch('/api/processing/sessions')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setSessions((data as SessionLite[]).filter(s => s.status === 'complete' || s.status === 'baker_storage'))
      })
      .catch(() => {})
    onSaved()
    setTimeout(() => setSuccess(''), 5000)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — form */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
        <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 1.25rem' }}>
          New Delivery
        </h3>

        {success && (
          <div style={{
            background: success.startsWith('⚠') ? 'rgba(217,119,6,0.15)' : 'rgba(76,175,80,0.15)',
            border: `1px solid ${success.startsWith('⚠') ? 'rgba(217,119,6,0.4)' : 'rgba(76,175,80,0.4)'}`,
            borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1rem',
            color: success.startsWith('⚠') ? C.yellow : C.green, fontSize: '0.85rem',
          }}>
            {success}
          </div>
        )}

        {/* Destination — where this run drops the product */}
        <div style={{ marginBottom: '0.9rem' }}>
          <label style={LABEL}>Destination *</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            {(Object.keys(DEST_CFG) as Destination[]).map(d => {
              const cfg = DEST_CFG[d]
              const on  = destination === d
              return (
                <button
                  key={d}
                  onClick={() => { setDestination(d); setPicked([]) }}
                  style={{
                    flex: 1, borderRadius: 3, padding: '0.55rem 0.5rem', fontSize: '0.83rem', fontWeight: 700,
                    cursor: 'pointer', letterSpacing: '0.03em',
                    background: on ? cfg.color : 'transparent',
                    color: on ? C.dark : cfg.color,
                    border: `1px solid ${cfg.color}`,
                  }}
                >
                  {cfg.icon} {cfg.label}
                </button>
              )
            })}
          </div>
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.35rem' }}>
            {destination === 'baker_storage'
              ? 'Hauled to the locker in Baker — still ours, still on storage fee.'
              : 'Into the customer’s hands — closes the session out.'}
          </div>
        </div>

        <div style={{ marginBottom: '0.9rem' }}>
          <label style={LABEL}>Date / Time *</label>
          <input type="datetime-local" style={INPUT} value={form.delivered_at} onChange={f('delivered_at')} />
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 1rem' }}>
          <div style={{ marginBottom: '0.9rem' }}>
            <label style={LABEL}>Driver *</label>
            <input style={INPUT} value={form.driver} onChange={f('driver')} placeholder="Name" />
          </div>
          <div style={{ marginBottom: '0.9rem' }}>
            <label style={LABEL}>Customer {pickedSessions.length > 0 ? '' : '*'}</label>
            <input style={INPUT} value={form.customer} onChange={f('customer')}
              placeholder={pickedSessions.length > 0 ? derivedCustomer : 'Name'} />
          </div>
        </div>

        {/* Sessions on this run — the tie-in to the processing scanner */}
        <div style={{ marginBottom: '0.9rem' }}>
          <label style={LABEL}>
            Sessions on this run {picked.length > 0 && <span style={{ color: C.tan }}>· {picked.length} selected</span>}
          </label>
          <div style={{ border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, maxHeight: 190, overflowY: 'auto', background: 'rgba(255,255,255,0.03)' }}>
            {loadable.length === 0 ? (
              <p style={{ color: C.lightBrown, fontSize: '0.8rem', padding: '0.9rem', margin: 0, textAlign: 'center' }}>
                Nothing in the freezer to load.
              </p>
            ) : loadable.map(s => {
              const key = sessionKey(s)
              const on  = picked.includes(key)
              const d   = daysSince(s.session_date)
              return (
                <div
                  key={key}
                  onClick={() => togglePick(s)}
                  style={{
                    display: 'flex', alignItems: 'center', gap: '0.6rem', cursor: 'pointer',
                    padding: '0.5rem 0.75rem', borderBottom: '1px solid rgba(166,120,90,0.1)',
                    background: on ? 'rgba(201,168,130,0.14)' : 'transparent',
                  }}
                >
                  <span style={{ color: on ? C.tan : C.lightBrown, fontSize: '0.9rem', lineHeight: 1 }}>{on ? '☑' : '☐'}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ color: C.cream, fontSize: '0.83rem', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.customer_name}
                    </div>
                    <div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>
                      {s.box_count} box{s.box_count !== 1 ? 'es' : ''}
                      {s.total_weight > 0 && ` · ${s.total_weight.toFixed(1)} lbs`}
                      {` · ${d}d`}
                    </div>
                  </div>
                  {s.status === 'baker_storage' && (
                    <span style={{ fontSize: '0.66rem', fontWeight: 700, color: C.tan, background: 'rgba(201,168,130,0.15)', borderRadius: 99, padding: '2px 7px', flexShrink: 0 }}>
                      IN BAKER
                    </span>
                  )}
                </div>
              )
            })}
          </div>
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.3rem' }}>
            {destination === 'baker_storage'
              ? 'Selected sessions move to Baker Storage on save.'
              : 'Selected sessions get marked picked up on save.'}
          </div>
        </div>

        {/* Barcode scanner section */}
        <div style={{ marginBottom: '0.9rem' }}>
          <label style={LABEL}>Scan / Enter Barcodes</label>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input
              ref={barcodeInputRef}
              style={{ ...INPUT, flex: 1, fontFamily: 'monospace', fontSize: '0.95rem' }}
              value={barcodeInput}
              onChange={e => setBarcodeInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addBarcode(barcodeInput) } }}
              placeholder="Scan or type barcode → Enter"
              autoComplete="off"
            />
            <button style={{ ...BTN(C.medBrown, C.cream), whiteSpace: 'nowrap', flexShrink: 0 }} onClick={() => addBarcode(barcodeInput)}>
              Add
            </button>
          </div>
          {lastAdded && (
            <div style={{ fontSize: '0.8rem', color: lastAdded.startsWith('⚠') ? C.yellow : C.green, marginTop: '0.35rem', fontFamily: 'monospace' }}>
              {lastAdded}
            </div>
          )}
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.3rem' }}>
            Barcode scanner will auto-add on scan. Press Enter after manual entry.
          </div>
        </div>

        <div style={{ marginBottom: '1rem' }}>
          <label style={LABEL}>Notes</label>
          <textarea style={{ ...INPUT, height: 72, resize: 'vertical' }} value={form.notes} onChange={f('notes')} placeholder="Delivery notes, issues, etc." />
        </div>

        <button
          style={{ ...BTN(canSave ? C.tan : C.medBrown), width: '100%', opacity: canSave ? 1 : 0.55 }}
          onClick={handleSubmit}
          disabled={saving || !canSave}
        >
          {saving ? 'Saving…' : `Save ${DEST_CFG[destination].icon} ${DEST_CFG[destination].short} Delivery${barcodes.length > 0 ? ` (${barcodes.length} items)` : ''}`}
        </button>
      </div>

      {/* Right — barcode list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
            Scanned Items
          </span>
          <span style={{ fontSize: '1.1rem', fontWeight: 700, color: C.cream }}>{barcodes.length}</span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1, padding: '0.5rem 0' }}>
          {barcodes.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>
              No items scanned yet.<br />
              <span style={{ fontSize: '0.78rem' }}>Focus the barcode field and start scanning.</span>
            </p>
          )}
          {[...barcodes].reverse().map((b, ri) => {
            const idx   = barcodes.length - 1 - ri
            const label = barcodeLabel(b.barcode, pluMap)
            return (
              <div key={b.barcode} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.08)' }}>
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}>
                    <span style={{ fontSize: '1rem', lineHeight: 1 }}>{label.icon}</span>
                    <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>{label.primary}</span>
                    {label.secondary && <span style={{ color: C.lightBrown, fontSize: '0.82rem' }}>{label.secondary}</span>}
                  </div>
                  <div style={{ color: C.lightBrown, fontSize: '0.72rem', marginTop: '0.15rem' }}>
                    {new Date(b.scannedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                  </div>
                </div>
                <button
                  onClick={() => removeBarcode(idx)}
                  style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', fontSize: '1rem', padding: '0 0.25rem', lineHeight: 1 }}
                  title="Remove"
                >
                  ×
                </button>
              </div>
            )
          })}
        </div>

        {barcodes.length > 0 && (
          <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(166,120,90,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: C.tan }}>{barcodes.length} item{barcodes.length !== 1 ? 's' : ''} ready to save</span>
            <button
              onClick={() => setBarcodes([])}
              style={{ background: 'none', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, color: C.lightBrown, cursor: 'pointer', fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}
            >
              Clear All
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// DELIVERY LOG TAB
// ══════════════════════════════════════════════════════════════════════════════
function DeliveryLogTab({ pluMap }: { pluMap: Record<string, string> }) {
  const [deliveries, setDeliveries] = useState<DeliveryScan[]>([])
  const [selected, setSelected] = useState<DeliveryScan | null>(null)
  const [filter, setFilter] = useState<LogFilter>('all')
  const [marking, setMarking] = useState(false)

  const load = useCallback(async () => {
    const res = await fetch('/api/delivery')
    const data: DeliveryScan[] = await res.json()
    setDeliveries(data)
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = deliveries.filter(d => filter === 'all' || d.status === filter)

  async function markReviewed(d: DeliveryScan) {
    setMarking(true)
    const res = await fetch('/api/delivery', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: d.id, status: 'reviewed' }),
    })
    const updated = await res.json()
    setSelected(updated)
    setDeliveries(prev => prev.map(x => x.id === updated.id ? updated : x))
    setMarking(false)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        {/* Filter */}
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(166,120,90,0.2)', display: 'flex', gap: '0.4rem' }}>
          {(['all', 'pending', 'reviewed'] as LogFilter[]).map(f => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              style={{
                padding: '0.3rem 0.8rem', borderRadius: 99, border: 'none', cursor: 'pointer',
                fontSize: '0.75rem', fontWeight: 600, textTransform: 'capitalize',
                background: filter === f ? C.medBrown : 'rgba(255,255,255,0.05)',
                color: filter === f ? C.cream : C.lightBrown,
                transition: 'background 0.15s',
              }}
            >
              {f}
            </button>
          ))}
          <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: C.lightBrown, alignSelf: 'center' }}>
            {filtered.length}
          </span>
        </div>

        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 && (
            <p style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>No deliveries found</p>
          )}
          {filtered.map(d => {
            // Build unique label list from barcodes (cuts, carcasses, boxes)
            const itemLabels: string[] = []
            for (const b of d.barcodes ?? []) {
              const lbl     = barcodeLabel(b.barcode, pluMap)
              const display = `${lbl.icon} ${lbl.primary}`
              if (!itemLabels.includes(display)) itemLabels.push(display)
            }
            const shown    = itemLabels.slice(0, 3)
            const overflow = itemLabels.length - shown.length
            return (
              <div
                key={d.id}
                onClick={() => setSelected(d)}
                style={{
                  padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.12)',
                  cursor: 'pointer', background: selected?.id === d.id ? 'rgba(166,120,90,0.12)' : 'transparent',
                  transition: 'background 0.15s',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
                  <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>{d.customer}</span>
                  <StatusBadge status={d.status} />
                </div>
                <div style={{ fontSize: '0.78rem', color: C.tan }}>
                  {d.destination === 'baker_storage' && (
                    <span style={{ color: DEST_CFG.baker_storage.color, fontWeight: 700 }}>🚚 Baker · </span>
                  )}
                  {new Date(d.delivered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {d.driver ? ` · ${d.driver}` : ''}
                </div>
                {/* Cut names summary */}
                {shown.length > 0 ? (
                  <div style={{ fontSize: '0.74rem', color: C.lightBrown, marginTop: '0.25rem', lineHeight: 1.5 }}>
                    {shown.map((label, i) => (
                      <span key={label}>
                        <span style={{ color: C.tan }}>{label}</span>
                        {i < shown.length - 1 && <span style={{ color: 'rgba(166,120,90,0.4)' }}> · </span>}
                      </span>
                    ))}
                    {overflow > 0 && <span style={{ color: 'rgba(166,120,90,0.5)' }}> +{overflow} more</span>}
                  </div>
                ) : (
                  <div style={{ fontSize: '0.74rem', color: C.lightBrown, marginTop: '0.15rem' }}>
                    {d.barcodes?.length ?? 0} item{(d.barcodes?.length ?? 0) !== 1 ? 's' : ''}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>

      {/* Right — detail */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: C.lightBrown, fontSize: '0.9rem' }}>
            ← Select a delivery to view
          </div>
        ) : (
          <>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.5rem' }}>
              <div>
                <h2 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.15rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.4rem' }}>
                  {selected.customer}
                </h2>
                <div style={{ fontSize: '0.82rem', color: C.tan }}>
                  {new Date(selected.delivered_at).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}
                </div>
                {selected.driver && (
                  <div style={{ fontSize: '0.8rem', color: C.lightBrown, marginTop: '0.2rem' }}>Driver: {selected.driver}</div>
                )}
                <div style={{ marginTop: '0.45rem' }}>
                  <span style={{
                    fontSize: '0.72rem', fontWeight: 700, borderRadius: 99, padding: '3px 10px',
                    color: DEST_CFG[(selected.destination as Destination)] ? DEST_CFG[selected.destination as Destination].color : C.tan,
                    background: 'rgba(255,255,255,0.05)',
                  }}>
                    {(DEST_CFG[selected.destination as Destination] ?? DEST_CFG.customer).icon}{' '}
                    {(DEST_CFG[selected.destination as Destination] ?? DEST_CFG.customer).label}
                  </span>
                </div>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
                <StatusBadge status={selected.status} />
                {selected.status === 'pending' && (
                  <button style={BTN(C.green, C.dark)} onClick={() => markReviewed(selected)} disabled={marking}>
                    {marking ? 'Saving…' : '✓ Mark Reviewed'}
                  </button>
                )}
              </div>
            </div>

            {selected.notes && (
              <div style={{ background: 'rgba(166,120,90,0.08)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '0.85rem 1.25rem', marginBottom: '1.25rem', fontSize: '0.85rem', color: C.tan, fontStyle: 'italic' }}>
                {selected.notes}
              </div>
            )}

            {/* Summary bar */}
            <div style={{ display: 'flex', gap: '1.5rem', padding: '0.85rem 1.25rem', background: 'rgba(255,255,255,0.04)', borderRadius: 4, marginBottom: '1.25rem' }}>
              <div style={{ textAlign: 'center' }}>
                <div style={{ fontSize: '1.6rem', fontWeight: 700, color: C.cream, lineHeight: 1 }}>{selected.barcodes?.length ?? 0}</div>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: '0.2rem' }}>Items</div>
              </div>
            </div>

            {/* Sessions this run covered */}
            {(selected.session_refs?.length ?? 0) > 0 && (
              <div style={{ marginBottom: '1.25rem' }}>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
                  Sessions on this run
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem' }}>
                  {selected.session_refs.map(r => (
                    <span key={`${r.customer_name}|${r.session_date}`}
                      style={{ background: 'rgba(201,168,130,0.12)', border: '1px solid rgba(201,168,130,0.3)', borderRadius: 3, padding: '0.3rem 0.6rem', fontSize: '0.78rem', color: C.tan }}>
                      {r.customer_name}
                      <span style={{ color: C.lightBrown }}> · {new Date(r.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</span>
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Barcode list */}
            {(selected.barcodes?.length ?? 0) > 0 ? (
              <>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
                  Scanned Items
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {selected.barcodes.map((b, i) => {
                    const label = barcodeLabel(b.barcode, pluMap)
                    return (
                      <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 3, padding: '0.55rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
                          <span style={{ fontSize: '1.15rem', lineHeight: 1 }}>{label.icon}</span>
                          <div>
                            <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>
                              {label.primary}
                              {label.secondary && <span style={{ color: C.tan, fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.82rem' }}>{label.secondary}</span>}
                            </div>
                            <div style={{ fontFamily: 'monospace', color: C.lightBrown, fontSize: '0.7rem', marginTop: '0.1rem' }}>
                              {b.barcode}
                            </div>
                          </div>
                        </div>
                        <div style={{ fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0, marginLeft: '1rem' }}>
                          {new Date(b.scannedAt).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' })}
                        </div>
                      </div>
                    )
                  })}
                </div>
              </>
            ) : (
              <p style={{ color: C.lightBrown, fontSize: '0.85rem', fontStyle: 'italic' }}>No barcodes recorded for this delivery.</p>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// BAKER STORAGE TAB — what's on the shelf in Baker right now
// ══════════════════════════════════════════════════════════════════════════════
function BakerStorageTab() {
  const [sessions, setSessions] = useState<SessionLite[]>([])
  const [loading, setLoading]   = useState(true)
  const [busy, setBusy]         = useState('')

  const load = useCallback(() => {
    fetch('/api/processing/sessions')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) setSessions((data as SessionLite[]).filter(s => s.status === 'baker_storage'))
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  // Oldest first — the top of this list is what's been billing storage longest.
  const inBaker = [...sessions].sort((a, b) => a.session_date.localeCompare(b.session_date))
  const totalWeight = inBaker.reduce((sum, s) => sum + (s.total_weight || 0), 0)
  const totalBoxes  = inBaker.reduce((sum, s) => sum + (s.box_count || 0), 0)

  async function markPickedUp(s: SessionLite) {
    setBusy(sessionKey(s))
    await fetch('/api/processing/sessions', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ customer_name: s.customer_name, session_date: s.session_date, status: 'picked_up' }),
    })
    setSessions(prev => prev.filter(x => sessionKey(x) !== sessionKey(s)))
    setBusy('')
  }

  if (loading) {
    return <div style={{ color: C.lightBrown, fontSize: '0.9rem', textAlign: 'center', padding: '3rem' }}>Loading…</div>
  }

  return (
    <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '1.25rem', flexWrap: 'wrap', gap: '0.75rem' }}>
        <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>
          🚚 On the shelf in Baker
        </h3>
        <div style={{ fontSize: '0.82rem', color: C.tan }}>
          {inBaker.length} customer{inBaker.length !== 1 ? 's' : ''} · {totalBoxes} box{totalBoxes !== 1 ? 'es' : ''}
          {totalWeight > 0 && ` · ${totalWeight.toFixed(1)} lbs`}
        </div>
      </div>

      {inBaker.length === 0 ? (
        <p style={{ color: C.lightBrown, fontSize: '0.88rem', textAlign: 'center', padding: '2.5rem 1rem', margin: 0 }}>
          Nothing in Baker Storage right now.<br />
          <span style={{ fontSize: '0.8rem' }}>Log a run on the New Delivery tab with destination “Baker Storage”.</span>
        </p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {inBaker.map(s => {
            const d = daysSince(s.session_date)
            // A month on the shelf is a storage-fee line worth noticing.
            const aged = d >= 30
            return (
              <div key={sessionKey(s)} style={{
                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem',
                background: 'rgba(255,255,255,0.04)', border: `1px solid ${aged ? 'rgba(217,119,6,0.4)' : 'rgba(166,120,90,0.18)'}`,
                borderRadius: 4, padding: '0.75rem 1rem',
              }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>{s.customer_name}</div>
                  <div style={{ color: C.lightBrown, fontSize: '0.76rem', marginTop: '0.15rem' }}>
                    packed {new Date(s.session_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                    {s.box_count > 0 && ` · ${s.box_count} box${s.box_count !== 1 ? 'es' : ''}`}
                    {s.total_weight > 0 && ` · ${s.total_weight.toFixed(1)} lbs`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexShrink: 0 }}>
                  <span style={{ color: aged ? C.yellow : C.tan, fontWeight: 700, fontSize: '0.82rem' }}>
                    {d}d{aged && ' ⚠'}
                  </span>
                  <button
                    onClick={() => markPickedUp(s)}
                    disabled={busy === sessionKey(s)}
                    style={{ ...BTN(C.green, C.dark), padding: '0.4rem 0.9rem', fontSize: '0.78rem', opacity: busy === sessionKey(s) ? 0.5 : 1 }}
                  >
                    {busy === sessionKey(s) ? 'Saving…' : '📦 Picked Up'}
                  </button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {inBaker.length > 0 && (
        <p style={{ color: C.lightBrown, fontSize: '0.75rem', marginTop: '1.25rem', marginBottom: 0 }}>
          ⚠ = 30+ days on the shelf. These are the ones carrying a monthly storage fee.
        </p>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function DeliveryPage() {
  const [tab,    setTab]    = useState<Tab>('new')
  const [logKey, setLogKey] = useState(0)
  const [pluMap, setPluMap] = useState<Record<string, string>>({})

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
  }, [])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            Delivery
          </h1>
        </div>

        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
          {(['new', 'log', 'baker'] as Tab[]).map(t => (
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
              {t === 'new' ? '🚚 New Delivery' : t === 'log' ? '📋 Delivery Log' : '🏔 Baker Storage'}
            </button>
          ))}
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1300px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'new'  && <NewDeliveryTab onSaved={() => setLogKey(k => k + 1)} pluMap={pluMap} />}
        {tab === 'log'  && <DeliveryLogTab key={logKey} pluMap={pluMap} />}
        {tab === 'baker' && <BakerStorageTab key={logKey} />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
