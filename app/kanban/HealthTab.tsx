'use client'
import { useMemo } from 'react'
import { daysBetweenISO, isoDate } from '@/lib/dates'
import { cardLabel, itemHealth, leadDays, money, sizing, type Item, type Vendor } from '@/lib/kanban'
import type { TabProps } from './page'
import { C, Pill, cardStyle } from './ui'

// Is the kanban working? Lean measures a replenishment loop by what it
// prevents: stockouts. Then by whether the plan matches reality — the lead
// time the cards are sized on vs the lead time the trucks actually take — and
// by what the loops cost. Last, the housekeeping that quietly breaks a loop:
// no vendor, no price, a price nobody has checked in six months.

interface Row {
  item: Item
  vendor: Vendor | undefined
  h: ReturnType<typeof itemHealth>
  planned: number | null
  issues: { text: string; color: string }[]
  score: number
}

export default function HealthTab({ data }: TabProps) {
  const today = isoDate()
  const vendors = useMemo(() => new Map(data.vendors.map(v => [v.id, v])), [data.vendors])

  const rows: Row[] = useMemo(() => data.items.filter(i => i.active).map(item => {
    const vendor = vendors.get(item.vendor_id ?? '')
    const h = itemHealth(data.signals.filter(s => s.item_id === item.id))
    const planned = leadDays(item, vendor).days
    const sz = sizing(item, vendor)
    const issues: Row['issues'] = []
    if (h.stockouts) issues.push({ text: `${h.stockouts} stockout${h.stockouts === 1 ? '' : 's'}`, color: C.red })
    if (sz.flag === 'undersized') issues.push({ text: 'undersized', color: C.red })
    if (planned != null && h.avgLead != null && h.avgLead > planned + 1) {
      issues.push({ text: `lead runs ${Math.round(h.avgLead - planned)}d over plan`, color: C.amber })
    }
    if (sz.flag === 'oversized') issues.push({ text: 'oversized', color: C.amber })
    if (!item.vendor_id) issues.push({ text: 'no vendor', color: C.amber })
    if (item.price == null) issues.push({ text: 'no price', color: C.amber })
    else if (item.price_updated_at && daysBetweenISO(isoDate(new Date(item.price_updated_at)), today) > 180) {
      issues.push({ text: 'price 6+ months old', color: C.lightBrown })
    }
    if (planned == null) issues.push({ text: 'no lead time', color: C.amber })
    if (item.daily_usage == null) issues.push({ text: 'no usage rate', color: C.lightBrown })
    if (!item.location) issues.push({ text: 'no location', color: C.lightBrown })
    const score = issues.reduce((t, i) => t + (i.color === C.red ? 100 : i.color === C.amber ? 10 : 1), 0)
    return { item, vendor, h, planned, issues, score }
  }).sort((a, b) => b.score - a.score || a.item.name.localeCompare(b.item.name)), [data, vendors, today])

  const all = itemHealth(data.signals)
  const spendByVendor = new Map<string, number>()
  for (const s of data.signals) {
    if (s.status !== 'received') continue
    const q = s.received_qty ?? s.qty
    if (q == null || s.unit_price == null) continue
    const k = vendors.get(s.vendor_id ?? '')?.name ?? 'No vendor'
    spendByVendor.set(k, (spendByVendor.get(k) ?? 0) + q * s.unit_price)
  }
  const maxSpend = Math.max(1, ...spendByVendor.values())

  return (
    <div>
      <div style={{ color: C.lightBrown, fontSize: 12, marginBottom: 10 }}>Last 90 days of kanban signals.</div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: 10, marginBottom: 16 }}>
        <Tile label="Stockouts" value={String(all.stockouts)} color={all.stockouts ? C.red : C.green} sub="cards pulled OUT" />
        <Tile label="Orders received" value={String(all.cycles)} color={C.blue} sub="loops completed" />
        <Tile label="On time" value={all.onTimePct == null ? '—' : `${all.onTimePct}%`} color={all.onTimePct == null || all.onTimePct >= 90 ? C.green : C.amber} sub="received by expected date" />
        <Tile label="Avg lead time" value={all.avgLead == null ? '—' : `${all.avgLead.toFixed(1)}d`} color={C.tan} sub="ordered → received" />
        <Tile label="Pull → shelf" value={all.avgPullToReceive == null ? '—' : `${all.avgPullToReceive.toFixed(1)}d`} color={C.tan} sub="whole loop, incl. time to order" />
        <Tile label="Spend" value={money(all.spend)} color={C.cream} sub="received at invoice price" />
      </div>

      {spendByVendor.size > 0 && (
        <div style={{ ...cardStyle, marginBottom: 16 }}>
          <h3 style={{ color: C.cream, fontSize: 15, margin: '0 0 10px' }}>Spend by vendor</h3>
          {[...spendByVendor.entries()].sort((a, b) => b[1] - a[1]).map(([name, amt]) => (
            <div key={name} style={{ display: 'grid', gridTemplateColumns: '160px 1fr 90px', gap: 10, alignItems: 'center', marginBottom: 6, fontSize: 13 }}>
              <span style={{ color: C.tan, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
              <div style={{ background: C.dark, borderRadius: 4, height: 12 }}>
                <div style={{ width: `${(amt / maxSpend) * 100}%`, background: C.medBrown, height: '100%', borderRadius: 4 }} />
              </div>
              <span style={{ color: C.cream, textAlign: 'right' }}>{money(amt)}</span>
            </div>
          ))}
        </div>
      )}

      <div style={{ overflowX: 'auto', background: C.dark, borderRadius: 10, border: `1px solid ${C.medBrown}` }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 900 }}>
          <thead>
            <tr style={{ color: C.tan, fontSize: 12, textAlign: 'left' }}>
              {['Card', 'Cycles', 'Stockouts', 'Lead plan / actual', 'On time', 'Spend', 'Needs attention'].map(h => (
                <th key={h} style={{ padding: '8px 10px', borderBottom: `1px solid ${C.medBrown}`, fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.item.id} style={{ color: C.cream, borderBottom: `1px solid ${C.medBrown}55` }}>
                <td style={{ padding: '8px 10px' }}>
                  <span style={{ fontFamily: 'monospace', color: C.tan }}>{cardLabel(r.item.card_no)}</span> {r.item.name}
                  <div style={{ color: C.lightBrown, fontSize: 11 }}>{r.vendor?.name ?? '—'}</div>
                </td>
                <td style={{ padding: '8px 10px' }}>{r.h.cycles}</td>
                <td style={{ padding: '8px 10px', color: r.h.stockouts ? C.red : C.cream }}>{r.h.stockouts}</td>
                <td style={{ padding: '8px 10px' }}>
                  {r.planned != null ? `${r.planned}d` : '—'} / {r.h.avgLead != null ? `${r.h.avgLead.toFixed(1)}d` : '—'}
                </td>
                <td style={{ padding: '8px 10px' }}>{r.h.onTimePct != null ? `${r.h.onTimePct}%` : '—'}</td>
                <td style={{ padding: '8px 10px' }}>{r.h.spend ? money(r.h.spend) : '—'}</td>
                <td style={{ padding: '8px 10px' }}>
                  <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                    {r.issues.length === 0 ? <Pill color={C.green}>healthy</Pill> : r.issues.map(i => <Pill key={i.text} color={i.color}>{i.text}</Pill>)}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Tile({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div style={{ ...cardStyle, padding: 12, borderLeft: `4px solid ${color}` }}>
      <div style={{ color: C.tan, fontSize: 12 }}>{label}</div>
      <div style={{ color, fontSize: 24, fontWeight: 800, lineHeight: 1.2 }}>{value}</div>
      <div style={{ color: C.lightBrown, fontSize: 11 }}>{sub}</div>
    </div>
  )
}
