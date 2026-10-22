'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { callupKeys, wedgeOnline, WEDGE_ONLINE_SECONDS, type CallupFormat, type Wedge } from '@/lib/scaleCallup'

// ── Scale call-up ────────────────────────────────────────────────────────────
// The bench page for the Pico wedges (scripts/pico-wedge): pick a scale, pick
// a PLU, send, and watch the board type it. This is how a board is proven on
// the laptop (into Notepad) and then on a scale, before the scanner page gets
// a tap-the-cut button that queues the same thing.

interface Callup {
  id: string; created_at: string; requested_by: string | null
  scale: string; plu: string; item_name: string | null; keys: string; format: CallupFormat
  status: 'pending' | 'claimed' | 'done' | 'error' | 'expired'
  claimed_at: string | null; completed_at: string | null; error: string | null
}
interface Data { requests: Callup[]; wedges: Wedge[]; plus: { plu: string; name: string }[]; now: string; ttl: number }

const SCALES = ['1', '2', '3']
const SCALE_KEY = 'scaleCallupScale'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  amber:      '#F59E0B',
  red:        '#EF4444',
}
const btn = (bg: string, fg: string = C.dark): React.CSSProperties => ({
  background: bg, color: fg, border: bg === 'transparent' ? '1px solid rgba(166,120,90,0.35)' : 'none',
  borderRadius: 3, padding: '0.45rem 0.9rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
})
const input: React.CSSProperties = {
  background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3,
  color: C.cream, padding: '0.45rem 0.6rem', fontSize: '0.95rem', fontFamily: 'monospace',
}
// The shop runs on Mountain time; the database is UTC.
const mt = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' })
  : '—'
const STATUS_COLOR: Record<Callup['status'], string> = {
  pending: C.tan, claimed: C.amber, done: C.green, error: C.red, expired: C.lightBrown,
}

