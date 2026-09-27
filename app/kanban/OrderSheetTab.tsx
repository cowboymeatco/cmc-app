'use client'
import { useMemo, useState } from 'react'
import { dateLabel, isoDate } from '@/lib/dates'
import {
  ORDER_METHOD_LABEL, cardLabel, expectedOn, leadDays, money, nextOrderDay, orderText,
  type Item, type Signal, type Vendor,
} from '@/lib/kanban'
import type { TabProps } from './page'
import { C, Banner, Pill, cardStyle, inputStyle, smallBtn } from './ui'

// Pulled cards grouped by vendor: one call, one email, one PO per vendor, with
// everything needed to place it on screen — how they take orders, the account
// number, the cutoff, the minimum and the free-freight line.

interface Group { vendor: Vendor | undefined; lines: { s: Signal; item: Item }[] }

export default function OrderSheetTab({ data, who, reload, setError }: TabProps) {
  const today = isoDate()
  const items = useMemo(() => new Map(data.items.map(i => [i.id, i])), [data.items])
  const vendors = useMemo(() => new Map(data.vendors.map(v => [v.id, v])), [data.vendors])

  const groups: Group[] = useMemo(() => {
    const by = new Map<string, Group>()
    for (const s of data.signals) {
      if (s.status !== 'pulled') continue
      const item = items.get(s.item_id)
      if (!item) continue
      const key = item.vendor_id ?? ''
      if (!by.has(key)) by.set(key, { vendor: vendors.get(key), lines: [] })
      by.get(key)!.lines.push({ s, item })
    }
    // Vendors whose order day is today first, then by name; "no vendor" last.
    return [...by.values()].sort((a, b) => {
      if (!a.vendor) return 1
      if (!b.vendor) return -1
      const ad = nextOrderDay(a.vendor, today), bd = nextOrderDay(b.vendor, today)
      return ad.localeCompare(bd) || a.vendor.name.localeCompare(b.vendor.name)
    })
  }, [data.signals, items, vendors, today])

  if (groups.length === 0) {
    return <div style={{ ...cardStyle, color: C.tan }}>No cards pulled — nothing to order. 👍</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      {groups.map(g => (
        <VendorOrder key={g.vendor?.id ?? 'none'} g={g} today={today} who={who} reload={reload} setError={setError} />
      ))}
    </div>
  )
}

