'use client'
import { useMemo, useState } from 'react'
import { addDaysISO, dateLabel, isoDate } from '@/lib/dates'
import {
  CATEGORIES, CATEGORY_COLOR, cardLabel, daysLate, money, nextOrderDay, qtyText,
  type Item, type Signal, type Vendor,
} from '@/lib/kanban'
import type { TabProps } from './page'
import { C, Pill, ago, cardStyle, inputStyle, smallBtn } from './ui'

// The loop, left to right: cards pulled and waiting on an order, cards on
// order, what came in this week, and everything still full on the shelf.

export default function BoardTab({ data, who, reload, setError, goOrder }: TabProps & { goOrder: () => void }) {
  const [cat, setCat] = useState('')
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [receiving, setReceiving] = useState<string | null>(null)

  const items = useMemo(() => new Map(data.items.map(i => [i.id, i])), [data.items])
  const vendors = useMemo(() => new Map(data.vendors.map(v => [v.id, v])), [data.vendors])
  const today = isoDate()

  const matches = (item: Item | undefined) => {
    if (!item) return false
    if (cat && item.category !== cat) return false
    if (!q.trim()) return true
    const hay = `${item.name} ${cardLabel(item.card_no)} ${item.location ?? ''} ${item.vendor_sku ?? ''} ${vendors.get(item.vendor_id ?? '')?.name ?? ''}`.toLowerCase()
    return hay.includes(q.trim().toLowerCase())
  }

  const pulled = data.signals.filter(s => s.status === 'pulled' && matches(items.get(s.item_id)))
    .sort((a, b) => (a.urgency === 'out' ? 0 : 1) - (b.urgency === 'out' ? 0 : 1) || a.pulled_at.localeCompare(b.pulled_at))
  const ordered = data.signals.filter(s => s.status === 'ordered' && matches(items.get(s.item_id)))
    .sort((a, b) => (a.expected_on ?? '9999').localeCompare(b.expected_on ?? '9999'))
  const weekAgo = addDaysISO(today, -7)
  const received = data.signals.filter(s => s.status === 'received' && s.received_at &&
    isoDate(new Date(s.received_at)) > weekAgo && matches(items.get(s.item_id)))
    .sort((a, b) => (b.received_at ?? '').localeCompare(a.received_at ?? ''))

  const outCount = new Map<string, number>()
  for (const s of data.signals) if (s.status === 'pulled' || s.status === 'ordered') {
    outCount.set(s.item_id, (outCount.get(s.item_id) ?? 0) + 1)
  }
  const onShelf = data.items.filter(i => i.active && matches(i) && (outCount.get(i.id) ?? 0) < i.cards_in_loop)
    .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))

  const value = (sigs: Signal[]) => sigs.reduce((t, s) => t + (s.qty ?? 0) * (s.unit_price ?? 0), 0)
  const late = ordered.filter(s => (daysLate(s, today) ?? 0) > 0)
  const outs = [...pulled, ...ordered].filter(s => s.urgency === 'out')
  const orderToday = new Set(pulled.map(s => items.get(s.item_id)?.vendor_id ?? '')
    .filter(vid => vid && nextOrderDay(vendors.get(vid), today) === today)).size

  async function act(body: Record<string, unknown>, key: string) {
    if (!who.trim()) { setError('Type your name in the top corner first.'); return }
    setBusy(key)
    try {
      const method = body.action ? 'PATCH' : 'POST'
      const res = await fetch('/api/kanban/signals', {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body.action ? { ...body, by: who } : { ...body, pulled_by: who }),
      })
      const out = await res.json()
      if (!res.ok) setError(out?.error ?? "That didn't save.")
      else setReceiving(null)
      await reload()
    } catch {
      setError('No signal — nothing was saved.')
    } finally {
      setBusy(null)
    }
  }

  if (data.items.length === 0) {
    return (
      <div style={{ ...cardStyle, color: C.tan, lineHeight: 1.6 }}>
        No kanban cards yet. Set up your <b>Vendors</b> first, then add a <b>Card</b> for each thing you
        reorder — then print the cards and put them on the bins.
      </div>
    )
  }

  return (
    <div>
      {/* Top-line numbers: what needs a person today. */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 14 }}>
        <Stat label="Pulled — to order" value={String(pulled.length)} sub={money(value(pulled))} color={C.amber} onClick={goOrder} />
        <Stat label="Vendors to order today" value={String(orderToday)} sub="on their order day" color={C.amber} onClick={goOrder} />
        <Stat label="On order" value={String(ordered.length)} sub={money(value(ordered))} color={C.blue} />
        <Stat label="Late" value={String(late.length)} sub="past expected date" color={late.length ? C.red : C.green} />
        <Stat label="Stockouts open" value={String(outs.length)} sub="flagged OUT" color={outs.length ? C.red : C.green} />
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search name, K-#, location, SKU, vendor"
          style={{ ...inputStyle, flex: '1 1 240px', minHeight: 42 }} />
        <select value={cat} onChange={e => setCat(e.target.value)} style={{ ...inputStyle, flex: '0 1 220px', minHeight: 42 }}>
          <option value="">All categories</option>
          {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 14, alignItems: 'start' }}>
        <Column title="Pulled — needs ordering" color={C.amber} count={pulled.length}>
          {pulled.map(s => {
            const item = items.get(s.item_id)!
            const v = vendors.get(item.vendor_id ?? '')
            return (
              <SignalCard key={s.id} s={s} item={item} vendor={v}>
                <div style={{ color: C.tan, fontSize: 12 }}>
                  Pulled by {s.pulled_by} · {ago(s.pulled_at)}{s.source === 'scan' ? ' · scanned' : ''}
                </div>
                {v && (
                  <div style={{ color: C.lightBrown, fontSize: 12 }}>
                    Next order day: {nextOrderDay(v, today) === today ? <b style={{ color: C.amber }}>today</b> : dateLabel(nextOrderDay(v, today), { weekday: 'short', month: 'short', day: 'numeric' })}
                    {v.order_cutoff ? ` · cutoff ${v.order_cutoff}` : ''}
                  </div>
                )}
                <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                  <button disabled={busy === s.id} onClick={() => act({ ids: [s.id], action: 'ordered' }, s.id)} style={smallBtn(C.blue)}>Ordered</button>
                  <button disabled={busy === s.id} onClick={goOrder} style={smallBtn(C.tan)}>Order sheet ›</button>
                  <button disabled={busy === s.id} onClick={() => { if (confirm(`Put ${item.name} back — no order needed?`)) act({ ids: [s.id], action: 'cancelled' }, s.id) }} style={smallBtn(C.lightBrown)}>✕</button>
                </div>
              </SignalCard>
            )
          })}
          {pulled.length === 0 && <Empty>No cards waiting on an order.</Empty>}
        </Column>

        <Column title="On order" color={C.blue} count={ordered.length}>
          {ordered.map(s => {
            const item = items.get(s.item_id)!
            const lateBy = daysLate(s, today)
            return (
              <SignalCard key={s.id} s={s} item={item} vendor={vendors.get(s.vendor_id ?? item.vendor_id ?? '')}>
                <div style={{ color: C.tan, fontSize: 12 }}>
                  Ordered {s.ordered_at ? ago(s.ordered_at) : ''}{s.ordered_by ? ` by ${s.ordered_by}` : ''}{s.po_number ? ` · PO ${s.po_number}` : ''}
                </div>
                <div style={{ fontSize: 13, marginTop: 2, color: lateBy != null && lateBy > 0 ? C.red : C.cream, fontWeight: 600 }}>
                  {s.expected_on
                    ? lateBy! > 0 ? `${lateBy} day${lateBy === 1 ? '' : 's'} LATE — was due ${dateLabel(s.expected_on, { month: 'short', day: 'numeric' })}`
                      : lateBy === 0 ? 'Due today'
                      : `Due ${dateLabel(s.expected_on, { weekday: 'short', month: 'short', day: 'numeric' })}`
                    : 'No expected date — add a lead time'}
                </div>
                {receiving === s.id
                  ? <ReceiveForm s={s} item={item} busy={busy === s.id} onCancel={() => setReceiving(null)}
                      onSave={(qty, price) => act({ ids: [s.id], action: 'received', received_qty: qty, unit_price: price }, s.id)} />
                  : (
                    <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                      <button disabled={busy === s.id} onClick={() => setReceiving(s.id)} style={smallBtn(C.green)}>Received</button>
                      <button disabled={busy === s.id} onClick={() => act({ ids: [s.id], action: 'reopen' }, s.id)} style={smallBtn(C.lightBrown)}>Not ordered after all</button>
                    </div>
                  )}
              </SignalCard>
            )
          })}
          {ordered.length === 0 && <Empty>Nothing on order.</Empty>}
        </Column>

        <Column title="Received — last 7 days" color={C.green} count={received.length}>
          {received.map(s => {
            const item = items.get(s.item_id)!
            return (
              <SignalCard key={s.id} s={s} item={item} vendor={vendors.get(s.vendor_id ?? '')} dim>
                <div style={{ color: C.tan, fontSize: 12 }}>
                  In {ago(s.received_at)}{s.received_by ? ` · ${s.received_by}` : ''}
                  {s.received_qty != null && s.qty != null && s.received_qty !== s.qty ? ` · got ${s.received_qty} of ${s.qty}` : ''}
                </div>
                <div style={{ color: C.lightBrown, fontSize: 12 }}>Put the card back on the bin.</div>
              </SignalCard>
            )
          })}
          {received.length === 0 && <Empty>Nothing received this week.</Empty>}
        </Column>

        <Column title="Full — on the shelf" color={C.tan} count={onShelf.length}>
          {onShelf.map(i => {
            const out = outCount.get(i.id) ?? 0
            return (
              <div key={i.id} style={{ ...cardStyle, padding: 10, borderLeft: `4px solid ${CATEGORY_COLOR[i.category] ?? C.tan}`, display: 'flex', alignItems: 'center', gap: 8 }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.cream, fontSize: 14, fontWeight: 600 }}>
                    <span style={{ color: C.tan, fontFamily: 'monospace', fontSize: 12 }}>{cardLabel(i.card_no)}</span> {i.name}
                  </div>
                  <div style={{ color: C.lightBrown, fontSize: 12 }}>
                    {[i.location, i.cards_in_loop > 1 ? `${i.cards_in_loop - out}/${i.cards_in_loop} cards home` : null].filter(Boolean).join(' · ') || ' '}
                  </div>
                </div>
                <button disabled={busy === i.id} onClick={() => act({ item_id: i.id, source: 'board' }, i.id)} style={smallBtn(C.amber)}>Pull</button>
              </div>
            )
          })}
          {onShelf.length === 0 && <Empty>Every card is out.</Empty>}
        </Column>
      </div>
    </div>
  )
}

