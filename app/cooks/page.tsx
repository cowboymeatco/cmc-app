'use client'
import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  orange:     '#FB923C',
  green:      '#4CAF50',
}

interface Cook {
  id: string; started_at: string | null; ended_at: string | null
  hours: number | null; profile_key: string | null; recipe: string | null; operator: string | null
}
interface Profile { profile_key: string; display_name: string }

const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 4, padding: '0.4rem 0.6rem', color: C.cream, fontSize: '0.85rem', outline: 'none',
}

function fmtWhen(iso: string | null): string {
  if (!iso) return '—'
  const d = new Date(iso)
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) + ' · ' +
         d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })
}

export default function CookTagging() {
  const [cooks, setCooks] = useState<Cook[]>([])
  const [profiles, setProfiles] = useState<Profile[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState<Record<string, boolean>>({})
  const [onlyUntagged, setOnlyUntagged] = useState(false)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/cooks?days=60').then(r => r.json()),
      fetch('/api/cook-profile').then(r => r.json()),
    ]).then(([c, p]) => {
      if (cancelled) return
      setCooks(Array.isArray(c?.cooks) ? c.cooks : [])
      setProfiles(Array.isArray(p?.profiles) ? p.profiles.map((x: Profile) => ({ profile_key: x.profile_key, display_name: x.display_name })) : [])
    }).catch(() => {}).finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [])

  async function tag(cook: Cook, profile_key: string) {
    const recipe = profiles.find(p => p.profile_key === profile_key)?.display_name ?? null
    setCooks(prev => prev.map(c => c.id === cook.id ? { ...c, profile_key: profile_key || null, recipe } : c))
    setSaving(s => ({ ...s, [cook.id]: true }))
    try {
      await fetch('/api/cooks', {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: cook.id, profile_key }),
      })
    } finally {
      setSaving(s => ({ ...s, [cook.id]: false }))
    }
  }

  const shown = useMemo(() => onlyUntagged ? cooks.filter(c => !c.profile_key) : cooks, [cooks, onlyUntagged])
  const tagged = cooks.filter(c => c.profile_key).length

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/calendar" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Calendar</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Cook Tagging</h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>Tag each cook with its recipe — it shows on the calendar</p>
        </div>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 900, margin: '0 auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <span style={{ color: C.tan, fontSize: '0.85rem', fontWeight: 700 }}>{tagged} of {cooks.length} tagged</span>
          <div style={{ flex: 1 }} />
          <button onClick={() => setOnlyUntagged(v => !v)} style={{
            background: onlyUntagged ? C.tan : 'rgba(255,255,255,0.04)', color: onlyUntagged ? C.dark : C.lightBrown,
            border: `1px solid ${onlyUntagged ? C.tan : 'rgba(166,120,90,0.3)'}`, borderRadius: 4,
            padding: '0.4rem 0.9rem', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer',
          }}>{onlyUntagged ? '✓ ' : ''}Untagged only</button>
        </div>

        {loading ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>Loading…</div>
        ) : shown.length === 0 ? (
          <div style={{ padding: '2rem', textAlign: 'center', color: C.lightBrown }}>{onlyUntagged ? 'Every recent cook is tagged. 🎉' : 'No cooks in the last 60 days.'}</div>
        ) : (
          <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 6, overflow: 'hidden' }}>
            {shown.map((c, i) => (
              <div key={c.id} style={{
                display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.7rem 1rem',
                borderTop: i === 0 ? 'none' : '1px solid rgba(166,120,90,0.1)',
                background: c.profile_key ? 'transparent' : 'rgba(251,146,60,0.05)',
              }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.profile_key ? C.green : C.orange, flexShrink: 0 }} />
                <div style={{ minWidth: 170 }}>
                  <div style={{ color: C.cream, fontSize: '0.85rem', fontWeight: 600 }}>{fmtWhen(c.started_at)}</div>
                  <div style={{ color: C.lightBrown, fontSize: '0.72rem' }}>
                    {c.hours != null ? `${c.hours}h` : (c.ended_at ? '—' : 'running')}{c.operator ? ` · ${c.operator}` : ''}
                  </div>
                </div>
                <div style={{ flex: 1 }} />
                <select
                  value={c.profile_key ?? ''}
                  onChange={e => tag(c, e.target.value)}
                  style={{ ...INPUT, minWidth: 190, color: c.profile_key ? C.cream : C.lightBrown }}
                >
                  <option value="">— pick recipe —</option>
                  {profiles.map(p => <option key={p.profile_key} value={p.profile_key} style={{ background: '#2a1d16' }}>{p.display_name}</option>)}
                </select>
                <span style={{ width: 44, fontSize: '0.7rem', color: C.lightBrown, textAlign: 'right' }}>{saving[c.id] ? 'saving…' : c.profile_key ? '✓' : ''}</span>
              </div>
            ))}
          </div>
        )}

        <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.75rem', lineHeight: 1.6 }}>
          Cooks come off the smokehouse controller with no product on them. Tagging one with its recipe puts the name
          (Ham, Bacon, Snack Sticks…) on the <strong style={{ color: C.tan }}>Master Calendar</strong> Smokehouse lane.
          Next step is scheduling planned cooks so the board shows what&apos;s coming, not just what ran.
        </p>
      </main>
    </div>
  )
}