export default function ScaleCallupPage() {
  const [data, setData]     = useState<Data | null>(null)
  const [error, setError]   = useState<string | null>(null)
  const [busy, setBusy]     = useState(false)
  const [scale, setScale]   = useState('2')
  const [plu, setPlu]       = useState('')
  const [format, setFormat] = useState<CallupFormat>('plu')
  const [now, setNow]       = useState(() => Date.now())

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring the remembered scale after mount; reading it during render would mismatch the server HTML
    try { const v = localStorage.getItem(SCALE_KEY); if (v && SCALES.includes(v)) setScale(v) } catch {}
  }, [])
  const pickScale = (s: string) => { setScale(s); try { localStorage.setItem(SCALE_KEY, s) } catch {} }

  const load = useCallback(() =>
    fetch('/api/scale-callup')
      .then(r => r.json())
      .then(j => { setNow(Date.now()); if (j?.error) setError(String(j.error)); else { setData(j); setError(null) } })
      .catch(() => setError('Could not load the call-ups.')), [])

  // Poll quickly while a call-up is waiting on a board, so the row flips to
  // done by itself the moment the board reports.
  const open = data?.requests.some(r => r.status === 'pending' || r.status === 'claimed') ?? false
  useEffect(() => {
    load()
    const t = setInterval(load, open ? 1500 : 5000)
    return () => clearInterval(t)
  }, [load, open])

  const byPlu = useMemo(() => new Map((data?.plus ?? []).map(p => [p.plu, p.name])), [data])
  const wedgeFor = (s: string) => data?.wedges.find(w => w.scale === s)
  const online = (s: string) => wedgeOnline(wedgeFor(s), now)
  const pluClean = plu.trim()
  const pluOk = /^\d{1,5}$/.test(pluClean) && parseInt(pluClean, 10) > 0
  const itemName = pluOk ? byPlu.get(String(parseInt(pluClean, 10))) ?? null : null

  async function send() {
    if (!pluOk || busy) return
    setBusy(true)
    setError(null)
    const res = await fetch('/api/scale-callup', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scale, plu: pluClean, format, item_name: itemName, requested_by: 'scale-callup' }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(j?.error ?? 'Could not queue the call-up')
    await load()
    setBusy(false)
  }

  const waitingSecs = (r: Callup) => Math.round((now - new Date(r.created_at).getTime()) / 1000)

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, color: C.cream, fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', minHeight: 64, display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <Link href="/scale-check" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Scale Check</Link>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Scale Call-up</h1>
        <Link href="/scanner" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem', marginLeft: 'auto' }}>Scanner →</Link>
      </header>

      <main style={{ maxWidth: 900, margin: '0 auto', padding: '1.25rem 2rem 4rem' }}>
        <p style={{ fontSize: '0.85rem', color: C.tan, lineHeight: 1.55, margin: '0 0 1rem', maxWidth: 760 }}>
          Sends a PLU to the Pico wedge on a scale, which types it into the scale the way a barcode scanner would.
          On the laptop, click into Notepad first and the board types there instead: that is the bench test.
          A call-up nobody types within {data?.ttl ?? 90} seconds expires rather than landing late.
          A green dot on a scale means its board checked in within the last {WEDGE_ONLINE_SECONDS} seconds.
        </p>

        {error && <div style={{ background: 'rgba(239,68,68,0.12)', border: `1px solid ${C.red}`, borderRadius: 4, padding: '0.6rem 0.9rem', marginBottom: '1rem', fontSize: '0.85rem' }}>{error}</div>}

        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '0.9rem 1.1rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '1.25rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div>
              <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>Scale</div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                {SCALES.map(s => {
                  const w = wedgeFor(s)
                  const on = online(s)
                  return (
                    <button key={s} onClick={() => pickScale(s)}
                      title={on ? `Board on scale ${s} is online (checked in ${mt(w!.last_seen_at)})` : w ? `Board on scale ${s} last checked in ${mt(w.last_seen_at)} — off, or off the wifi` : `No board has ever checked in as scale ${s}`}
                      style={{ ...btn(scale === s ? C.tan : 'transparent', scale === s ? C.dark : C.tan), display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                      <span style={{ width: 8, height: 8, borderRadius: 4, background: on ? C.green : w ? C.red : 'rgba(166,120,90,0.35)', boxShadow: on ? `0 0 6px ${C.green}` : 'none' }} />
                      {scale === s ? '✓ ' : ''}{s}
                    </button>
                  )
                })}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>PLU</div>
              <input
                list="plu-book" value={plu} inputMode="numeric" placeholder="118"
                onChange={e => setPlu(e.target.value.replace(/\D/g, '').slice(0, 5))}
                onKeyDown={e => { if (e.key === 'Enter') send() }}
                style={{ ...input, width: 110 }}
              />
              <datalist id="plu-book">
                {(data?.plus ?? []).map(p => <option key={p.plu} value={p.plu}>{p.name}</option>)}
              </datalist>
            </div>
            <div>
              <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>Board types</div>
              <div style={{ display: 'flex', gap: '0.4rem' }}>
                <button onClick={() => setFormat('plu')} style={btn(format === 'plu' ? C.tan : 'transparent', format === 'plu' ? C.dark : C.tan)}>PLU digits</button>
                <button onClick={() => setFormat('barcode')} style={btn(format === 'barcode' ? C.tan : 'transparent', format === 'barcode' ? C.dark : C.tan)}>13-digit barcode</button>
              </div>
            </div>
            <button disabled={!pluOk || busy} onClick={send} style={{ ...btn(C.green), opacity: !pluOk || busy ? 0.5 : 1 }}>
              Send to scale {scale}
            </button>
          </div>
          <div style={{ fontSize: '0.8rem', color: C.lightBrown, marginTop: '0.75rem', fontFamily: 'monospace', minHeight: '1.2em' }}>
            {pluOk
              ? <>{itemName ?? <span style={{ color: C.amber }}>not a PLU the price push sends</span>} · will type <strong style={{ color: C.cream }}>{callupKeys(pluClean, format)}</strong> ⏎</>
              : 'Type a PLU, or start typing a name to pick from the book.'}
          </div>
          {data && !online(scale) && (
            <div style={{ fontSize: '0.8rem', color: C.amber, marginTop: '0.4rem' }}>
              {wedgeFor(scale)
                ? `The board on scale ${scale} has not checked in for ${Math.round((now - new Date(wedgeFor(scale)!.last_seen_at).getTime()) / 1000)}s. A call-up will wait ${data.ttl}s for it, then expire.`
                : `No board has ever checked in as scale ${scale}. Is one flashed with CMC_SCALE = "${scale}"?`}
            </div>
          )}
        </div>

        <h2 style={{ fontSize: '0.75rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', margin: '0 0 0.5rem' }}>Last 20</h2>
        {!data && !error && <div style={{ color: C.lightBrown }}>Loading…</div>}
        {data && !data.requests.length && <div style={{ color: C.lightBrown, fontSize: '0.9rem' }}>Nothing sent yet.</div>}
        {data && data.requests.length > 0 && (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem' }}>
            <thead>
              <tr style={{ color: C.lightBrown, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', textAlign: 'left' }}>
                <th style={{ padding: '0.3rem 0.5rem' }}>Sent</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Scale</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>PLU</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Typed</th>
                <th style={{ padding: '0.3rem 0.5rem' }}>Status</th>
              </tr>
            </thead>
            <tbody>
              {data.requests.map(r => (
                <tr key={r.id} style={{ borderTop: '1px solid rgba(166,120,90,0.15)' }}>
                  <td style={{ padding: '0.4rem 0.5rem', color: C.tan, whiteSpace: 'nowrap' }}>{mt(r.created_at)}</td>
                  <td style={{ padding: '0.4rem 0.5rem', fontWeight: 700 }}>{r.scale}</td>
                  <td style={{ padding: '0.4rem 0.5rem' }}>{r.plu}{r.item_name ? <span style={{ color: C.lightBrown }}> · {r.item_name}</span> : null}</td>
                  <td style={{ padding: '0.4rem 0.5rem', fontFamily: 'monospace', color: C.tan }}>{r.keys}</td>
                  <td style={{ padding: '0.4rem 0.5rem', color: STATUS_COLOR[r.status] }}>
                    {r.status === 'pending' && `⏳ waiting for the board on scale ${r.scale} (${waitingSecs(r)}s)`}
                    {r.status === 'pending' && waitingSecs(r) > 10 && <span style={{ color: C.amber }}> — nothing has picked it up. Is the board powered, on wifi, and set to scale {r.scale}?</span>}
                    {r.status === 'claimed' && '⌨ board is typing…'}
                    {r.status === 'done' && `✓ typed ${mt(r.completed_at)}`}
                    {r.status === 'error' && `✗ ${r.error ?? 'failed'}`}
                    {r.status === 'expired' && `expired — ${r.error ?? 'not typed in time'}`}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </main>
    </div>
  )
}
