'use client'
// Which QuickBooks customer this booking bills — picked when the booking is
// made, so the invoice can be found by who it's written to rather than by how
// a name happens to be spelled (Charlie, 2026-09-14).
//
// A link somebody already confirmed fills itself in and says so. Otherwise the
// closest QuickBooks names are offered as one-tap chips, with a search for
// anything else. Nothing is picked without a person picking it.

import { useEffect, useRef, useState } from 'react'

export interface QboPick { id: string; name: string }

interface Hit { qbo_id: string; display_name: string; sim?: number; company_name?: string | null }

export default function QboPicker({ label, scope, name, value, onChange }: {
  label: string
  scope: 'producer' | 'customer'
  /** The name on the booking to suggest for. */
  name: string
  value: QboPick | null
  onChange: (v: QboPick | null, how: 'saved link' | 'picked' | 'cleared') => void
}) {
  const [candidates, setCandidates] = useState<Hit[]>([])
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState<Hit[]>([])
  const [autoNote, setAutoNote] = useState('')
  const lastName = useRef('')
  // The form hands a fresh onChange every render; reading it through a ref keeps
  // the half-second settle below from restarting on each one.
  const onChangeRef = useRef(onChange)
  useEffect(() => { onChangeRef.current = onChange })

  // Suggest for the booking's name once typing settles.
  useEffect(() => {
    const n = name.trim()
    if (value || n.length < 2 || n === lastName.current) return
    const t = setTimeout(() => {
      lastName.current = n
      fetch(`/api/qbo/customers/suggest?scope=${scope}&name=${encodeURIComponent(n)}`).then(r => r.json())
        .then((d: { linked: Hit | null; candidates: Hit[] }) => {
          if (d.linked) { onChangeRef.current({ id: d.linked.qbo_id, name: d.linked.display_name }, 'saved link'); setAutoNote('from a saved link') }
          setCandidates(d.candidates ?? [])
        }).catch(() => {})
    }, 500)
    return () => clearTimeout(t)
  }, [name, scope, value])

  useEffect(() => {
    if (!searching || q.trim().length < 2) return
    const t = setTimeout(() => {
      fetch(`/api/qbo/customers?search=${encodeURIComponent(q.trim())}`).then(r => r.json())
        .then((d: { results?: Hit[] }) => setResults(d.results ?? [])).catch(() => {})
    }, 300)
    return () => clearTimeout(t)
  }, [q, searching])

  const pick = (h: Hit) => { onChange({ id: h.qbo_id, name: h.display_name }, 'picked'); setAutoNote(''); setSearching(false); setQ('') }

  const chip: React.CSSProperties = { background: 'rgba(201,168,130,0.12)', border: '1px solid rgba(201,168,130,0.4)', color: 'var(--cream)', borderRadius: 99, padding: '0.15rem 0.6rem', fontSize: '0.74rem', cursor: 'pointer' }

  return (
    <div style={{ marginTop: '0.5rem' }}>
      <div style={{ color: 'var(--light-brown)', fontSize: '0.68rem', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: '0.25rem' }}>{label}</div>
      {value ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.45rem', flexWrap: 'wrap' }}>
          <span style={{ color: '#86EFAC', fontSize: '0.85rem', fontWeight: 600 }}>💵 {value.name}</span>
          {autoNote && <span style={{ color: 'var(--light-brown)', fontSize: '0.7rem' }}>{autoNote}</span>}
          <button type="button" onClick={() => { onChange(null, 'cleared'); setAutoNote(''); lastName.current = '' }}
            style={{ background: 'none', border: 'none', color: 'var(--tan)', fontSize: '0.74rem', cursor: 'pointer', textDecoration: 'underline' }}>change</button>
        </div>
      ) : (
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
          {candidates.slice(0, 3).map(c => (
            <button key={c.qbo_id} type="button" onClick={() => pick(c)} style={chip} title={`Close match to "${name}"`}>{c.display_name}?</button>
          ))}
          {!searching
            ? <button type="button" onClick={() => setSearching(true)} style={{ background: 'none', border: 'none', color: 'var(--tan)', fontSize: '0.74rem', cursor: 'pointer', textDecoration: 'underline' }}>
                {candidates.length ? 'someone else…' : 'find in QuickBooks…'}
              </button>
            : <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Search QuickBooks customers"
                style={{ flex: 1, minWidth: 180, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.4)', borderRadius: 3, color: 'var(--cream)', fontSize: '0.8rem', padding: '0.3rem 0.5rem' }} />}
          {!candidates.length && !searching && name.trim().length >= 2 && <span style={{ color: 'var(--light-brown)', fontSize: '0.7rem' }}>not set</span>}
        </div>
      )}
      {searching && q.trim().length >= 2 && results.length > 0 && (
        <div style={{ marginTop: '0.3rem', border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, maxHeight: 180, overflowY: 'auto', background: 'var(--dark)' }}>
          {results.map(r => (
            <button key={r.qbo_id} type="button" onClick={() => pick(r)}
              style={{ display: 'block', width: '100%', textAlign: 'left', background: 'transparent', border: 'none', borderBottom: '1px solid rgba(166,120,90,0.12)', color: 'var(--cream)', fontSize: '0.8rem', padding: '0.35rem 0.55rem', cursor: 'pointer' }}>
              {r.display_name}{r.company_name ? <span style={{ color: 'var(--light-brown)' }}> · {r.company_name}</span> : null}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
