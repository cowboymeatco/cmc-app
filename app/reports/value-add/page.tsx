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

interface Row {
  customer_name: string
  pack_date:     string
  plu_number:    string | null
  item_name:     string
  species:       string
  weight_lbs:    number
  pieces:        number
  boxes:         number
}

const speciesEmoji = (s: string) =>
  s === 'Pork' ? '🐷' : s === 'Beef' ? '🐄' : s === 'Lamb' ? '🐑' : s === 'Goat' ? '🐐' : s === 'Processed' ? '🌭' : '🥩'

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

function Stat({ n, label, color }: { n: string | number; label: string; color: string }) {
  return (
    <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '0.7rem 1rem', minWidth: 110 }}>
      <div style={{ color, fontSize: '1.35rem', fontWeight: 800, fontFamily: 'Georgia, serif' }}>{n}</div>
      <div style={{ color: C.lightBrown, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  )
}

type SortKey = 'pack_date' | 'customer_name' | 'item_name' | 'weight_lbs'

export default function ValueAddReport() {
  const today = isoDate()
  const yearStart = today.slice(0, 4) + '-01-01'

  const [from, setFrom] = useState(yearStart)
  const [to,   setTo]   = useState(today)
  const [rows, setRows] = useState<Row[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  // Charlie asked for hogs first, everything eventually — so default to Pork.
  const [species, setSpecies] = useState('Pork')
  const [search,  setSearch]  = useState('')
  const [sortKey, setSortKey] = useState<SortKey>('pack_date')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr('')
    const p = new URLSearchParams({ type: 'value_add', from, to })
    fetch(`/api/reports?${p}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setRows(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancelled) setErr('Could not load the report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  const speciesList = useMemo(
    () => [...new Set(rows.map(r => r.species).filter(s => s && s !== '—'))].sort() as string[],
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    const out = rows.filter(r => {
      if (species !== 'all' && r.species !== species) return false
      if (q) {
        const hay = `${r.customer_name} ${r.item_name}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      if (sortKey === 'weight_lbs') return (a.weight_lbs - b.weight_lbs) * dir
      const av = String(a[sortKey] ?? ''), bv = String(b[sortKey] ?? '')
      // Secondary key keeps a stable, readable order within the primary sort.
      return (av.localeCompare(bv) || a.pack_date.localeCompare(b.pack_date) || a.customer_name.localeCompare(b.customer_name)) * dir
    })
    return out
  }, [rows, species, search, sortKey, sortDir])

  const stats = useMemo(() => ({
    customers: new Set(filtered.map(r => r.customer_name)).size,
    products:  new Set(filtered.map(r => r.item_name)).size,
    lbs:       Math.round(filtered.reduce((s, r) => s + Number(r.weight_lbs), 0)),
    lines:     filtered.length,
  }), [filtered])

  function setSort(k: SortKey) {
    if (k === sortKey) setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSortKey(k); setSortDir(k === 'weight_lbs' || k === 'pack_date' ? 'desc' : 'asc') }
  }

  function exportCSV() {
    const out = filtered.map(r => ({
      pack_date: r.pack_date, customer: r.customer_name, product: r.item_name,
      species: r.species, plu: r.plu_number ?? '', weight_lbs: r.weight_lbs, boxes: r.boxes,
    }))
    download(toCSV(out), `value-add_${species}_${from}_to_${to}.csv`)
  }

  const arrow = (k: SortKey) => sortKey === k ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''
  const th = (label: string, k: SortKey, align: 'left' | 'right' = 'left'): React.ReactNode => (
    <th onClick={() => setSort(k)} style={{ textAlign: align, padding: '0.6rem 0.8rem', color: C.tan, fontWeight: 700, whiteSpace: 'nowrap', cursor: 'pointer', userSelect: 'none' }}>
      {label}{arrow(k)}
    </th>
  )

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
            Who got value-add product, by processing date
          </p>
        </div>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 1200, margin: '0 auto', boxSizing: 'border-box' }}>

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
          <input
            placeholder="Search customer or product…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 200 }}
          />
          <button onClick={exportCSV} disabled={!filtered.length} style={{
            background: filtered.length ? C.tan : C.medBrown, color: C.dark, border: 'none', borderRadius: 3,
            padding: '0.5rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, cursor: filtered.length ? 'pointer' : 'default',
          }}>⬇ CSV</button>
        </div>

        {/* Summary */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <Stat n={stats.customers} label="Customers" color={C.cream} />
          <Stat n={stats.products}  label="Products" color={C.tan} />
          <Stat n={stats.lbs.toLocaleString()} label="Lbs value-add" color={C.green} />
          <Stat n={stats.lines}     label="Line items" color={C.blue} />
        </div>

        {/* Table */}
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 760 }}>
              <thead>
                <tr style={{ background: 'rgba(166,120,90,0.12)' }}>
                  {th('Processing date', 'pack_date')}
                  {th('Customer', 'customer_name')}
                  {th('Value-add product', 'item_name')}
                  <th style={{ textAlign: 'left', padding: '0.6rem 0.8rem', color: C.tan, fontWeight: 700 }}>Species</th>
                  {th('Weight', 'weight_lbs', 'right')}
                  <th style={{ textAlign: 'right', padding: '0.6rem 0.8rem', color: C.tan, fontWeight: 700 }}>Boxes</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>Loading…</td></tr>
                ) : err ? (
                  <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: C.amber }}>{err}</td></tr>
                ) : !filtered.length ? (
                  <tr><td colSpan={6} style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>No value-add product for these filters.</td></tr>
                ) : filtered.map((r, i) => (
                  <tr key={i} style={{ borderTop: '1px solid rgba(166,120,90,0.1)' }}>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.lightBrown, whiteSpace: 'nowrap', fontFamily: 'monospace' }}>{r.pack_date}</td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.cream, fontWeight: 600 }}>{r.customer_name}</td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.tan }}>{r.item_name}</td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.lightBrown, whiteSpace: 'nowrap' }}>{speciesEmoji(r.species)} {r.species}</td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.cream, textAlign: 'right', fontFamily: 'monospace', whiteSpace: 'nowrap' }}>{Number(r.weight_lbs).toFixed(1)} lb</td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.lightBrown, textAlign: 'right', fontFamily: 'monospace' }}>{r.boxes}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.75rem', lineHeight: 1.6 }}>
          Each row is one value-add product scanned into a customer&apos;s boxes on a processing date, weights summed.
          Value-add = anything smoked, cured, seasoned, or made into a product (bacon, ham, sausage, brats, snack
          sticks, summer sausage, salami, jerky…); plain fresh cuts are left out. Click a column heading to sort.
        </p>
      </main>
    </div>
  )
}
