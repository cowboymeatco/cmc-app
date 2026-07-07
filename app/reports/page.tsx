'use client'
import { useState } from 'react'
import Link from 'next/link'
import { isoDate } from '@/lib/dates'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
}

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box',
}

const BTN = (bg: string): React.CSSProperties => ({
  background: bg, color: C.dark, border: 'none', borderRadius: 3,
  padding: '0.55rem 1.2rem', fontSize: '0.83rem', fontWeight: 700, cursor: 'pointer',
  whiteSpace: 'nowrap',
})

function toCSV(rows: Record<string, unknown>[]): string {
  if (!rows.length) return ''
  const flatRows = rows.map(row => {
    const flat: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(row)) {
      if (Array.isArray(v)) {
        flat[k] = v.map(item =>
          typeof item === 'object' ? JSON.stringify(item) : String(item)
        ).join(' | ')
      } else {
        flat[k] = v
      }
    }
    return flat
  })
  const headers = Object.keys(flatRows[0])
  const escape  = (v: unknown) => {
    const s = v == null ? '' : String(v)
    return s.includes(',') || s.includes('"') || s.includes('\n')
      ? `"${s.replace(/"/g, '""')}"` : s
  }
  return [
    headers.join(','),
    ...flatRows.map(r => headers.map(h => escape(r[h])).join(',')),
  ].join('\n')
}

function downloadCSV(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/csv' })
  const url  = URL.createObjectURL(blob)
  const a    = document.createElement('a')
  a.href = url; a.download = filename
  document.body.appendChild(a); a.click()
  document.body.removeChild(a); URL.revokeObjectURL(url)
}

// ── Export card ───────────────────────────────────────────────────────────────
interface ExportCardProps {
  icon:    string
  title:   string
  desc:    string
  color:   string
  fields:  string[]
  type:    string
  from:    string
  to:      string
}

