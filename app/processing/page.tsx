'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'

type Tab = 'plu' | 'upload'

interface PluItem {
  id:          string
  plu_number:  string
  item_name:   string
  price:       number | null
  tare_weight: number | null
  department:  string
  unit:        string
  updated_at:  string
  raw_data:    Record<string, string>
}

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
}

const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.5rem 0.75rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.72rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem',
}
const BTN = (bg: string, color = C.dark): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 3,
  padding: '0.55rem 1.2rem', fontSize: '0.85rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})

// ══════════════════════════════════════════════════════════════════════════════
// PLU BROWSER TAB
// ══════════════════════════════════════════════════════════════════════════════
function PluTab() {
  const [items, setItems]       = useState<PluItem[]>([])
  const [search, setSearch]     = useState('')
  const [selected, setSelected] = useState<PluItem | null>(null)
  const [loading, setLoading]   = useState(true)

  const load = useCallback(async (q = '') => {
    setLoading(true)
    const res = await fetch(`/api/processing${q ? `?search=${encodeURIComponent(q)}` : ''}`)
    setItems(await res.json())
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const t = setTimeout(() => load(search), 250)
    return () => clearTimeout(t)
  }, [search, load])

  const fmt = (n: number | null, prefix = '') => n != null ? `${prefix}${n.toFixed(2)}` : '—'

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '380px 1fr', gap: '1.5rem', height: '100%' }}>
      {/* Left — list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid rgba(166,120,90,0.2)' }}>
          <input
            style={INPUT}
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search PLU # or name…"
          />
        </div>
        <div style={{ padding: '0.5rem 1rem', borderBottom: '1px solid rgba(166,120,90,0.15)', fontSize: '0.72rem', color: C.lightBrown }}>
          {loading ? 'Loading…' : `${items.length} items`}
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {!loading && items.length === 0 && (
            <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown, fontSize: '0.85rem' }}>
              {search ? 'No matches found' : 'No PLU items yet — upload a file to get started'}
            </div>
          )}
          {items.map(item => (
            <div
              key={item.id}
              onClick={() => setSelected(item)}
              style={{
                padding: '0.75rem 1rem', borderBottom: '1px solid rgba(166,120,90,0.1)',
                cursor: 'pointer', background: selected?.id === item.id ? 'rgba(166,120,90,0.12)' : 'transparent',
                transition: 'background 0.15s', display: 'flex', justifyContent: 'space-between', alignItems: 'center',
              }}
            >
              <div>
                <div style={{ color: C.cream, fontSize: '0.88rem', fontWeight: 600 }}>{item.item_name || '—'}</div>
                <div style={{ color: C.lightBrown, fontSize: '0.75rem', fontFamily: 'monospace', marginTop: '0.1rem' }}>
                  PLU {item.plu_number}
                  {item.department ? ` · ${item.department}` : ''}
                </div>
              </div>
              <div style={{ textAlign: 'right', flexShrink: 0, marginLeft: '0.75rem' }}>
                {item.price != null && (
                  <div style={{ color: C.tan, fontSize: '0.88rem', fontWeight: 600 }}>${item.price.toFixed(2)}</div>
                )}
                {item.unit && <div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>/{item.unit}</div>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Right — detail */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', overflowY: 'auto' }}>
        {!selected ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '60%', color: C.lightBrown, fontSize: '0.9rem' }}>
            ← Select an item to view details
          </div>
        ) : (
          <>
            <h2 style={{ fontFamily: 'Georgia, serif', color: C.cream, fontSize: '1.2rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', margin: '0 0 0.35rem' }}>
              {selected.item_name || 'Unnamed Item'}
            </h2>
            <div style={{ fontSize: '0.8rem', color: C.lightBrown, marginBottom: '1.5rem' }}>
              Last updated {new Date(selected.updated_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
            </div>

            {/* Key fields */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: '1rem', marginBottom: '1.5rem' }}>
              {[
                ['PLU #',       selected.plu_number],
                ['Price',       selected.price != null ? `$${selected.price.toFixed(2)}` : '—'],
                ['Unit',        selected.unit || '—'],
                ['Tare Weight', selected.tare_weight != null ? `${selected.tare_weight} lbs` : '—'],
                ['Department',  selected.department || '—'],
              ].map(([label, val]) => (
                <div key={label} style={{ background: 'rgba(255,255,255,0.04)', borderRadius: 4, padding: '0.75rem 1rem' }}>
                  <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem' }}>{label}</div>
                  <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.95rem' }}>{val}</div>
                </div>
              ))}
            </div>

            {/* Raw data — all fields from the Hobart file */}
            {Object.keys(selected.raw_data ?? {}).length > 0 && (
              <>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
                  All Fields from Hobart
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.4rem' }}>
                  {Object.entries(selected.raw_data).map(([k, v]) => (
                    <div key={k} style={{ display: 'flex', justifyContent: 'space-between', padding: '0.4rem 0.75rem', background: 'rgba(255,255,255,0.03)', borderRadius: 3, fontSize: '0.8rem' }}>
                      <span style={{ color: C.lightBrown }}>{k}</span>
                      <span style={{ color: C.tan, fontFamily: 'monospace' }}>{v}</span>
                    </div>
                  ))}
                </div>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// CSV UPLOAD TAB
// ══════════════════════════════════════════════════════════════════════════════
function UploadTab() {
  const fileRef = useRef<HTMLInputElement>(null)
  const [preview, setPreview]     = useState<Record<string, string>[]>([])
  const [headers, setHeaders]     = useState<string[]>([])
  const [fileName, setFileName]   = useState('')
  const [uploading, setUploading] = useState(false)
  const [result, setResult]       = useState<{ ok: boolean; count?: number; error?: string } | null>(null)

  // Column mapping state — user picks which CSV column maps to which field
  const [mapping, setMapping] = useState({
    plu_number:  '',
    item_name:   '',
    price:       '',
    tare_weight: '',
    department:  '',
    unit:        '',
  })

  function parseCSV(text: string): { headers: string[]; rows: Record<string, string>[] } {
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) return { headers: [], rows: [] }
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''))
    const rows = lines.slice(1).map(line => {
      const vals = line.split(',').map(v => v.trim().replace(/^"|"$/g, ''))
      return Object.fromEntries(headers.map((h, i) => [h, vals[i] ?? '']))
    })
    return { headers, rows }
  }

  function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setFileName(file.name)
    setResult(null)
    const reader = new FileReader()
    reader.onload = ev => {
      const { headers, rows } = parseCSV(ev.target?.result as string)
      setHeaders(headers)
      setPreview(rows.slice(0, 5))
      // Auto-map common column names
      const autoMap = { ...mapping }
      const lower = (s: string) => s.toLowerCase()
      headers.forEach(h => {
        const l = lower(h)
        if (!autoMap.plu_number  && (l.includes('plu') || l.includes('number') || l === 'no')) autoMap.plu_number = h
        if (!autoMap.item_name   && (l.includes('name') || l.includes('desc')))                autoMap.item_name = h
        if (!autoMap.price       && (l.includes('price') || l.includes('cost')))               autoMap.price = h
        if (!autoMap.tare_weight && (l.includes('tare') || l.includes('weight')))              autoMap.tare_weight = h
        if (!autoMap.department  && (l.includes('dept') || l.includes('department')))          autoMap.department = h
        if (!autoMap.unit        && (l.includes('unit') || l.includes('uom')))                 autoMap.unit = h
      })
      setMapping(autoMap)
    }
    reader.readAsText(file)
  }

  async function handleUpload() {
    if (!preview.length || !mapping.plu_number) return
    setUploading(true)
    setResult(null)

    // Re-read full file
    const file = fileRef.current?.files?.[0]
    if (!file) return
    const text = await file.text()
    const { rows } = parseCSV(text)

    const items = rows
      .filter(r => r[mapping.plu_number]?.trim())
      .map(r => ({
        plu_number:  r[mapping.plu_number]?.trim() ?? '',
        item_name:   mapping.item_name   ? (r[mapping.item_name]   ?? '') : '',
        price:       mapping.price       ? (parseFloat(r[mapping.price])   || null) : null,
        tare_weight: mapping.tare_weight ? (parseFloat(r[mapping.tare_weight]) || null) : null,
        department:  mapping.department  ? (r[mapping.department]  ?? '') : '',
        unit:        mapping.unit        ? (r[mapping.unit]        ?? '') : '',
        raw_data:    r,
      }))

    const res = await fetch('/api/processing', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ items }),
    })
    const json = await res.json()
    setResult(json.ok ? { ok: true, count: json.count } : { ok: false, error: json.error })
    setUploading(false)
  }

  const colOpts = ['', ...headers]

  return (
    <div style={{ maxWidth: 800, margin: '0 auto' }}>
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.5rem', marginBottom: '1.5rem' }}>
        <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 1rem' }}>
          Upload PLU File
        </h3>

        {/* Drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          style={{
            border: '2px dashed rgba(166,120,90,0.4)', borderRadius: 4, padding: '2rem',
            textAlign: 'center', cursor: 'pointer', marginBottom: '1.25rem',
            background: 'rgba(255,255,255,0.02)', transition: 'border-color 0.15s',
          }}
        >
          <div style={{ fontSize: '2rem', marginBottom: '0.5rem' }}>📂</div>
          <div style={{ color: C.tan, fontSize: '0.9rem', marginBottom: '0.25rem' }}>
            {fileName || 'Click to select a CSV file'}
          </div>
          <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>Export from Hobart as CSV, then upload here</div>
          <input ref={fileRef} type="file" accept=".csv,.txt" onChange={handleFile} style={{ display: 'none' }} />
        </div>

        {/* Column mapping */}
        {headers.length > 0 && (
          <>
            <div style={{ fontSize: '0.75rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>
              Map Columns — tell us which column is which
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem 1rem', marginBottom: '1.25rem' }}>
              {(Object.keys(mapping) as (keyof typeof mapping)[]).map(field => (
                <div key={field}>
                  <label style={LABEL}>
                    {field.replace(/_/g, ' ')}
                    {field === 'plu_number' ? ' *' : ''}
                  </label>
                  <select
                    style={{ ...INPUT }}
                    value={mapping[field]}
                    onChange={e => setMapping(p => ({ ...p, [field]: e.target.value }))}
                  >
                    {colOpts.map(o => <option key={o} value={o}>{o || '— not mapped —'}</option>)}
                  </select>
                </div>
              ))}
            </div>

            {/* Preview */}
            <div style={{ fontSize: '0.75rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.5rem' }}>
              Preview (first 5 rows)
            </div>
            <div style={{ overflowX: 'auto', marginBottom: '1.25rem' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    {headers.map(h => (
                      <th key={h} style={{ padding: '0.4rem 0.75rem', borderBottom: '1px solid rgba(166,120,90,0.3)', color: C.tan, textAlign: 'left', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.map((row, i) => (
                    <tr key={i} style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)' }}>
                      {headers.map(h => (
                        <td key={h} style={{ padding: '0.4rem 0.75rem', color: C.cream, borderBottom: '1px solid rgba(166,120,90,0.08)', whiteSpace: 'nowrap' }}>{row[h]}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {result && (
              <div style={{
                background: result.ok ? 'rgba(76,175,80,0.15)' : 'rgba(229,62,62,0.15)',
                border: `1px solid ${result.ok ? 'rgba(76,175,80,0.4)' : 'rgba(229,62,62,0.4)'}`,
                borderRadius: 4, padding: '0.75rem 1rem', marginBottom: '1rem',
                color: result.ok ? C.green : C.red, fontSize: '0.85rem',
              }}>
                {result.ok ? `✓ ${result.count} PLU items saved / updated` : `Error: ${result.error}`}
              </div>
            )}

            <button
              style={{ ...BTN(mapping.plu_number ? C.tan : C.medBrown), opacity: mapping.plu_number ? 1 : 0.55 }}
              onClick={handleUpload}
              disabled={uploading || !mapping.plu_number}
            >
              {uploading ? 'Uploading…' : 'Upload to Supabase'}
            </button>
          </>
        )}
      </div>

      {/* Instructions */}
      <div style={{ background: 'rgba(26,10,4,0.6)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 4, padding: '1.25rem 1.5rem', fontSize: '0.82rem', color: C.lightBrown, lineHeight: 1.7 }}>
        <strong style={{ color: C.tan, display: 'block', marginBottom: '0.5rem' }}>How to export from Hobart:</strong>
        <ol style={{ margin: 0, paddingLeft: '1.25rem' }}>
          <li>Open the Hobart Scale Manager software</li>
          <li>Go to PLU / Items list</li>
          <li>Export or Save As → CSV format</li>
          <li>Upload that file here</li>
        </ol>
        <div style={{ marginTop: '0.75rem', color: C.lightBrown, fontSize: '0.78rem' }}>
          Uploading the same PLU number twice will update the existing record, not create a duplicate.
        </div>
      </div>
    </div>
  )
}

// ══════════════════════════════════════════════════════════════════════════════
// PAGE
// ══════════════════════════════════════════════════════════════════════════════
export default function ProcessingPage() {
  const [tab, setTab] = useState<Tab>('plu')

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
            Processing
          </h1>
        </div>

        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
          {(['plu', 'upload'] as Tab[]).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                padding: '0.45rem 1.25rem', border: 'none', cursor: 'pointer', fontSize: '0.83rem', fontWeight: 600,
                background: tab === t ? C.medBrown : 'transparent',
                color: tab === t ? C.cream : C.lightBrown,
                letterSpacing: '0.05em', textTransform: 'uppercase',
                transition: 'background 0.15s',
              }}
            >
              {t === 'plu' ? '🔪 PLU Browser' : '📂 Upload File'}
            </button>
          ))}
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1300px', width: '100%', margin: '0 auto', boxSizing: 'border-box', display: 'flex', flexDirection: 'column' }}>
        {tab === 'plu' ? <PluTab /> : <UploadTab />}
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660
      </footer>
    </div>
  )
}
