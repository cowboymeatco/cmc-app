'use client'
import { useEffect, useMemo, useState, useCallback } from 'react'
import { CureTag } from '@/lib/types'

// ══════════════════════════════════════════════════════════════════════════════
// IN CURE — numbered seals riding on hams/bacons through the cure cooler.
// One row per tagged piece: whose it is, what it is, and what their cut sheet
// says to do with it when it comes out (tag 0036013 → ham → cut in quarters).
//
// This is an operational board, not a report: the crew works off it on the
// floor, so it lives on /processing next to the cut schedule (Charlie, 2026-08-01)
// rather than on the value-add report where it was first built.
// ══════════════════════════════════════════════════════════════════════════════

const C = {
  dark:       '#1A0A04',
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

// "2026-07-30" → "Jul 30, 2026" (noon avoids the UTC-parse off-by-one)
const fmtDay = (iso: string) =>
  iso ? new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'

const dayDiff = (fromIso: string, toIso?: string | null) =>
  Math.max(0, Math.round((new Date(toIso ?? Date.now()).getTime() - new Date(fromIso).getTime()) / 86400000))

export default function CureTagsTab() {
  const [tags,    setTags]    = useState<CureTag[]>([])
  const [loading, setLoading] = useState(true)
  const [err,     setErr]     = useState('')

  const [statusFilter, setStatusFilter] = useState<'curing' | 'done' | 'all'>('curing')
  const [search,       setSearch]       = useState('')
  const [busyId,       setBusyId]       = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true); setErr('')
    try {
      const res  = await fetch('/api/cure-tags?instructions=1')
      const data = await res.json()
      setTags(Array.isArray(data) ? data : [])
    } catch { setErr('Could not load cure tags.') }
    finally { setLoading(false) }
  }, [])
  useEffect(() => { load() }, [load])

  const rows = useMemo(() => {
    const q = search.trim().toLowerCase()
    return tags.filter(t => {
      if (statusFilter !== 'all' && t.status !== statusFilter) return false
      if (q && !t.customer_name.toLowerCase().includes(q) && !t.tag_number.includes(q)) return false
      return true
    })
  }, [tags, statusFilter, search])

  const inCure = tags.filter(t => t.status === 'curing').length

  async function setStatus(tag: CureTag, status: 'curing' | 'done') {
    setBusyId(tag.id)
    try {
      const res = await fetch('/api/cure-tags', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: tag.id, status }),
      })
      const row: CureTag = await res.json()
      if (res.ok) setTags(prev => prev.map(t => t.id === tag.id ? { ...t, ...row } : t))
    } finally { setBusyId(null) }
  }

  async function removeTag(tag: CureTag) {
    if (!confirm(`Delete tag ${tag.tag_number} (${tag.product} · ${tag.customer_name})? Only for mis-scans — finished pieces should be marked done.`)) return
    setBusyId(tag.id)
    try {
      const res = await fetch(`/api/cure-tags?id=${tag.id}`, { method: 'DELETE' })
      if (res.ok) setTags(prev => prev.filter(t => t.id !== tag.id))
    } finally { setBusyId(null) }
  }

  const th: React.CSSProperties = { textAlign: 'left', padding: '0.6rem 0.7rem', color: C.tan, fontWeight: 700, whiteSpace: 'nowrap', fontSize: '0.76rem', textTransform: 'uppercase', letterSpacing: '0.06em' }
  const td: React.CSSProperties = { padding: '0.5rem 0.7rem', color: C.cream, whiteSpace: 'nowrap' }

  return (
    <>
      {/* Controls */}
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginBottom: '1rem' }}>
        <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as 'curing' | 'done' | 'all')} style={{ ...INPUT, width: 160 }}>
          <option value="curing">🧂 In cure ({inCure})</option>
          <option value="done">✓ Done</option>
          <option value="all">All tags</option>
        </select>
        <input
          placeholder="Search customer or tag #…"
          value={search} onChange={e => setSearch(e.target.value)}
          style={{ ...INPUT, flex: 1, minWidth: 180 }}
        />
      </div>

      {/* Tag list */}
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          {loading ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>Loading…</div>
          ) : err ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: C.amber }}>{err}</div>
          ) : !rows.length ? (
            <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>
              {statusFilter === 'curing' ? 'Nothing in cure. Tags scanned on the cut floor land here.' : 'No tags for these filters.'}
            </div>
          ) : (
            <table style={{ borderCollapse: 'collapse', fontSize: '0.85rem', minWidth: '100%' }}>
              <thead>
                <tr style={{ background: 'rgba(166,120,90,0.14)' }}>
                  <th style={th}>Tag</th>
                  <th style={th}>Customer</th>
                  <th style={th}>Product</th>
                  <th style={th}>Cut sheet says</th>
                  <th style={{ ...th, textAlign: 'right' }}>Weight</th>
                  <th style={th}>Tagged</th>
                  <th style={{ ...th, textAlign: 'center' }}>Days in cure</th>
                  <th style={th}>Status</th>
                  <th style={th} />
                </tr>
              </thead>
              <tbody>
                {rows.map(t => (
                  <tr key={t.id} style={{ borderTop: '1px solid rgba(166,120,90,0.1)', opacity: busyId === t.id ? 0.5 : 1 }}>
                    <td style={{ ...td, fontFamily: 'monospace', color: C.tan, fontWeight: 700 }}>🏷 {t.tag_number}</td>
                    <td style={{ ...td, fontWeight: 600 }}>{t.customer_name}</td>
                    <td style={td}>{t.product}</td>
                    <td style={{ ...td, color: t.instruction ? C.green : C.lightBrown, fontWeight: t.instruction ? 700 : 400 }}>
                      {t.instruction ?? 'no cut sheet found'}
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontFamily: 'monospace' }}>{t.weight_lbs != null ? `${Number(t.weight_lbs).toFixed(2)} lb` : '—'}</td>
                    <td style={{ ...td, color: C.lightBrown, fontFamily: 'monospace' }}>{fmtDay(t.session_date ?? t.created_at.slice(0, 10))}</td>
                    <td style={{ ...td, textAlign: 'center', fontWeight: 700, color: C.blue }}>{dayDiff(t.created_at, t.completed_at)}</td>
                    <td style={td}>
                      <span style={{
                        background: t.status === 'done' ? `${C.green}22` : `${C.amber}22`,
                        border: `1px solid ${t.status === 'done' ? C.green : C.amber}55`,
                        color: t.status === 'done' ? C.green : C.amber,
                        fontSize: '0.7rem', fontWeight: 700, borderRadius: 99, padding: '2px 10px',
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                      }}>
                        {t.status === 'done' ? 'Done' : 'In cure'}
                      </span>
                    </td>
                    <td style={{ ...td, textAlign: 'right' }}>
                      {t.status === 'curing' ? (
                        <button onClick={() => setStatus(t, 'done')} disabled={busyId === t.id} style={{
                          background: C.green, color: C.dark, border: 'none', borderRadius: 3,
                          padding: '0.35rem 0.8rem', fontSize: '0.78rem', fontWeight: 700, cursor: 'pointer', marginRight: '0.4rem',
                        }}>✓ Done</button>
                      ) : (
                        <button onClick={() => setStatus(t, 'curing')} disabled={busyId === t.id} style={{
                          background: 'transparent', color: C.lightBrown, border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3,
                          padding: '0.35rem 0.8rem', fontSize: '0.78rem', cursor: 'pointer', marginRight: '0.4rem',
                        }}>↩ Back to cure</button>
                      )}
                      <button onClick={() => removeTag(t)} disabled={busyId === t.id} title="Delete (mis-scan only)" style={{
                        background: 'transparent', color: C.lightBrown, border: 'none', cursor: 'pointer', fontSize: '0.9rem',
                      }}>✕</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.75rem', lineHeight: 1.6 }}>
        One row per <strong style={{ color: C.tan }}>numbered seal</strong> scanned on the cut floor — the tag rides the
        piece through the cure cooler, so the smokehouse can scan or read any tag and see whose it is.
        <strong style={{ color: C.tan }}> Cut sheet says</strong> is pulled live from that customer&apos;s cutting
        instructions — how they want the piece finished once it&apos;s out of cure. Mark a tag
        <strong style={{ color: C.tan }}> Done</strong> when the piece is processed and packed; delete is only for mis-scans.
      </p>
    </>
  )
}
