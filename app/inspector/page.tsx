'use client'
import { useCallback, useEffect, useState } from 'react'
import { formatBytes } from '@/lib/haccpDocs'
import { isoDate } from '@/lib/dates'

// Read-only portal for inspectors, reachable only from the plant network and
// only after signing a name. Nothing here writes to plant records — every
// fetch goes to /api/inspector/*, which enforces both doors server-side.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  amber:      '#F59E0B',
  red:        '#E53E3E',
}

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.6rem 0.8rem', color: C.cream, fontSize: '0.95rem',
  outline: 'none', boxSizing: 'border-box', width: '100%',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.3rem',
}

interface Visit { id: string; inspector: string; agency: string | null }
interface Session { onNetwork: boolean; ip: string; visit: Visit | null }

interface Doc {
  id: string; title: string; category: string; filename: string
  size_bytes: number | null; version_date: string | null; notes: string | null
}

type Tab = 'documents' | 'cold-storage' | 'kill-day'

export default function InspectorPortal() {
  const [session, setSession] = useState<Session | null>(null)
  const [tab,     setTab]     = useState<Tab>('documents')

  const loadSession = useCallback(async () => {
    const res = await fetch('/api/inspector/session')
    setSession(res.ok ? await res.json() : { onNetwork: false, ip: '', visit: null })
  }, [])

  useEffect(() => { loadSession() }, [loadSession])

  async function signOut() {
    await fetch('/api/inspector/session', { method: 'DELETE' })
    loadSession()
  }

  if (!session)          return <Shell><Centered>Loading…</Centered></Shell>
  if (!session.onNetwork) return <Shell><OffNetwork ip={session.ip} /></Shell>
  if (!session.visit)     return <Shell><SignIn onSignedIn={loadSession} /></Shell>

  return (
    <Shell>
      <header style={{
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', minHeight: '64px',
        display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap',
      }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0 }}>
          Inspector Portal
        </h1>
        <span style={{ color: 'rgba(166,120,90,0.4)' }}>|</span>
        <span style={{ color: C.tan, fontSize: '0.85rem' }}>
          {session.visit.inspector}{session.visit.agency ? ` · ${session.visit.agency}` : ''}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {([
            ['documents',    '📚 Plan & Programs'],
            ['cold-storage', '🌡 Cold Storage'],
            ['kill-day',     '🐄 Kill Day Records'],
          ] as [Tab, string][]).map(([id, label]) => (
            <button key={id} onClick={() => setTab(id)} style={{
              padding: '0.45rem 1rem', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4,
              cursor: 'pointer', fontSize: '0.8rem', fontWeight: 600, letterSpacing: '0.04em',
              background: tab === id ? C.medBrown : 'rgba(255,255,255,0.05)',
              color: tab === id ? C.cream : C.lightBrown,
            }}>{label}</button>
          ))}
          <button onClick={signOut} style={{
            padding: '0.45rem 0.9rem', border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4,
            background: 'transparent', color: C.lightBrown, fontSize: '0.8rem', cursor: 'pointer',
          }}>Sign out</button>
        </div>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem 3rem', maxWidth: '1150px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {tab === 'documents'    && <DocumentsView />}
        {tab === 'cold-storage' && <ColdStorageView />}
        {tab === 'kill-day'     && <KillDayView />}
      </main>

      <footer style={{ background: C.dark, borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: C.lightBrown }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660 · Read-only view · Visits are logged
      </footer>
    </Shell>
  )
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>
      {children}
    </div>
  )
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
      <div style={{ maxWidth: 460, width: '100%' }}>{children}</div>
    </div>
  )
}

// ── Gate screens ──────────────────────────────────────────────────────────────

function OffNetwork({ ip }: { ip: string }) {
  return (
    <Centered>
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderLeft: `4px solid ${C.amber}`, borderRadius: 4, padding: '1.75rem' }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.05rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.75rem' }}>
          Available at the plant only
        </div>
        <p style={{ fontSize: '0.88rem', color: C.tan, lineHeight: 1.55, margin: '0 0 1rem' }}>
          HACCP records open on site, from the plant&rsquo;s own network. This device isn&rsquo;t on it.
        </p>
        <p style={{ fontSize: '0.8rem', color: C.lightBrown, lineHeight: 1.55, margin: 0 }}>
          If you are standing in the plant and seeing this, the network address may have changed. Read this
          line to the office and they can authorize it: <strong style={{ color: C.cream }}>{ip || 'unknown'}</strong>
        </p>
      </div>
    </Centered>
  )
}

