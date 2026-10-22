'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { isoDate } from '@/lib/dates'
import { labelKey, type ScannerProducerSet } from '@/lib/producerLabels'
import { wedgeOnline, type Wedge } from '@/lib/scaleCallup'
import { benchRows, benchProgress, type BenchExpectedLine, type BenchPluLink, type BenchScan } from '@/lib/benchLines'

// ── Bench ────────────────────────────────────────────────────────────────────
// The packer's screen at the scale. One job: show what this session still
// owes, in type you can read from the platter, and call a cut up on the
// Hobart with one tap. The Pico wedge on the scale (scripts/pico-wedge) types
// the PLU in; the packer puts the meat on and prints.
//
// It does not start sessions, make boxes or take scans. The scanner does all
// of that and this reads the same session: pick a customer that is packing
// today and the list is the scanner's still-to-pack list, big. A line nobody
// has linked a PLU to yet can't be called up, and says so.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  yellow:     '#D97706',
  red:        '#EF4444',
}
const SCALES = ['1', '2', '3']
const SCALES_KEY = 'benchScales'

interface Session { customer_name: string; session_date: string; status: string; box_count: number; closed_count: number; animals: string[] }
interface ExpectedCard { found: boolean; name: string; cards: number; species: string[]; lines: BenchExpectedLine[]; links: BenchPluLink[]; scaleLabels?: string[] }
const BANNER: Record<string, string> = { beef: '🐄 BEEF', pork: '🐷 HOG', lamb: '🐑 LAMB', goat: '🐐 GOAT' }

const shiftDate = (d: string, days: number) => {
  const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + days)
  return t.toISOString().slice(0, 10)
}
const niceDate = (d: string) => new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