function Stat({ label, value, sub, color, onClick }: { label: string; value: string; sub: string; color: string; onClick?: () => void }) {
  return (
    <div onClick={onClick} style={{ ...cardStyle, borderLeft: `4px solid ${color}`, cursor: onClick ? 'pointer' : 'default', padding: 12 }}>
      <div style={{ color: C.tan, fontSize: 12 }}>{label}</div>
      <div style={{ color, fontSize: 26, fontWeight: 800, lineHeight: 1.2 }}>{value}</div>
      <div style={{ color: C.lightBrown, fontSize: 12 }}>{sub}</div>
    </div>
  )
}

function Column({ title, color, count, children }: { title: string; color: string; count: number; children: React.ReactNode }) {
  return (
    <section style={{ background: C.dark, border: `1px solid ${C.medBrown}`, borderTop: `3px solid ${color}`, borderRadius: 10, padding: 10 }}>
      <h2 style={{ color: C.cream, fontSize: 14, fontWeight: 700, margin: '2px 4px 10px', display: 'flex', justifyContent: 'space-between' }}>
        {title} <span style={{ color }}>{count}</span>
      </h2>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>{children}</div>
    </section>
  )
}

function Empty({ children }: { children: React.ReactNode }) {
  return <div style={{ color: C.lightBrown, fontSize: 13, padding: '8px 4px', fontStyle: 'italic' }}>{children}</div>
}

