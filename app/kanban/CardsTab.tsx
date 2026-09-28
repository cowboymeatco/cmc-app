'use client'
import { useMemo, useState } from 'react'
import Link from 'next/link'
import { dateLabel, isoDate } from '@/lib/dates'
import {
  CARD_TYPE_LABEL, CATEGORIES, CATEGORY_COLOR, cardLabel, cardValue, leadDays, money, qtyText, sizing,
  type Item, type Vendor,
} from '@/lib/kanban'
import type { TabProps } from './page'
import { C, Banner, BigButton, Pill, cardStyle, inputStyle, labelStyle, num, smallBtn } from './ui'

// The card catalog. Each row is one kanban loop: what a pulled card orders,
// where the bins live, who we buy it from and at what price, and whether the
// card is sized for the lead time.

const FLAG_COLOR = { undersized: C.red, oversized: C.amber, ok: C.green, unknown: C.lightBrown }

export default function CardsTab({ data, who, reload, setError }: TabProps) {
  const [editing, setEditing] = useState<Item | 'new' | null>(null)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState('')
  const [showRetired, setShowRetired] = useState(false)
  const vendors = useMemo(() => new Map(data.vendors.map(v => [v.id, v])), [data.vendors])

  const rows = data.items
    .filter(i => showRetired || i.active)
    .filter(i => !cat || i.category === cat)
    .filter(i => {
      if (!q.trim()) return true
      const hay = `${i.name} ${cardLabel(i.card_no)} ${i.location ?? ''} ${i.vendor_sku ?? ''} ${i.mfg_part_no ?? ''} ${vendors.get(i.vendor_id ?? '')?.name ?? ''}`.toLowerCase()
      return hay.includes(q.trim().toLowerCase())
    })
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  if (editing) {
    return (
      <ItemEditor
        item={editing === 'new' ? null : editing}
        vendors={data.vendors}
        who={who}
        onDone={async () => { setEditing(null); await reload() }}
        onCancel={() => setEditing(null)}
        setError={setError}
      />
    )
  }

  const inventoryValue = data.items.filter(i => i.active).reduce((t, i) => t + (cardValue(i) ?? 0) * i.cards_in_loop, 0)

  return (
    <div>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <button onClick={() => setEditing('new')} style={{ ...smallBtn(C.amber), minHeight: 44, fontSize: 15 }}>+ New card</button>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search" style={{ ...inputStyle, flex: '1 1 200px', minHeight: 42 }} />
        <select value={cat} onChange={e => setCat(e.target.value)} style={{ ...inputStyle, flex: '0 1 220px', minHeight: 42 }}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
        <label style={{ color: C.tan, fontSize: 13, display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={showRetired} onChange={e => setShowRetired(e.target.checked)} /> Retired
        </label>
      </div>
      <div style={{ color: C.lightBrown, fontSize: 12, marginBottom: 10 }}>
        {data.items.filter(i => i.active).length} active cards · about {money(inventoryValue)} of stock in the loops at full
      </div>

      <div style={{ overflowX: 'auto', background: C.dark, borderRadius: 10, border: `1px solid ${C.medBrown}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 980 }}>
          <thead>
            <tr style={{ color: C.tan, fontSize: 12, textAlign: 'left' }}>
              {['Card', 'Item', 'Location', 'Vendor / #', 'One card orders', 'Price', 'Lead', 'Sizing', ''].map(h => (
                <th key={h} style={{ padding: '8px 10px', borderBottom: `1px solid ${C.medBrown}`, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(i => {
              const v = vendors.get(i.vendor_id ?? '')
              const lead = leadDays(i, v)
              const sz = sizing(i, v)
              return (
                <tr key={i.id} onClick={() => setEditing(i)} style={{ color: C.cream, cursor: 'pointer', borderBottom: `1px solid ${C.medBrown}55`, opacity: i.active ? 1 : 0.5 }}>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap', borderLeft: `4px solid ${CATEGORY_COLOR[i.category] ?? C.tan}` }}>
                    <span style={{ fontFamily: 'monospace', color: C.tan }}>{cardLabel(i.card_no)}</span>
                    <div style={{ color: C.lightBrown, fontSize: 11 }}>{CARD_TYPE_LABEL[i.card_type]} · {i.cards_in_loop} card{i.cards_in_loop === 1 ? '' : 's'}</div>
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <b>{i.name}</b>{!i.active && ' (retired)'}
                    <div style={{ color: C.lightBrown, fontSize: 11 }}>{i.category}</div>
                  </td>
                  <td style={{ padding: '8px 10px', color: C.tan }}>{i.location ?? '—'}</td>
                  <td style={{ padding: '8px 10px' }}>
                    {v?.name ?? <span style={{ color: C.amber }}>no vendor</span>}
                    {i.vendor_sku && <div style={{ fontFamily: 'monospace', color: C.tan, fontSize: 11 }}>#{i.vendor_sku}</div>}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {qtyText(i.order_qty, i.order_unit ?? i.unit)}
                    {i.units_per_order_unit && i.order_unit && i.unit ? <div style={{ color: C.lightBrown, fontSize: 11 }}>{i.units_per_order_unit} {i.unit}/{i.order_unit}</div> : null}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    {money(i.price)}
                    {cardValue(i) != null && <div style={{ color: C.lightBrown, fontSize: 11 }}>{money(cardValue(i))}/card</div>}
                  </td>
                  <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                    {lead.days != null ? `${lead.days}d` : <span style={{ color: C.amber }}>—</span>}
                    {lead.from === 'vendor' && <span style={{ color: C.lightBrown, fontSize: 11 }}> (vendor)</span>}
                    {i.learned_lead_days != null && <div style={{ color: C.lightBrown, fontSize: 11 }}>actual {i.learned_lead_days}d</div>}
                  </td>
                  <td style={{ padding: '8px 10px' }}>
                    <Pill color={FLAG_COLOR[sz.flag]}>{sz.flag === 'unknown' ? 'not sized' : sz.flag}</Pill>
                  </td>
                  <td style={{ padding: '8px 10px' }} onClick={e => e.stopPropagation()}>
                    <Link href={`/kanban/print?ids=${i.id}`} style={{ color: C.tan, fontSize: 12 }}>🖨</Link>
                  </td>
                </tr>
              )
            })}
            {rows.length === 0 && (
              <tr><td colSpan={9} style={{ padding: 16, color: C.lightBrown }}>No cards match.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────

type Form = Record<string, string>

function toForm(i: Item | null): Form {
  const s = (v: unknown) => (v == null ? '' : String(v))
  return {
    name: s(i?.name), description: s(i?.description), category: i?.category ?? 'Other',
    location: s(i?.location), backstock_location: s(i?.backstock_location),
    card_type: i?.card_type ?? 'two_bin', cards_in_loop: s(i?.cards_in_loop ?? 2),
    unit: s(i?.unit), order_unit: s(i?.order_unit), units_per_order_unit: s(i?.units_per_order_unit),
    order_qty: s(i?.order_qty), min_order_qty: s(i?.min_order_qty), bin_qty: s(i?.bin_qty),
    reorder_point: s(i?.reorder_point), price: s(i?.price),
    vendor_id: s(i?.vendor_id), vendor_sku: s(i?.vendor_sku),
    alt_vendor_id: s(i?.alt_vendor_id), alt_vendor_sku: s(i?.alt_vendor_sku),
    manufacturer: s(i?.manufacturer), mfg_part_no: s(i?.mfg_part_no),
    lead_days: s(i?.lead_days), daily_usage: s(i?.daily_usage), safety_days: s(i?.safety_days ?? 2),
    owner: s(i?.owner), order_instructions: s(i?.order_instructions), sds_url: s(i?.sds_url), notes: s(i?.notes),
  }
}

const NUMERIC = ['cards_in_loop', 'units_per_order_unit', 'order_qty', 'min_order_qty', 'bin_qty',
  'reorder_point', 'price', 'lead_days', 'daily_usage', 'safety_days']

/** The form as an Item, so the live sizing readout uses the same math as the table. */
function formItem(f: Form, base: Item | null): Item {
  const n = (k: string) => (f[k].trim() === '' ? null : Number(f[k]))
  return {
    ...(base ?? ({} as Item)),
    card_type: f.card_type as Item['card_type'],
    cards_in_loop: n('cards_in_loop') ?? 2,
    units_per_order_unit: n('units_per_order_unit'), order_qty: n('order_qty'),
    min_order_qty: n('min_order_qty'), lead_days: n('lead_days'),
    daily_usage: n('daily_usage'), safety_days: n('safety_days') ?? 0,
    vendor_id: f.vendor_id || null,
  }
}

function ItemEditor({ item, vendors, who, onDone, onCancel, setError }: {
  item: Item | null; vendors: Vendor[]; who: string
  onDone: () => Promise<void>; onCancel: () => void; setError: (e: string | null) => void
}) {
  const [f, setF] = useState<Form>(() => toForm(item))
  const [busy, setBusy] = useState(false)
  const set = (k: string) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) =>
    setF(prev => ({ ...prev, [k]: e.target.value }))

  const activeVendors = vendors.filter(v => v.active || v.id === item?.vendor_id || v.id === item?.alt_vendor_id)
  const vendor = vendors.find(v => v.id === f.vendor_id)
  const live = formItem(f, item)
  const sz = sizing(live, vendor)
  const unit = f.unit || 'units'
  const ou = f.order_unit || f.unit || 'units'

  async function save(extra: Record<string, unknown> = {}) {
    if (!who.trim()) { setError('Type your name in the top corner first.'); return }
    setBusy(true)
    try {
      const body: Record<string, unknown> = { updated_by: who, ...extra }
      if (item) body.id = item.id
      for (const [k, v] of Object.entries(f)) body[k] = NUMERIC.includes(k) ? num(v) : v
      const res = await fetch('/api/kanban/items', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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
    if (!item || !confirm(`Retire ${item.name}? Printed cards for it will say it's retired when scanned.`)) return
    setBusy(true)
    const res = await fetch(`/api/kanban/items?id=${item.id}`, { method: 'DELETE' })
    setBusy(false)
    if (!res.ok) { setError((await res.json())?.error ?? "That didn't save."); return }
    await onDone()
  }

  const field = (k: string, label: string, opts: { type?: string; placeholder?: string; step?: string; hint?: string } = {}) => (
    <label style={{ display: 'block' }}>
      <span style={labelStyle}>{label}</span>
      <input type={opts.type ?? 'text'} step={opts.step} inputMode={opts.type === 'number' ? 'decimal' : undefined}
        value={f[k]} onChange={set(k)} placeholder={opts.placeholder} style={{ ...inputStyle, minHeight: 42 }} />
      {opts.hint && <span style={{ color: C.lightBrown, fontSize: 11 }}>{opts.hint}</span>}
    </label>
  )
  const grid: React.CSSProperties = { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 12 }
  const section = (title: string, children: React.ReactNode, sub?: string) => (
    <div style={{ ...cardStyle, marginBottom: 14 }}>
      <h3 style={{ color: C.cream, fontSize: 15, margin: '0 0 2px' }}>{title}</h3>
      {sub && <div style={{ color: C.lightBrown, fontSize: 12, marginBottom: 10 }}>{sub}</div>}
      <div style={{ marginTop: sub ? 0 : 10 }}>{children}</div>
    </div>
  )

  return (
    <div style={{ maxWidth: 980, margin: '0 auto' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <button onClick={onCancel} style={smallBtn(C.tan)}>‹ Cards</button>
        <h2 style={{ color: C.cream, margin: 0, fontSize: 20, flex: 1 }}>
          {item ? <><span style={{ fontFamily: 'monospace', color: C.tan }}>{cardLabel(item.card_no)}</span> {item.name}</> : 'New kanban card'}
        </h2>
        {item && <Link href={`/kanban/print?ids=${item.id}`} style={{ ...smallBtn(C.tan), display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>🖨 Print</Link>}
      </div>

      {section('What it is', (
        <div style={grid}>
          {field('name', 'Name *', { placeholder: 'e.g. Vacuum bags 10×14' })}
          <label><span style={labelStyle}>Category</span>
            <select value={f.category} onChange={set('category')} style={{ ...inputStyle, minHeight: 42 }}>
              {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          {field('description', 'Description / spec', { placeholder: '3 mil, clear' })}
          {field('manufacturer', 'Manufacturer')}
          {field('mfg_part_no', 'Mfg part #')}
          {field('sds_url', 'SDS / spec sheet link', { placeholder: 'https://…' })}
        </div>
      ))}

      {section('Where it lives', (
        <div style={grid}>
          {field('location', 'Point of use (working bin)', { placeholder: 'Packaging room, shelf B2' })}
          {field('backstock_location', 'Backstock (second bin / reserve)', { placeholder: 'Dry storage, rack 3' })}
        </div>
      ), 'Printed on the card so anyone can put it back where it goes.')}

      {section('The loop', (
        <div style={grid}>
          <label><span style={labelStyle}>Card type</span>
            <select value={f.card_type} onChange={set('card_type')} style={{ ...inputStyle, minHeight: 42 }}>
              <option value="two_bin">Two-bin — pull when a bin is empty</option>
              <option value="reorder_point">Reorder point — pull at a marked level</option>
              <option value="single">Single card — pull when it runs out</option>
            </select>
          </label>
          {field('cards_in_loop', 'Cards in the loop', { type: 'number', hint: 'Two-bin = 2. More cards for fast movers.' })}
          {field('unit', 'Unit you use / count', { placeholder: 'roll, each, gal, lb' })}
          {field('order_unit', 'Unit you buy', { placeholder: 'case, pail, box' })}
          {field('units_per_order_unit', `${unit} per ${f.order_unit || 'order unit'}`, { type: 'number' })}
          {field('bin_qty', `Full bin holds (${unit})`, { type: 'number' })}
          {f.card_type === 'reorder_point' && field('reorder_point', `Reorder when down to (${unit})`, { type: 'number', hint: sz.reorderPoint != null ? `Math says ${Math.ceil(sz.reorderPoint)}` : undefined })}
          {field('order_qty', `One card orders (${ou}) — the kanban qty`, { type: 'number' })}
          {field('min_order_qty', `Vendor minimum (${ou})`, { type: 'number' })}
        </div>
      ))}

      {section('Buying it', (
        <div style={grid}>
          <label><span style={labelStyle}>Vendor</span>
            <select value={f.vendor_id} onChange={set('vendor_id')} style={{ ...inputStyle, minHeight: 42 }}>
              <option value="">— none —</option>
              {activeVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          {field('vendor_sku', 'Vendor item #')}
          {field('price', `Price per ${ou} ($)`, { type: 'number', step: '0.01',
            hint: item?.price_updated_at ? `Last changed ${dateLabel(isoDate(new Date(item.price_updated_at)), { month: 'short', day: 'numeric', year: 'numeric' })}` : undefined })}
          <label><span style={labelStyle}>Backup vendor</span>
            <select value={f.alt_vendor_id} onChange={set('alt_vendor_id')} style={{ ...inputStyle, minHeight: 42 }}>
              <option value="">— none —</option>
              {activeVendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
            </select>
          </label>
          {field('alt_vendor_sku', 'Backup vendor item #')}
          {field('owner', 'Who orders it', { placeholder: 'Jill' })}
          <label style={{ gridColumn: '1 / -1' }}><span style={labelStyle}>Ordering instructions</span>
            <textarea value={f.order_instructions} onChange={set('order_instructions')} rows={2}
              placeholder="Ask for the 3 mil, not the 2.5 — the 2.5 tears on bone-in" style={{ ...inputStyle, minHeight: 60 }} />
          </label>
        </div>
      ), 'Shown on the order sheet next to the line.')}

      {section('Lead time & sizing', (
        <>
          <div style={grid}>
            {field('lead_days', 'Lead time (days)', { type: 'number',
              hint: vendor?.lead_days != null ? `Blank uses ${vendor.name}'s ${vendor.lead_days} days` : 'Order placed → on the shelf' })}
            {field('daily_usage', `Average use per day (${unit})`, { type: 'number' })}
            {field('safety_days', 'Safety stock (days of use)', { type: 'number', hint: 'Covers a late truck or a busy week' })}
          </div>
          <div style={{ marginTop: 12, background: C.dark, borderRadius: 8, padding: 12, fontSize: 13, color: C.tan, lineHeight: 1.7 }}>
            {sz.reorderPoint == null ? (
              <span>{sz.note}.</span>
            ) : (
              <>
                <div>Use during lead time: <b style={{ color: C.cream }}>{qtyText(round1(sz.demandDuringLead), unit)}</b> ({f.daily_usage}/day × {sz.lead} days)</div>
                <div>Safety stock: <b style={{ color: C.cream }}>{qtyText(round1(sz.safetyStock), unit)}</b></div>
                <div>Reorder point{f.card_type === 'two_bin' ? ' (what the second bin has to hold)' : ''}: <b style={{ color: C.cream }}>{qtyText(Math.ceil(sz.reorderPoint), unit)}</b></div>
                <div>Suggested kanban qty: <b style={{ color: C.cream }}>{qtyText(sz.suggestedOrderQty, ou)}</b>
                  {sz.coverDays != null && <> · one card as set lasts about <b style={{ color: C.cream }}>{Math.round(sz.coverDays)} days</b></>}
                </div>
                <div style={{ color: FLAG_COLOR[sz.flag], fontWeight: 700 }}>{sz.note}</div>
                <div style={{ display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' }}>
                  {sz.suggestedOrderQty != null && String(sz.suggestedOrderQty) !== f.order_qty && (
                    <button onClick={() => setF(p => ({ ...p, order_qty: String(sz.suggestedOrderQty) }))} style={smallBtn(C.green)}>
                      Use {sz.suggestedOrderQty} {ou}
                    </button>
                  )}
                  {f.card_type === 'reorder_point' && String(Math.ceil(sz.reorderPoint)) !== f.reorder_point && (
                    <button onClick={() => setF(p => ({ ...p, reorder_point: String(Math.ceil(sz.reorderPoint!)) }))} style={smallBtn(C.green)}>
                      Set reorder point to {Math.ceil(sz.reorderPoint)}
                    </button>
                  )}
                </div>
              </>
            )}
            {item?.learned_lead_days != null && (
              <div style={{ marginTop: 6 }}>
                Actual lead time (last receipts): <b style={{ color: C.cream }}>{item.learned_lead_days} days</b>
                {String(Math.ceil(item.learned_lead_days)) !== f.lead_days && (
                  <button onClick={() => setF(p => ({ ...p, lead_days: String(Math.ceil(item.learned_lead_days!)) }))} style={{ ...smallBtn(C.tan), marginLeft: 8, minHeight: 30 }}>
                    Plan with {Math.ceil(item.learned_lead_days)}
                  </button>
                )}
              </div>
            )}
          </div>
        </>
      ), 'Lean sizing: the second bin has to carry you through the lead time plus a safety margin.')}

      {section('Notes', (
        <textarea value={f.notes} onChange={set('notes')} rows={3} style={{ ...inputStyle, minHeight: 70 }} />
      ))}

      {!f.name.trim() && <Banner tone="warn">Give the card a name to save it.</Banner>}
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <BigButton label={busy ? 'Saving…' : item ? 'Save card' : 'Create card'} disabled={busy || !f.name.trim()} onClick={() => save()} tone={C.medBrown} />
        </div>
        {item && item.active && <button disabled={busy} onClick={retire} style={{ ...smallBtn(C.red), minHeight: 56 }}>Retire</button>}
        {item && !item.active && <button disabled={busy} onClick={() => save({ active: true })} style={{ ...smallBtn(C.green), minHeight: 56 }}>Bring back</button>}
      </div>
    </div>
  )
}

function round1(n: number | null): number | null {
  return n == null ? null : Math.round(n * 10) / 10
}
