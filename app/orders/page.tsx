'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import { isoDate } from '@/lib/dates'

type Tab       = 'new' | 'open' | 'fulfilled'
type Fulfillment = 'pickup' | 'delivery' | 'shipping'
type FreshFrozen = 'fresh' | 'frozen'
type OrderStatus = 'pending' | 'in_progress' | 'ready' | 'fulfilled'

interface OrderItem {
  id:          string
  order_id:    string
  plu_number:  string | null
  item_name:   string
  unit:        string
  qty_ordered: number
  qty_filled:  number
  notes:       string
  /** Packed on the scanner into a box linked to this order (added by /api/orders). */
  scanned_qty?: number
}

// What's actually been filled on a line. Scanned packages are weighed by the
// scale, so they win over a hand-typed number; a line nobody scanned falls
// back to whatever was typed in.
const filledQty = (i: OrderItem) => i.scanned_qty != null ? i.scanned_qty : Number(i.qty_filled)

// plu_items.unit is the Hobart scale code ('02' on every PLU), not a unit of
// sale — an order line wants LB or EA, which is the PLU's sell-by-weight flag.
const saleUnit = (d: { sell_by_weight?: boolean | null }) => d.sell_by_weight === false ? 'EA' : 'LB'

interface RetailOrder {
  id:                string
  created_at:        string
  customer_name:     string
  customer_phone:    string
  taken_by:          string
  order_date:        string
  due_date:          string
  fresh_or_frozen:   FreshFrozen
  fulfillment_type:  Fulfillment
  pickup_datetime:   string | null
  delivery_datetime: string | null
  delivery_address:  string | null
  shipping_address:  string | null
  status:            OrderStatus
  notes:             string
  retail_order_items: OrderItem[]
}

interface PluItem { plu_number: string; item_name: string; unit: string }

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
  blue:       '#3B82F6',
  pink:       '#E879A0',
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
  padding: '0.5rem 1.1rem', fontSize: '0.83rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})

// ── The retail case's standing order ─────────────────────────────────────────
// Charlie, 2026-10-06: "where I see I am out of New York Steak or anything in
// retail and I can have a standing order in the back and when that meat comes
// through either with boxed meat or a carcass we can fill it."
//
// It is an ordinary open order whose customer is the case itself, so nothing
// downstream had to learn anything: the scanner already packs boxes against
// any open order and the fill bars read off those scans. What's new is the
// one-click "Out of stock" that puts a line on it without the New Order form,
// and the order being recognised: pinned to the top, never overdue, and the
// detail pane says what it is. There is one open restock order at a time;
// marking it fulfilled closes that round and the next shortage starts a new
// one.
const RESTOCK_CUSTOMER = 'Retail Case'
const isRestock = (o: { customer_name: string }) => o.customer_name.trim().toLowerCase() === RESTOCK_CUSTOMER.toLowerCase()

const STATUS_COLORS: Record<OrderStatus, string> = {
  pending:    C.yellow,
  in_progress: C.blue,
  ready:      C.green,
  fulfilled:  C.lightBrown,
}
const STATUS_LABELS: Record<OrderStatus, string> = {
  pending:    'Pending',
  in_progress: 'In Progress',
  ready:      'Ready',
  fulfilled:  'Fulfilled',
}
const NEXT_STATUS: Record<OrderStatus, OrderStatus | null> = {
  pending:    'in_progress',
  in_progress: 'ready',
  ready:      'fulfilled',
  fulfilled:  null,
}

function StatusBadge({ status }: { status: OrderStatus }) {
  const color = STATUS_COLORS[status]
  return (
    <span style={{
      background: `${color}22`, border: `1px solid ${color}55`,
      color, fontSize: '0.7rem', fontWeight: 700, borderRadius: 99,
      padding: '2px 10px', textTransform: 'uppercase', letterSpacing: '0.08em',
      whiteSpace: 'nowrap',
    }}>
      {STATUS_LABELS[status]}
    </span>
  )
}