function SignalCard({ s, item, vendor, dim, children }: {
  s: Signal; item: Item; vendor: Vendor | undefined; dim?: boolean; children: React.ReactNode
}) {
  const unit = item.order_unit ?? item.unit
  const edge = `1px solid ${s.urgency === 'out' && s.status !== 'received' ? C.red : C.medBrown}`
  return (
    // Sides spelled out rather than cardStyle's `border` shorthand: the OUT
    // colour changes on re-render, and React warns when a shorthand and its
    // longhands are mixed on the same element.
    <div style={{
      background: cardStyle.background, borderRadius: cardStyle.borderRadius, padding: 10, opacity: dim ? 0.8 : 1,
      borderTop: edge, borderRight: edge, borderBottom: edge,
      borderLeft: `4px solid ${CATEGORY_COLOR[item.category] ?? C.tan}`,
    }}>
      <div style={{ display: 'flex', gap: 6, alignItems: 'flex-start' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.cream, fontSize: 15, fontWeight: 700 }}>
            <span style={{ color: C.tan, fontFamily: 'monospace', fontSize: 12 }}>{cardLabel(item.card_no)}</span> {item.name}
          </div>
          <div style={{ color: C.tan, fontSize: 13 }}>
            {qtyText(s.qty, unit)}{s.unit_price != null && s.qty != null ? ` · ${money(s.unit_price * s.qty)}` : ''}
            {vendor ? ` · ${vendor.name}` : ' · no vendor set'}
            {item.vendor_sku ? ` #${item.vendor_sku}` : ''}
          </div>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
          {s.urgency === 'out' && s.status !== 'received' && <Pill color={C.red} solid>OUT</Pill>}
          {s.card_seq != null && item.cards_in_loop > 1 && <Pill color={C.tan}>card {s.card_seq}/{item.cards_in_loop}</Pill>}
        </div>
      </div>
      {children}
      {s.note && <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 4 }}>{s.note}</div>}
    </div>
  )
}

