'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import { aliasMap, nameKeyWith, type CustomerNameAlias } from '@/lib/nameKey'

// The customer field on a new packing session.
//
// It was a plain text box, and every downstream record inherits what gets typed
// into it — the boxes, the processing inputs, and the cure tags. The floor types
// what the customer goes by ("MVML KRISTIN", "REBECCA") and the office typed
// the full account name on the cut sheet, so the two never met: 52 tagged pieces
// in the cure cooler belonged to 8 names no cut sheet used (Charlie,
// 2026-08-27). Reconciling those afterwards is guesswork. Offering the office's
// spelling while somebody is typing is not.
//
// It still takes anything. A new customer, a retail walk-in and a repack all
// have to be typeable, and a picker that blocks the floor at 6am is a picker
// they route around. This suggests, warns, and gets out of the way.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  yellow:     '#D97706',
}

export interface CustomerName {
  name: string
  source: 'sheet' | 'recent'
  species: string | null
  lastSeen: string
  /** 8-char cutting-instruction id prefixes — what the slip barcode carries */
  ids?: string[]
}

// The packaging sheet prints a CI-xxxxxxxx barcode (8 hex chars of the
// instruction id). Scanning it — into this picker or the sessions screen —
// resolves straight to the office's spelling of the customer, so nobody types
// a name at all (Charlie, 2026-08-27).
const CI_SCAN = /^CI-?([0-9A-F]{8})$/i
export function resolveCiScan(raw: string, names: CustomerName[]): string | null {
  const m = raw.trim().match(CI_SCAN)
  if (!m) return null
  const id8 = m[1].toUpperCase()
  return names.find(n => n.ids?.includes(id8))?.name ?? null
}

const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.07)',
  border: '1px solid rgba(166,120,90,0.4)', borderRadius: 4,
  padding: '0.75rem', color: C.cream, fontSize: '1.1rem',
  outline: 'none', boxSizing: 'border-box',
}

/** Every word of the query has to appear in the name — so "kristin mont"
 *  finds "MT Veterans Meat Locker Kristin" and word order doesn't matter. */
function matches(name: string, query: string): boolean {
  const hay = name.toUpperCase()
  return query.toUpperCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w))
}