function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [name,   setName]   = useState('')
  const [agency, setAgency] = useState('')
  const [busy,   setBusy]   = useState(false)
  const [err,    setErr]    = useState('')

  async function submit() {
    if (name.trim().length < 2) { setErr('Enter your name to continue'); return }
    setBusy(true); setErr('')
    const res = await fetch('/api/inspector/session', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ inspector: name, agency }),
    })
    setBusy(false)
    if (!res.ok) {
      const body = await res.json().catch(() => ({}))
      setErr(body.error ?? 'Could not sign in')
      return
    }
    onSignedIn()
  }

  return (
    <Centered>
      <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderLeft: `4px solid ${C.green}`, borderRadius: 4, padding: '1.75rem' }}>
        <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.15rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
          Cowboy Meat Company
        </div>
        <div style={{ fontSize: '0.78rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '1.25rem' }}>
          Inspector Portal
        </div>

        <p style={{ fontSize: '0.85rem', color: C.tan, lineHeight: 1.55, margin: '0 0 1.25rem' }}>
          Please sign in. Your name and the records you open are kept in our visitor log.
        </p>

        <div style={{ marginBottom: '0.85rem' }}>
          <label style={LABEL}>Your name</label>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            autoFocus
            style={INPUT}
          />
        </div>
        <div style={{ marginBottom: '1.25rem' }}>
          <label style={LABEL}>Agency <span style={{ textTransform: 'none', letterSpacing: 0 }}>(optional)</span></label>
          <input
            value={agency}
            onChange={e => setAgency(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') submit() }}
            placeholder="USDA FSIS, Montana Dept. of Livestock…"
            style={INPUT}
          />
        </div>

        {err && <div style={{ color: C.red, fontSize: '0.82rem', marginBottom: '0.75rem' }}>{err}</div>}

        <button onClick={submit} disabled={busy} style={{
          width: '100%', background: busy ? 'rgba(166,120,90,0.2)' : C.green,
          color: busy ? 'rgba(166,120,90,0.5)' : C.dark, border: 'none', borderRadius: 3,
          padding: '0.7rem', fontSize: '0.92rem', fontWeight: 700, letterSpacing: '0.05em',
          cursor: busy ? 'default' : 'pointer',
        }}>
          {busy ? 'Signing in…' : 'Enter'}
        </button>
      </div>
    </Centered>
  )
}

// ── Content ───────────────────────────────────────────────────────────────────

const SECTION_H: React.CSSProperties = {
  fontFamily: 'Georgia, serif', fontSize: '0.85rem', color: C.tan,
  textTransform: 'uppercase', letterSpacing: '0.12em', margin: '0 0 0.6rem',
}
const TH: React.CSSProperties = {
  textAlign: 'left', padding: '0.5rem 0.7rem', fontSize: '0.68rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid rgba(166,120,90,0.25)',
  whiteSpace: 'nowrap',
}
const TD: React.CSSProperties = {
  padding: '0.45rem 0.7rem', fontSize: '0.83rem', color: C.cream,
  borderBottom: '1px solid rgba(166,120,90,0.12)', whiteSpace: 'nowrap',
}

function Panel({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, overflowX: 'auto' }}>
      {children}
    </div>
  )
}