export default function BenchPage() {
  // ── Station: which scales this screen stands at ───────────────────────────
  const [scales, setScales]   = useState<string[]>([])
  const [wedges, setWedges]   = useState<Wedge[]>([])
  const [now, setNow]         = useState(() => Date.now())
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring the station's scales after mount; reading them during render would mismatch the server HTML
    try { const v = JSON.parse(localStorage.getItem(SCALES_KEY) ?? '[]'); if (Array.isArray(v)) setScales(v.filter((s: unknown) => SCALES.includes(String(s)))) } catch {}
  }, [])
  const toggleScale = (s: string) => setScales(prev => {
    const next = prev.includes(s) ? prev.filter(x => x !== s) : [...prev, s].sort()
    try { localStorage.setItem(SCALES_KEY, JSON.stringify(next)) } catch {}
    return next
  })
  useEffect(() => {
    let stop = false
    const poll = () => fetch('/api/scale-callup?wedges=1').then(r => r.json())
      .then((j: { wedges?: Wedge[] }) => { if (!stop) { setWedges(Array.isArray(j?.wedges) ? j.wedges : []); setNow(Date.now()) } })
      .catch(() => {})
    poll()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') poll() }, 5000)
    return () => { stop = true; clearInterval(iv) }
  }, [])
  const online = (s: string) => wedgeOnline(wedges.find(w => w.scale === s), now)
  const everSeen = (s: string) => wedges.some(w => w.scale === s)

  // ── Sessions packing on a day ─────────────────────────────────────────────
  const [date, setDate]         = useState(() => isoDate())
  const [sessions, setSessions] = useState<Session[] | null>(null)
  const [picked, setPicked]     = useState<{ customer: string; date: string } | null>(null)
  useEffect(() => {
    if (picked) return
    let stop = false
    const load = () => fetch('/api/processing/sessions').then(r => r.json())
      .then((rows: Session[]) => { if (!stop) setSessions((Array.isArray(rows) ? rows : []).filter(s => s.session_date === date)) })
      .catch(() => { if (!stop) setSessions([]) })
    load()
    const iv = setInterval(() => { if (document.visibilityState === 'visible') load() }, 30000)
    return () => { stop = true; clearInterval(iv) }
  }, [date, picked])

  // ── The picked session: what it owes, what has been packed ────────────────
  const [expected, setExpected] = useState<ExpectedCard | null>(null)
  const [scans, setScans]       = useState<BenchScan[]>([])
  const [loading, setLoading]   = useState(false)
  const loadSession = useCallback(async (customer: string, dt: string) => {
    const [ex, sc] = await Promise.all([
      fetch(`/api/processing/expected?customer_name=${encodeURIComponent(customer)}&date=${dt}`).then(r => r.json()).catch(() => null),
      fetch(`/api/boxes/scans?customer_name=${encodeURIComponent(customer)}&date=${dt}`).then(r => r.json()).catch(() => []),
    ])
    setExpected(ex?.found ? ex as ExpectedCard : null)
    setScans(Array.isArray(sc) ? sc as BenchScan[] : [])
  }, [])
  useEffect(() => {
    if (!picked) { setExpected(null); setScans([]); return }
    let stop = false
    setLoading(true)
    loadSession(picked.customer, picked.date).finally(() => { if (!stop) setLoading(false) })
    // The scanner on the other bench is the one taking scans; this list is only
    // honest if it keeps up with them.
    const iv = setInterval(() => { if (document.visibilityState === 'visible') loadSession(picked.customer, picked.date) }, 15000)
    return () => { stop = true; clearInterval(iv) }
  }, [picked, loadSession])

  // Producer label sets: a session packing on a producer's label calls up the
  // producer's copy of each PLU, because that is what is on the scale.
  const [producerSets, setProducerSets] = useState<ScannerProducerSet[]>([])
  useEffect(() => {
    fetch('/api/producer-labels?scanner=1').then(r => r.json())
      .then((j: { sets?: ScannerProducerSet[] }) => setProducerSets(Array.isArray(j?.sets) ? j.sets : []))
      .catch(() => {})
  }, [])
  const houseToScalePlu = useMemo(() => {
    const m = new Map<string, string>()
    const keys = (expected?.scaleLabels ?? []).map(labelKey)
    for (const st of producerSets) {
      if (!keys.includes(st.key)) continue
      for (const it of st.items) m.set(it.house_plu, it.plu_number)
    }
    return m
  }, [expected, producerSets])

  const rows = useMemo(() => expected ? benchRows(expected.lines, expected.links, scans) : [], [expected, scans])
  const progress = useMemo(() => expected ? benchProgress(expected.lines, expected.links, scans) : { packed: 0, total: 0 }, [expected, scans])

  // ── Call a cut up ─────────────────────────────────────────────────────────
  const [callups, setCallups] = useState<Record<string, string>>({})
  const busyRef = useRef<Set<string>>(new Set())
  async function callUp(lineKey: string, housePlu: string, itemName: string) {
    if (!scales.length || busyRef.current.has(lineKey)) return
    const plu = houseToScalePlu.get(housePlu) ?? housePlu
    busyRef.current.add(lineKey)
    setCallups(c => ({ ...c, [lineKey]: '⏳' }))
    try {
      const ids = new Map<string, string>()
      for (const scale of scales) {
        const res = await fetch('/api/scale-callup', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ scale, plu, item_name: itemName, requested_by: 'bench' }),
        })
        const d = await res.json()
        if (!res.ok) throw new Error(d.error || `HTTP ${res.status}`)
        if (d.request?.id) ids.set(d.request.id, scale)
      }
      for (let i = 0; i < 12 && ids.size; i++) {
        await new Promise(r => setTimeout(r, 1000))
        const j = await fetch('/api/scale-callup?wedges=1').then(r => r.json()).catch(() => null)
        for (const row of (j?.requests ?? []) as { id: string; status: string; error?: string | null }[]) {
          const scale = ids.get(row.id)
          if (!scale) continue
          if (row.status === 'done') ids.delete(row.id)
          if (row.status === 'error' || row.status === 'expired') {
            setCallups(c => ({ ...c, [lineKey]: `✗ scale ${scale}: ${row.error ?? row.status}` }))
            return
          }
        }
      }
      setCallups(c => ({ ...c, [lineKey]: ids.size
        ? `⚠ scale ${[...ids.values()].join(', ')} hasn't typed it. Is its board on?`
        : `✓ on scale ${scales.join(' & ')}` }))
    } catch (e) {
      setCallups(c => ({ ...c, [lineKey]: `✗ ${e instanceof Error ? e.message : 'failed'}` }))
    } finally {
      busyRef.current.delete(lineKey)
    }
  }

  // ── Render ────────────────────────────────────────────────────────────────
  const scaleChip = (s: string) => {
    const on = scales.includes(s)
    const dot = online(s) ? C.green : everSeen(s) ? C.red : 'rgba(166,120,90,0.35)'
    return (
      <button key={s} onClick={() => toggleScale(s)}
        title={online(s) ? `Scale ${s}: board online` : everSeen(s) ? `Scale ${s}: board not checking in` : `Scale ${s}: no board has checked in`}
        style={{
          display: 'inline-flex', alignItems: 'center', gap: '0.5rem', minHeight: 48, padding: '0 1rem',
          background: on ? 'rgba(201,168,130,0.28)' : 'rgba(255,255,255,0.03)',
          border: `2px solid ${on ? C.tan : 'rgba(166,120,90,0.25)'}`, borderRadius: 6,
          color: on ? C.cream : C.lightBrown, fontSize: '1.05rem', fontWeight: 700, cursor: 'pointer',
        }}>
        <span style={{ width: 10, height: 10, borderRadius: 5, background: dot, boxShadow: online(s) ? `0 0 8px ${C.green}` : 'none' }} />
        {on ? '✓ ' : ''}Scale {s}
      </button>
    )
  }

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, color: C.cream, fontFamily: 'system-ui, sans-serif', display: 'flex', flexDirection: 'column' }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0.6rem 1rem', display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap', position: 'sticky', top: 0, zIndex: 5 }}>
        {picked ? (
          <button onClick={() => { setPicked(null); setCallups({}) }} style={{ minHeight: 48, padding: '0 1rem', background: 'transparent', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 6, color: C.tan, fontSize: '1rem', cursor: 'pointer' }}>‹ Sessions</button>
        ) : (
          <Link href="/scanner" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.9rem' }}>‹ Scanner</Link>
        )}
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          {picked ? picked.customer : 'Bench'}
        </h1>
        {picked && expected && (
          <span style={{ fontSize: '0.95rem', color: progress.packed === progress.total ? C.green : C.tan, fontVariantNumeric: 'tabular-nums' }}>
            {progress.packed} of {progress.total} cuts packed
          </span>
        )}
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>{SCALES.map(scaleChip)}</div>
      </header>

      <main style={{ flex: 1, padding: '1rem', maxWidth: 1100, width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {!scales.length && (
          <div style={{ background: 'rgba(217,119,6,0.12)', border: `1px solid ${C.yellow}`, borderRadius: 6, padding: '0.9rem 1.1rem', marginBottom: '1rem', fontSize: '1.05rem', lineHeight: 1.5 }}>
            <strong>Which scale is this screen at?</strong> Tap it top right. A tap on a cut then calls it up on that scale. This screen remembers.
          </div>
        )}

        {!picked && (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1rem' }}>
              <button onClick={() => setDate(d => shiftDate(d, -1))} style={navBtn}>‹</button>
              <div style={{ fontSize: '1.2rem', fontWeight: 700 }}>{date === isoDate() ? 'Today' : niceDate(date)}<span style={{ color: C.lightBrown, fontWeight: 400, fontSize: '0.9rem', marginLeft: '0.6rem' }}>{date === isoDate() ? niceDate(date) : ''}</span></div>
              <button onClick={() => setDate(d => shiftDate(d, 1))} disabled={date >= isoDate()} style={{ ...navBtn, opacity: date >= isoDate() ? 0.3 : 1 }}>›</button>
            </div>
            {sessions === null && <div style={{ color: C.lightBrown, fontSize: '1.05rem' }}>Loading…</div>}
            {sessions && !sessions.length && (
              <div style={{ color: C.lightBrown, fontSize: '1.05rem', lineHeight: 1.5 }}>
                Nobody is packing on this day yet. Start the session on the <Link href="/scanner" style={{ color: C.tan }}>scanner</Link> and it shows up here.
              </div>
            )}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: '0.75rem' }}>
              {(sessions ?? []).map(s => (
                <button key={`${s.customer_name}|${s.session_date}`} onClick={() => setPicked({ customer: s.customer_name, date: s.session_date })}
                  style={{ textAlign: 'left', minHeight: 96, padding: '0.9rem 1rem', background: C.dark, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 8, color: C.cream, cursor: 'pointer' }}>
                  <div style={{ fontSize: '1.25rem', fontWeight: 700, lineHeight: 1.2, marginBottom: '0.35rem' }}>{s.customer_name}</div>
                  <div style={{ fontSize: '0.9rem', color: C.lightBrown, lineHeight: 1.4 }}>
                    {s.box_count} box{s.box_count === 1 ? '' : 'es'}{s.closed_count ? `, ${s.closed_count} closed` : ''}
                    {s.animals.length > 0 && <><br />{s.animals.join(' · ')}</>}
                  </div>
                </button>
              ))}
            </div>
          </>
        )}

        {picked && (
          <>
            {loading && !expected && <div style={{ color: C.lightBrown, fontSize: '1.05rem' }}>Loading the card…</div>}
            {!loading && !expected && (
              <div style={{ color: C.lightBrown, fontSize: '1.05rem', lineHeight: 1.5 }}>
                No cut card found for {picked.customer} on {niceDate(picked.date)}, so there is no list to pack from. The scanner can still scan into boxes.
              </div>
            )}
            {expected && !rows.length && (
              <div style={{ fontSize: '1.4rem', color: C.green, fontWeight: 700, padding: '2rem 0', textAlign: 'center' }}>✓ Everything on the card is packed.</div>
            )}
            {expected && rows.length > 0 && (() => {
              let section = ''
              let card = -1
              return (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
                  {rows.map(({ line: l, of, done, plus }, i) => {
                    const cardHead = expected.cards > 1 && l.card !== card ? (card = l.card, section = '', true) : false
                    const head = l.section !== section ? (section = l.section) : null
                    const status = callups[l.key]
                    const canTap = scales.length > 0 && plus.length > 0
                    return (
                      <div key={`${l.card}-${l.key}-${i}`}>
                        {cardHead && (
                          <div style={{ color: C.cream, fontSize: '0.95rem', fontWeight: 700, letterSpacing: '0.14em', margin: `${i === 0 ? 0 : '1rem'} 0 0.3rem`, padding: '0.4rem 0.6rem', background: 'rgba(201,168,130,0.16)', border: '1px solid rgba(201,168,130,0.45)', borderRadius: 6 }}>
                            {BANNER[l.species] ?? l.species.toUpperCase()} CARD
                            {expected.lines.some(o => o.species === l.species && o.card !== l.card) && <span style={{ marginLeft: '0.5rem', color: C.tan }}>{l.card + 1} OF {new Set(expected.lines.filter(o => o.species === l.species).map(o => o.card)).size}</span>}
                          </div>
                        )}
                        {head && (
                          <div style={{ color: C.tan, fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', margin: '0.9rem 0 0.3rem', borderBottom: '1px solid rgba(166,120,90,0.25)', paddingBottom: '0.2rem' }}>{head}</div>
                        )}
                        <div style={{
                          display: 'flex', alignItems: 'center', gap: '0.75rem', minHeight: 64, padding: '0.6rem 0.9rem',
                          background: C.dark, border: `1px solid ${status?.startsWith('✓') ? 'rgba(76,175,80,0.6)' : 'rgba(166,120,90,0.25)'}`, borderRadius: 8,
                          opacity: canTap ? 1 : 0.6,
                        }}>
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: '1.3rem', fontWeight: 700 }}>{l.label || l.cut}</span>
                              {of > 1 && <span style={{ color: done ? C.yellow : C.lightBrown, fontSize: '0.85rem', fontWeight: 700, fontFamily: 'monospace', border: `1px solid ${done ? 'rgba(217,119,6,0.45)' : 'rgba(166,120,90,0.35)'}`, borderRadius: 3, padding: '0 5px' }}>{done}/{of}</span>}
                            </div>
                            {l.spec && <div style={{ color: C.lightBrown, fontSize: '0.95rem', marginTop: '0.1rem', overflowWrap: 'anywhere' }}>{l.spec}</div>}
                            {status && <div style={{ fontSize: '0.95rem', marginTop: '0.25rem', color: status.startsWith('✓') ? C.green : status.startsWith('⏳') ? C.tan : C.yellow }}>{status}</div>}
                            {!plus.length && <div style={{ fontSize: '0.85rem', marginTop: '0.25rem', color: C.lightBrown, fontStyle: 'italic' }}>No PLU linked yet. Link one on the scanner and this line gets a button.</div>}
                          </div>
                          {plus.map(p => (
                            <button key={p.plu} disabled={!canTap || status === '⏳'} onClick={() => callUp(l.key, p.plu, p.name)}
                              title={`${p.name || `PLU ${p.plu}`} → scale ${scales.join(', ')}`}
                              style={{
                                flexShrink: 0, minWidth: 96, minHeight: 56, padding: '0 1rem',
                                background: status === '⏳' ? 'rgba(201,168,130,0.15)' : 'rgba(76,175,80,0.18)',
                                border: `2px solid ${status === '⏳' ? C.tan : 'rgba(76,175,80,0.6)'}`, borderRadius: 8,
                                color: status === '⏳' ? C.tan : C.green, fontSize: '1.1rem', fontWeight: 800, cursor: canTap ? 'pointer' : 'default',
                                opacity: canTap ? 1 : 0.4, fontFamily: plus.length > 1 ? 'monospace' : 'inherit',
                              }}>
                              {status === '⏳' ? '⏳' : plus.length > 1 ? `⚖ ${p.plu}` : '⚖ Scale'}
                            </button>
                          ))}
                        </div>
                      </div>
                    )
                  })}
                </div>
              )
            })()}
          </>
        )}
      </main>
    </div>
  )
}

const navBtn: React.CSSProperties = {
  minWidth: 56, minHeight: 48, background: 'transparent', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 6,
  color: C.tan, fontSize: '1.4rem', cursor: 'pointer',
}
