'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { DeliveryScan } from '@/lib/types'

type Tab = 'new' | 'log'
type LogFilter = 'all' | 'pending' | 'reviewed'

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
  const [success, setSuccess] = useState(false)

  const [form, setForm] = useState({
    delivered_at: new Date().toISOString().slice(0, 16),
    driver:       '',
    customer:     '',
    notes:        '',
  })
  const [barcodes, setBarcodes] = useState<{ barcode: string; scannedAt: string }[]>([])
  const [barcodeInput, setBarcodeInput] = useState('')
  const [lastAdded, setLastAdded] = useState('')

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

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
    if (!form.customer || !form.driver) return
    setSaving(true)
    await fetch('/api/delivery', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...form, barcodes }),
    })
    setSaving(false)
    setSuccess(true)
    setForm({ delivered_at: new Date().toISOString().slice(0, 16), driver: '', customer: '', notes: '' })
    setBarcodes([])
    onSaved()
    setTimeout(() => setSuccess(false), 4000)
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — form */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
        <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 1.25rem' }}>
          New Delivery
        </h3>

        {success && (
          <div style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1rem', color: C.green, fontSize: '0.85rem' }}>
            ✓ Delivery saved
          </div>
        )}

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
            <label style={LABEL}>Customer *</label>
            <input style={INPUT} value={form.customer} onChange={f('customer')} placeholder="Name" />
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
          style={{ ...BTN(form.customer && form.driver ? C.tan : C.medBrown), width: '100%', opacity: form.customer && form.driver ? 1 : 0.55 }}
          onClick={handleSubmit}
          disabled={saving || !form.customer || !form.driver}
        >
          {saving ? 'Saving…' : `Save Delivery${barcodes.length > 0 ? ` (${barcodes.length} items)` : ''}`}
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
            const idx     = barcodes.length - 1 - ri
            const decoded = decodeBarcode(b.barcode)
            const cutName = decoded ? (pluMap[decoded.plu] ?? `PLU ${decoded.plu}`) : null
            return (
              <div key={b.barcode} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0.6rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.08)' }}>
                <div>
                  <div style={{ fontFamily: 'monospace', color: C.cream, fontSize: '0.88rem' }}>{b.barcode}</div>
                  {cutName && (
                    <div style={{ fontSize: '0.82rem', color: C.tan, fontWeight: 600, marginTop: '0.1rem' }}>
                      {cutName}
                      {decoded && <span style={{ color: C.lightBrown, fontWeight: 400, marginLeft: '0.5rem' }}>{decoded.weightLbs.toFixed(2)} lb</span>}
                    </div>
                  )}
                  <div style={{ color: C.lightBrown, fontSize: '0.72rem', marginTop: cutName ? '0.1rem' : 0 }}>
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
            // Build unique cut name list from barcodes
            const cutNames: string[] = []
            for (const b of d.barcodes ?? []) {
              const dec = decodeBarcode(b.barcode)
              if (dec) {
                const name = pluMap[dec.plu] ?? `PLU ${dec.plu}`
                if (!cutNames.includes(name)) cutNames.push(name)
              }
            }
            const shown   = cutNames.slice(0, 3)
            const overflow = cutNames.length - shown.length
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
                  {new Date(d.delivered_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                  {d.driver ? ` · ${d.driver}` : ''}
                </div>
                {/* Cut names summary */}
                {shown.length > 0 ? (
                  <div style={{ fontSize: '0.74rem', color: C.lightBrown, marginTop: '0.25rem', lineHeight: 1.5 }}>
                    {shown.map((name, i) => (
                      <span key={name}>
                        <span style={{ color: C.tan }}>{name}</span>
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

            {/* Barcode list */}
            {(selected.barcodes?.length ?? 0) > 0 ? (
              <>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
                  Scanned Items
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {selected.barcodes.map((b, i) => {
                    const decoded = decodeBarcode(b.barcode)
                    const cutName = decoded ? (pluMap[decoded.plu] ?? `PLU ${decoded.plu}`) : null
                    return (
                      <div key={i} style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 3, padding: '0.55rem 0.85rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          {cutName && (
                            <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>
                              {cutName}
                              {decoded && <span style={{ color: C.tan, fontWeight: 400, marginLeft: '0.5rem', fontSize: '0.82rem' }}>{decoded.weightLbs.toFixed(2)} lb</span>}
                            </div>
                          )}
                          <div style={{ fontFamily: 'monospace', color: cutName ? C.lightBrown : C.cream, fontSize: cutName ? '0.72rem' : '0.88rem', marginTop: cutName ? '0.1rem' : 0 }}>
                            {b.barcode}
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
          {(['new', 'log'] as Tab[]).map(t => (
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
              {t === 'new' ? '🚚 New Delivery' : '📋 Delivery Log'}
            </button>
          ))}
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1300px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'new'
          ? <NewDeliveryTab onSaved={() => setLogKey(k => k + 1)} pluMap={pluMap} />
          : <DeliveryLogTab key={logKey} pluMap={pluMap} />
        }
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