// Fill progress bar for an order
function FillBar({ items }: { items: OrderItem[] }) {
  const lbItems = items.filter(i => i.unit === 'LB')
  const eaItems = items.filter(i => i.unit === 'EA')

  const totalLb   = lbItems.reduce((s, i) => s + Number(i.qty_ordered), 0)
  const filledLb  = lbItems.reduce((s, i) => s + filledQty(i),  0)
  const totalEa   = eaItems.reduce((s, i) => s + Number(i.qty_ordered), 0)
  const filledEa  = eaItems.reduce((s, i) => s + filledQty(i),  0)

  if (items.length === 0) return null

  const pct = totalLb > 0 ? Math.min(100, Math.round((filledLb / totalLb) * 100)) : null

  return (
    <div style={{ marginTop: '0.5rem' }}>
      {totalLb > 0 && (
        <div style={{ marginBottom: '0.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: C.lightBrown, marginBottom: '0.2rem' }}>
            <span>{filledLb.toFixed(1)} / {totalLb.toFixed(1)} lbs filled</span>
            <span style={{ color: pct === 100 ? C.green : C.tan, fontWeight: 700 }}>{pct}%</span>
          </div>
          <div style={{ height: 6, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{
              height: '100%', borderRadius: 99,
              width: `${pct}%`,
              background: pct === 100 ? C.green : C.tan,
              transition: 'width 0.3s ease',
            }} />
          </div>
        </div>
      )}
      {totalEa > 0 && (
        <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>
          {filledEa} / {totalEa} ea filled
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// NEW ORDER FORM
// ══════════════════════════════════════════════════════════════════════════════
function NewOrderTab({ onSaved, pluList }: { onSaved: () => void; pluList: PluItem[] }) {
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)

  const blankForm = () => ({
    customer_name:    '',
    customer_phone:   '',
    taken_by:         '',
    order_date:       isoDate(),
    due_date:         '',
    fresh_or_frozen:  'frozen' as FreshFrozen,
    fulfillment_type: 'pickup' as Fulfillment,
    pickup_datetime:  '',
    delivery_datetime:'',
    delivery_address: '',
    shipping_address: '',
    ship_date:        '',
    notes:            '',
  })

  const [form, setForm] = useState(blankForm())
  const [items, setItems] = useState<{ plu_number: string; item_name: string; unit: string; qty_ordered: string; notes: string }[]>([])
  const [pluSearch, setPluSearch] = useState('')
  const [pluDropdown, setPluDropdown] = useState<PluItem[]>([])
  const [newItem, setNewItem] = useState({ plu_number: '', item_name: '', unit: 'LB', qty_ordered: '', notes: '' })

  const f = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setForm(p => ({ ...p, [k]: e.target.value }))

  function searchPlu(q: string) {
    setPluSearch(q)
    if (q.length < 1) { setPluDropdown([]); return }
    const lower = q.toLowerCase()
    setPluDropdown(
      pluList.filter(p =>
        p.plu_number.includes(q) || p.item_name.toLowerCase().includes(lower)
      ).slice(0, 8)
    )
  }

  function selectPlu(p: PluItem) {
    setNewItem(prev => ({ ...prev, plu_number: p.plu_number, item_name: p.item_name, unit: p.unit || 'LB' }))
    setPluSearch(`${p.plu_number} — ${p.item_name}`)
    setPluDropdown([])
  }

  function addItem() {
    if (!newItem.item_name || !newItem.qty_ordered) return
    setItems(prev => [...prev, { ...newItem }])
    setNewItem({ plu_number: '', item_name: '', unit: 'LB', qty_ordered: '', notes: '' })
    setPluSearch('')
  }

  function removeItem(i: number) {
    setItems(prev => prev.filter((_, idx) => idx !== i))
  }

  async function handleSubmit() {
    if (!canSubmit) return
    setSaving(true)
    await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        pickup_datetime:   form.pickup_datetime   || null,
        // A shipping order has no delivery time, so its ship date rides in the
        // same column (nothing else reads it). Noon, so the day can't slip
        // across midnight on the way to UTC.
        delivery_datetime: form.fulfillment_type === 'shipping'
          ? (form.ship_date ? `${form.ship_date}T12:00:00` : null)
          : form.delivery_datetime || null,
        delivery_address:  form.delivery_address  || null,
        shipping_address:  form.shipping_address  || null,
        items: items.map(it => ({ ...it, qty_ordered: parseFloat(it.qty_ordered) || 0 })),
      }),
    })
    setSaving(false)
    setSuccess(true)
    setForm(blankForm())
    setItems([])
    onSaved()
    setTimeout(() => setSuccess(false), 4000)
  }

  const canSubmit = !!form.customer_name && !!form.due_date && !addressNeed(form)?.missing

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '420px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — order header */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '0.85rem' }}>
        <h3 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: 0 }}>New Retail Order</h3>

        {success && (
          <div style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 4, padding: '0.75rem', color: C.green, fontSize: '0.85rem' }}>
            ✓ Order saved
          </div>
        )}

        {/* Customer */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={LABEL}>Customer Name *</label>
            <input style={INPUT} value={form.customer_name} onChange={f('customer_name')} placeholder="Full name" />
          </div>
          <div>
            <label style={LABEL}>Phone</label>
            <input style={INPUT} value={form.customer_phone} onChange={f('customer_phone')} placeholder="(406) 555-0000" />
          </div>
        </div>

        {/* Staff + dates */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={LABEL}>Taken By *</label>
            <input style={INPUT} value={form.taken_by} onChange={f('taken_by')} placeholder="Staff name" />
          </div>
          <div>
            <label style={LABEL}>Order Date</label>
            <input type="date" style={INPUT} value={form.order_date} onChange={f('order_date')} />
          </div>
          <div>
            <label style={LABEL}>Due Date *</label>
            <input type="date" style={INPUT} value={form.due_date} onChange={f('due_date')} />
          </div>
        </div>

        {/* Fresh/Frozen + Fulfillment */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}>
          <div>
            <label style={LABEL}>Condition</label>
            <select style={INPUT} value={form.fresh_or_frozen} onChange={f('fresh_or_frozen')}>
              <option value="frozen">Frozen</option>
              <option value="fresh">Fresh</option>
            </select>
          </div>
          <div>
            <label style={LABEL}>Fulfillment</label>
            <select style={INPUT} value={form.fulfillment_type} onChange={f('fulfillment_type')}>
              <option value="pickup">Pickup</option>
              <option value="delivery">Delivery</option>
              <option value="shipping">Shipping</option>
            </select>
          </div>
        </div>

        {/* Conditional fulfillment fields */}
        {form.fulfillment_type === 'pickup' && (
          <div>
            <label style={LABEL}>Pickup Date / Time</label>
            <input type="datetime-local" style={INPUT} value={form.pickup_datetime} onChange={f('pickup_datetime')} />
          </div>
        )}
        {form.fulfillment_type === 'delivery' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label style={LABEL}>Delivery Date / Time</label>
              <input type="datetime-local" style={INPUT} value={form.delivery_datetime} onChange={f('delivery_datetime')} />
            </div>
            <div>
              <label style={LABEL}>Delivery Address *</label>
              <input style={INPUT} value={form.delivery_address} onChange={f('delivery_address')} placeholder="Street, City, State ZIP" />
            </div>
          </div>
        )}
        {form.fulfillment_type === 'shipping' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <div>
              <label style={LABEL}>Ship Date</label>
              <input type="date" style={INPUT} value={form.ship_date} onChange={f('ship_date')} />
            </div>
            <div>
              <label style={LABEL}>Shipping Address *</label>
              <textarea style={{ ...INPUT, height: 64, resize: 'vertical' }} value={form.shipping_address} onChange={f('shipping_address')} placeholder="Full shipping address" />
            </div>
          </div>
        )}

        <div>
          <label style={LABEL}>Notes</label>
          <textarea style={{ ...INPUT, height: 64, resize: 'vertical' }} value={form.notes} onChange={f('notes')} placeholder="Special instructions, customer preferences…" />
        </div>

        <button
          style={{ ...BTN(canSubmit ? C.tan : C.medBrown), width: '100%', opacity: canSubmit ? 1 : 0.5, marginTop: 'auto' }}
          onClick={handleSubmit}
          disabled={saving || !canSubmit}
        >
          {saving ? 'Saving…' : `Save Order${items.length > 0 ? ` (${items.length} item${items.length !== 1 ? 's' : ''})` : ''}`}
        </button>
      </div>

      {/* Right — line items */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '1rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.2)' }}>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '0.75rem' }}>
            Order Items
          </div>

          {/* Add item row */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 80px 90px auto', gap: '0.5rem', alignItems: 'end' }}>
            {/* PLU search */}
            <div style={{ position: 'relative' }}>
              <label style={LABEL}>PLU / Item Name</label>
              <input
                style={INPUT}
                value={pluSearch}
                onChange={e => searchPlu(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter' && pluDropdown.length > 0) selectPlu(pluDropdown[0])
                }}
                placeholder="Search PLU # or name…"
              />
              {pluDropdown.length > 0 && (
                <div style={{
                  position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50,
                  background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)',
                  borderRadius: 3, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', maxHeight: 220, overflowY: 'auto',
                }}>
                  {pluDropdown.map(p => (
                    <div
                      key={p.plu_number}
                      onClick={() => selectPlu(p)}
                      style={{ padding: '0.55rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid rgba(166,120,90,0.1)' }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(166,120,90,0.12)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                    >
                      <span style={{ fontFamily: 'monospace', color: C.lightBrown, fontSize: '0.78rem' }}>PLU {p.plu_number}</span>
                      <span style={{ color: C.cream, marginLeft: '0.6rem', fontSize: '0.85rem' }}>{p.item_name}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <label style={LABEL}>Unit</label>
              <select style={INPUT} value={newItem.unit} onChange={e => setNewItem(p => ({ ...p, unit: e.target.value }))}>
                <option value="LB">LB</option>
                <option value="EA">EA</option>
              </select>
            </div>
            <div>
              <label style={LABEL}>Qty / Weight</label>
              <input
                type="number" step="0.1" min="0"
                style={INPUT}
                value={newItem.qty_ordered}
                onChange={e => setNewItem(p => ({ ...p, qty_ordered: e.target.value }))}
                onKeyDown={e => { if (e.key === 'Enter') addItem() }}
                placeholder="0"
              />
            </div>
            <button style={{ ...BTN(C.medBrown, C.cream), alignSelf: 'flex-end', whiteSpace: 'nowrap' }} onClick={addItem}>
              + Add
            </button>
          </div>
        </div>

        {/* Items list */}
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {items.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.85rem' }}>
              No items added yet.<br />
              <span style={{ fontSize: '0.78rem' }}>Search for a PLU above or type any item name.</span>
            </div>
          )}
          {items.map((it, i) => (
            <div key={i} style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '0.7rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.1)',
            }}>
              <div>
                {it.plu_number && (
                  <span style={{ fontFamily: 'monospace', fontSize: '0.72rem', color: C.lightBrown, marginRight: '0.5rem' }}>
                    PLU {it.plu_number}
                  </span>
                )}
                <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>{it.item_name}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                <span style={{ color: C.tan, fontSize: '0.88rem', fontWeight: 600 }}>
                  {parseFloat(it.qty_ordered).toFixed(it.unit === 'LB' ? 1 : 0)} {it.unit}
                </span>
                <button
                  onClick={() => removeItem(i)}
                  style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', fontSize: '1rem', lineHeight: 1 }}
                >×</button>
              </div>
            </div>
          ))}
        </div>

        {items.length > 0 && (
          <div style={{ padding: '0.75rem 1.25rem', borderTop: '1px solid rgba(166,120,90,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.8rem', color: C.tan }}>
              {items.length} item{items.length !== 1 ? 's' : ''} · {items.filter(i => i.unit === 'LB').reduce((s, i) => s + (parseFloat(i.qty_ordered) || 0), 0).toFixed(1)} lbs total
            </span>
            <button onClick={() => setItems([])} style={{ background: 'none', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 3, color: C.lightBrown, cursor: 'pointer', fontSize: '0.78rem', padding: '0.3rem 0.75rem' }}>
              Clear All
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ORDER DETAIL PANEL
// ══════════════════════════════════════════════════════════════════════════════
// ── Printed pick ticket ───────────────────────────────────────────────────────
//
// The paper copy of a retail order, for whoever walks the cooler with it and for
// the box it ends up taped to (Charlie, 2026-08-26).
//
// It is a PICK sheet, not a receipt. What matters to the person holding it is
// what to pull, how it is measured, and where it goes afterwards — so quantities
// get a write-in box rather than being presented as settled, and the three
// things that change the handling (due date, fresh vs frozen, and how it leaves
// the building) sit in boxes across the top instead of buried in a line of text.
//
// Anything already filled in the app prints pre-filled, the same bargain the
// harvest worksheet makes: a number that is known is shown, a number that isn't
// leaves a line to write on.
function printOrder(order: RetailOrder) {
  const esc = (s: string) => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c] as string))

  const fmtDay = (iso: string) =>
    new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
  const fmtWhen = (ts: string) =>
    new Date(ts).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

  // How the order leaves, and the one detail that goes with it. A delivery sheet
  // with no address on it sends somebody back to a screen.
  const handoff =
    order.fulfillment_type === 'delivery' ? { label: 'Delivery', when: order.delivery_datetime, where: order.delivery_address }
    : order.fulfillment_type === 'shipping' ? { label: 'Shipping', when: order.delivery_datetime, where: order.shipping_address }
    : { label: 'Pickup', when: order.pickup_datetime, where: null }

  const items = order.retail_order_items ?? []
  // The Picked box is left empty to write in, whatever the unit — the unit column
  // right beside it already says whether that means pounds or packages.
  const rows = items.map(i => {
    const filled = filledQty(i) > 0
    return `<tr>
      <td class="plu">${i.plu_number ? esc(i.plu_number) : ''}</td>
      <td class="nm">${esc(i.item_name)}</td>
      <td class="qty">${esc(String(i.qty_ordered))}</td>
      <td class="un">${esc(i.unit || '')}</td>
      <td class="pick">${filled ? `<span class="pre">${esc(String(filledQty(i)))}</span>` : ''}</td>
      <td class="note">${esc(i.notes || '')}</td>
    </tr>`
  }).join('')

  const body = rows || '<tr><td colspan="6" class="empty">No items on this order.</td></tr>'

  const boxes = [
    { k: 'Due',         v: fmtDay(order.due_date) },
    { k: 'Condition',   v: order.fresh_or_frozen === 'fresh' ? 'FRESH' : 'FROZEN' },
    // A ship date is a day, not a time of day.
    { k: 'Fulfillment', v: !handoff.when ? handoff.label
        : order.fulfillment_type === 'shipping' ? `Ships ${fmtDay(handoff.when.slice(0, 10))}`
        : `${handoff.label} · ${fmtWhen(handoff.when)}` },
  ].map(b => `<div class="box"><div class="bk">${esc(b.k)}</div><div class="bv">${esc(b.v)}</div></div>`).join('')

  const css = `
    @page { size: letter portrait; margin: 0.5in; }
    * { box-sizing: border-box; }
    body { font-family: Arial, sans-serif; color: #000; margin: 0; }
    h1 { font-size: 15pt; margin: 0 0 1pt; letter-spacing: 0.03em; }
    .sub { font-size: 8.5pt; color: #444; text-transform: uppercase; letter-spacing: 0.12em; margin-bottom: 10pt; }
    .cust { font-size: 13pt; font-weight: 800; letter-spacing: 0.02em; }
    .meta { font-size: 9.5pt; color: #333; margin-bottom: 9pt; }
    .boxes { display: flex; gap: 8pt; margin-bottom: 10pt; }
    .box { border: 1pt solid #000; padding: 4pt 8pt; min-width: 1.5in; }
    .bk { font-size: 7pt; text-transform: uppercase; letter-spacing: 0.1em; color: #555; }
    .bv { font-size: 11pt; font-weight: 800; margin-top: 1pt; }
    .where { font-size: 10pt; border: 0.75pt solid #000; padding: 5pt 8pt; margin-bottom: 9pt; }
    .blank { display: inline-block; width: 5.5in; border-bottom: 0.75pt solid #000; height: 12pt; vertical-align: bottom; }
    .note-blk { font-size: 10pt; font-style: italic; border-left: 2.5pt solid #000; padding: 3pt 0 3pt 8pt; margin-bottom: 10pt; }
    table { width: 100%; border-collapse: collapse; font-size: 10pt; }
    th, td { border: 0.75pt solid #000; padding: 5pt 6pt; text-align: left; vertical-align: middle; }
    th { background: #eee; font-size: 7.5pt; text-transform: uppercase; letter-spacing: 0.05em; }
    td.plu { width: 0.6in; font-family: monospace; font-size: 9pt; }
    td.nm { font-weight: 600; }
    td.qty { width: 0.5in; text-align: center; font-weight: 800; font-size: 11pt; }
    td.un { width: 0.5in; font-size: 8.5pt; color: #444; }
    td.pick { width: 0.9in; height: 30pt; }
    td.note { width: 1.6in; font-size: 8.5pt; color: #333; }
    .pre { font-weight: 700; font-size: 11pt; }
    .empty { text-align: center; padding: 20pt; color: #666; }
    .sig { margin-top: 22pt; font-size: 9pt; }
    .sig span { display: inline-block; border-top: 0.75pt solid #000; padding-top: 2pt; width: 2.1in; margin-right: 0.45in; }
    .foot { margin-top: 14pt; font-size: 8pt; color: #666; }
  `

  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Order — ${esc(order.customer_name)}</title><style>${css}</style></head><body>
    <h1>Cowboy Meat Co. — Retail Order</h1>
    <div class="sub">Forsyth, Montana</div>
    <div class="cust">${esc(order.customer_name)}</div>
    <div class="meta">
      ${order.customer_phone ? esc(order.customer_phone) + ' &nbsp;·&nbsp; ' : ''}Ordered ${fmtDay(order.order_date)}${order.taken_by ? ' &nbsp;·&nbsp; Taken by ' + esc(order.taken_by) : ''} &nbsp;·&nbsp; ${esc(STATUS_LABELS[order.status])}
    </div>
    <div class="boxes">${boxes}</div>
    ${/* No address on a delivery or shipping order gets a line to write it on,
         not silence — same bargain as the rest of the sheet. */''}
    ${handoff.where ? `<div class="where"><strong>${esc(handoff.label)} to:</strong> ${esc(handoff.where)}</div>`
      : order.fulfillment_type !== 'pickup' ? `<div class="where"><strong>${esc(handoff.label)} to:</strong> <span class="blank"></span></div>` : ''}
    ${order.notes ? `<div class="note-blk">${esc(order.notes)}</div>` : ''}
    <table>
      <thead><tr>
        <th>PLU</th><th>Item</th><th>Qty</th><th>Unit</th><th>Picked</th><th>Notes</th>
      </tr></thead>
      <tbody>${body}</tbody>
    </table>
    <div class="sig"><span>Picked by</span><span>Checked by</span><span>Date</span></div>
    <div class="foot">Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660</div>
    <script>window.onload=function(){window.print()}<\/script>
  </body></html>`

  const w = window.open('', '_blank', 'width=900,height=760')
  if (w) { w.document.write(html); w.document.close() }
}

/** Which address a delivery or shipping order needs, and whether it's missing.
 *  Portal orders arrive with none (the portal never asks), so /orders has to
 *  say so rather than quietly show nothing (Charlie, 2026-09-28). */
function addressNeed(o: { fulfillment_type: Fulfillment; delivery_address: string | null; shipping_address: string | null }) {
  if (o.fulfillment_type === 'pickup') return null
  const key = o.fulfillment_type === 'shipping' ? 'shipping_address' as const : 'delivery_address' as const
  return { key, label: o.fulfillment_type === 'shipping' ? 'shipping' : 'delivery', missing: !o[key]?.trim() }
}

function OrderDetail({ order, onUpdated, onDeleted, pluList }: { order: RetailOrder; onUpdated: (o: RetailOrder) => void; onDeleted: (id: string) => void; pluList: PluItem[] }) {
  const [advancing, setAdvancing] = useState(false)
  const [deleting, setDeleting]   = useState(false)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [filledVal, setFilledVal] = useState('')
  const need = addressNeed(order)
  const [addrDraft, setAddrDraft]   = useState('')
  const [addrSaving, setAddrSaving] = useState(false)

  async function saveAddress() {
    if (!need || !addrDraft.trim()) return
    setAddrSaving(true)
    const res = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id, [need.key]: addrDraft.trim() }),
    })
    setAddrSaving(false)
    if (res.ok) { setAddrDraft(''); onUpdated({ ...order, [need.key]: addrDraft.trim() }) }
  }

  // Add item state
  const [showAddItem, setShowAddItem]       = useState(false)
  const [addPluSearch, setAddPluSearch]     = useState('')
  const [addPluDropdown, setAddPluDropdown] = useState<PluItem[]>([])
  const [addNewItem, setAddNewItem]         = useState({ plu_number: '', item_name: '', unit: 'LB', qty_ordered: '' })
  const [addingSaving, setAddingSaving]     = useState(false)

  function searchAddPlu(q: string) {
    setAddPluSearch(q)
    if (q.length < 1) { setAddPluDropdown([]); return }
    const lower = q.toLowerCase()
    setAddPluDropdown(pluList.filter(p =>
      p.plu_number.includes(q) || p.item_name.toLowerCase().includes(lower)
    ).slice(0, 8))
  }

  function selectAddPlu(p: PluItem) {
    setAddNewItem(prev => ({ ...prev, plu_number: p.plu_number, item_name: p.item_name, unit: p.unit || 'LB' }))
    setAddPluSearch(`${p.plu_number} — ${p.item_name}`)
    setAddPluDropdown([])
  }

  async function saveAddItem() {
    if (!addNewItem.item_name || !addNewItem.qty_ordered) return
    setAddingSaving(true)
    const res = await fetch('/api/orders/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_id:    order.id,
        plu_number:  addNewItem.plu_number || null,
        item_name:   addNewItem.item_name,
        unit:        addNewItem.unit,
        qty_ordered: parseFloat(addNewItem.qty_ordered) || 0,
      }),
    })
    const created = await res.json()
    onUpdated({ ...order, retail_order_items: [...order.retail_order_items, created] })
    setAddNewItem({ plu_number: '', item_name: '', unit: 'LB', qty_ordered: '' })
    setAddPluSearch('')
    setAddingSaving(false)
    setShowAddItem(false)
  }

  async function deleteItem(itemId: string) {
    await fetch(`/api/orders/items?id=${itemId}`, { method: 'DELETE' })
    onUpdated({ ...order, retail_order_items: order.retail_order_items.filter(i => i.id !== itemId) })
  }

  const nextStatus = NEXT_STATUS[order.status]

  async function advance() {
    if (!nextStatus) return
    setAdvancing(true)
    const res = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: order.id, status: nextStatus }),
    })
    const updated = await res.json()
    setAdvancing(false)
    onUpdated(updated)
  }

  async function deleteOrder() {
    const itemNote = order.retail_order_items.length
      ? ` and its ${order.retail_order_items.length} item${order.retail_order_items.length !== 1 ? 's' : ''}`
      : ''
    if (!window.confirm(`Delete ${order.customer_name}'s order${itemNote}? This can’t be undone.`)) return
    setDeleting(true)
    const res = await fetch(`/api/orders?id=${order.id}`, { method: 'DELETE' })
    setDeleting(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      alert(body.error ?? 'Could not delete this order.')
      return
    }
    onDeleted(order.id)
  }

  async function saveFilled(itemId: string) {
    const qty = parseFloat(filledVal)
    if (isNaN(qty)) return
    const res = await fetch('/api/orders/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId, qty_filled: qty }),
    })
    const updatedItem = await res.json()
    const updatedItems = order.retail_order_items.map(i => i.id === itemId ? { ...i, ...updatedItem } : i)
    onUpdated({ ...order, retail_order_items: updatedItems })
    setEditingItem(null)
    setFilledVal('')
  }

  const fulfillmentLabel: Record<Fulfillment, string> = {
    pickup: '📦 Pickup', delivery: '🚚 Delivery', shipping: '✈️ Shipping',
  }

  const totalLb   = order.retail_order_items.filter(i => i.unit === 'LB').reduce((s, i) => s + Number(i.qty_ordered), 0)
  const filledLb  = order.retail_order_items.filter(i => i.unit === 'LB').reduce((s, i) => s + filledQty(i),  0)
  const pct = totalLb > 0 ? Math.min(100, Math.round((filledLb / totalLb) * 100)) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.2rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.3rem' }}>
            {isRestock(order) ? '🥩 ' : ''}{order.customer_name}
          </h2>
          {isRestock(order) && (
            <div style={{ fontSize: '0.8rem', color: C.tan, lineHeight: 1.5, maxWidth: 520, marginBottom: '0.3rem' }}>
              The case&apos;s standing restock order. Whatever is short goes on here from the <strong>Out of stock</strong> button;
              it fills when boxed meat or the next carcass is packed against it on the scanner.
              Mark it fulfilled once the case is stocked — the next shortage starts a fresh one.
            </div>
          )}
          {order.customer_phone && (
            <div style={{ fontSize: '0.82rem', color: C.lightBrown }}>{order.customer_phone}</div>
          )}
          <div style={{ fontSize: '0.78rem', color: C.tan, marginTop: '0.25rem' }}>
            Ordered {new Date(order.order_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            {order.taken_by ? ` · Taken by ${order.taken_by}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '0.5rem' }}>
          <StatusBadge status={order.status} />
          {nextStatus && (
            <button
              style={BTN(STATUS_COLORS[nextStatus])}
              onClick={advance}
              disabled={advancing}
            >
              {advancing ? '…' : `→ Mark ${STATUS_LABELS[nextStatus]}`}
            </button>
          )}
          <button
            onClick={() => printOrder(order)}
            title="Print a pick ticket for this order"
            style={{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.35)', color: C.tan, borderRadius: 3, padding: '0.4rem 0.9rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer' }}
          >
            🖨 Print Order
          </button>
          <button
            onClick={deleteOrder}
            disabled={deleting}
            title="Delete this order"
            style={{ background: 'transparent', border: `1px solid ${C.red}`, color: C.red, borderRadius: 3, padding: '0.3rem 0.7rem', fontSize: '0.75rem', fontWeight: 600, cursor: deleting ? 'default' : 'pointer', opacity: deleting ? 0.5 : 1 }}
          >
            {deleting ? 'Deleting…' : '🗑 Delete Order'}
          </button>
        </div>
      </div>

      {/* Info bar */}
      <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
        {[
          { label: 'Due', value: new Date(order.due_date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) },
          { label: 'Condition', value: order.fresh_or_frozen === 'fresh' ? '🌿 Fresh' : '❄️ Frozen' },
          { label: 'Fulfillment', value: fulfillmentLabel[order.fulfillment_type] },
        ].map(({ label, value }) => (
          <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.5rem 0.85rem' }}>
            <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
            <div style={{ fontSize: '0.85rem', color: C.cream, fontWeight: 600, marginTop: '0.15rem' }}>{value}</div>
          </div>
        ))}
        {order.pickup_datetime && (
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.5rem 0.85rem' }}>
            <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Pickup Time</div>
            <div style={{ fontSize: '0.85rem', color: C.cream, fontWeight: 600, marginTop: '0.15rem' }}>
              {new Date(order.pickup_datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
        )}
        {order.delivery_datetime && (
          <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.5rem 0.85rem' }}>
            <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{order.fulfillment_type === 'shipping' ? 'Ship Date' : 'Delivery Time'}</div>
            <div style={{ fontSize: '0.85rem', color: C.cream, fontWeight: 600, marginTop: '0.15rem' }}>
              {order.fulfillment_type === 'shipping'
                ? new Date(order.delivery_datetime.slice(0, 10) + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : new Date(order.delivery_datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
        )}
      </div>

      {need?.missing ? (
        <div style={{ background: 'rgba(229,57,53,0.1)', border: `1px solid ${C.red}`, borderRadius: 4, padding: '0.6rem 0.85rem', fontSize: '0.82rem', color: C.red, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <span>⚠ No {need.label} address{order.customer_phone ? ` — call ${order.customer_phone}` : ''}</span>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <input style={{ ...INPUT, flex: 1 }} value={addrDraft} onChange={e => setAddrDraft(e.target.value)} placeholder="Street, City, State ZIP" />
            <button style={{ ...BTN(C.tan), opacity: addrDraft.trim() && !addrSaving ? 1 : 0.5 }} disabled={!addrDraft.trim() || addrSaving} onClick={saveAddress}>
              {addrSaving ? 'Saving…' : 'Save address'}
            </button>
          </div>
        </div>
      ) : (order.delivery_address || order.shipping_address) && (
        <div style={{ fontSize: '0.82rem', color: C.tan, fontStyle: 'italic' }}>
          <span style={{ fontStyle: 'normal', color: C.lightBrown }}>{order.fulfillment_type === 'shipping' ? 'Ship to: ' : order.fulfillment_type === 'delivery' ? 'Deliver to: ' : ''}</span>
          {order.delivery_address || order.shipping_address}
        </div>
      )}

      {order.notes && (
        <div style={{ background: 'rgba(166,120,90,0.08)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '0.75rem 1rem', fontSize: '0.82rem', color: C.tan, fontStyle: 'italic' }}>
          {order.notes}
        </div>
      )}

      {/* Fill progress summary */}
      {pct !== null && (
        <div style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.85rem 1.25rem' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.4rem' }}>
            <span style={{ fontSize: '0.78rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Order Fill</span>
            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: pct === 100 ? C.green : C.tan }}>{pct}%</span>
          </div>
          <div style={{ height: 8, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
            <div style={{ height: '100%', width: `${pct}%`, borderRadius: 99, background: pct === 100 ? C.green : C.tan, transition: 'width 0.3s' }} />
          </div>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.3rem' }}>
            {filledLb.toFixed(2)} of {totalLb.toFixed(2)} lbs filled
          </div>
        </div>
      )}

      {/* Line items */}
      <div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.6rem' }}>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Items</div>
          <button
            onClick={() => setShowAddItem(s => !s)}
            style={{ background: showAddItem ? 'rgba(166,120,90,0.15)' : 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, color: C.tan, fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', padding: '0.25rem 0.7rem' }}
          >
            {showAddItem ? '✕ Cancel' : '+ Add Item'}
          </button>
        </div>

        {/* Add item form */}
        {showAddItem && (
          <div style={{ background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '0.85rem', marginBottom: '0.75rem' }}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 70px 90px auto', gap: '0.5rem', alignItems: 'end' }}>
              {/* PLU search */}
              <div style={{ position: 'relative' }}>
                <label style={LABEL}>PLU / Item Name</label>
                <input
                  style={INPUT}
                  value={addPluSearch}
                  onChange={e => searchAddPlu(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter' && addPluDropdown.length > 0) selectAddPlu(addPluDropdown[0]) }}
                  placeholder="Search PLU # or name…"
                  autoFocus
                />
                {addPluDropdown.length > 0 && (
                  <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 3, boxShadow: '0 4px 16px rgba(0,0,0,0.4)', maxHeight: 200, overflowY: 'auto' }}>
                    {addPluDropdown.map(p => (
                      <div
                        key={p.plu_number}
                        onClick={() => selectAddPlu(p)}
                        style={{ padding: '0.5rem 0.85rem', cursor: 'pointer', borderBottom: '1px solid rgba(166,120,90,0.1)' }}
                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(166,120,90,0.12)')}
                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                      >
                        <span style={{ fontFamily: 'monospace', color: C.lightBrown, fontSize: '0.78rem' }}>PLU {p.plu_number}</span>
                        <span style={{ color: C.cream, marginLeft: '0.6rem', fontSize: '0.85rem' }}>{p.item_name}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div>
                <label style={LABEL}>Unit</label>
                <select style={INPUT} value={addNewItem.unit} onChange={e => setAddNewItem(p => ({ ...p, unit: e.target.value }))}>
                  <option value="LB">LB</option>
                  <option value="EA">EA</option>
                </select>
              </div>
              <div>
                <label style={LABEL}>Qty</label>
                <input
                  type="number" step="0.1" min="0"
                  style={INPUT}
                  value={addNewItem.qty_ordered}
                  onChange={e => setAddNewItem(p => ({ ...p, qty_ordered: e.target.value }))}
                  onKeyDown={e => { if (e.key === 'Enter') saveAddItem() }}
                  placeholder="0"
                />
              </div>
              <button
                style={{ ...BTN(C.tan), alignSelf: 'flex-end', whiteSpace: 'nowrap', opacity: addNewItem.item_name && addNewItem.qty_ordered ? 1 : 0.5 }}
                onClick={saveAddItem}
                disabled={addingSaving || !addNewItem.item_name || !addNewItem.qty_ordered}
              >
                {addingSaving ? '…' : 'Save'}
              </button>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {order.retail_order_items.length === 0 && (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem', fontStyle: 'italic' }}>No items on this order.</div>
          )}
          {order.retail_order_items.map(item => {
            const itemPct = item.qty_ordered > 0 ? Math.min(100, Math.round((filledQty(item) / Number(item.qty_ordered)) * 100)) : 0
            const done    = itemPct >= 100
            return (
              <div key={item.id} style={{ background: 'rgba(255,255,255,0.04)', border: `1px solid ${done ? 'rgba(76,175,80,0.3)' : 'rgba(166,120,90,0.15)'}`, borderRadius: 3, padding: '0.65rem 0.85rem' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: item.unit === 'LB' ? '0.35rem' : 0 }}>
                  <div>
                    {item.plu_number && (
                      <span style={{ fontFamily: 'monospace', fontSize: '0.7rem', color: C.lightBrown, marginRight: '0.4rem' }}>
                        PLU {item.plu_number}
                      </span>
                    )}
                    <span style={{ color: done ? C.green : C.cream, fontWeight: 600, fontSize: '0.88rem' }}>
                      {done && '✓ '}{item.item_name}
                    </span>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                    <span style={{ fontSize: '0.82rem', color: C.tan }}>
                      {Number(item.qty_ordered).toFixed(item.unit === 'LB' ? 1 : 0)} {item.unit}
                    </span>
                    {/* Fill input */}
                    {editingItem === item.id ? (
                      <div style={{ display: 'flex', gap: '0.35rem' }}>
                        <input
                          type="number" step="0.01" min="0"
                          style={{ ...INPUT, width: 80, padding: '0.25rem 0.5rem', fontSize: '0.82rem' }}
                          value={filledVal}
                          autoFocus
                          onChange={e => setFilledVal(e.target.value)}
                          onKeyDown={e => { if (e.key === 'Enter') saveFilled(item.id) }}
                          placeholder="Filled"
                        />
                        <button style={BTN(C.green)} onClick={() => saveFilled(item.id)}>✓</button>
                        <button style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }} onClick={() => setEditingItem(null)}>✕</button>
                      </div>
                    ) : (
                      <button
                        onClick={() => { setEditingItem(item.id); setFilledVal(String(item.qty_filled)) }}
                        style={{
                          background: done ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.06)',
                          border: `1px solid ${done ? 'rgba(76,175,80,0.4)' : 'rgba(166,120,90,0.3)'}`,
                          borderRadius: 3, color: done ? C.green : C.tan,
                          fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer', padding: '0.25rem 0.6rem', whiteSpace: 'nowrap',
                        }}
                      >
                        {filledQty(item).toFixed(item.unit === 'LB' ? 1 : 0)} filled{item.scanned_qty != null ? ' · scanned' : ''}
                      </button>
                    )}
                    <button
                      onClick={() => deleteItem(item.id)}
                      title="Remove item"
                      style={{ background: 'none', border: 'none', color: 'rgba(166,120,90,0.4)', cursor: 'pointer', fontSize: '0.95rem', lineHeight: 1, padding: '0 0.1rem' }}
                      onMouseEnter={e => (e.currentTarget.style.color = C.red)}
                      onMouseLeave={e => (e.currentTarget.style.color = 'rgba(166,120,90,0.4)')}
                    >×</button>
                  </div>
                </div>
                {item.unit === 'LB' && (
                  <div style={{ height: 4, background: 'rgba(255,255,255,0.08)', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${itemPct}%`, borderRadius: 99, background: done ? C.green : C.tan, transition: 'width 0.3s' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// ORDER LIST TAB (open or fulfilled)
// ══════════════════════════════════════════════════════════════════════════════
function OrderListTab({ fulfilled, pluList, focusOrderId = null }: { fulfilled: boolean; pluList: PluItem[]; focusOrderId?: string | null }) {
  const [orders, setOrders]     = useState<RetailOrder[]>([])
  const [selected, setSelected] = useState<RetailOrder | null>(null)
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const url = fulfilled ? '/api/orders?status=fulfilled' : '/api/orders'
    const res  = await fetch(url)
    const data: RetailOrder[] = await res.json()
    // For open tab, exclude fulfilled
    const filtered = fulfilled ? data : data.filter(o => o.status !== 'fulfilled')
    // The case's standing order sits on top of the open list — it is the one
    // the crew fills from whatever comes through, not a pickup on a date.
    const list = Array.isArray(filtered) ? [...filtered].sort((a, b) => Number(isRestock(b)) - Number(isRestock(a))) : []
    setOrders(list)
    if (focusOrderId) setSelected(list.find(o => o.id === focusOrderId) ?? null)
    setLoading(false)
  }, [fulfilled, focusOrderId])

  useEffect(() => { load() }, [load])

  function handleUpdated(updated: RetailOrder) {
    setOrders(prev => prev.map(o => o.id === updated.id ? updated : o))
    setSelected(updated)
  }

  function handleDeleted(id: string) {
    setOrders(prev => prev.filter(o => o.id !== id))
    setSelected(prev => prev?.id === id ? null : prev)
  }

  const overdue = (o: RetailOrder) => !isRestock(o) && o.due_date < isoDate() && o.status !== 'fulfilled'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '340px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0.85rem 1rem', borderBottom: '1px solid rgba(166,120,90,0.2)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            {fulfilled ? 'Fulfilled Orders' : 'Open Orders'}
          </span>
          <span style={{ fontSize: '0.82rem', fontWeight: 700, color: C.cream }}>{orders.length}</span>
        </div>
        <div style={{ flex: 1, overflowY: 'auto' }}>
          {loading && <div style={{ padding: '1.5rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.85rem' }}>Loading…</div>}
          {!loading && orders.length === 0 && (
            <div style={{ padding: '1.5rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.85rem' }}>No orders found</div>
          )}
          {orders.map(o => (
            <div
              key={o.id}
              onClick={() => setSelected(o)}
              style={{
                padding: '0.9rem 1.1rem', borderBottom: '1px solid rgba(166,120,90,0.1)',
                cursor: 'pointer',
                background: selected?.id === o.id ? 'rgba(166,120,90,0.12)' : 'transparent',
                borderLeft: overdue(o) ? `3px solid ${C.red}` : selected?.id === o.id ? `3px solid ${C.tan}` : '3px solid transparent',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.25rem' }}>
                <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>{isRestock(o) ? '🥩 ' : ''}{o.customer_name}</span>
                <StatusBadge status={o.status} />
              </div>
              {isRestock(o) ? (
                <div style={{ fontSize: '0.75rem', color: C.tan }}>
                  Standing restock · {o.retail_order_items.length} item{o.retail_order_items.length === 1 ? '' : 's'} short
                </div>
              ) : (
              <div style={{ fontSize: '0.75rem', color: overdue(o) ? C.red : C.tan }}>
                Due {new Date(o.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {overdue(o) ? ' — OVERDUE' : ''}
                {' · '}{o.fulfillment_type.charAt(0).toUpperCase() + o.fulfillment_type.slice(1)}
                {addressNeed(o)?.missing && <span style={{ color: C.red }}> · ⚠ no address</span>}
              </div>
              )}
              <FillBar items={o.retail_order_items} />
            </div>
          ))}
        </div>
      </div>

      {/* Right detail */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: C.lightBrown, fontSize: '0.9rem' }}>
            ← Select an order to view
          </div>
        ) : (
          <OrderDetail key={selected.id} order={selected} onUpdated={handleUpdated} onDeleted={handleDeleted} pluList={pluList} />
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// OUT OF STOCK — one line onto the case's standing restock order
// ══════════════════════════════════════════════════════════════════════════════
function OutOfStockButton({ pluList, onAdded }: { pluList: PluItem[]; onAdded: (orderId: string) => void }) {
  const [open, setOpen]         = useState(false)
  const [search, setSearch]     = useState('')
  const [dropdown, setDropdown] = useState<PluItem[]>([])
  const [pick, setPick]         = useState<PluItem | null>(null)
  const [qty, setQty]           = useState('')
  const [saving, setSaving]     = useState(false)
  const [done, setDone]         = useState<string | null>(null)
  const [err, setErr]           = useState<string | null>(null)

  function doSearch(q: string) {
    setSearch(q); setPick(null)
    if (q.length < 1) { setDropdown([]); return }
    const lower = q.toLowerCase()
    setDropdown(pluList.filter(p => p.plu_number.includes(q) || p.item_name.toLowerCase().includes(lower)).slice(0, 8))
  }
  function choose(p: PluItem) {
    setPick(p); setSearch(`${p.plu_number} — ${p.item_name}`); setDropdown([])
  }
  function reset() { setSearch(''); setDropdown([]); setPick(null); setQty(''); setErr(null) }

  // The open restock order, or a new one. Status in_progress from the start:
  // it is being worked the moment something is on it.
  async function restockOrder(): Promise<RetailOrder> {
    const all: unknown = await fetch('/api/orders').then(r => r.json())
    const found = (Array.isArray(all) ? all as RetailOrder[] : []).find(o => isRestock(o) && o.status !== 'fulfilled')
    if (found) return found
    const created: RetailOrder = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        customer_name: RESTOCK_CUSTOMER, taken_by: 'Retail', order_date: isoDate(), due_date: isoDate(),
        fresh_or_frozen: 'fresh', fulfillment_type: 'pickup',
        notes: 'Standing restock order for the retail case. Fill from boxed meat or the next carcass; mark fulfilled once the case is stocked.',
        items: [],
      }),
    }).then(r => r.json())
    if (!created?.id) throw new Error(((created as unknown) as { error?: string })?.error ?? 'could not start the restock order')
    await fetch('/api/orders', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: created.id, status: 'in_progress' }) })
    return created
  }

  async function add() {
    const name = pick?.item_name ?? search.trim()
    const n = parseFloat(qty)
    if (!name || !(n > 0)) return
    setSaving(true); setErr(null)
    try {
      const order = await restockOrder()
      // Already short on this item: top the line up rather than listing it twice.
      const line = (order.retail_order_items ?? []).find(i =>
        pick ? i.plu_number === pick.plu_number : i.item_name.trim().toLowerCase() === name.toLowerCase())
      const res = line
        ? await fetch('/api/orders/items', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: line.id, qty_ordered: Number(line.qty_ordered) + n }) })
        : await fetch('/api/orders/items', { method: 'POST',  headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order_id: order.id, plu_number: pick?.plu_number ?? null, item_name: name, unit: pick?.unit ?? 'LB', qty_ordered: n }) })
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? 'could not add the line')
      setDone(`${n} ${pick?.unit ?? 'LB'} ${name} ${line ? 'added to the' : 'put on the'} restock order`)
      setTimeout(() => setDone(null), 4000)
      reset()
      onAdded(order.id)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'could not add the line')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div style={{ position: 'relative' }}>
      <button
        onClick={() => { setOpen(o => !o); if (!open) reset() }}
        title="Short on something in the case? Put it on the standing restock order — the crew fills it from boxed meat or the next carcass."
        style={{ ...BTN(open ? C.red : 'rgba(229,62,62,0.18)', open ? C.cream : '#F08080'), border: '1px solid rgba(229,62,62,0.5)', whiteSpace: 'nowrap' }}
      >
        🥩 Out of stock
      </button>
      {done && !open && (
        <div style={{ position: 'absolute', top: '110%', right: 0, background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', color: C.green, borderRadius: 4, padding: '0.4rem 0.7rem', fontSize: '0.78rem', whiteSpace: 'nowrap', zIndex: 20 }}>
          ✓ {done}
        </div>
      )}
      {open && (
        <div style={{ position: 'absolute', top: '110%', right: 0, width: 360, background: C.dark, border: '1px solid rgba(166,120,90,0.35)', borderRadius: 4, padding: '0.9rem', zIndex: 20, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>What&apos;s the case out of?</div>
          <div style={{ position: 'relative' }}>
            <input style={INPUT} value={search} autoFocus placeholder="PLU or item — e.g. New York" onChange={e => doSearch(e.target.value)} />
            {dropdown.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: C.darkBrown, border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, zIndex: 30, maxHeight: 220, overflowY: 'auto' }}>
                {dropdown.map(p => (
                  <div key={p.plu_number} onClick={() => choose(p)} style={{ padding: '0.45rem 0.7rem', cursor: 'pointer', fontSize: '0.83rem', color: C.cream, borderBottom: '1px solid rgba(166,120,90,0.12)' }}>
                    <span style={{ fontFamily: 'monospace', color: C.lightBrown, marginRight: '0.4rem' }}>{p.plu_number}</span>{p.item_name}
                    <span style={{ float: 'right', color: C.tan, fontSize: '0.72rem' }}>{p.unit}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center' }}>
            <input type="number" min="0" step="0.5" style={{ ...INPUT, width: 110 }} value={qty} placeholder="How much" onChange={e => setQty(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') add() }} />
            <span style={{ color: C.tan, fontSize: '0.82rem' }}>{pick?.unit ?? 'LB'}</span>
            <div style={{ flex: 1 }} />
            <button onClick={() => setOpen(false)} style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }}>Cancel</button>
            <button onClick={add} disabled={saving || !(search.trim()) || !(parseFloat(qty) > 0)} style={{ ...BTN(C.green), opacity: saving || !(search.trim()) || !(parseFloat(qty) > 0) ? 0.5 : 1 }}>
              {saving ? '…' : 'Add to restock'}
            </button>
          </div>
          {!pick && search.trim() && dropdown.length === 0 && (
            <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>No PLU matches — it will go on by name, in LB.</div>
          )}
          {err && <div style={{ fontSize: '0.78rem', color: C.red }}>{err}</div>}
        </div>
      )}
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function OrdersPage() {
  const [tab,    setTab]    = useState<Tab>('open')
  const [newKey, setNewKey] = useState(0)
  const [pluList, setPluList] = useState<PluItem[]>([])
  // Bumped when the Out-of-stock button lands a line, so the open list reloads
  // and opens the restock order on it.
  const [restockKey, setRestockKey] = useState(0)
  const [focusOrderId, setFocusOrderId] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/processing?active=true')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setPluList((data as { plu_number?: string; item_name?: string; sell_by_weight?: boolean | null }[])
            .filter(d => d.plu_number)
            .map(d => ({ plu_number: String(d.plu_number), item_name: d.item_name ?? '', unit: saleUnit(d) }))
          )
        }
      })
      .catch(() => {})
  }, [])

  const tabs = [
    { id: 'new' as Tab,       label: '+ New Order' },
    { id: 'open' as Tab,      label: '📋 Open Orders' },
    { id: 'fulfilled' as Tab, label: '✓ Fulfilled' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Retail Orders</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
        <OutOfStockButton pluList={pluList} onAdded={id => { setFocusOrderId(id); setRestockKey(k => k + 1); setTab('open') }} />
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: '0.45rem 1.25rem', border: 'none', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600,
              background: tab === t.id ? C.medBrown : 'transparent',
              color: tab === t.id ? C.cream : C.lightBrown,
              letterSpacing: '0.04em', transition: 'background 0.15s',
            }}>{t.label}</button>
          ))}
        </div>
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'new'       && <NewOrderTab key={newKey} onSaved={() => { setNewKey(k => k + 1); setTab('open') }} pluList={pluList} />}
        {tab === 'open'      && <OrderListTab key={`open-${restockKey}`} fulfilled={false} pluList={pluList} focusOrderId={focusOrderId} />}
        {tab === 'fulfilled' && <OrderListTab key="fulfilled" fulfilled={true}  pluList={pluList} />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