function VendorOrder({ g, today, who, reload, setError }: {
  g: Group; today: string; who: string
  reload: () => Promise<void>; setError: (e: string | null) => void
}) {
  const v = g.vendor
  const [po, setPo] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  // The ETA for the whole order is the slowest line's lead time.
  const leads = g.lines.map(l => leadDays(l.item, v).days).filter((d): d is number => d != null)
  const defaultEta = leads.length ? expectedOn(today, Math.max(...leads)) : null
  const [eta, setEta] = useState(defaultEta ?? '')

  const subtotal = g.lines.reduce((t, l) => t + (l.s.qty ?? 0) * (l.item.price ?? 0), 0)
  const unpriced = g.lines.filter(l => l.item.price == null).length
  const orderDay = nextOrderDay(v, today)
  const text = orderText(v, g.lines.map(l => ({ item: l.item, qty: l.s.qty })))

  async function patch(body: Record<string, unknown>) {
    if (!who.trim()) { setError('Type your name in the top corner first.'); return false }
    setBusy(true)
    try {
      const res = await fetch('/api/kanban/signals', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, by: who }),
      })
      const out = await res.json()
      if (!res.ok) { setError(out?.error ?? "That didn't save."); return false }
      await reload()
      return true
    } catch {
      setError('No signal — nothing was saved.')
      return false
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError('Could not copy — select the text and copy it by hand.')
    }
  }

  const mailto = v?.email
    ? `mailto:${v.email}?subject=${encodeURIComponent(`Order — Cowboy Meat Co.${v.account_number ? ` (acct ${v.account_number})` : ''}`)}&body=${encodeURIComponent(text)}`
    : null

  return (
    <section style={{ ...cardStyle, padding: 0, overflow: 'hidden' }}>
      {/* How to place it */}
      <div style={{ padding: 14, background: C.dark, borderBottom: `1px solid ${C.medBrown}` }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'baseline', justifyContent: 'space-between' }}>
          <h2 style={{ color: C.cream, fontSize: 20, margin: 0 }}>{v?.name ?? 'No vendor set'}</h2>
          {v && (
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              <Pill color={C.tan}>{ORDER_METHOD_LABEL[v.order_method] ?? v.order_method}</Pill>
              {orderDay === today
                ? <Pill color={C.amber} solid>Order day: TODAY{v.order_cutoff ? ` by ${v.order_cutoff}` : ''}</Pill>
                : <Pill color={C.tan}>Next order day {dateLabel(orderDay, { weekday: 'short', month: 'short', day: 'numeric' })}</Pill>}
            </div>
          )}
        </div>
        {v ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '4px 16px', marginTop: 8, fontSize: 13, color: C.tan }}>
            {v.contact_name && <div>👤 {v.contact_name}</div>}
            {v.phone && <div>📞 <a href={`tel:${v.phone}`} style={{ color: C.cream }}>{v.phone}</a></div>}
            {v.email && <div>✉️ <a href={`mailto:${v.email}`} style={{ color: C.cream }}>{v.email}</a></div>}
            {v.website && <div>🌐 <a href={v.website.startsWith('http') ? v.website : `https://${v.website}`} target="_blank" rel="noreferrer" style={{ color: C.cream }}>{v.website}</a></div>}
            {v.account_number && <div>Acct # <b style={{ color: C.cream }}>{v.account_number}</b></div>}
            {v.order_days.length > 0 && <div>Takes orders: {v.order_days.join(', ')}</div>}
            {v.delivery_days.length > 0 && <div>Delivers: {v.delivery_days.join(', ')}</div>}
            {v.lead_days != null && <div>Lead time: {v.lead_days} days</div>}
            {v.payment_terms && <div>Terms: {v.payment_terms}</div>}
          </div>
        ) : (
          <div style={{ color: C.amber, fontSize: 13, marginTop: 6 }}>These cards have no vendor — set one on the Cards tab.</div>
        )}
        {v?.notes && <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 6 }}>{v.notes}</div>}
      </div>

      {/* What to order */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 14 }}>
          <thead>
            <tr style={{ color: C.tan, fontSize: 12, textAlign: 'left' }}>
              {['Card', 'Item', 'Vendor #', 'Qty', '$ each', 'Line $', ''].map(h => (
                <th key={h} style={{ padding: '8px 10px', borderBottom: `1px solid ${C.medBrown}`, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {g.lines.map(({ s, item }) => (
              <tr key={s.id} style={{ color: C.cream, borderBottom: `1px solid ${C.medBrown}55` }}>
                <td style={{ padding: '8px 10px', fontFamily: 'monospace', color: C.tan, whiteSpace: 'nowrap' }}>{cardLabel(item.card_no)}</td>
                <td style={{ padding: '8px 10px' }}>
                  {item.name} {s.urgency === 'out' && <Pill color={C.red} solid>OUT</Pill>}
                  {item.order_instructions && <div style={{ color: C.amber, fontSize: 12 }}>{item.order_instructions}</div>}
                  {item.alt_vendor_sku && <div style={{ color: C.lightBrown, fontSize: 11 }}>Alt #{item.alt_vendor_sku}</div>}
                </td>
                <td style={{ padding: '8px 10px', fontFamily: 'monospace' }}>{item.vendor_sku ?? '—'}</td>
                <td style={{ padding: '8px 10px', whiteSpace: 'nowrap' }}>
                  <QtyEdit s={s} unit={item.order_unit ?? item.unit} busy={busy}
                    onSave={qty => patch({ ids: [s.id], action: 'qty', qty })} />
                  {item.min_order_qty != null && (s.qty ?? 0) < item.min_order_qty && (
                    <div style={{ color: C.red, fontSize: 11 }}>Min {item.min_order_qty}</div>
                  )}
                </td>
                <td style={{ padding: '8px 10px' }}>{money(item.price)}</td>
                <td style={{ padding: '8px 10px' }}>{item.price != null && s.qty != null ? money(item.price * s.qty) : '—'}</td>
                <td style={{ padding: '8px 10px' }}>
                  <button disabled={busy} onClick={() => { if (confirm(`Take ${item.name} off this order?`)) patch({ ids: [s.id], action: 'cancelled' }) }} style={{ ...smallBtn(C.lightBrown), minHeight: 30 }}>✕</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Totals against the vendor's lines */}
      <div style={{ padding: 14 }}>
        <div style={{ color: C.cream, fontSize: 16, fontWeight: 700 }}>
          Subtotal {money(subtotal)}{unpriced ? <span style={{ color: C.amber, fontSize: 12, fontWeight: 400 }}> · {unpriced} line{unpriced === 1 ? '' : 's'} with no price</span> : null}
        </div>
        {v?.min_order != null && subtotal < v.min_order && (
          <Banner tone="warn">Under {v.name}&apos;s {money(v.min_order)} minimum by {money(v.min_order - subtotal)} — wait for more cards, or add from the shelf.</Banner>
        )}
        {v?.free_freight_at != null && (
          subtotal >= v.free_freight_at
            ? <div style={{ color: C.green, fontSize: 13, margin: '4px 0 10px' }}>✓ Free freight (over {money(v.free_freight_at)})</div>
            : <div style={{ color: C.tan, fontSize: 13, margin: '4px 0 10px' }}>{money(v.free_freight_at - subtotal)} more for free freight</div>
        )}

        <details style={{ margin: '8px 0 12px' }}>
          <summary style={{ color: C.tan, cursor: 'pointer', fontSize: 13 }}>Order text (to paste or read down the phone)</summary>
          <pre style={{ whiteSpace: 'pre-wrap', background: C.dark, color: C.cream, padding: 10, borderRadius: 8, fontSize: 13, marginTop: 6 }}>{text}</pre>
        </details>

        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}>
          <button onClick={copy} style={smallBtn(C.tan)}>{copied ? '✓ Copied' : '📋 Copy order'}</button>
          {mailto && <a href={mailto} style={{ ...smallBtn(C.tan), display: 'inline-flex', alignItems: 'center', textDecoration: 'none' }}>✉️ Email it</a>}
          <div style={{ flex: 1 }} />
          <label style={{ color: C.tan, fontSize: 11 }}>PO / confirmation #
            <input value={po} onChange={e => setPo(e.target.value)} style={{ ...inputStyle, minHeight: 38, width: 150 }} />
          </label>
          <label style={{ color: C.tan, fontSize: 11 }}>Expected
            <input type="date" value={eta} onChange={e => setEta(e.target.value)} style={{ ...inputStyle, minHeight: 38, width: 160 }} />
          </label>
          <button disabled={busy} onClick={async () => {
            const ok = await patch({ ids: g.lines.map(l => l.s.id), action: 'ordered', po_number: po, expected_on: eta || undefined })
            if (ok) setPo('')
          }} style={{ ...smallBtn(C.blue), minHeight: 44, fontSize: 15 }}>
            {busy ? 'Saving…' : `✓ Placed — mark ${g.lines.length} ordered`}
          </button>
        </div>
      </div>
    </section>
  )
}

function QtyEdit({ s, unit, busy, onSave }: { s: Signal; unit: string | null; busy: boolean; onSave: (q: number) => void }) {
  const [v, setV] = useState(s.qty != null ? String(s.qty) : '')
  const changed = v !== (s.qty != null ? String(s.qty) : '')
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
      <input type="number" inputMode="decimal" value={v} onChange={e => setV(e.target.value)}
        style={{ ...inputStyle, minHeight: 32, width: 70, padding: '4px 6px', fontSize: 14 }} />
      <span style={{ color: C.tan, fontSize: 12 }}>{unit ?? ''}</span>
      {changed && Number(v) > 0 && (
        <button disabled={busy} onClick={() => onSave(Number(v))} style={{ ...smallBtn(C.green), minHeight: 30, padding: '0 8px' }}>Save</button>
      )}
    </span>
  )
}
