'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

// ── Cut ↔ PLU Link Book ──────────────────────────────────────────────────────
// Every cut line a cut card can ask for, one row each, with the PLU(s) it is
// linked to. Built so the whole table gets filled in one sitting instead of two
// taps at a time on the bench (Charlie, 2026-09-05: "marry up what is the
// expected cuts with their appropriate PLU's so that we are all in sync").
//
// The same table feeds three things: the scanner's still-to-pack ticking, the
// off-card warning, and — next — the bench screen that sends a PLU to the
// Hobart when a packer taps the cut. A wrong link goes to all three, so
// suggestions are tapped in by a person, never saved on their own.
//
// Read the other way it is the scale-readiness list: a line with no PLU at all
// is a product the scale can't label yet (Cheddar Polish Dogs, 2026-08).

interface PluRef { plu: string; name: string; active: boolean; scans?: number }
interface BookLine {
  species: string; key: string; label: string; section: string; cut: string; isGrind: boolean
  cards: number; lastSeen: string
  exact: boolean
  links: PluRef[]
  suggested: PluRef[]
}
interface Orphan { species: string; key: string; plu: string; name: string }
interface PluOption { plu: string; name: string; species: string; scans: number }
interface Book {
  stats: { cards: number; lines: number; linked: number; unlinked: number; noExact: number; deletedPlu: number }
  lines: BookLine[]
  orphans: Orphan[]
  plus: PluOption[]
}

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  amber:      '#F59E0B',
  red:        '#EF4444',
}

const SPECIES = ['beef', 'pork', 'lamb', 'goat'] as const
const SPECIES_WORD: Record<string, string> = { beef: '🐄 Beef', pork: '🐷 Pork', lamb: '🐑 Lamb', goat: '🐐 Goat' }

type View = 'all' | 'unlinked' | 'needs_plu' | 'deleted'

