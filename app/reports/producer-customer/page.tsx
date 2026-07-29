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
  kill_order:             number | null
  carcass_tag:            string | null
  ear_tag:                string | null
  sex:                    string | null
  breed:                  string | null
  kill_type:              string | null
  half_1_weight_lbs:      number | null
  half_2_weight_lbs:      number | null
  hanging_weight_lbs:     number | null
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

// Carcass tags are mostly numeric with the odd letter suffix ("27B"); sort on
// the leading number so 9 comes before 10. Untagged sorts last.
function tagNum(t: string | null): number {
  const m = (t ?? '').match(/\d+/)
  return m ? parseInt(m[0], 10) : 1e9
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

// A producer's block: their animals (from the date range) with worksheet
// identifiers, and the cut customer each ties to.
interface Group {
  producer: string
  rows:     Tie[]
  animals:  number
  weight:   number
  customers: string[]
  anyDiffers: boolean
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
      if (q) {
        const hay = `${r.producer ?? ''} ${r.customer_name ?? ''} ${r.carcass_tag ?? ''} ${r.ear_tag ?? ''}`.toLowerCase()
        if (!hay.includes(q)) return false
      }
      return true
    })
  }, [rows, species, search, diffOnly, untiedOnly])

  // Group by producer. Within a producer, animals sort by tag # (carcass tags
  // repeat across harvest days, so date stays the outer key to keep days coherent).
  const groups: Group[] = useMemo(() => {
    const byProducer = new Map<string, Tie[]>()
    for (const r of filtered) {
      const key = r.producer || '— no producer —'
      const bucket = byProducer.get(key)
      if (bucket) bucket.push(r); else byProducer.set(key, [r])
    }
    const out: Group[] = []
    for (const [producer, ties] of byProducer) {
      ties.sort((a, b) =>
        a.harvest_date.localeCompare(b.harvest_date) ||
        tagNum(a.carcass_tag) - tagNum(b.carcass_tag) ||
        (a.carcass_tag ?? '').localeCompare(b.carcass_tag ?? ''),
      )
      const animalIds = new Set(ties.map(t => t.harvest_log_id))
      // Sum each distinct animal's hanging weight once (splits repeat the row).
      const seen = new Set<string>()
      let weight = 0
      for (const t of ties) {
        if (t.hanging_weight_lbs != null && !seen.has(t.harvest_log_id)) {
          weight += Number(t.hanging_weight_lbs); seen.add(t.harvest_log_id)
        }
      }
      out.push({
        producer,
        rows: ties,
        animals: animalIds.size,
        weight,
        customers: [...new Set(ties.map(t => t.customer_name).filter(Boolean) as string[])].sort(),
        anyDiffers: ties.some(t => t.producer_differs),
      })
    }
    // Producer blocks read in tag order too — each block sits where its first
    // (earliest date, lowest tag) animal falls, so the page runs 01, 02, 03…
    // like the worksheet rather than A–Z.
    out.sort((a, b) => {
      const ra = a.rows[0], rb = b.rows[0]
      return ra.harvest_date.localeCompare(rb.harvest_date) ||
        tagNum(ra.carcass_tag) - tagNum(rb.carcass_tag) ||
        (ra.carcass_tag ?? '').localeCompare(rb.carcass_tag ?? '')
    })
    return out
  }, [filtered])

  const stats = useMemo(() => {
    const producers = groups.length
    const animals = new Set(filtered.map(r => r.harvest_log_id))
    const untied  = new Set(filtered.filter(r => !r.customer_name).map(r => r.harvest_log_id))
    return {
      producers,
      animals: animals.size,
      ties:    filtered.filter(r => r.customer_name).length,
      untied:  untied.size,
    }
  }, [groups, filtered])

  function exportCSV() {
    const out = filtered
      .slice()
      .sort((a, b) =>
        a.harvest_date.localeCompare(b.harvest_date) ||
        tagNum(a.carcass_tag) - tagNum(b.carcass_tag) ||
        (a.producer ?? '').localeCompare(b.producer ?? ''))
      .map(r => ({
        producer: r.producer ?? '', harvest_date: r.harvest_date, species: r.species ?? '',
        kill_order: r.kill_order ?? '', carcass_tag: r.carcass_tag ?? '', ear_tag: r.ear_tag ?? '',
        hanging_weight_lbs: r.hanging_weight_lbs ?? '', customer: r.customer_name ?? '',
        portion: r.portion ?? '', pays: r.payment_responsibility ?? '',
        assigned: r.assigned ? 'yes' : 'booked', cut_sheet: r.has_cut_sheet ? 'yes' : 'no',
      }))
    download(toCSV(out), `producer-customer_${from}_to_${to}.csv`)
  }

  const HEAD = ['Kill #', 'Tag #', 'Ear Tag', 'Species', 'Hang Wt', 'Customer', 'Portion', 'Pays', 'Cut', 'Status']

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
            Harvest worksheet, grouped by producer, with each animal&apos;s customer
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
        </div>

        {/* Summary */}
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', marginBottom: '1.25rem' }}>
          <Stat n={stats.producers} label="Producers" color={C.cream} />
          <Stat n={stats.animals}   label="Animals" color={C.tan} />
          <Stat n={stats.ties}      label="Customer ties" color={C.green} />
          <Stat n={stats.untied}    label="Not tied yet" color={C.blue} />
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>Loading…</div>
        ) : err ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: C.amber }}>{err}</div>
        ) : !groups.length ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>No rows for these filters.</div>
        ) : groups.map(g => (
          <div key={g.producer} style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, marginBottom: '1rem', overflow: 'hidden' }}>
            {/* Producer header */}
            <div style={{
              padding: '0.7rem 1rem', background: g.anyDiffers ? 'rgba(232,136,58,0.1)' : 'rgba(166,120,90,0.12)',
              borderBottom: '1px solid rgba(166,120,90,0.18)',
            }}>
              <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.98rem', fontFamily: 'Georgia, serif' }}>{g.producer}</span>
                <span style={{ color: C.lightBrown, fontSize: '0.78rem' }}>
                  {g.animals} {g.animals === 1 ? 'animal' : 'animals'} · {g.weight.toLocaleString()} lb hanging
                </span>
              </div>
              <div style={{ color: C.tan, fontSize: '0.76rem', marginTop: '0.2rem' }}>
                {g.customers.length
                  ? <>Customers: <span style={{ color: C.cream }}>{g.customers.join(', ')}</span></>
                  : <span style={{ color: C.medBrown }}>No customers tied yet</span>}
              </div>
            </div>
            {/* Animal rows */}
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', minWidth: 820 }}>
                <thead>
                  <tr>
                    {HEAD.map(h => (
                      <th key={h} style={{ textAlign: 'left', padding: '0.4rem 0.8rem', color: C.lightBrown, fontWeight: 700, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {g.rows.map((r, i) => (
                    <tr key={`${r.harvest_log_id}-${i}`} style={{ borderTop: '1px solid rgba(166,120,90,0.08)' }}>
                      <td style={{ padding: '0.45rem 0.8rem', color: C.cream, fontWeight: 700, fontFamily: 'monospace' }}>{r.kill_order ?? '—'}</td>
                      <td style={{ padding: '0.45rem 0.8rem', color: C.tan, fontFamily: 'monospace' }}>{r.carcass_tag || '—'}</td>
                      <td style={{ padding: '0.45rem 0.8rem', color: C.lightBrown, whiteSpace: 'nowrap' }}>{r.ear_tag || '—'}</td>
                      <td style={{ padding: '0.45rem 0.8rem', color: C.lightBrown }}>{r.species}</td>
                      <td style={{ padding: '0.45rem 0.8rem', color: C.lightBrown, whiteSpace: 'nowrap' }}>{r.hanging_weight_lbs != null ? `${r.hanging_weight_lbs} lb` : '—'}</td>
                      <td style={{ padding: '0.45rem 0.8rem', fontWeight: 600, color: r.customer_name ? C.cream : C.medBrown }}>{r.customer_name || '— not tied —'}</td>
                      <td style={{ padding: '0.45rem 0.8rem', color: C.lightBrown }}>{r.portion || '—'}</td>
                      <td style={{ padding: '0.45rem 0.8rem', color: C.lightBrown, textTransform: 'capitalize' }}>{r.payment_responsibility || '—'}</td>
                      <td style={{ padding: '0.45rem 0.8rem', textAlign: 'center', color: C.green }}>{r.has_cut_sheet ? '✓' : ''}</td>
                      <td style={{ padding: '0.45rem 0.8rem', whiteSpace: 'nowrap' }}>
                        <span style={{
                          fontSize: '0.64rem', fontWeight: 700, padding: '0.12rem 0.45rem', borderRadius: 999,
                          color: r.assigned ? C.green : C.blue, border: `1px solid ${r.assigned ? C.green : C.blue}`,
                        }}>{r.assigned ? 'ASSIGNED' : 'BOOKED'}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))}

        <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.5rem', lineHeight: 1.6 }}>
          The harvest worksheet grouped by producer, with the cut customer on each animal.
          <strong style={{ color: C.tan }}> Customer</strong> is the physical carcass assignment once one is made
          (<span style={{ color: C.green }}>ASSIGNED</span>), otherwise the customer booked on the appointment
          (<span style={{ color: C.blue }}>BOOKED</span>). A split animal lists once per share. Producer blocks
          shaded amber are drop-offs where a business brings the animal and an individual receives it.
        </p>
      </main>
    </div>
  )
}
