'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { makeCode39Barcode } from '@/lib/label'

// ── PLU Barcode Book ────────────────────────────────────────────────────────
// Printable sheets of Code 39 barcodes (raw PLU digits) so the crew can scan
// a PLU into the Hobart HT scales instead of keying the number by hand.
// On screen: white "paper" preview on the app's brown chrome.
// Print: portrait letter, black on white, one species per page-break section.

interface PluItem {
  id:          string
  plu_number:  string
  item_name:   string
  species:     string
  active:      boolean
}

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
}

const SPECIES_ORDER = ['Beef', 'Pork', 'Lamb', 'Goat', 'Processed', 'Wild Game', 'Cheese', 'Wholesale', 'Other']

// Code 39 encodes 0-9 A-Z . and -  Anything else (spaces, slashes) would be
// silently dropped by the generator and scan as the WRONG number, so refuse.
const CODE39_SAFE = /^[0-9A-Z.\-]+$/i

export default function PluBookPage() {
  const [items,   setItems]   = useState<PluItem[]>([])
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState('')
  const [sortBy,  setSortBy]  = useState<'name' | 'plu'>('name')
  const [hidden,  setHidden]  = useState<Set<string>>(new Set())

  useEffect(() => {
    fetch('/api/processing?active=true')
      .then(r => r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`)))
      .then((data: PluItem[]) => setItems(data))
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const sections = useMemo(() => {
    const bySpecies = new Map<string, PluItem[]>()
    for (const it of items) {
      const sp = SPECIES_ORDER.includes(it.species) ? it.species : 'Other'
      if (!bySpecies.has(sp)) bySpecies.set(sp, [])
      bySpecies.get(sp)!.push(it)
    }
    const cmp = sortBy === 'name'
      ? (a: PluItem, b: PluItem) => a.item_name.localeCompare(b.item_name)
      : (a: PluItem, b: PluItem) => Number(a.plu_number) - Number(b.plu_number)
    return SPECIES_ORDER
      .filter(sp => bySpecies.has(sp))
      .map(sp => ({ species: sp, items: bySpecies.get(sp)!.sort(cmp) }))
  }, [items, sortBy])

  const visibleSections = sections.filter(s => !hidden.has(s.species))
  const totalVisible = visibleSections.reduce((n, s) => n + s.items.length, 0)

  const toggleSpecies = (sp: string) => {
    setHidden(prev => {
      const next = new Set(prev)
      if (next.has(sp)) next.delete(sp); else next.add(sp)
      return next
    })
  }

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      {/* page-specific print rules; global @media print in globals.css already
          hides header/footer/button/[data-print-hide] and forces black-on-white */}
      <style>{`
        @media print {
          @page { size: letter portrait; margin: 0.4in; }
          .plu-section { break-before: page; }
          .plu-section:first-of-type { break-before: auto; }
          .plu-cell { break-inside: avoid; }
          .plu-paper { box-shadow: none !important; border-radius: 0 !important; margin: 0 !important; padding: 0 !important; }
        }
      `}</style>

      <header data-print-hide style={{ background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0, gap: '1rem', flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/processing" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Processing</Link>
          <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>PLU Barcode Book</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflow: 'hidden' }}>
            {(['name', 'plu'] as const).map(s => (
              <button key={s} onClick={() => setSortBy(s)} style={{
                padding: '0.4rem 0.9rem', border: 'none', cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
                background: sortBy === s ? C.medBrown : 'transparent',
                color: sortBy === s ? C.cream : C.lightBrown, letterSpacing: '0.04em',
              }}>{s === 'name' ? 'A → Z' : 'PLU #'}</button>
            ))}
          </div>
          <button onClick={() => window.print()} style={{
            background: C.tan, color: C.dark, border: 'none', borderRadius: 3,
            padding: '0.5rem 1.2rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer', letterSpacing: '0.04em',
          }}>🖨️ Print</button>
        </div>
      </header>

      <div data-print-hide style={{ padding: '0.75rem 2rem', display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Sections:</span>
        {sections.map(s => {
          const on = !hidden.has(s.species)
          return (
            <button key={s.species} onClick={() => toggleSpecies(s.species)} style={{
              padding: '0.3rem 0.8rem', borderRadius: 999, cursor: 'pointer', fontSize: '0.78rem', fontWeight: 600,
              border: `1px solid ${on ? C.tan : 'rgba(166,120,90,0.35)'}`,
              background: on ? 'rgba(201,168,130,0.15)' : 'transparent',
              color: on ? C.cream : 'rgba(166,120,90,0.6)',
            }}>{on ? '✓ ' : ''}{s.species} ({s.items.length})</button>
          )
        })}
        <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: C.lightBrown }}>
          {loading ? 'Loading…' : `${totalVisible} barcodes · each species starts a new page`}
        </span>
      </div>

      <main style={{ flex: 1, padding: '0.5rem 2rem 2rem', maxWidth: 1100, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {error && (
          <div data-print-hide style={{ background: 'rgba(229,62,62,0.15)', border: '1px solid #E53E3E', borderRadius: 4, padding: '0.75rem 1rem', color: C.cream, marginBottom: '1rem' }}>
            Couldn&apos;t load PLUs: {error}
          </div>
        )}

        {visibleSections.map(({ species, items: rows }) => (
          <section key={species} className="plu-section plu-paper" style={{
            background: '#fff', color: '#000', borderRadius: 6, padding: '0.5in 0.4in',
            margin: '0 0 1.5rem', boxShadow: '0 4px 16px rgba(0,0,0,0.4)',
          }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', borderBottom: '2.5px solid #000', paddingBottom: 6, marginBottom: 14 }}>
              <h2 style={{ margin: 0, fontFamily: 'Arial, sans-serif', fontSize: '15pt', fontWeight: 800, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                {species}
              </h2>
              <span style={{ fontFamily: 'Arial, sans-serif', fontSize: '8pt', fontWeight: 700, letterSpacing: '0.08em' }}>
                COWBOY MEAT COMPANY · PLU BARCODE BOOK · {rows.length} ITEMS
              </span>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '10px 14px' }}>
              {rows.map(it => {
                const code = it.plu_number.trim()
                const ok = CODE39_SAFE.test(code)
                return (
                  <div key={it.id} className="plu-cell" style={{ border: '1px solid #bbb', borderRadius: 3, padding: '5px 6px 4px', textAlign: 'center', display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}>
                    <div style={{ fontFamily: '"Arial Narrow", Arial, sans-serif', fontSize: '7.5pt', fontWeight: 700, lineHeight: 1.15, textTransform: 'uppercase', minHeight: '2.3em', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {it.item_name.toUpperCase()}
                    </div>
                    {ok ? (
                      <div style={{ padding: '2px 8px' }} dangerouslySetInnerHTML={{ __html: makeCode39Barcode(code) }} />
                    ) : (
                      <div style={{ fontSize: '7pt', color: '#000', padding: '14px 0' }}>NO BARCODE — PLU HAS INVALID CHARACTERS</div>
                    )}
                    <div style={{ fontFamily: 'monospace', fontSize: '9pt', fontWeight: 700, letterSpacing: '0.15em' }}>{code}</div>
                  </div>
                )
              })}
            </div>
          </section>
        ))}

        {!loading && !error && totalVisible === 0 && (
          <div data-print-hide style={{ textAlign: 'center', color: C.lightBrown, padding: '3rem 0' }}>
            No active PLUs to show — check the section toggles above.
          </div>
        )}
      </main>

      <footer data-print-hide style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown, flexShrink: 0 }}>
        Barcodes are Code 39 of the raw PLU digits — scan with a USB scanner at the scale to fill the PLU field.
      </footer>
    </div>
  )
}
