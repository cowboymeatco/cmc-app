'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { isoDate } from '@/lib/dates'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  amber:      '#E8883A',
  blue:       '#60A5FA',
}

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box',
}

interface VAItem { product: string; category: string; detail?: string; qty?: number }
interface Sheet {
  id:            string
  customer_name: string
  species:       string | null
  date:          string | null
  products:      VAItem[]
}

// Column order for the value-add matrix — the way the cut walks the hog, ending
// with the smokehouse. Anything not listed sorts after, alphabetically.
const COL_ORDER = [
  'Bacon', 'Shoulder Bacon', 'Cured & Smoked Ham', 'Cured & Smoked Hocks',
  'Smoked Chops', 'Pulled Pork',
  'Pork Sausage', 'Italian Sausage', 'Jumpstart Spicy Sausage',
  'Brats', 'Snack Sticks', 'Summer Sausage', 'Jerky', 'Hot Dogs',
]
const colRank = (p: string) => { const i = COL_ORDER.indexOf(p); return i === -1 ? 999 : i }

const speciesEmoji = (s: string | null) =>
  s === 'Pork' ? '🐷' : s === 'Beef' ? '🐄' : s === 'Lamb' ? '🐑' : s === 'Goat' ? '🐐' : '🥩'

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const headers = Object.keys(rows[0])
  const esc = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [headers.join(','), ...rows.map(r => headers.map(h => esc(r[h])).join(','))].join('\n')
}

