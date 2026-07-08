'use client'

import { useEffect, useMemo, useState, useCallback } from 'react'

// Cross-system alignment view: every active PLU with its Scale / Clover /
// QuickBooks standing side by side. Read-only — links are made in the
// Clover and QuickBooks tabs; this is the "where are the gaps" dashboard.

const C = {
  dark:       '#1A0A04',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
}
const CARD: React.CSSProperties = {
  background: C.dark, border: '1px solid rgba(166,120,90,0.25)',
  borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem',
}
const TH: React.CSSProperties = {
  textAlign: 'left', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase',
  letterSpacing: '0.1em', padding: '0.4rem 0.6rem', borderBottom: '1px solid rgba(166,120,90,0.25)',
}
const TD: React.CSSProperties = {
  padding: '0.45rem 0.6rem', fontSize: '0.83rem', color: C.cream,
  borderBottom: '1px solid rgba(166,120,90,0.12)',
}

interface CloverCell { name?: string; price?: number; priceDrift?: boolean; nameDrift?: boolean; missing?: boolean }
interface QboCell { name?: string; fullName?: string; salesPrice?: number | null; inactive?: boolean; priceDrift?: boolean; nameDrift?: boolean; missing?: boolean }
interface Row {
  plu: { id: string; plu_number: string; item_name: string; price: number | null; retail_price: number | null; is_retail: boolean }
  onScale: boolean
  clover: CloverCell | null
  qbo: QboCell | null
}
interface Summary {
  total: number; bothLinked: number; cloverOnly: number; qboOnly: number
  unlinked: number; priceDrift: number; nameDrift: number; brokenLinks: number
}

type Filter = 'all' | 'both' | 'clover-only' | 'qbo-only' | 'unlinked' | 'price-drift' | 'name-drift' | 'broken'

const money = (v: number | null | undefined) => (v != null ? `$${v.toFixed(2)}` : '—')
const cents = (v: number | undefined) => (v != null ? `$${(v / 100).toFixed(2)}` : '—')

