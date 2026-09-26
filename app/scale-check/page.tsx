'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import type { ScaleCompare } from '@/lib/scaleReads'

// ── Scale Check ──────────────────────────────────────────────────────────────
// What is actually ON the Hobart scales, against what the app thinks. The app
// has always known what it sends; this is the first time it can see what the
// scales hold (Charlie, 2026-09-26). A read is done by the kiosk — the only
// machine on the shop LAN — and is read-only: nothing is sent to a scale.
//
// One button per scale, not just "read all": someone may be packing on a
// scale (Eric on jerky at .191), and the office should be able to leave it be.

interface ReadRequest {
  id: string; created_at: string; status: string; scales: string[] | null
  result: { scales?: { ip: string; plu?: number; labels?: number; asleep?: boolean; error?: string }[] } | null
  completed_at: string | null
}
type Data = ScaleCompare & { requests: ReadRequest[] }

// The kiosk's config.json. The scanner calls them Scale 1/2/3, but which IP is
// which physical scale is still being confirmed, so this page goes by IP.
const SCALE_IPS = ['192.168.1.190', '192.168.1.191', '192.168.1.192']

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
const btn = (bg: string, fg: string = C.dark): React.CSSProperties => ({
  background: bg, color: fg, border: bg === 'transparent' ? '1px solid rgba(166,120,90,0.35)' : 'none',
  borderRadius: 3, padding: '0.4rem 0.8rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
})
const short = (ip: string) => '.' + ip.split('.').pop()
// The shop runs on Mountain time; the database is UTC.
const mt = (iso: string | null) => iso
  ? new Date(iso).toLocaleString('en-US', { timeZone: 'America/Denver', weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
  : '—'

export default function ScaleCheckPage() {
  const [data, setData]   = useState<Data | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy]   = useState(false)
  // Clock for "waiting N minutes", ticked on each load rather than read during render.
  const [now, setNow]     = useState(() => Date.now())

  const load = useCallback(() =>
    fetch('/api/scale-reads')
      .then(r => r.json())
      .then(j => { setNow(Date.now()); if (j?.error) setError(String(j.error)); else { setData(j); setError(null) } })
      .catch(() => setError('Could not load the scale reads.')), [])

  // Poll while a read is waiting on the kiosk, so the page fills in by itself.
  const open = data?.requests.find(r => r.status === 'pending' || r.status === 'running')
  const openId = open?.id
  useEffect(() => {
    load()
    if (!openId) return
    const t = setInterval(load, 5000)
    return () => clearInterval(t)
  }, [load, openId])

  async function requestRead(scales: string[] | null) {
    setBusy(true)
    setError(null)
    const res = await fetch('/api/scale-reads', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requested_by: 'scale-check', ...(scales ? { scales } : {}) }),
    })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) setError(j?.error ?? 'Could not queue the read')
    await load()
    setBusy(false)
  }

  const waitingMins = open ? (now - new Date(open.created_at).getTime()) / 60000 : 0
  const byIp = new Map((data?.scales ?? []).map(s => [s.ip, s]))
  const neverRead = !data?.scales.length

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown, color: C.cream, fontFamily: 'system-ui, sans-serif' }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', minHeight: 64, display: 'flex', alignItems: 'center', gap: '1.25rem', flexWrap: 'wrap' }}>
        <Link href="/processing" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Processing</Link>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>Scale Check</h1>
        <Link href="/producer-labels" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem', marginLeft: 'auto' }}>Producer Labels →</Link>
      </header>

      <main style={{ maxWidth: 1100, margin: '0 auto', padding: '1.25rem 2rem 4rem' }}>
        <p style={{ fontSize: '0.85rem', color: C.tan, lineHeight: 1.55, margin: '0 0 1rem', maxWidth: 800 }}>
          What&apos;s actually on each scale, read back by the kiosk, against what the app sells. A read only
          <strong style={{ color: C.cream }}> reads</strong> — nothing is sent to the scale — but it does talk to it,
          so leave a scale alone while someone is packing on it.
        </p>

        {error && <Banner color={C.red}>{error}</Banner>}

        {/* Read buttons, one per scale */}
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '0.9rem 1.1rem', marginBottom: '1.25rem' }}>
          <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'stretch' }}>
            {SCALE_IPS.map(ip => {
              const s = byIp.get(ip)
              return (
                <div key={ip} style={{ flex: '1 1 220px', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '0.6rem 0.8rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '0.5rem' }}>
                    <span style={{ fontFamily: 'monospace', fontWeight: 700 }}>{ip}</span>
                    <button disabled={busy || !!open} onClick={() => requestRead([ip])} style={btn('transparent', C.tan)}>Read {short(ip)}</button>
                  </div>
                  <div style={{ fontSize: '0.78rem', color: C.lightBrown, marginTop: '0.35rem', lineHeight: 1.5 }}>
                    {s?.plu_count != null ? <><strong style={{ color: C.cream }}>{s.plu_count}</strong> PLUs · read {mt(s.plu_read_at)}</> : 'PLUs never read'}<br />
                    {s?.format_count != null ? <><strong style={{ color: C.cream }}>{s.format_count}</strong> label formats · read {mt(s.label_read_at)}</> : 'Label formats never read'}
                  </div>
                </div>
              )
            })}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '0.75rem', flexWrap: 'wrap' }}>
            <button disabled={busy || !!open} onClick={() => requestRead(null)} style={btn(C.tan)}>Read all three</button>
            {open ? (
              <span style={{ fontSize: '0.8rem', color: waitingMins > 3 ? C.amber : C.tan }}>
                {open.status === 'running' ? '⏳ The kiosk is reading…' : '⏳ Waiting for the kiosk…'}{' '}
                ({open.scales?.map(short).join(', ') ?? 'all scales'}, asked {mt(open.created_at)})
                {waitingMins > 3 && open.status === 'pending' && ' — nothing has picked it up. Is the kiosk watcher updated to do reads (scripts/kiosk/READ_REQUESTS.md) and running?'}
              </span>
            ) : data?.requests[0] ? (
              <LastRequest r={data.requests[0]} />
            ) : null}
          </div>
        </div>

        {!data && !error && <div style={{ color: C.lightBrown }}>Loading…</div>}
        {data && neverRead && (
          <div style={{ color: C.lightBrown, fontSize: '0.9rem' }}>No scale has been read yet. Press a Read button above once the kiosk can do reads.</div>
        )}

        {data && !neverRead && (
          <>
            <Section title="Producer label sets" count={data.producerSets.length} hint="Whether each producer's PLUs are on each scale, and whether the scale has their label format.">
              {data.producerSets.map(s => (
                <div key={s.name} style={{ display: 'flex', gap: '0.9rem', flexWrap: 'wrap', padding: '0.3rem 0', fontSize: '0.83rem', borderTop: '1px solid rgba(166,120,90,0.1)' }}>
                  <span style={{ minWidth: 180, fontWeight: 600 }}>🏷 {s.name}</span>
                  <span style={{ color: C.tan, minWidth: 220 }}>
                    format {s.label_format ?? '—'}{s.format_texts.length ? ` · ${s.format_texts.slice(0, 2).join(' · ')}` : ''}
                  </span>
                  {s.byScale.map(b => (
                    <span key={b.ip} style={{ fontFamily: 'monospace', color: b.found === s.total && s.total > 0 ? C.green : b.found ? C.amber : C.lightBrown }}>
                      {short(b.ip)} {b.found}/{s.total}{b.format_on_scale === false ? ' (no format!)' : ''}
                    </span>
                  ))}
                  <span style={{ color: s.loaded_at ? C.green : C.lightBrown }}>{s.loaded_at ? 'marked loaded' : 'marked off'}</span>
                </div>
              ))}
            </Section>

            <Section title="Sold in the app but missing from a scale" count={data.missingFromScale.length}
              hint="Active, priced PLUs the push should have sent. A package keyed on that scale won't find them.">
              <Rows rows={data.missingFromScale.map(x => ({ plu: x.plu, name: x.name, note: 'missing on ' + x.missing.map(short).join(', ') }))} />
            </Section>

            <Section title="On a scale, not in the app" count={data.notInApp.length}
              hint="The scanner shows these as Unknown Item. Add them in the PLU Browser, or delete them at the scale.">
              <Rows rows={data.notInApp.map(x => ({ plu: x.plu, name: x.name, note: x.scales.map(short).join(', ') }))} />
            </Section>

            <Section title="Retired in the app, still on a scale" count={data.retiredOnScale.length}
              hint="Deleted in the app but still keyable at the scale.">
              <Rows rows={data.retiredOnScale.map(x => ({ plu: x.plu, name: x.name, note: x.scales.map(short).join(', ') }))} />
            </Section>

            <Section title="On a label format the scale doesn't have" count={data.unknownFormat.length}
              hint="Usually a typo at the scale (1107 on format 1107, retail items on 0). They print on whatever the scale falls back to.">
              <Rows rows={data.unknownFormat.map(x => ({ plu: x.plu, name: x.name, note: `format ${x.format} · ${x.scales.map(short).join(', ')}` }))} />
            </Section>

            <Section title="Label format differs from the app's copy" count={data.differsFromApp.length}
              hint="The scale says one format, the app's last captured record says another. The next push sends the app's.">
              <Rows rows={data.differsFromApp.map(x => ({ plu: x.plu, name: x.name, note: `app ${x.app} · scale ${x.scale} (${x.scales.map(short).join(', ')})` }))} />
            </Section>

            <Section title="Label format differs between scales" count={data.differsBetweenScales.length}
              hint="The same PLU prints on different labels depending on the scale.">
              <Rows rows={data.differsBetweenScales.map(x => ({ plu: x.plu, name: x.name, note: Object.entries(x.byScale).map(([ip, f]) => `${short(ip)} ${f || '—'}`).join(' · ') }))} />
            </Section>

            <Section title="Label formats on the scales" count={data.formats.length}
              hint="The formats carry no names; their logos and text say whose label each one is.">
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                <thead>
                  <tr style={{ color: C.lightBrown, textAlign: 'left', fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    <th style={{ padding: '0.3rem' }}>#</th><th style={{ padding: '0.3rem' }}>Logos / text</th>
                    <th style={{ padding: '0.3rem' }}>PLUs on it</th><th style={{ padding: '0.3rem' }}>Scales</th>
                  </tr>
                </thead>
                <tbody>
                  {data.formats.map(f => (
                    <tr key={f.number} style={{ borderTop: '1px solid rgba(166,120,90,0.1)' }}>
                      <td style={{ padding: '0.3rem', fontFamily: 'monospace', fontWeight: 700 }}>{f.number}</td>
                      <td style={{ padding: '0.3rem', color: C.tan }}>{f.texts.join(' · ') || f.internal_name || '—'}</td>
                      <td style={{ padding: '0.3rem', fontFamily: 'monospace', color: f.plus_using ? C.cream : C.lightBrown }}>{f.plus_using}</td>
                      <td style={{ padding: '0.3rem', fontFamily: 'monospace', color: C.lightBrown }}>{f.scales.map(short).join(' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Section>
          </>
        )}
      </main>
    </div>
  )
}

function Banner({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <div style={{ background: 'rgba(0,0,0,0.25)', border: `1px solid ${color}`, borderRadius: 4, padding: '0.6rem 0.9rem', color, fontSize: '0.85rem', marginBottom: '1rem' }}>
      {children}
    </div>
  )
}

function LastRequest({ r }: { r: ReadRequest }) {
  const parts = (r.result?.scales ?? []).map(s =>
    `${short(s.ip)} ${s.asleep ? 'asleep' : s.error ? 'failed' : `${s.plu ?? 0} PLUs, ${s.labels ?? 0} formats`}`)
  return (
    <span style={{ fontSize: '0.8rem', color: r.status === 'error' ? C.amber : C.lightBrown }}>
      Last read {mt(r.completed_at ?? r.created_at)} — {r.status}{parts.length ? `: ${parts.join(' · ')}` : ''}
    </span>
  )
}

function Section({ title, count, hint, children }: { title: string; count: number; hint: string; children: React.ReactNode }) {
  const [openState, setOpen] = useState(count > 0 && count <= 25)
  return (
    <section style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, marginBottom: '0.9rem' }}>
      <button onClick={() => setOpen(o => !o)} style={{ width: '100%', textAlign: 'left', background: 'none', border: 'none', color: C.cream, cursor: 'pointer', padding: '0.7rem 1rem', display: 'flex', alignItems: 'baseline', gap: '0.6rem' }}>
        <span style={{ fontFamily: 'monospace', color: C.lightBrown }}>{openState ? '▾' : '▸'}</span>
        <span style={{ fontWeight: 700, fontSize: '0.9rem' }}>{title}</span>
        <span style={{ fontFamily: 'monospace', fontWeight: 700, color: count ? C.amber : C.green }}>{count}</span>
        <span style={{ fontSize: '0.75rem', color: C.lightBrown, marginLeft: 'auto', textAlign: 'right' }}>{hint}</span>
      </button>
      {openState && count > 0 && <div style={{ padding: '0 1rem 0.8rem' }}>{children}</div>}
    </section>
  )
}

function Rows({ rows }: { rows: { plu: string; name: string; note: string }[] }) {
  return (
    <div style={{ fontSize: '0.8rem', maxHeight: 360, overflowY: 'auto' }}>
      {rows.map(r => (
        <div key={r.plu + r.note} style={{ display: 'flex', gap: '0.75rem', padding: '0.18rem 0', borderTop: '1px solid rgba(166,120,90,0.08)' }}>
          <span style={{ fontFamily: 'monospace', color: C.lightBrown, minWidth: 60 }}>{r.plu}</span>
          <span style={{ flex: 1 }}>{r.name}</span>
          <span style={{ color: C.tan, fontFamily: 'monospace' }}>{r.note}</span>
        </div>
      ))}
    </div>
  )
}