function ExportCard({ icon, title, desc, color, fields, type, from, to }: ExportCardProps) {
  const [status, setStatus] = useState<'idle' | 'loading' | 'done' | 'empty'>('idle')

  async function handleExport() {
    setStatus('loading')
    try {
      const params = new URLSearchParams({ type })
      if (from) params.set('from', from)
      if (to)   params.set('to',   to)
      const res  = await fetch(`/api/reports?${params}`)
      const data = await res.json() as Record<string, unknown>[]
      if (!Array.isArray(data) || !data.length) { setStatus('empty'); return }

      // Flatten orders items into separate rows
      let rows: Record<string, unknown>[] = data
      if (type === 'orders') {
        rows = data.flatMap(order => {
          const { retail_order_items, ...orderBase } = order as Record<string, unknown>
          const items = Array.isArray(retail_order_items) ? retail_order_items : []
          if (!items.length) return [orderBase]
          return items.map((item: Record<string, unknown>) => ({ ...orderBase, ...item }))
        })
      }

      const date = new Date().toISOString().slice(0, 10)
      downloadCSV(toCSV(rows), `cowboy_${type}_${date}.csv`)
      setStatus('done')
      setTimeout(() => setStatus('idle'), 3000)
    } catch {
      setStatus('idle')
    }
  }

  const label = status === 'loading' ? 'Exporting…'
              : status === 'done'    ? 'Downloaded!'
              : status === 'empty'   ? 'No data'
              : 'Download CSV'

  return (
    <div style={{
      background: C.dark, border: '1px solid rgba(166,120,90,0.18)',
      borderLeft: `4px solid ${color}`, borderRadius: 4, padding: '1.25rem',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', marginBottom: '0.5rem' }}>
        <span style={{ fontSize: '1.3rem' }}>{icon}</span>
        <span style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
          {title}
        </span>
      </div>
      <p style={{ fontSize: '0.78rem', color: C.tan, marginBottom: '0.75rem', lineHeight: 1.5 }}>{desc}</p>
      <div style={{ fontSize: '0.7rem', color: C.lightBrown, marginBottom: '1rem', lineHeight: 1.8 }}>
        <strong style={{ color: C.tan }}>Columns:</strong><br />
        {fields.join(', ')}
      </div>
      <button
        style={BTN(status === 'done' ? '#4CAF50' : status === 'empty' ? '#E8883A' : color)}
        onClick={handleExport}
        disabled={status === 'loading'}
      >
        {label}
      </button>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function ReportsPage() {
  const today    = isoDate()
  const firstOfMonth = today.slice(0, 8) + '01'

  const [from, setFrom] = useState(firstOfMonth)
  const [to,   setTo]   = useState(today)

  const exports = [
    {
      type:  'harvest',
      icon:  '🐄',
      title: 'Harvest Log',
      color: '#E8883A',
      desc:  'One row per carcass. Live weights, hot carcass weights, yield %, CCP pass/fail.',
      fields: ['harvest_date', 'species', 'carcass_tag', 'sex', 'breed', 'live_weight_lbs', 'hot_carcass_weight_lbs', 'yield_pct', 'ccp_pass', 'performed_by', 'producer'],
    },
    {
      type:  'processing',
      icon:  '🔪',
      title: 'Processing Records',
      color: '#4CAF50',
      desc:  'Every box scanned and labeled on the cut floor.',
      fields: ['processed_at', 'product', 'weight_lbs', 'box_id', 'customer', 'employee'],
    },
    {
      type:  'orders',
      icon:  '🛒',
      title: 'Retail Orders',
      color: '#06B6D4',
      desc:  'One row per order line item — customer name, product, qty ordered vs filled.',
      fields: ['order_date', 'due_date', 'customer_name', 'status', 'item_name', 'unit', 'qty_ordered', 'qty_filled', 'plu_number'],
    },
    {
      type:  'receiving',
      icon:  '📦',
      title: 'Receiving Log',
      color: '#60A5FA',
      desc:  'Animals received and box product received — combined with a record_type column.',
      fields: ['received_at', 'record_type', 'vendor/ear_tag', 'product/breed', 'quantity/weight_lbs', 'invoice_no', 'received_by'],
    },
    {
      type:  'appointments',
      icon:  '📅',
      title: 'Harvest Schedule',
      color: '#A78BFA',
      desc:  'All scheduled harvest appointments with head counts and status.',
      fields: ['harvest_date', 'species', 'head_count', 'source', 'status'],
    },
  ]

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>

      {/* Header */}
      <header style={{
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: '72px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
          <div>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              Reports &amp; Exports
            </h1>
            <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>
              Power BI · Excel · CSV
            </p>
          </div>
        </div>
      </header>

      <main style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Date range */}
        <div style={{
          background: C.dark, border: '1px solid rgba(166,120,90,0.18)',
          borderRadius: 4, padding: '1.25rem', marginBottom: '1.5rem',
          display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
        }}>
          <span style={{ color: C.tan, fontSize: '0.85rem', fontWeight: 600 }}>Date Range</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...INPUT, width: 160 }} />
            <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>to</span>
            <input type="date" value={to}   onChange={e => setTo(e.target.value)}   style={{ ...INPUT, width: 160 }} />
          </div>
          <span style={{ fontSize: '0.75rem', color: C.lightBrown, marginLeft: 'auto' }}>
            All exports use this range · save CSVs to OneDrive for Power BI auto-refresh
          </span>
        </div>

        {/* Export cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '1rem' }}>
          {exports.map(e => (
            <ExportCard key={e.type} {...e} from={from} to={to} />
          ))}
        </div>

        {/* Power BI setup note */}
        <div style={{
          marginTop: '1.5rem', background: C.dark,
          border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '1.25rem',
        }}>
          <p style={{ fontSize: '0.8rem', fontWeight: 700, color: C.tan, marginBottom: '0.5rem', textTransform: 'uppercase', letterSpacing: '0.1em' }}>
            Power BI Desktop Setup
          </p>
          <ol style={{ fontSize: '0.8rem', color: C.lightBrown, lineHeight: 2, paddingLeft: '1.25rem', margin: 0 }}>
            <li>Download the CSVs you need and save them to a OneDrive folder</li>
            <li>Power BI Desktop → <strong style={{ color: C.tan }}>Get Data → Text/CSV</strong> → select each file</li>
            <li>Build your line chart: X = date, Lines = revenue / direct cost / overhead</li>
            <li>When you export fresh data, click <strong style={{ color: C.tan }}>Refresh</strong> in Power BI to pull it in</li>
          </ol>
        </div>

      </main>
    </div>
  )
}
