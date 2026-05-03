'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'

type Tab        = 'new' | 'open' | 'fulfilled'
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
}

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
  const filledLb  = lbItems.reduce((s, i) => s + Number(i.qty_filled),  0)
  const totalEa   = eaItems.reduce((s, i) => s + Number(i.qty_ordered), 0)
  const filledEa  = eaItems.reduce((s, i) => s + Number(i.qty_filled),  0)

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
    order_date:       new Date().toISOString().slice(0, 10),
    due_date:         '',
    fresh_or_frozen:  'frozen' as FreshFrozen,
    fulfillment_type: 'pickup' as Fulfillment,
    pickup_datetime:  '',
    delivery_datetime:'',
    delivery_address: '',
    shipping_address: '',
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
    if (!form.customer_name || !form.due_date) return
    setSaving(true)
    await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        pickup_datetime:   form.pickup_datetime   || null,
        delivery_datetime: form.delivery_datetime || null,
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

  const canSubmit = !!form.customer_name && !!form.due_date

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
              <label style={LABEL}>Delivery Address</label>
              <input style={INPUT} value={form.delivery_address} onChange={f('delivery_address')} placeholder="Street, City, State ZIP" />
            </div>
          </div>
        )}
        {form.fulfillment_type === 'shipping' && (
          <div>
            <label style={LABEL}>Shipping Address</label>
            <textarea style={{ ...INPUT, height: 64, resize: 'vertical' }} value={form.shipping_address} onChange={f('shipping_address')} placeholder="Full shipping address" />
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
function OrderDetail({ order, onUpdated }: { order: RetailOrder; onUpdated: (o: RetailOrder) => void }) {
  const [advancing, setAdvancing] = useState(false)
  const [editingItem, setEditingItem] = useState<string | null>(null)
  const [filledVal, setFilledVal] = useState('')

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

  async function saveFilled(itemId: string) {
    const qty = parseFloat(filledVal)
    if (isNaN(qty)) return
    const res = await fetch('/api/orders/items', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: itemId, qty_filled: qty }),
    })
    const updatedItem = await res.json()
    const updatedItems = order.retail_order_items.map(i => i.id === itemId ? updatedItem : i)
    onUpdated({ ...order, retail_order_items: updatedItems })
    setEditingItem(null)
    setFilledVal('')
  }

  const fulfillmentLabel: Record<Fulfillment, string> = {
    pickup: '📦 Pickup', delivery: '🚚 Delivery', shipping: '✈️ Shipping',
  }

  const totalLb   = order.retail_order_items.filter(i => i.unit === 'LB').reduce((s, i) => s + Number(i.qty_ordered), 0)
  const filledLb  = order.retail_order_items.filter(i => i.unit === 'LB').reduce((s, i) => s + Number(i.qty_filled),  0)
  const pct = totalLb > 0 ? Math.min(100, Math.round((filledLb / totalLb) * 100)) : null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflowY: 'auto', gap: '1.25rem' }}>
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
        <div>
          <h2 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.2rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.3rem' }}>
            {order.customer_name}
          </h2>
          {order.customer_phone && (
            <div style={{ fontSize: '0.82rem', color: C.lightBrown }}>{order.customer_phone}</div>
          )}
          <div style={{ fontSize: '0.78rem', color: C.tan, marginTop: '0.25rem' }}>
            Ordered {new Date(order.order_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
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
            <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Delivery Time</div>
            <div style={{ fontSize: '0.85rem', color: C.cream, fontWeight: 600, marginTop: '0.15rem' }}>
              {new Date(order.delivery_datetime).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
            </div>
          </div>
        )}
      </div>

      {(order.delivery_address || order.shipping_address) && (
        <div style={{ fontSize: '0.82rem', color: C.tan, fontStyle: 'italic' }}>
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
        <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>
          Items
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {order.retail_order_items.length === 0 && (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem', fontStyle: 'italic' }}>No items on this order.</div>
          )}
          {order.retail_order_items.map(item => {
            const itemPct = item.qty_ordered > 0 ? Math.min(100, Math.round((Number(item.qty_filled) / Number(item.qty_ordered)) * 100)) : 0
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
                        {Number(item.qty_filled).toFixed(item.unit === 'LB' ? 1 : 0)} filled
                      </button>
                    )}
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
function OrderListTab({ fulfilled }: { fulfilled: boolean }) {
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
    setOrders(Array.isArray(filtered) ? filtered : [])
    setLoading(false)
  }, [fulfilled])

  useEffect(() => { load() }, [load])

  function handleUpdated(updated: RetailOrder) {
    setOrders(prev => prev.map(o => o.id === updated.id ? updated : o))
    setSelected(updated)
  }

  const overdue = (o: RetailOrder) => new Date(o.due_date) < new Date() && o.status !== 'fulfilled'

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
                <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.88rem' }}>{o.customer_name}</span>
                <StatusBadge status={o.status} />
              </div>
              <div style={{ fontSize: '0.75rem', color: overdue(o) ? C.red : C.tan }}>
                Due {new Date(o.due_date + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                {overdue(o) ? ' — OVERDUE' : ''}
                {' · '}{o.fulfillment_type.charAt(0).toUpperCase() + o.fulfillment_type.slice(1)}
              </div>
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
          <OrderDetail order={selected} onUpdated={handleUpdated} />
        )}
      </div>
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

  useEffect(() => {
    fetch('/api/processing?active=true')
      .then(r => r.json())
      .then((data: unknown) => {
        if (Array.isArray(data)) {
          setPluList((data as { plu_number?: string; item_name?: string; unit?: string }[])
            .filter(d => d.plu_number)
            .map(d => ({ plu_number: String(d.plu_number), item_name: d.item_name ?? '', unit: d.unit ?? 'LB' }))
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
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1400px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'new'       && <NewOrderTab key={newKey} onSaved={() => { setNewKey(k => k + 1); setTab('open') }} pluList={pluList} />}
        {tab === 'open'      && <OrderListTab key="open"      fulfilled={false} />}
        {tab === 'fulfilled' && <OrderListTab key="fulfilled" fulfilled={true}  />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