function ReceiveForm({ s, item, busy, onSave, onCancel }: {
  s: Signal; item: Item; busy: boolean
  onSave: (qty: number | '', price: number | '') => void
  onCancel: () => void
}) {
  const [qty, setQty] = useState(s.qty != null ? String(s.qty) : '')
  const [price, setPrice] = useState(s.unit_price != null ? String(s.unit_price) : '')
  return (
    <div style={{ marginTop: 8, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
      <label style={{ color: C.tan, fontSize: 11 }}>Qty in ({item.order_unit ?? item.unit ?? 'units'})
        <input type="number" inputMode="decimal" value={qty} onChange={e => setQty(e.target.value)} style={{ ...inputStyle, minHeight: 38 }} />
      </label>
      <label style={{ color: C.tan, fontSize: 11 }}>$ each (on the invoice)
        <input type="number" inputMode="decimal" step="0.01" value={price} onChange={e => setPrice(e.target.value)} style={{ ...inputStyle, minHeight: 38 }} />
      </label>
      <button disabled={busy} onClick={() => onSave(qty === '' ? '' : Number(qty), price === '' ? '' : Number(price))} style={smallBtn(C.green)}>
        {busy ? 'Saving…' : 'Save — it’s here'}
      </button>
      <button onClick={onCancel} style={smallBtn(C.lightBrown)}>Cancel</button>
    </div>
  )
}
