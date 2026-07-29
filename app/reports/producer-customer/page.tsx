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

interface Tie {
  harvest_date:           string
  species:                string | null
  carcass_tag:            string | null
  kill_type:              string | null
  hcw_lbs:                number | null
  producer:               string | null
  producer_id:            string | null
  customer_name:          string | null
  customer_id:            string | null
  portion:                string | null
  assigned:               boolean
  has_cut_sheet:          boolean
  payment_responsibility: string | null
  producer_differs:       boolean
  harvest_log_id:         string
}

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

function Pill({ label, on, onClick, color = C.tan }: { label: string; on: boolean; onClick: () => void; color?: string }) {
  return (
    <button onClick={onClick} style={{
      background: on ? color : 'transparent', color: on ? C.dark : color,
      border: `1px solid ${color}`, borderRadius: 999, padding: '0.35rem 0.8rem',
      fontSize: '0.76rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
    }}>{label}</button>
  )
}

function Stat({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '0.7rem 1rem', minWidth: 110 }}>
      <div style={{ color, fontSize: '1.35rem', fontWeight: 800, fontFamily: 'Georgia, serif' }}>{n}</div>
      <div style={{ color: C.lightBrown, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</div>
    </div>
  )
}

export default function ProducerCustomerReport() {
  const today = isoDate()
  // Default to a wide window — this is a "who's tied to what" audit, not a daily.
  const yearStart = today.slice(0, 4) + '-01-01'

  const [from, setFrom] = useState(yearStart)
  const [to,   setTo]   = useState(today)
  const [rows, setRows] = useState<Tie[]>([])
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const [species,   setSpecies]   = useState('')
  const [search,    setSearch]    = useState('')
  const [diffOnly,  setDiffOnly]  = useState(false)
  const [untiedOnly, setUntiedOnly] = useState(false)
  const [assignedOnly, setAssignedOnly] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr('')
    const p = new URLSearchParams({ type: 'producer_customer', from, to })
    fetch(`/api/reports?${p}`)
      .then(r => r.json())
      .then(d => { if (!cancelled) setRows(Array.isArray(d) ? d : []) })
      .catch(() => { if (!cancelled) setErr('Could not load the report.') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [from, to])

  const speciesList = useMemo(
    () => [...new Set(rows.map(r => r.species).filter(Boolean))].sort() as string[],
    [rows],
  )

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    return rows.filter(r => {
      if (species && r.species !== species) return false
      if (diffOnly && !r.producer_differs) return false
      if (untiedOnly && r.customer_name) return false
      if (assignedOnly && !r.assigned) return false
      if (q) {
        const hay = `${r.producer ?? ''} ${r.customer_name ?? ''} ${r.carcass_tag ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, species, search, diffOnly, untiedOnly, assignedOnly])

  const stats = useMemo(() => {
    const animals = new Set(filtered.map(r => r.harvest_log_id))
    const untied  = new Set(filtered.filter(r => !r.customer_name).map(r => r.harvest_log_id))
    return {
      animals: animals.size,
      ties:    filtered.filter(r => r.customer_name).length,
      untied:  untied.size,
      differs: filtered.filter(r => r.producer_differs).length,
    }
  }, [filtered])

  function exportCSV() {
    const out = filtered.map(r => ({
      harvest_date: r.harvest_date, producer: r.producer ?? '', species: r.species ?? '',
      carcass_tag: r.carcass_tag ?? '', hcw_lbs: r.hcw_lbs ?? '', kill_type: r.kill_type ?? '',
      customer: r.customer_name ?? '', portion: r.portion ?? '',
      pays: r.payment_responsibility ?? '', assigned: r.assigned ? 'yes' : 'booked',
      cut_sheet: r.has_cut_sheet ? 'yes' : 'no', producer_differs: r.producer_differs ? 'yes' : 'no',
    }))
    download(toCSV(out), `producer-customer_${from}_to_${to}.csv`)
  }

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
            Producer &amp; Customer
          </h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>
            Which animals tie back to which customer
          </p>
        </div>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 1200, margin: '0 auto', boxSizing: 'border-box' }}>

        {/* Controls */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
          <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={{ ...INPUT, width: 150 }} />
          <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>to</span>
          <input type="date" value={to} onChange={e => setTo(e.target.value)} style={{ ...INPUT, width: 150 }} />
          <select value={species} onChange={e => setSpecies(e.target.value)} style={{ ...INPUT, width: 130 }}>
            <option value="">All species</option>
            {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          <input
            placeholder="Search producer, customer, tag…"
            value={search} onChange={e => setSearch(e.target.value)}
            style={{ ...INPUT, flex: 1, minWidth: 200 }}
          />
          <button onClick={exportCSV} disabled={!filtered.length} style={{
            background: filtered.length ? C.tan : C.medBrown, color: C.dark, border: 'none', borderRadius: 3,
            padding: '0.5rem 1.1rem', fontSize: '0.82rem', fontWeight: 700, cursor: filtered.length ? 'pointer' : 'default',
          }}>⬇ CSV</button>
        </div>

        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
          <Pill label="Producer ≠ customer" on={diffOnly} onClick={() => setDiffOnly(v => !v)} color={C.amber} />
          <Pill label="Not tied yet" on={untiedOnly} onClick={() => setUntiedOnly(v => !v)} color={C.blue} />
          <Pill label="Physically assigned" on={assignedOnly} onClick={() => setAssignedOnly(v => !v)} color={C.green} />
        </div>

        {/* Summary */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <Stat n={stats.animals} label="Animals" color={C.cream} />
          <Stat n={stats.ties}    label="Customer ties" color={C.green} />
          <Stat n={stats.untied}  label="Not tied yet" color={C.blue} />
          <Stat n={stats.differs} label="Producer ≠ cust." color={C.amber} />
        </div>

        {/* Table */}
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 860 }}>
              <thead>
                <tr style={{ background: 'rgba(166,120,90,0.12)' }}>
                  {['Date', 'Producer', 'Animal', 'HCW', 'Customer', 'Portion', 'Pays', 'Cut sheet', 'Status'].map(h => (
                    <th key={h} style={{ textAlign: 'left', padding: '0.6rem 0.8rem', color: C.tan, fontWeight: 700, whiteSpace: 'nowrap' }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>Loading…</td></tr>
                ) : err ? (
                  <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: C.amber }}>{err}</td></tr>
                ) : !filtered.length ? (
                  <tr><td colSpan={9} style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>No rows for these filters.</td></tr>
                ) : filtered.map((r, i) => (
                  <tr key={`${r.harvest_log_id}-${i}`} style={{
                    borderTop: '1px solid rgba(166,120,90,0.1)',
                    background: r.producer_differs ? 'rgba(232,136,58,0.05)' : 'transparent',
                  }}>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.lightBrown, whiteSpace: 'nowrap' }}>{r.harvest_date}</td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.cream, fontWeight: 600 }}>{r.producer || '—'}</td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.tan, whiteSpace: 'nowrap' }}>
                      {r.species} <span style={{ fontFamily: 'monospace', color: C.lightBrown }}>#{r.carcass_tag || '—'}</span>
                    </td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.lightBrown, whiteSpace: 'nowrap' }}>{r.hcw_lbs != null ? `${r.hcw_lbs} lb` : '—'}</td>
                    <td style={{ padding: '0.5rem 0.8rem', fontWeight: 600, color: r.customer_name ? C.cream : C.medBrown }}>
                      {r.customer_name || '— not tied —'}
                    </td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.lightBrown }}>{r.portion || '—'}</td>
                    <td style={{ padding: '0.5rem 0.8rem', color: C.lightBrown, textTransform: 'capitalize' }}>{r.payment_responsibility || '—'}</td>
                    <td style={{ padding: '0.5rem 0.8rem', textAlign: 'center' }}>{r.has_cut_sheet ? '✓' : ''}</td>
                    <td style={{ padding: '0.5rem 0.8rem', whiteSpace: 'nowrap' }}>
                      <span style={{
                        fontSize: '0.68rem', fontWeight: 700, padding: '0.15rem 0.5rem', borderRadius: 999,
                        color: r.assigned ? C.green : C.blue,
                        border: `1px solid ${r.assigned ? C.green : C.blue}`,
                      }}>{r.assigned ? 'ASSIGNED' : 'BOOKED'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.75rem', lineHeight: 1.6 }}>
          <strong style={{ color: C.tan }}>Customer</strong> is the physical carcass assignment when one has been made
          (<span style={{ color: C.green }}>ASSIGNED</span>), otherwise the customer booked on the appointment
          (<span style={{ color: C.blue }}>BOOKED</span>). A split animal appears once per share.
          Rows shaded amber are where the producer of record and the customer differ — a drop-off where a
          business brings the animal and an individual receives it.
        </p>
      </main>
    </div>
  )
}
