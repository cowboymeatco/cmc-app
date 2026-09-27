'use client'
import { useState } from 'react'
import { DAYS, ORDER_METHODS, ORDER_METHOD_LABEL, money, type Vendor } from '@/lib/kanban'
import type { TabProps } from './page'
import { C, Banner, BigButton, Pill, cardStyle, inputStyle, labelStyle, num, smallBtn } from './ui'

// Who we buy from, and how each one takes an order. Everything the order sheet
// needs to place an order without digging for a business card.

export default function VendorsTab({ data, who, reload, setError }: TabProps) {
  const [editing, setEditing] = useState<Vendor | 'new' | null>(null)
  const [showRetired, setShowRetired] = useState(false)

  if (editing) {
    return (
      <VendorEditor vendor={editing === 'new' ? null : editing} who={who} setError={setError}
        onDone={async () => { setEditing(null); await reload() }} onCancel={() => setEditing(null)} />
    )
  }

  const cardCount = new Map<string, number>()
  for (const i of data.items) if (i.active && i.vendor_id) cardCount.set(i.vendor_id, (cardCount.get(i.vendor_id) ?? 0) + 1)
  const rows = data.vendors.filter(v => showRetired || v.active)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, alignItems: 'center' }}>
        <button onClick={() => setEditing('new')} style={{ ...smallBtn(C.amber), minHeight: 44, fontSize: 15 }}>+ New vendor</button>
        <div style={{ flex: 1 }} />
        <label style={{ color: C.tan, fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} /> Retired
        </label>
      </div>
      {rows.length === 0 && <div style={{ ...cardStyle, color: C.tan }}>No vendors yet.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
        {rows.map(v => (
          <div key={v.id} onClick={() => setEditing(v)} style={{ ...cardStyle, cursor: 'pointer', opacity: v.active ? 1 : 0.5 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <div style={{ color: C.cream, fontSize: 17, fontWeight: 700 }}>{v.name}{!v.active && ' (retired)'}</div>
              <Pill color={C.tan}>{cardCount.get(v.id) ?? 0} cards</Pill>
            </div>
            <div style={{ color: C.tan, fontSize: 13, marginTop: 6, lineHeight: 1.6 }}>
              <div>{ORDER_METHOD_LABEL[v.order_method]}{v.contact_name ? ` · ${v.contact_name}` : ''}</div>
              {(v.phone || v.email) && <div>{[v.phone, v.email].filter(Boolean).join(' · ')}</div>}
              {v.account_number && <div>Acct # {v.account_number}</div>}
              <div>
                Lead {v.lead_days != null ? `${v.lead_days}d` : '—'}
                {v.order_days.length ? ` · orders ${v.order_days.join('/')}` : ''}
                {v.order_cutoff ? ` by ${v.order_cutoff}` : ''}
              </div>
              {(v.min_order != null || v.free_freight_at != null) && (
                <div>
                  {v.min_order != null ? `Min ${money(v.min_order)}` : ''}
                  {v.min_order != null && v.free_freight_at != null ? ' · ' : ''}
                  {v.free_freight_at != null ? `Free freight ${money(v.free_freight_at)}` : ''}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

type Form = Record<string, string>

function VendorEditor({ vendor, who, onDone, onCancel, setError }: {
  vendor: Vendor | null; who: string
  onDone: () => Promise<void>; onCancel: () => void; setError: (e: string | null) => void
}) {
  const s = (v: unknown) => (v == null ? '' : String(v))
  const [f, setF] = useState<Form>({
    name: s(vendor?.name), contact_name: s(vendor?.contact_name), phone: s(vendor?.phone),
    email: s(vendor?.email), website: s(vendor?.website), account_number: s(vendor?.account_number),
    order_method: vendor?.order_method ?? 'phone', order_cutoff: s(vendor?.order_cutoff),
    lead_days: s(vendor?.lead_days), min_order: s(vendor?.min_order), free_freight_at: s(vendor?.free_freight_at),
    payment_terms: s(vendor?.payment_terms), notes: s(vendor?.notes),
  })
  const [orderDays, setOrderDays] = useState<string[]>(vendor?.order_days ?? [])
  const [deliveryDays, setDeliveryDays] = useState<string[]>(vendor?.delivery_days ?? [])
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(p => ({ ...p, [k]: e.target.value }))

  async function save(extra: Record<string, unknown> = {}) {
    if (!who.trim()) { setError('Type your name in the top corner first.'); return }
    setBusy(true)
    try {
      const body: Record<string, unknown> = {
        ...f, lead_days: num(f.lead_days), min_order: num(f.min_order), free_freight_at: num(f.free_freight_at),
        order_days: orderDays, delivery_days: deliveryDays, updated_by: who, ...extra,
      }
      if (vendor) body.id = vendor.id
      const res = await fetch('/api/kanban/vendors', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const out = await res.json()
      if (!res.ok) { setError(out?.error ?? "That didn't save."); return }
      setError(null)
      await onDone()
    } catch {
      setError('No signal — nothing was saved.')
    } finally {
      setBusy(false)
    }
  }

  async function retire() {
    if (!vendor || !confirm(`Retire ${vendor.name}? Cards that use them keep the link until you change it.`)) return
    setBusy(true)
    const res = await fetch(`/api/kanban/vendors?id=${vendor.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { setError((await res.json())?.error ?? "That didn't save."); return }
    await onDone()
  }

  const field = (k: string, label: string, opts: { type?: string; placeholder?: string } = {}) => (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      <input type={opts.type ?? 'text'} inputMode={opts.type === 'number' ? 'decimal' : undefined}
        value={f[k]} onChange={set(k)} placeholder={opts.placeholder} style={{ ...inputStyle, minHeight: 42 }} />
    </label>
  )
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 12 }

  return (
    <div style={{ maxWidth: 900, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={onCancel} style={smallBtn(C.tan)}>‹ Vendors</button>
        <h2 style={{ color: C.cream, margin: 0, fontSize: 20 }}>{vendor ? vendor.name : 'New vendor'}</h2>
      </div>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <h3 style={{ color: C.cream, fontSize: 15, margin: '0 0 10px' }}>Contact</h3>
        <div style={grid}>
          {field('name', 'Vendor name *')}
          {field('contact_name', 'Rep / contact')}
          {field('phone', 'Phone', { type: 'tel' })}
          {field('email', 'Order email', { type: 'email' })}
          {field('website', 'Website / order portal')}
          {field('account_number', 'Our account #')}
        </div>
      </div>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <h3 style={{ color: C.cream, fontSize: 15, margin: '0 0 10px' }}>How they take an order</h3>
        <div style={grid}>
          <label><span style={labelStyle}>Order by</span>
            <select value={f.order_method} onChange={set('order_method')} style={{ ...inputStyle, minHeight: 42 }}>
              {ORDER_METHODS.map(m => <option key={m} value={m}>{ORDER_METHOD_LABEL[m]}</option>)}
            </select>
          </label>
          {field('order_cutoff', 'Order cutoff', { placeholder: '2 PM MT' })}
          {field('lead_days', 'Lead time (days, order → our dock)', { type: 'number' })}
        </div>
        <DayPicker label="Days they take orders (none = any day)" days={orderDays} setDays={setOrderDays} />
        <DayPicker label="Days they deliver" days={deliveryDays} setDays={setDeliveryDays} />
      </div>

      <div style={{ ...cardStyle, marginBottom: 14 }}>
        <h3 style={{ color: C.cream, fontSize: 15, margin: '0 0 10px' }}>Money</h3>
        <div style={grid}>
          {field('min_order', 'Minimum order ($)', { type: 'number' })}
          {field('free_freight_at', 'Free freight at ($)', { type: 'number' })}
          {field('payment_terms', 'Payment terms', { placeholder: 'Net 30' })}
        </div>
        <label style={{ display: 'block', marginTop: 12 }}><span style={labelStyle}>Notes</span>
          <textarea value={f.notes} onChange={set('notes')} rows={3} style={{ ...inputStyle, minHeight: 70 }} />
        </label>
      </div>

      {!f.name.trim() && <Banner tone="warn">Name the vendor to save.</Banner>}
      <div style={{ display: 'flex', gap: 10 }}>
        <div style={{ flex: 1 }}>
          <BigButton label={busy ? 'Saving…' : vendor ? 'Save vendor' : 'Add vendor'} disabled={busy || !f.name.trim()} onClick={() => save()} />
        </div>
        {vendor?.active && <button disabled={busy} onClick={retire} style={{ ...smallBtn(C.red), minHeight: 56 }}>Retire</button>}
        {vendor && !vendor.active && <button disabled={busy} onClick={() => save({ active: true })} style={{ ...smallBtn(C.green), minHeight: 56 }}>Bring back</button>}
      </div>
    </div>
  )
}

function DayPicker({ label, days, setDays }: { label: string; days: string[]; setDays: (d: string[]) => void }) {
  return (
    <div style={{ marginTop: 12 }}>
      <span style={labelStyle}>{label}</span>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {DAYS.map(d => {
          const on = days.includes(d)
          return (
            <button key={d} type="button"
              onClick={() => setDays(on ? days.filter(x => x !== d) : DAYS.filter(x => x === d || days.includes(x)))}
              style={{ minWidth: 52, minHeight: 40, borderRadius: 8, cursor: 'pointer', fontWeight: 600,
                background: on ? C.medBrown : C.dark, border: `1px solid ${on ? C.tan : C.medBrown}`, color: on ? C.cream : C.tan }}>
              {d}
            </button>
          )
        })}
      </div>
    </div>
  )
}