export default function CustomerPicker({
  value, onChange, onEnter, names, aliases, autoFocus,
}: {
  value: string
  onChange: (v: string) => void
  onEnter?: () => void
  names: CustomerName[]
  aliases: CustomerNameAlias[]
  autoFocus?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [hi, setHi] = useState(0)
  // Whether the arrow keys have been used since the last keystroke. Enter only
  // takes the highlighted suggestion when the crew steered onto it (or it's the
  // same customer respelled) — a suggestion nobody chose must not replace a
  // typed name, or cuts land in the wrong customer's boxes (ae, 2026-08-28).
  const [navigated, setNavigated] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  const keys = useMemo(() => aliasMap(aliases), [aliases])

  const hits = useMemo(() => {
    const q = value.trim()
    // Nothing until two typed characters: a list that appears on bare focus is
    // a list that gets clicked by accident (ae, 2026-08-28).
    if (q.length < 2) return []
    // Cut sheets that resolve to the same customer come FIRST, even when the
    // letters don't overlap at all: typing "MVML KRISTIN" has to be able to
    // surface "Montana Veterans Meat Locker Kristin", and no amount of
    // substring matching gets there. That is the whole reason the alias table
    // exists.
    const k = nameKeyWith(q, keys)
    const byKey = k ? names.filter(n => n.source === 'sheet' && nameKeyWith(n.name, keys) === k) : []
    const seen = new Set(byKey.map(n => n.name))
    const rest = names.filter(n => !seen.has(n.name) && matches(n.name, q))
    return [...byKey, ...rest].slice(0, 8)
  }, [names, value, keys])

  // Typed a name that IS one we already have, spelled differently. This is the
  // whole point: "MVML KRISTIN" and "Kristin Montana Veterans Meat Locker"
  // resolve to the same key, so say so before the session is opened rather
  // than leaving it for somebody to untangle off a cure sheet in a fortnight.
  //
  // Measured against CUT SHEETS only, and never against past sessions. Every
  // bad spelling is already a past session — "MVML KRISTIN" has been used four
  // times — so treating a session name as proof the spelling is fine would
  // make this warning silent in exactly the case it exists for.
  const sameAs = useMemo(() => {
    const q = value.trim()
    if (!q) return null
    // Already the office's spelling. Nothing to say.
    if (names.some(n => n.source === 'sheet' && n.name === q)) return null
    const k = nameKeyWith(q, keys)
    if (!k) return null
    return names.find(n => n.source === 'sheet' && nameKeyWith(n.name, keys) === k) ?? null
  }, [names, value, keys])

  useEffect(() => {
    const away = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', away)
    return () => document.removeEventListener('mousedown', away)
  }, [])

  const pick = (n: string) => { onChange(n); setOpen(false) }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <input
        autoFocus={autoFocus}
        style={INPUT}
        value={value}
        placeholder="Start typing — cut sheets first"
        // Highlight resets here rather than in an effect on `value`: typing is
        // what invalidates the old highlight, and resetting it in a render
        // cascade is a lint error and a wasted render both.
        onChange={e => { onChange(e.target.value); setOpen(true); setHi(0); setNavigated(false) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          // A slip barcode scanned into the field: the gun types CI-xxxxxxxx
          // and sends Enter — swap in the sheet name it stands for.
          if (e.key === 'Enter') {
            const scanned = resolveCiScan(value, names)
            if (scanned) { e.preventDefault(); pick(scanned); return }
          }
          if (open && hits.length) {
            if (e.key === 'ArrowDown') { e.preventDefault(); setNavigated(true); setHi(h => Math.min(h + 1, hits.length - 1)); return }
            if (e.key === 'ArrowUp')   { e.preventDefault(); setNavigated(true); setHi(h => Math.max(h - 1, 0)); return }
            // Enter takes the highlighted suggestion only when it's the one
            // they steered onto, or it's this same customer under the office's
            // spelling. A different customer's name that merely matched the
            // letters stays a suggestion — Enter on a typed name keeps the
            // typed name (ae, 2026-08-28).
            if (e.key === 'Enter' && hits[hi]
                && (navigated || nameKeyWith(hits[hi].name, keys) === nameKeyWith(value.trim(), keys))) {
              e.preventDefault(); pick(hits[hi].name); return
            }
          }
          if (e.key === 'Enter' && value.trim()) { setOpen(false); onEnter?.() }
          if (e.key === 'Escape') setOpen(false)
        }}
      />

      {open && hits.length > 0 && (
        <div style={{
          position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 200, marginTop: 3,
          background: C.dark, border: '1px solid rgba(166,120,90,0.45)', borderRadius: 4,
          maxHeight: 260, overflowY: 'auto', boxShadow: '0 8px 20px rgba(0,0,0,0.5)',
        }}>
          {hits.map((n, i) => (
            <div
              key={n.name}
              onMouseDown={e => { e.preventDefault(); pick(n.name) }}
              onMouseEnter={() => setHi(i)}
              style={{
                padding: '0.55rem 0.7rem', cursor: 'pointer',
                background: i === hi ? 'rgba(201,168,130,0.18)' : 'transparent',
                borderBottom: '1px solid rgba(166,120,90,0.12)',
              }}
            >
              <div style={{ color: C.cream, fontSize: '0.95rem' }}>{n.name}</div>
              <div style={{ color: C.lightBrown, fontSize: '0.7rem' }}>
                {n.source === 'sheet'
                  ? `cut sheet${n.species ? ` · ${n.species}` : ''}${n.lastSeen ? ` · ${n.lastSeen}` : ''}`
                  : `recent session${n.lastSeen ? ` · ${n.lastSeen}` : ''}`}
              </div>
            </div>
          ))}
        </div>
      )}

      {sameAs && (
        <div style={{
          marginTop: '0.5rem', background: 'rgba(217,119,6,0.12)',
          border: `1px solid ${C.yellow}`, borderRadius: 4, padding: '0.55rem 0.7rem',
        }}>
          <div style={{ color: C.yellow, fontSize: '0.78rem', fontWeight: 700, marginBottom: 2 }}>
            Same customer, different spelling
          </div>
          <div style={{ color: C.cream, fontSize: '0.8rem', lineHeight: 1.4 }}>
            Their cut sheet says <strong>{sameAs.name}</strong>. Using that spelling keeps their cure tags
            and boxes with the rest of their animal.
          </div>
          <button
            type="button"
            onMouseDown={e => { e.preventDefault(); pick(sameAs.name) }}
            style={{
              marginTop: '0.45rem', background: C.tan, color: C.dark, border: 'none',
              borderRadius: 3, padding: '0.35rem 0.7rem', fontSize: '0.78rem',
              fontWeight: 700, cursor: 'pointer',
            }}
          >
            Use “{sameAs.name}”
          </button>
        </div>
      )}
    </div>
  )
}