export default function AlignmentTab() {
  const [rows, setRows] = useState<Row[] | null>(null)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [cloverError, setCloverError] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [filter, setFilter] = useState<Filter>('all')
  const [search, setSearch] = useState('')

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/alignment')
      const json = await res.json()
      if (!res.ok || json.error) throw new Error(json.error ?? 'Load failed')
      setRows(json.rows)
      setSummary(json.summary)
      setCloverError(json.cloverError)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => { load() }, [load])

  const filtered = useMemo(() => {
    if (!rows) return []
    const s = search.toUpperCase().trim()
    return rows.filter(r => {
      if (s && !r.plu.item_name.toUpperCase().includes(s) && !r.plu.plu_number.includes(s)) return false
      switch (filter) {
        case 'both':        return !!r.clover && !!r.qbo
        case 'clover-only': return !!r.clover && !r.qbo
        case 'qbo-only':    return !r.clover && !!r.qbo
        case 'unlinked':    return !r.clover && !r.qbo
        case 'price-drift': return !!(r.clover?.priceDrift || r.qbo?.priceDrift)
        case 'name-drift':  return !!(r.clover?.nameDrift || r.qbo?.nameDrift)
        case 'broken':      return !!(r.clover?.missing || r.qbo?.missing)
        default:            return true
      }
    })
  }, [rows, filter, search])

  if (error) return (
    <div style={{ ...CARD, borderColor: C.red, color: C.red, fontSize: '0.85rem' }}>
      {error} <button onClick={load} style={{ background: 'transparent', color: C.red, border: `1px solid ${C.red}`, borderRadius: 3, marginLeft: '1rem', padding: '0.2rem 0.6rem', cursor: 'pointer' }}>Retry</button>
    </div>
  )
  if (!rows || !summary) return <div style={{ color: C.lightBrown, padding: '2rem' }}>Comparing catalogs…</div>

  const chips: { id: Filter; label: string; count: number; color?: string }[] = [
    { id: 'all',         label: 'All PLUs',        count: summary.total },
    { id: 'both',        label: '✓ Fully linked',  count: summary.bothLinked, color: C.green },
    { id: 'clover-only', label: 'Clover only',     count: summary.cloverOnly, color: C.yellow },
    { id: 'qbo-only',    label: 'QuickBooks only', count: summary.qboOnly, color: C.yellow },
    { id: 'unlinked',    label: 'Unlinked',        count: summary.unlinked, color: C.lightBrown },
    { id: 'price-drift', label: 'Price drift',     count: summary.priceDrift, color: C.yellow },
    { id: 'name-drift',  label: 'Name drift',      count: summary.nameDrift, color: C.yellow },
    { id: 'broken',      label: '⚠ Broken links',  count: summary.brokenLinks, color: C.red },
  ]

  return (
    <div>
      <div style={{ ...CARD, display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: '0.75rem' }}>
        <div>
          <div style={{ color: C.tan, fontWeight: 700, fontSize: '0.95rem' }}>Catalog Alignment</div>
          <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
            One row per active PLU — the scale book, Clover, and QuickBooks side by side.
            Fix links in the 🍀 Clover and 📗 QuickBooks tabs.
          </div>
          {cloverError && <div style={{ color: C.yellow, fontSize: '0.75rem', marginTop: '0.3rem' }}>⚠ Clover unreachable right now ({cloverError}) — Clover column reflects links only.</div>}
        </div>
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search PLU # or name…"
          style={{
            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3,
            padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.85rem', outline: 'none', width: 240,
          }}
        />
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
        {chips.map(ch => (
          <button key={ch.id} onClick={() => setFilter(ch.id)} style={{
            background: filter === ch.id ? C.medBrown : 'rgba(255,255,255,0.05)',
            border: `1px solid ${filter === ch.id ? C.tan : 'rgba(166,120,90,0.3)'}`,
            borderRadius: 3, color: ch.color ?? C.cream, padding: '0.35rem 0.8rem',
            fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
          }}>
            {ch.label} <span style={{ opacity: 0.7 }}>({ch.count})</span>
          </button>
        ))}
      </div>

      <div style={{ ...CARD, padding: 0, overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead><tr>
            <th style={TH}>PLU</th><th style={TH}>App Item</th>
            <th style={TH}>Scale $</th><th style={TH}>Retail $</th>
            <th style={TH}>Clover</th><th style={TH}>Clover $</th>
            <th style={TH}>QuickBooks</th><th style={TH}>QB $</th>
          </tr></thead>
          <tbody>
            {filtered.slice(0, 400).map(r => (
              <tr key={r.plu.id}>
                <td style={{ ...TD, fontFamily: 'monospace', color: C.lightBrown }}>{r.plu.plu_number}</td>
                <td style={TD}>{r.plu.item_name}</td>
                <td style={{ ...TD, color: r.onScale ? C.cream : C.lightBrown }}>{money(r.plu.price)}</td>
                <td style={TD}>{money(r.plu.retail_price)}</td>
                <td style={{ ...TD, fontSize: '0.78rem', color: r.clover?.nameDrift ? C.yellow : C.cream }}>
                  {!r.clover ? <span style={{ color: 'rgba(166,120,90,0.5)' }}>—</span>
                    : r.clover.missing ? <span style={{ color: C.red }}>⚠ gone from Clover</span>
                    : r.clover.name}
                </td>
                <td style={{ ...TD, color: r.clover?.priceDrift ? C.yellow : C.cream }}>
                  {r.clover && !r.clover.missing ? cents(r.clover.price) : '—'}
                </td>
                <td style={{ ...TD, fontSize: '0.78rem', color: r.qbo?.nameDrift ? C.yellow : C.cream }}>
                  {!r.qbo ? <span style={{ color: 'rgba(166,120,90,0.5)' }}>—</span>
                    : r.qbo.missing ? <span style={{ color: C.red }}>⚠ not in QB cache</span>
                    : <>{r.qbo.name}{r.qbo.inactive && <span style={{ color: C.yellow }}> (inactive)</span>}</>}
                </td>
                <td style={{ ...TD, color: r.qbo?.priceDrift ? C.yellow : C.cream }}>
                  {r.qbo && !r.qbo.missing ? money(r.qbo.salesPrice) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length > 400 && (
          <div style={{ padding: '0.6rem 1rem', color: C.lightBrown, fontSize: '0.78rem' }}>
            Showing first 400 of {filtered.length} — narrow with search or a filter.
          </div>
        )}
        {filtered.length === 0 && (
          <div style={{ padding: '1rem', color: C.lightBrown, fontSize: '0.83rem' }}>Nothing matches this filter.</div>
        )}
      </div>
    </div>
  )
}