function DocumentsView() {
  const [docs,    setDocs]    = useState<Doc[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/inspector/documents')
      .then(r => r.ok ? r.json() : [])
      .then(d => { setDocs(d); setLoading(false) })
  }, [])

  async function open(doc: Doc) {
    const res = await fetch(`/api/inspector/documents/${doc.id}`)
    if (!res.ok) return
    const { url } = await res.json()
    window.open(url, '_blank', 'noopener')
  }

  if (loading) return <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Loading…</p>
  if (docs.length === 0) {
    return <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>No documents have been published yet.</p>
  }

  const categories = [...new Set(docs.map(d => d.category))]
  return (
    <>
      {categories.map(cat => (
        <section key={cat} style={{ marginBottom: '1.75rem' }}>
          <h2 style={SECTION_H}>{cat}</h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {docs.filter(d => d.category === cat).map(d => (
              <div key={d.id} style={{
                background: C.dark, border: '1px solid rgba(166,120,90,0.2)',
                borderLeft: `3px solid ${C.amber}`, borderRadius: 4,
                padding: '0.7rem 1rem', display: 'flex', alignItems: 'center', gap: '1rem',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>{d.title}</div>
                  <div style={{ color: C.lightBrown, fontSize: '0.74rem', marginTop: '0.15rem' }}>
                    {d.filename} · {formatBytes(d.size_bytes)}{d.version_date ? ` · rev ${d.version_date}` : ''}
                  </div>
                  {d.notes && <div style={{ color: C.tan, fontSize: '0.74rem', marginTop: '0.2rem' }}>{d.notes}</div>}
                </div>
                <button onClick={() => open(d)} style={{
                  background: C.tan, color: C.dark, border: 'none', borderRadius: 3,
                  padding: '0.45rem 1rem', fontSize: '0.82rem', fontWeight: 700, cursor: 'pointer',
                }}>Open ↗</button>
              </div>
            ))}
          </div>
        </section>
      ))}
    </>
  )
}

interface ColdRow {
  id: string; recorded_date: string; recorded_time: string | null
  showcase_freezer_f: number | null; showcase_cooler_f: number | null
  retail_freezer_f: number | null; custom_freezer_middle_f: number | null
  custom_freezer_east_f: number | null; new_carcass_cooler_f: number | null
  old_carcass_cooler_f: number | null; initials: string | null; notes: string | null
}

// Freezers hold at or below 0°F, coolers at or below 41°F. Out-of-spec numbers
// are called out rather than left for the reader to catch.
const COLD_COLS: { key: keyof ColdRow; label: string; max: number }[] = [
  { key: 'showcase_freezer_f',      label: 'Showcase Fzr',  max: 0 },
  { key: 'showcase_cooler_f',       label: 'Showcase Clr',  max: 41 },
  { key: 'retail_freezer_f',        label: 'Retail Fzr',    max: 0 },
  { key: 'custom_freezer_middle_f', label: 'Custom Mid',    max: 0 },
  { key: 'custom_freezer_east_f',   label: 'Custom East',   max: 0 },
  { key: 'new_carcass_cooler_f',    label: 'Carcass (New)', max: 41 },
  { key: 'old_carcass_cooler_f',    label: 'Carcass (Old)', max: 41 },
]

function ColdStorageView() {
  const [rows,    setRows]    = useState<ColdRow[]>([])
  const [days,    setDays]    = useState(30)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/inspector/records?view=cold-storage&days=${days}`)
      .then(r => r.ok ? r.json() : { rows: [] })
      .then(d => { setRows(d.rows ?? []); setLoading(false) })
  }, [days])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.85rem' }}>
        <h2 style={{ ...SECTION_H, margin: 0 }}>Cold Storage Temperature Log · Form 6c</h2>
        <select value={days} onChange={e => setDays(Number(e.target.value))} style={{ ...INPUT, width: 'auto', padding: '0.35rem 0.6rem', fontSize: '0.82rem', background: C.darkBrown }}>
          <option value={7}>Last 7 days</option>
          <option value={30}>Last 30 days</option>
          <option value={90}>Last 90 days</option>
          <option value={365}>Last year</option>
        </select>
      </div>

      {loading ? <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Loading…</p>
        : rows.length === 0 ? <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>No readings in this range.</p>
        : (
        <Panel>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH}>Date</th>
                <th style={TH}>Time</th>
                {COLD_COLS.map(c => <th key={c.key} style={TH}>{c.label}</th>)}
                <th style={TH}>By</th>
                <th style={TH}>Notes</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.id}>
                  <td style={TD}>{r.recorded_date}</td>
                  <td style={TD}>{r.recorded_time?.slice(0, 5) ?? '—'}</td>
                  {COLD_COLS.map(c => {
                    const v = r[c.key] as number | null
                    const bad = v !== null && v > c.max
                    return (
                      <td key={c.key} style={{ ...TD, color: bad ? C.red : C.cream, fontWeight: bad ? 700 : 400 }}>
                        {v === null ? '—' : `${v}°`}
                      </td>
                    )
                  })}
                  <td style={TD}>{r.initials || '—'}</td>
                  <td style={{ ...TD, whiteSpace: 'normal', color: C.lightBrown }}>{r.notes || ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
      )}
    </>
  )
}

interface HarvestRow {
  carcass_tag: string; species: string; sex: string
  live_weight_lbs: number | null; hot_carcass_weight_lbs: number | null; yield_pct: number | null
  inspector_initials: string | null; intervention_applied: boolean; intervention_type: string | null
  intervention_temp_f: number | null; final_carcass_temp_f: number | null
  ccp_pass: boolean; performed_by: string | null; status: string; notes: string | null
}
interface ChillRow {
  carcass_tag: string; checked_at: string
  carcass_temp_f: number | null; cooler_temp_f: number | null; checked_by: string | null
}

function KillDayView() {
  const [date,    setDate]    = useState(isoDate(new Date()))
  const [harvest, setHarvest] = useState<HarvestRow[]>([])
  const [chill,   setChill]   = useState<ChillRow[]>([])
  const [loading, setLoading] = useState(false)
  const [loaded,  setLoaded]  = useState(false)

  const load = useCallback(async (d: string) => {
    setLoading(true)
    const res = await fetch(`/api/inspector/records?view=kill-day&date=${d}`)
    const data = res.ok ? await res.json() : { harvest: [], chill: [] }
    setHarvest(data.harvest ?? [])
    setChill(data.chill ?? [])
    setLoading(false)
    setLoaded(true)
  }, [])

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.75rem', marginBottom: '1.25rem', flexWrap: 'wrap' }}>
        <div>
          <label style={LABEL}>Kill day</label>
          <input type="date" value={date} onChange={e => { setDate(e.target.value); setLoaded(false) }} style={{ ...INPUT, width: 180 }} />
        </div>
        <button onClick={() => load(date)} disabled={loading} style={{
          background: C.tan, color: C.dark, border: 'none', borderRadius: 3,
          padding: '0.6rem 1.3rem', fontSize: '0.85rem', fontWeight: 700, cursor: 'pointer',
        }}>{loading ? 'Loading…' : 'View records'}</button>
      </div>

      {loaded && harvest.length === 0 && (
        <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>No carcasses logged on this date.</p>
      )}

      {harvest.length > 0 && (
        <>
          <h2 style={SECTION_H}>Harvest Floor · CCP · {harvest.length} carcass{harvest.length !== 1 ? 'es' : ''}</h2>
          <Panel>
            <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0 }}>
              <thead>
                <tr>
                  {['Tag', 'Species', 'Sex', 'Live lb', 'HCW lb', 'Yield', 'Intervention', 'Final °F', 'CCP', 'By'].map(h => (
                    <th key={h} style={TH}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {harvest.map(h => (
                  <tr key={h.carcass_tag}>
                    <td style={{ ...TD, fontWeight: 600 }}>{h.carcass_tag}</td>
                    <td style={TD}>{h.species}</td>
                    <td style={TD}>{h.sex}</td>
                    <td style={TD}>{h.live_weight_lbs ?? '—'}</td>
                    <td style={TD}>{h.hot_carcass_weight_lbs ?? '—'}</td>
                    <td style={TD}>{h.yield_pct != null ? `${h.yield_pct}%` : '—'}</td>
                    <td style={TD}>
                      {h.intervention_applied
                        ? `${h.intervention_type ?? 'applied'}${h.intervention_temp_f != null ? ` · ${h.intervention_temp_f}°` : ''}`
                        : '—'}
                    </td>
                    <td style={TD}>{h.final_carcass_temp_f != null ? `${h.final_carcass_temp_f}°` : '—'}</td>
                    <td style={{ ...TD, color: h.ccp_pass ? C.green : C.red, fontWeight: 700 }}>
                      {h.ccp_pass ? 'Pass' : 'Fail'}
                    </td>
                    <td style={TD}>{h.performed_by || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Panel>

          <h2 style={{ ...SECTION_H, marginTop: '1.75rem' }}>
            Carcass Chilling · Form 6b · {chill.length} reading{chill.length !== 1 ? 's' : ''}
          </h2>
          {chill.length === 0
            ? <p style={{ color: C.lightBrown, fontSize: '0.85rem' }}>No chill readings recorded for these carcasses yet.</p>
            : (
              <Panel>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <thead>
                    <tr>{['Tag', 'Checked', 'Carcass °F', 'Cooler °F', 'By'].map(h => <th key={h} style={TH}>{h}</th>)}</tr>
                  </thead>
                  <tbody>
                    {chill.map((c, i) => (
                      <tr key={`${c.carcass_tag}-${i}`}>
                        <td style={{ ...TD, fontWeight: 600 }}>{c.carcass_tag}</td>
                        <td style={TD}>{new Date(c.checked_at).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</td>
                        <td style={TD}>{c.carcass_temp_f != null ? `${c.carcass_temp_f}°` : '—'}</td>
                        <td style={TD}>{c.cooler_temp_f != null ? `${c.cooler_temp_f}°` : '—'}</td>
                        <td style={TD}>{c.checked_by || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            )}
        </>
      )}
    </>
  )
}
