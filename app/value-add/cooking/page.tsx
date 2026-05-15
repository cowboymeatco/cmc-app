'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import { CookSession, CookReading } from '@/lib/types'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#EF4444',
  amber:      '#F59E0B',
}

const INPUT: React.CSSProperties = {
  width: '100%', background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.45rem 0.6rem', color: C.cream, fontSize: '0.88rem', outline: 'none',
  boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.3rem',
}
const BTN = (bg: string, fg = C.dark): React.CSSProperties => ({
  background: bg, color: fg, border: 'none', borderRadius: 3,
  padding: '0.55rem 1.2rem', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer',
})
const CARD: React.CSSProperties = {
  background: C.darkBrown, border: `1px solid rgba(166,120,90,0.25)`,
  borderRadius: 4, padding: '1.25rem',
}

function fmt(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true,
  })
}
function elapsed(start: string, end?: string | null) {
  const ms = new Date(end ?? Date.now()).getTime() - new Date(start).getTime()
  const h  = Math.floor(ms / 3600000)
  const m  = Math.floor((ms % 3600000) / 60000)
  return h > 0 ? `${h}h ${m}m` : `${m}m`
}
function tempColor(f: number | null) {
  if (f === null) return C.lightBrown
  if (f >= 145)  return C.green
  if (f >= 100)  return C.amber
  return C.cream
}