export default function PluLinksPage() {
  const [book,    setBook]    = useState<Book | null>(null)
  const [error,   setError]   = useState<string | null>(null)
  const [species, setSpecies] = useState<string>('beef')
  const [view,    setView]    = useState<View>('all')
  const [q,       setQ]       = useState('')
  const [busy,    setBusy]    = useState<string | null>(null)
  const [picking, setPicking] = useState<string | null>(null)   // line id with the picker open

  const load = useCallback(() => {
    fetch('/api/processing/link-book')
      .then(r => r.json())
      .then(d => { if (d.error) setError(String(d.error)); else { setBook(d); setError(null) } })
      .catch(() => setError('Could not load the book.'))
  }, [])
  useEffect(() => { load() }, [load])

  async function link(line: BookLine, plu: string, name: string) {
    const id = `${line.species}|${line.key}`
    setBusy(id)
    try {
      const res = await fetch('/api/processing/expected', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ species: line.species, cut_key: line.key, plu_number: plu, item_name: name }),
      })
      if (!res.ok) { const b = await res.json().catch(() => null); setError(b?.error ?? `Link failed (${res.status})`); return }
      // Patch in place — a full reload re-scores every suggestion and scrolls the page.
      setBook(prev => prev && {
        ...prev,
        stats: { ...prev.stats, linked: prev.stats.linked + (line.links.length ? 0 : 1), unlinked: prev.stats.unlinked - (line.links.length ? 0 : 1) },
        lines: prev.lines.map(l => l.species === line.species && l.key === line.key
          ? { ...l, links: [...l.links, { plu, name, active: true }], suggested: [] }
          : l),
      })
      setPicking(null)
    } finally { setBusy(null) }
  }

  async function unlink(line: BookLine, plu: string) {
    const id = `${line.species}|${line.key}`
    setBusy(id)
    try {
      const res = await fetch(`/api/processing/expected?species=${encodeURIComponent(line.species)}&cut_key=${encodeURIComponent(line.key)}&plu_number=${encodeURIComponent(plu)}`, { method: 'DELETE' })
      if (!res.ok) { setError(`Unlink failed (${res.status})`); return }
      // Suggestions come back with the next load; the row just loses its chip.
      setBook(prev => prev && {
        ...prev,
        lines: prev.lines.map(l => l.species === line.species && l.key === line.key
          ? { ...l, links: l.links.filter(k => k.plu !== plu) }
          : l),
      })
      load()
    } finally { setBusy(null) }
  }

  async function dropOrphan(o: Orphan) {
    setBusy(`orphan|${o.species}|${o.key}|${o.plu}`)
    try {
      await fetch(`/api/processing/expected?species=${encodeURIComponent(o.species)}&cut_key=${encodeURIComponent(o.key)}&plu_number=${encodeURIComponent(o.plu)}`, { method: 'DELETE' })
      load()
    } finally { setBusy(null) }
  }

  const perSpecies = useMemo(() => {
    const m: Record<string, { total: number; linked: number }> = {}
    for (const l of book?.lines ?? []) {
      const s = m[l.species] ?? (m[l.species] = { total: 0, linked: 0 })
      s.total++
      if (l.links.length) s.linked++
    }
    return m
  }, [book])

  const rows = useMemo(() => {
    if (!book) return []
    const needle = q.trim().toLowerCase()
    return book.lines.filter(l => l.species === species).filter(l => {
      if (view === 'unlinked'  && l.links.length) return false
      if (view === 'needs_plu' && l.exact) return false
      if (view === 'deleted'   && !l.links.some(k => !k.active)) return false
      if (needle && !`${l.label} ${l.section} ${l.links.map(k => k.name + k.plu).join(' ')}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [book, species, view, q])

  // Rows grouped under their packaging-sheet section, in the order they appear.
  const grouped = useMemo(() => {
    const out: { section: string; lines: BookLine[] }[] = []
    for (const l of rows) {
      const last = out[out.length - 1]
      if (last && last.section === l.section) last.lines.push(l)
      else out.push({ section: l.section, lines: [l] })
    }
    return out
  }, [rows])

  const stats = book?.stats

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, color: C.cream, fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', minHeight: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
          <Link href="/processing" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Processing</Link>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Cut ↔ PLU Link Book</h1>
        </div>
        {stats && (
          <div style={{ display: 'flex', gap: '1.25rem', fontSize: '0.78rem', color: C.lightBrown, flexWrap: 'wrap' }}>
            <span><b style={{ color: C.cream }}>{stats.linked}</b> of {stats.lines} lines linked</span>
            <span style={{ color: stats.noExact ? C.amber : C.lightBrown }}><b>{stats.noExact}</b> with no PLU that says exactly this</span>
            {stats.deletedPlu > 0 && <span style={{ color: C.red }}><b>{stats.deletedPlu}</b> linked to a deleted PLU</span>}
            <span>read off {stats.cards} cut cards</span>
          </div>
        )}
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 2rem 4rem' }}>
        <p style={{ fontSize: '0.85rem', color: C.tan, lineHeight: 1.5, margin: '0 0 1rem', maxWidth: 760 }}>
          One row per cut line the packaging sheet can print. Tap a suggestion to link it, or <em>Pick…</em> to search every PLU.
          A link here is what the scanner ticks off, what the off-card warning checks, and what the bench screen will send to the scale.
          Nothing is linked until someone taps it.
        </p>

        {error && (
          <div style={{ background: C.dark, border: `1px solid ${C.red}`, color: C.red, borderRadius: 4, padding: '0.6rem 0.9rem', fontSize: '0.85rem', marginBottom: '1rem' }}>{error}</div>
        )}

        {/* Species tabs carry their own progress so the next sitting starts where the gaps are. */}
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: '0.75rem' }}>
          {SPECIES.map(sp => {
            const s = perSpecies[sp]
            const on = species === sp
            return (
              <button key={sp} onClick={() => setSpecies(sp)} style={{
                background: on ? C.tan : 'transparent', color: on ? C.dark : C.tan,
                border: `1px solid ${on ? C.tan : 'rgba(201,168,130,0.4)'}`, borderRadius: 4,
                padding: '0.4rem 0.8rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
              }}>
                {SPECIES_WORD[sp]}{s ? <span style={{ fontWeight: 400, marginLeft: 6, opacity: 0.8 }}>{s.linked}/{s.total}</span> : null}
              </button>
            )
          })}
          <span style={{ flex: 1 }} />
          {([['all', 'All lines'], ['unlinked', 'Unlinked'], ['needs_plu', 'May need a PLU made'], ['deleted', 'Deleted PLU']] as [View, string][]).map(([v, label]) => (
            <button key={v} onClick={() => setView(v)} style={{
              background: view === v ? 'rgba(201,168,130,0.18)' : 'transparent', color: C.cream,
              border: `1px solid ${view === v ? C.tan : 'rgba(201,168,130,0.25)'}`, borderRadius: 4,
              padding: '0.35rem 0.7rem', fontSize: '0.78rem', cursor: 'pointer',
            }}>{label}</button>
          ))}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a cut or PLU…"
            style={{ background: C.dark, border: '1px solid rgba(201,168,130,0.3)', borderRadius: 4, color: C.cream, padding: '0.35rem 0.6rem', fontSize: '0.82rem', minWidth: 180 }} />
        </div>

        {!book && !error && <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Reading every cut card…</div>}

        {book && rows.length === 0 && (
          <div style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1rem 0' }}>Nothing here for this filter.</div>
        )}

        {grouped.map(g => (
          <section key={g.section || '(no section)'} style={{ marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', padding: '0.4rem 0', borderBottom: '1px solid rgba(166,120,90,0.25)', marginBottom: 2 }}>
              {g.section || 'Other'}
            </div>
            {g.lines.map(l => {
              const id = `${l.species}|${l.key}`
              const dead = l.links.some(k => !k.active)
              const needsPlu = !l.exact
              return (
                <div key={id} style={{
                  display: 'grid', gridTemplateColumns: 'minmax(220px, 1.2fr) minmax(280px, 2fr)', gap: '0.5rem 1rem',
                  alignItems: 'start', padding: '0.55rem 0.5rem', borderBottom: '1px solid rgba(166,120,90,0.12)',
                  background: dead ? 'rgba(239,68,68,0.06)' : needsPlu ? 'rgba(245,158,11,0.06)' : 'transparent',
                  opacity: busy === id ? 0.6 : 1,
                }}>
                  <div>
                    <div style={{ fontSize: '0.95rem', color: C.cream, fontWeight: 600 }}>{l.label}</div>
                    <div style={{ fontSize: '0.7rem', color: C.lightBrown, marginTop: 2 }}>
                      on {l.cards} card{l.cards === 1 ? '' : 's'} · last {l.lastSeen}{l.isGrind ? ' · grind' : ''}
                    </div>
                  </div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
                    {l.links.map(k => (
                      <span key={k.plu} title={k.active ? 'Linked' : 'This PLU is deleted — relink the line'} style={{
                        display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: '0.78rem',
                        background: k.active ? 'rgba(76,175,80,0.14)' : 'rgba(239,68,68,0.14)',
                        border: `1px solid ${k.active ? 'rgba(76,175,80,0.5)' : C.red}`, borderRadius: 4, padding: '0.25rem 0.5rem', color: C.cream,
                      }}>
                        {k.active ? '✓' : '⚠'} <b style={{ fontVariantNumeric: 'tabular-nums' }}>{k.plu}</b> {k.name}{!k.active && ' · deleted'}
                        <button onClick={() => unlink(l, k.plu)} title="Unlink" style={{ background: 'transparent', border: 'none', color: C.lightBrown, cursor: 'pointer', padding: 0, fontSize: '0.85rem' }}>✕</button>
                      </span>
                    ))}
                    {!l.links.length && l.suggested.map(s => (
                      <button key={s.plu} onClick={() => link(l, s.plu, s.name)} title="Tap to link" style={{
                        fontSize: '0.78rem', background: 'transparent', border: '1px dashed rgba(201,168,130,0.6)',
                        borderRadius: 4, padding: '0.25rem 0.5rem', color: C.tan, cursor: 'pointer',
                      }}>
                        + <b style={{ fontVariantNumeric: 'tabular-nums' }}>{s.plu}</b> {s.name}
                        {s.scans ? <span style={{ color: C.lightBrown }}> · {s.scans} scans</span> : <span style={{ color: C.lightBrown }}> · never scanned</span>}
                      </button>
                    ))}
                    {needsPlu && (
                      <span style={{ fontSize: '0.75rem', color: C.amber, flexBasis: l.suggested.length ? '100%' : undefined }}>
                        {l.suggested.length
                          ? 'Closest matches only — no PLU carries every word of this line. Link one if it is the same product; otherwise make the PLU first.'
                          : 'No PLU looks like this — make one, then link it here'}
                      </span>
                    )}
                    <button onClick={() => setPicking(picking === id ? null : id)} style={{
                      fontSize: '0.75rem', background: 'transparent', border: '1px solid rgba(201,168,130,0.3)',
                      borderRadius: 4, padding: '0.25rem 0.5rem', color: C.lightBrown, cursor: 'pointer',
                    }}>{picking === id ? 'Close' : 'Pick…'}</button>
                    {picking === id && <Picker plus={book!.plus} species={l.species} onPick={(plu, name) => link(l, plu, name)} />}
                  </div>
                </div>
              )
            })}
          </section>
        ))}

        {book && book.orphans.length > 0 && (
          <section style={{ marginTop: '2rem' }}>
            <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', padding: '0.4rem 0', borderBottom: '1px solid rgba(166,120,90,0.25)' }}>
              Links to a line no cut card produces
            </div>
            <p style={{ fontSize: '0.78rem', color: C.lightBrown, margin: '0.5rem 0' }}>
              Made on the bench against a cut key the packaging sheet doesn&apos;t emit any more. Harmless, but they never fire — drop them.
            </p>
            {book.orphans.map(o => (
              <div key={`${o.species}|${o.key}|${o.plu}`} style={{ display: 'flex', gap: '1rem', alignItems: 'center', fontSize: '0.82rem', padding: '0.35rem 0.5rem', borderBottom: '1px solid rgba(166,120,90,0.12)' }}>
                <span style={{ color: C.lightBrown, minWidth: 50 }}>{o.species}</span>
                <span style={{ color: C.cream, flex: 1 }}>{o.key}</span>
                <span style={{ color: C.tan }}>{o.plu} {o.name}</span>
                <button onClick={() => dropOrphan(o)} style={{ background: 'transparent', border: '1px solid rgba(201,168,130,0.3)', borderRadius: 4, color: C.lightBrown, padding: '0.2rem 0.5rem', cursor: 'pointer', fontSize: '0.75rem' }}>Drop</button>
              </div>
            ))}
          </section>
        )}
      </main>
    </div>
  )
}

// Search every active PLU by number or name. Own species first, then the rest —
// a lamb line usually wants a LAMB PLU, but a smokehouse line off a hog wants a
// Processed one, so nothing is hidden, only ordered.
function Picker({ plus, species, onPick }: { plus: PluOption[]; species: string; onPick: (plu: string, name: string) => void }) {
  const [q, setQ] = useState('')
  const own: Record<string, string> = { beef: 'Beef', pork: 'Pork', lamb: 'Lamb', goat: 'Goat' }
  const needle = q.trim().toLowerCase()
  const hits = plus
    .filter(p => needle && (p.plu.startsWith(needle) || p.name.toLowerCase().includes(needle)))
    .sort((a, b) => Number(b.species === own[species]) - Number(a.species === own[species]) || a.name.localeCompare(b.name))
    .slice(0, 12)
  return (
    <div style={{ flexBasis: '100%', background: C.dark, border: '1px solid rgba(201,168,130,0.3)', borderRadius: 4, padding: '0.5rem' }}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type a PLU number or part of the name"
        style={{ width: '100%', boxSizing: 'border-box', background: C.darkBrown, border: '1px solid rgba(201,168,130,0.3)', borderRadius: 4, color: C.cream, padding: '0.4rem 0.6rem', fontSize: '0.85rem' }} />
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
        {hits.map(p => (
          <button key={p.plu} onClick={() => onPick(p.plu, p.name)} style={{
            fontSize: '0.78rem', background: 'transparent', border: '1px solid rgba(201,168,130,0.5)',
            borderRadius: 4, padding: '0.25rem 0.5rem', color: C.cream, cursor: 'pointer',
          }}>
            <b style={{ fontVariantNumeric: 'tabular-nums' }}>{p.plu}</b> {p.name} <span style={{ color: C.lightBrown }}>· {p.species}{p.scans ? ` · ${p.scans} scans` : ''}</span>
          </button>
        ))}
        {needle && hits.length === 0 && <span style={{ fontSize: '0.78rem', color: C.amber }}>No active PLU matches — this product may need one made.</span>}
      </div>
    </div>
  )
}