function download(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

export default function ValueAddReport() {
  const today = isoDate()
  const yearStart = today.slice(0, 4) + '-01-01'

  const [from, setFrom] = useState(yearStart)
  const [to,   setTo]   = useState(today)
  const [sheets, setSheets] = useState<Sheet[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [species, setSpecies] = useState('Pork') // hogs first
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState<'date' | 'customer'>('date')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr('')
    const p = new URLSearchParams({ type: 'value_add', from, to })
    fetch(`/api/reports?${p}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setSheets(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancelled) setErr('Could not load the report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  const speciesList = useMemo(
    () => [...new Set(sheets.map(s => s.species).filter(Boolean))].sort() as string[],
    [sheets],
  )

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = sheets.filter(s => {
      if (species !== 'all' && s.species !== species) return false
      if (q && !s.customer_name.toLowerCase().includes(q)) return false
      return true
    })
    out.sort((a, b) =>
      sortKey === 'customer'
        ? a.customer_name.localeCompare(b.customer_name) || (a.date ?? '').localeCompare(b.date ?? '')
        : (b.date ?? '').localeCompare(a.date ?? '') || a.customer_name.localeCompare(b.customer_name),
    )
    return out
  }, [sheets, species, search, sortKey])

  // Columns present in the filtered rows, in cut order. Cell = the detail
  // (brats "German · 25 lb") when the sheet carries it, else a plain check.
  const cols = useMemo(() => {
    const set = new Set<string>()
    for (const s of rows) for (const p of s.products) set.add(p.product)
    return [...set].sort((a, b) => (colRank(a) - colRank(b)) || a.localeCompare(b))
  }, [rows])

  const itemsFor = (s: Sheet, col: string): VAItem[] => s.products.filter(p => p.product === col)
  const qtyOf    = (it: VAItem) => it.qty ?? 1
  const rowQty   = (s: Sheet) => s.products.reduce((n, p) => n + qtyOf(p), 0)
  // Cell text: a bare quantity for plain products ("2"), qty×detail for the ones
  // that carry a spec ("2× Cut in Half", "German · 25 lb"), joined when a product
  // has more than one variant on the sheet.
  const cellText = (items: VAItem[]) =>
    items.map(it => it.detail ? (qtyOf(it) > 1 ? `${qtyOf(it)}× ${it.detail}` : it.detail) : String(qtyOf(it))).join('  /  ')
  const colTotals = useMemo(
    () => cols.map(c => rows.reduce((n, s) => n + itemsFor(s, c).reduce((m, it) => m + qtyOf(it), 0), 0)),
    [cols, rows],
  )

  function exportCSV() {
    const out = rows.map(s => {
      const base: Record<string, unknown> = { date: s.date ?? '', customer: s.customer_name, species: s.species ?? '' }
      for (const c of cols) { const items = itemsFor(s, c); base[c] = items.length ? cellText(items) : '' }
      base.total = rowQty(s)
      return base
    })
    download(toCSV(out), `value-add_${species}_${from}_to_${to}.csv`)
  }

  const totalCustomers = rows.length
  const totalItems = rows.reduce((n, s) => n + rowQty(s), 0)

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', gap: '1rem',
      }}>
        <Link href="/reports" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Reports</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
            Value-Add Output
          </h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
            Who ordered value-add — off the cut sheets, by kill date
          </p>
        </div>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 1280, margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...INPUT, width: 150 }} />
          <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...INPUT, width: 150 }} />
          <select value={species} onChange={e => setSpecies(e.target.value)} style={{ ...INPUT, width: 150 }}>
            <option value="Pork">🐷 Hogs (Pork)</option>
            {speciesList.filter(s => s !== 'Pork').map(s => <option key={s} value={s}>{speciesEmoji(s)} {s}</option>)}
            <option value="all">All species</option>
          </select>
          <select value={sortKey} onChange={e => setSortKey(e.target.value as 'date' | 'customer')} style={{ ...INPUT, width: 150 }}>
            <option value="date">Sort: kill date</option>
            <option value="customer">Sort: customer</option>
          </select>
          <input
            placeholder="Search customer…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 160 }}
          />
          <button onClick={exportCSV} disabled={!rows.length} style={{
            background: rows.length ? C.tan : C.medBrown, color: C.dark, border: 'none', borderRadius: 3,
            padding: '0.5rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, cursor: rows.length ? 'pointer' : 'default',
          }}>⬇ CSV</button>
        </div>

        {/* Matrix */}
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            {loading ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>Loading…</div>
            ) : err ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: C.amber }}>{err}</div>
            ) : !rows.length ? (
              <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>No value-add orders for these filters.</div>
            ) : (
              <table style={{ borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: '100%' }}>
                <thead>
                  <tr style={{ background: 'rgba(166,120,90,0.14)' }}>
                    <th style={{ position: 'sticky', left: 0, background: '#2a160a', textAlign: 'left', padding: '0.6rem 0.8rem', color: C.tan, fontWeight: 700, whiteSpace: 'nowrap', zIndex: 2 }}>Customer</th>
                    <th style={{ textAlign: 'left', padding: '0.6rem 0.7rem', color: C.tan, fontWeight: 700, whiteSpace: 'nowrap' }}>Kill date</th>
                    {cols.map(c => (
                      <th key={c} style={{ padding: '0.6rem 0.6rem', color: C.cream, fontWeight: 700, whiteSpace: 'nowrap', borderLeft: '1px solid rgba(166,120,90,0.12)', fontSize: '0.76rem' }}>{c}</th>
                    ))}
                    <th style={{ padding: '0.6rem 0.7rem', color: C.tan, fontWeight: 800, textAlign: 'center', borderLeft: '1px solid rgba(166,120,90,0.3)' }}>Total</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(s => (
                    <tr key={s.id} style={{ borderTop: '1px solid rgba(166,120,90,0.1)' }}>
                      <td style={{ position: 'sticky', left: 0, background: C.dark, padding: '0.45rem 0.8rem', color: C.cream, fontWeight: 600, whiteSpace: 'nowrap', zIndex: 1 }}>{s.customer_name}</td>
                      <td style={{ padding: '0.45rem 0.7rem', color: C.lightBrown, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{s.date ?? '—'}</td>
                      {cols.map(c => {
                        const items = itemsFor(s, c)
                        const hasDetail = items.some(it => it.detail)
                        return (
                          <td key={c} style={{ padding: '0.45rem 0.6rem', textAlign: 'center', borderLeft: '1px solid rgba(166,120,90,0.08)', whiteSpace: 'nowrap', color: hasDetail ? C.tan : C.green }}>
                            {items.length
                              ? <span style={{ fontSize: hasDetail ? '0.72rem' : '0.86rem', fontWeight: hasDetail ? 400 : 700 }}>{cellText(items)}</span>
                              : <span style={{ color: 'rgba(166,120,90,0.18)' }}>·</span>}
                          </td>
                        )
                      })}
                      <td style={{ padding: '0.45rem 0.7rem', textAlign: 'center', color: C.cream, fontWeight: 800, borderLeft: '1px solid rgba(166,120,90,0.3)' }}>{rowQty(s)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr style={{ borderTop: '2px solid rgba(166,120,90,0.4)', background: 'rgba(166,120,90,0.1)' }}>
                    <td style={{ position: 'sticky', left: 0, background: '#2a160a', padding: '0.55rem 0.8rem', color: C.tan, fontWeight: 800, whiteSpace: 'nowrap', zIndex: 1 }}>Total · {totalCustomers}</td>
                    <td />
                    {colTotals.map((n, i) => (
                      <td key={i} style={{ padding: '0.55rem 0.6rem', textAlign: 'center', color: C.amber, fontWeight: 800, borderLeft: '1px solid rgba(166,120,90,0.12)' }}>{n}</td>
                    ))}
                    <td style={{ padding: '0.55rem 0.7rem', textAlign: 'center', color: C.amber, fontWeight: 800, borderLeft: '1px solid rgba(166,120,90,0.3)' }}>{totalItems}</td>
                  </tr>
                </tfoot>
              </table>
            )}
          </div>
        </div>

        <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.75rem', lineHeight: 1.6 }}>
          Built from the <strong style={{ color: C.tan }}>cut sheets</strong> — what each customer ordered, before
          anything is made — one row per sheet. Each cell shows <strong style={{ color: C.tan }}>how many</strong> of that
          product they ordered — a whole hog has two bellies and two hams, so bacon and cured ham often read 2; ham shows
          its cut and smokehouse cells show the lbs and flavor. The <strong style={{ color: C.tan }}>Total</strong> column
          sums a customer&apos;s value-add pieces; the bottom row totals the pieces of each product across all customers.
          Kill date is the linked appointment&apos;s harvest date, or the date on the sheet. Beef &amp; lamb currently
          show the shared smokehouse and ground-sausage items only.
        </p>
      </main>
    </div>
  )
}