// ── Mini temp chart (SVG sparkline) ──────────────────────────────────────────
function Sparkline({ readings, channel }: { readings: CookReading[]; channel: number }) {
  const pts = readings.filter(r => r.channel === channel && r.temp_f !== null)
  if (pts.length < 2) return null

  const W = 260, H = 56
  const temps  = pts.map(r => r.temp_f as number)
  const minT   = Math.min(...temps)
  const maxT   = Math.max(...temps)
  const range  = maxT - minT || 1

  const x = (i: number) => (i / (pts.length - 1)) * W
  const y = (t: number)  => H - ((t - minT) / range) * (H - 8) - 4

  const path = pts.map((r, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(r.temp_f as number).toFixed(1)}`).join(' ')

  return (
    <svg width={W} height={H} style={{ display: 'block' }}>
      <polyline points={pts.map((r, i) => `${x(i).toFixed(1)},${y(r.temp_f as number).toFixed(1)}`).join(' ')}
        fill="none" stroke={C.amber} strokeWidth="1.5" strokeLinejoin="round" />
      {/* last point dot */}
      <circle cx={x(pts.length - 1)} cy={y(temps[temps.length - 1])} r="3" fill={C.amber} />
    </svg>
  )
}

// ── Channel badge in active session ──────────────────────────────────────────
function ChannelCard({ label, readings }: { label: string; readings: CookReading[] }) {
  const latest = readings[readings.length - 1]
  const temp   = latest?.temp_f ?? null
  const ch     = latest?.channel ?? 0
  return (
    <div style={{ ...CARD, minWidth: 160, flex: '1 1 160px' }}>
      <div style={{ fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.4rem' }}>
        {label}
      </div>
      <div style={{ fontSize: '2rem', fontWeight: 700, color: tempColor(temp), letterSpacing: '-0.02em', marginBottom: '0.5rem' }}>
        {temp !== null ? `${temp}°F` : '—'}
      </div>
      <Sparkline readings={readings} channel={ch} />
      {latest && (
        <div style={{ fontSize: '0.68rem', color: C.lightBrown, marginTop: '0.4rem' }}>
          Last read {fmt(latest.read_at)}
        </div>
      )}
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CookingPage() {
  const [sessions,       setSessions]       = useState<CookSession[]>([])
  const [readings,       setReadings]       = useState<CookReading[]>([])
  const [recentReadings, setRecentReadings] = useState<CookReading[]>([])
  const [selected,       setSelected]       = useState<CookSession | null>(null)
  const [loading,        setLoading]        = useState(true)
  const [showForm,       setShowForm]       = useState(false)
  const [saving,         setSaving]         = useState(false)
  const [ending,         setEnding]         = useState(false)

  // New session form state
  const [form, setForm] = useState({
    session_name:  '',
    product:       '',
    target_temp_f: '',
    notes:         '',
  })

  // ── Data fetching ────────────────────────────────────────────────────────
  const loadSessions = useCallback(async () => {
    const res = await fetch('/api/cook-session?limit=30')
    if (res.ok) {
      const data: CookSession[] = await res.json()
      setSessions(data)
      // Auto-select first active session
      const active = data.find(s => s.status === 'active')
      if (active && !selected) setSelected(active)
    }
    setLoading(false)
  }, [selected])

  const loadReadings = useCallback(async (sessionId: string) => {
    const res = await fetch(`/api/cook-reading?session_id=${sessionId}&limit=500`)
    if (res.ok) setReadings(await res.json())
  }, [])

  const loadRecentReadings = useCallback(async () => {
    const res = await fetch('/api/cook-reading?limit=100')
    if (res.ok) setRecentReadings(await res.json())
  }, [])

  useEffect(() => { loadSessions(); loadRecentReadings() }, [])

  useEffect(() => {
    if (selected) loadReadings(selected.id)
    else setReadings([])
  }, [selected, loadReadings])

  // Auto-refresh every 3 min
  useEffect(() => {
    const id = setInterval(() => {
      loadRecentReadings()
      if (selected?.status === 'active') loadReadings(selected.id)
    }, 3 * 60 * 1000)
    return () => clearInterval(id)
  }, [selected, loadReadings, loadRecentReadings])

  // ── Start session ────────────────────────────────────────────────────────
  async function startSession() {
    if (!form.session_name.trim()) return
    setSaving(true)
    const res = await fetch('/api/cook-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_name:  form.session_name.trim(),
        product:       form.product.trim()       || null,
        target_temp_f: form.target_temp_f        ? parseFloat(form.target_temp_f) : null,
        notes:         form.notes.trim()         || null,
      }),
    })
    if (res.ok) {
      const session: CookSession = await res.json()
      setSessions(prev => [session, ...prev])
      setSelected(session)
      setShowForm(false)
      setForm({ session_name: '', product: '', target_temp_f: '', notes: '' })
    }
    setSaving(false)
  }

  // ── End session ──────────────────────────────────────────────────────────
  async function endSession() {
    if (!selected) return
    setEnding(true)
    const res = await fetch(`/api/cook-session?id=${selected.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: 'complete', ended_at: new Date().toISOString() }),
    })
    if (res.ok) {
      const updated: CookSession = await res.json()
      setSessions(prev => prev.map(s => s.id === updated.id ? updated : s))
      setSelected(updated)
    }
    setEnding(false)
  }

  // ── Derived channel list from readings ───────────────────────────────────
  const channels = Array.from(
    new Map(readings.map(r => [r.channel, r.channel_label ?? `Ch${r.channel}`])).entries()
  ).sort((a, b) => a[0] - b[0])

  // Latest reading per channel across all recent data (for live panel)
  const latestByChannel = Array.from(
    new Map(
      [...recentReadings]
        .sort((a, b) => new Date(a.read_at).getTime() - new Date(b.read_at).getTime())
        .map(r => [r.channel, r])
    ).entries()
  ).sort((a, b) => a[0] - b[0])

  const activeSession = sessions.find(s => s.status === 'active') ?? null

  // ── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight: '100vh', background: C.dark, color: C.cream, fontFamily: 'system-ui, sans-serif', padding: '1.5rem' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1.75rem' }}>
        <Link href="/value-add" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.85rem' }}>
          ← Value Add
        </Link>
        <h1 style={{ margin: 0, fontSize: '1.25rem', fontWeight: 700, letterSpacing: '0.04em', color: C.cream }}>
          Cook / Smoke Log
        </h1>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <span style={{ fontSize: '0.72rem', color: C.lightBrown }}>
            Auto-synced from ThermoWorks every 30 min
          </span>
          {!activeSession && (
            <button style={BTN(C.medBrown, C.cream)} onClick={() => setShowForm(v => !v)}>
              + New Session
            </button>
          )}
        </div>
      </div>

      {/* New session form */}
      {showForm && (
        <div style={{ ...CARD, marginBottom: '1.5rem', maxWidth: 560 }}>
          <div style={{ fontWeight: 600, marginBottom: '1rem', color: C.tan }}>Start Cook Session</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <div>
              <label style={LABEL}>Session Name *</label>
              <input style={INPUT} placeholder="e.g. Brisket Smoke 5/10"
                value={form.session_name} onChange={e => setForm(p => ({ ...p, session_name: e.target.value }))} />
            </div>
            <div>
              <label style={LABEL}>Product</label>
              <input style={INPUT} placeholder="e.g. Beef Brisket"
                value={form.product} onChange={e => setForm(p => ({ ...p, product: e.target.value }))} />
            </div>
            <div>
              <label style={LABEL}>Target Internal Temp (°F)</label>
              <input style={INPUT} type="number" placeholder="e.g. 203"
                value={form.target_temp_f} onChange={e => setForm(p => ({ ...p, target_temp_f: e.target.value }))} />
            </div>
            <div>
              <label style={LABEL}>Notes</label>
              <input style={INPUT} placeholder="Optional"
                value={form.notes} onChange={e => setForm(p => ({ ...p, notes: e.target.value }))} />
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button style={BTN(C.green)} onClick={startSession} disabled={saving}>
              {saving ? 'Starting…' : 'Start Session'}
            </button>
            <button style={BTN('rgba(255,255,255,0.08)', C.cream)} onClick={() => setShowForm(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {loading && (
        <div style={{ color: C.lightBrown, fontSize: '0.9rem' }}>Loading…</div>
      )}

      {/* Latest probe readings — always visible */}
      {latestByChannel.length > 0 && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 600, color: C.tan, textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: '0.75rem' }}>
            Latest Readings
            <span style={{ fontWeight: 400, color: C.lightBrown, marginLeft: '0.75rem', textTransform: 'none', letterSpacing: 0 }}>
              {fmt(latestByChannel[0][1].read_at)}
            </span>
            <button
              style={{ background: 'none', border: 'none', color: C.tan, cursor: 'pointer', fontSize: '0.7rem', marginLeft: '0.75rem', textDecoration: 'underline' }}
              onClick={loadRecentReadings}
            >
              Refresh
            </button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
            {latestByChannel.map(([ch, r]) => (
              <ChannelCard key={ch} label={r.channel_label ?? `Ch${ch}`}
                readings={recentReadings.filter(x => x.channel === ch)} />
            ))}
          </div>
        </div>
      )}

      {/* Active session panel */}
      {activeSession && (
        <div style={{ marginBottom: '2rem' }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.75rem' }}>
            <span style={{ fontSize: '0.7rem', background: C.green, color: C.dark, borderRadius: 2, padding: '0.15rem 0.5rem', fontWeight: 700, letterSpacing: '0.06em' }}>
              ACTIVE
            </span>
            <span style={{ fontWeight: 600, color: C.tan }}>{activeSession.session_name}</span>
            {activeSession.product && (
              <span style={{ color: C.lightBrown, fontSize: '0.85rem' }}>{activeSession.product}</span>
            )}
            <span style={{ color: C.lightBrown, fontSize: '0.8rem', marginLeft: 'auto' }}>
              Started {fmt(activeSession.started_at)} · {elapsed(activeSession.started_at)}
            </span>
            {activeSession.target_temp_f && (
              <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>
                Target: {activeSession.target_temp_f}°F
              </span>
            )}
            <button style={BTN(C.red, C.cream)} onClick={endSession} disabled={ending}>
              {ending ? 'Ending…' : 'End Session'}
            </button>
          </div>

          {channels.length === 0 ? (
            <div style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '1rem 0' }}>
              No readings yet — ThermoWorks sync runs every 30 min.{' '}
              <button style={{ background: 'none', border: 'none', color: C.tan, cursor: 'pointer', textDecoration: 'underline', fontSize: '0.85rem' }}
                onClick={() => loadReadings(activeSession.id)}>
                Refresh
              </button>
            </div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.75rem' }}>
              {channels.map(([ch, label]) => (
                <ChannelCard key={ch} label={label}
                  readings={readings.filter(r => r.channel === ch)} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* Session list */}
      <div style={{ marginBottom: '1rem', display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <span style={{ fontSize: '0.8rem', fontWeight: 600, color: C.tan, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
          Session History
        </span>
        {activeSession && (
          <button style={BTN(C.medBrown, C.cream)} onClick={() => setShowForm(v => !v)}>
            + New Session
          </button>
        )}
      </div>

      {sessions.length === 0 && !loading && (
        <div style={{ color: C.lightBrown, fontSize: '0.88rem' }}>No sessions yet.</div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
        {sessions.map(s => {
          const isSelected = selected?.id === s.id
          const sessionReadings = s.id === selected?.id ? readings : []
          const chCount = new Set(sessionReadings.map(r => r.channel)).size

          return (
            <div key={s.id}
              onClick={() => { setSelected(s); if (s.id !== selected?.id) loadReadings(s.id) }}
              style={{
                ...CARD,
                cursor: 'pointer',
                borderColor: isSelected ? C.tan : 'rgba(166,120,90,0.25)',
                transition: 'border-color 0.15s',
              }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', flexWrap: 'wrap' }}>
                <span style={{
                  fontSize: '0.65rem', borderRadius: 2, padding: '0.1rem 0.45rem',
                  fontWeight: 700, letterSpacing: '0.06em',
                  background: s.status === 'active' ? C.green : 'rgba(255,255,255,0.1)',
                  color: s.status === 'active' ? C.dark : C.lightBrown,
                }}>
                  {s.status.toUpperCase()}
                </span>
                <span style={{ fontWeight: 600 }}>{s.session_name}</span>
                {s.product && <span style={{ color: C.lightBrown, fontSize: '0.85rem' }}>{s.product}</span>}
                <span style={{ marginLeft: 'auto', fontSize: '0.78rem', color: C.lightBrown }}>
                  {fmt(s.started_at)}
                  {s.ended_at ? ` → ${fmt(s.ended_at)} (${elapsed(s.started_at, s.ended_at)})` : ` · ${elapsed(s.started_at)} elapsed`}
                </span>
                {s.target_temp_f && (
                  <span style={{ fontSize: '0.78rem', color: C.lightBrown }}>Target {s.target_temp_f}°F</span>
                )}
              </div>

              {/* Expanded reading table */}
              {isSelected && readings.length > 0 && (
                <div style={{ marginTop: '1rem', overflowX: 'auto' }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: 'left', color: C.lightBrown, paddingBottom: '0.4rem', fontWeight: 500 }}>Time</th>
                        {channels.map(([ch, label]) => (
                          <th key={ch} style={{ textAlign: 'right', color: C.lightBrown, paddingBottom: '0.4rem', fontWeight: 500, paddingLeft: '1rem' }}>
                            {label}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {Array.from(
                        new Map(
                          readings.map(r => [r.read_at, r])
                        ).keys()
                      ).sort().reverse().slice(0, 50).map(ts => {
                        const row = readings.filter(r => r.read_at === ts)
                        return (
                          <tr key={ts} style={{ borderTop: '1px solid rgba(166,120,90,0.12)' }}>
                            <td style={{ padding: '0.35rem 0', color: C.lightBrown }}>{fmt(ts)}</td>
                            {channels.map(([ch]) => {
                              const r = row.find(x => x.channel === ch)
                              const t = r?.temp_f ?? null
                              return (
                                <td key={ch} style={{ textAlign: 'right', paddingLeft: '1rem', color: tempColor(t), fontWeight: t !== null ? 600 : 400 }}>
                                  {t !== null ? `${t}°F` : '—'}
                                </td>
                              )
                            })}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                  {readings.length > 50 && (
                    <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.5rem' }}>
                      Showing 50 most recent of {readings.length} readings
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
