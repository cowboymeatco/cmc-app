'use client'
import { useEffect, useState } from 'react'
import Link from 'next/link'

// Who is actually on portal.cowboymeats.com. Built because nothing in the app
// answered "how many people are even on there" (Charlie, 2026-08-04).
//
// The number that matters isn't accounts — it's how far each one got. Signing
// up, signing in, finishing a profile and actually doing something are four
// different things, and the gaps between them are where the portal is losing
// people.

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
}
const GREEN = '#3E9D63'
const WARN  = '#FAB219'
const COST  = '#CE6A20'

type Stage = 'active' | 'dormant' | 'setup' | 'never'

interface PortalUser {
  id: string; email: string; signed_up: string; last_seen: string | null
  name: string | null; role: string | null; stage: Stage
  animals: number; cut_cards: number
}
interface Payload {
  users: PortalUser[]
  totals: {
    accounts: number; active: number; dormant: number; setup: number; never: number
    outside: number; animals: number; cut_cards: number
  }
  signups: { week: string; n: number }[]
}

const STAGE: Record<Stage, { label: string; color: string; note: string }> = {
  active:  { label: 'Active',       color: GREEN,          note: 'signed in within a fortnight' },
  dormant: { label: 'Gone quiet',   color: C.tan,          note: 'signed in, but not lately' },
  setup:   { label: 'Stuck',        color: WARN,           note: 'signed in, never finished a profile' },
  never:   { label: 'Never signed in', color: COST,        note: 'made an account and never came back' },
}

const fmtDate = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' }) : '—'

function Tile({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: string }) {
  return (
    <div style={{
      background: C.dark, border: '1px solid rgba(166,120,90,0.18)',
      borderLeft: accent ? `4px solid ${accent}` : '1px solid rgba(166,120,90,0.18)',
      borderRadius: 4, padding: '1rem 1.25rem', flex: '1 1 150px', minWidth: 140,
    }}>
      <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.35rem' }}>{label}</div>
      <div style={{ fontSize: '1.9rem', fontWeight: 600, color: C.cream, lineHeight: 1 }}>{value}</div>
      {sub && <div style={{ fontSize: '0.7rem', color: C.lightBrown, marginTop: '0.35rem' }}>{sub}</div>}
    </div>
  )
}

export default function PortalUsersPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch('/api/portal-users')
      .then(r => r.json())
      .then(d => d?.error ? setError(d.error) : setData(d))
      .catch(e => setError(String(e)))
  }, [])

  const t = data?.totals
  const maxWeek = Math.max(1, ...(data?.signups ?? []).map(s => s.n))

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Portal Users</h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.12em', textTransform: 'uppercase', margin: 0 }}>portal.cowboymeats.com · who signed up, who came back</p>
        </div>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 1200, margin: '0 auto', boxSizing: 'border-box' }}>
        {error && (
          <div style={{ background: C.dark, border: '1px solid #E8883A', borderRadius: 4, padding: '1rem', color: '#E8883A', fontSize: '0.85rem' }}>{error}</div>
        )}
        {!data && !error && <div style={{ color: C.lightBrown, fontSize: '0.85rem' }}>Loading…</div>}

        {data && t && (
          <>
            <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
              <Tile label="Accounts" value={String(t.accounts)} sub={`${t.outside} outside the business`} />
              <Tile label="Active" value={String(t.active)} accent={GREEN} sub="signed in this fortnight" />
              <Tile label="Gone quiet" value={String(t.dormant)} sub="signed in, not lately" />
              <Tile label="Stuck at setup" value={String(t.setup)} accent={WARN} sub="no profile finished" />
              <Tile label="Never signed in" value={String(t.never)} accent={COST} sub="account made, never used" />
            </div>

            {/* The funnel, stated plainly. Each step is a count of people who got
                at least that far, so the drop between bars is the loss. */}
            <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
              <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>How far people get</div>
              {([
                ['Made an account', t.accounts, C.tan],
                ['Signed in at least once', t.accounts - t.never, C.tan],
                ['Finished a profile', t.accounts - t.never - t.setup, GREEN],
                ['Filed a cut sheet through it', t.cut_cards, t.cut_cards ? GREEN : COST],
                ['Booked an animal through it', t.animals, t.animals ? GREEN : COST],
              ] as [string, number, string][]).map(([label, n, color]) => (
                <div key={label} style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '0.4rem' }}>
                  <div style={{ width: 190, fontSize: '0.78rem', color: C.tan, flexShrink: 0 }}>{label}</div>
                  <div style={{ flex: 1, background: 'rgba(166,120,90,0.12)', borderRadius: 3, height: 20, position: 'relative' }}>
                    <div style={{ width: `${(n / Math.max(1, t.accounts)) * 100}%`, background: color, height: '100%', borderRadius: 3, minWidth: n ? 2 : 0 }} />
                  </div>
                  <div style={{ width: 30, textAlign: 'right', fontWeight: 700, color: C.cream, fontSize: '0.9rem' }}>{n}</div>
                </div>
              ))}
            </div>

            {data.signups.length > 1 && (
              <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '1rem 1.25rem', marginBottom: '1rem' }}>
                <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.75rem' }}>Signups by week</div>
                <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 90 }}>
                  {data.signups.map(s => (
                    <div key={s.week} style={{ flex: 1, textAlign: 'center', minWidth: 0 }} title={`Week of ${s.week} — ${s.n} signup${s.n === 1 ? '' : 's'}`}>
                      <div style={{ background: C.medBrown, height: `${(s.n / maxWeek) * 62}px`, borderRadius: '2px 2px 0 0' }} />
                      <div style={{ fontSize: '0.6rem', color: C.lightBrown, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {new Date(s.week + 'T12:00:00').toLocaleDateString('en-US', { month: 'numeric', day: 'numeric' })}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.82rem', color: C.tan }}>
                <thead>
                  <tr style={{ color: C.lightBrown, textTransform: 'uppercase', fontSize: '0.64rem', letterSpacing: '0.08em', borderBottom: '1px solid rgba(166,120,90,0.2)' }}>
                    {['Person', 'Email', 'Role', 'Signed up', 'Last seen', 'Animals', 'Cut cards', ''].map(h => (
                      <th key={h} style={{ textAlign: h === 'Animals' || h === 'Cut cards' ? 'right' : 'left', padding: '0.6rem 0.75rem', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.users.map(u => {
                    const s = STAGE[u.stage]
                    return (
                      <tr key={u.id} style={{ borderTop: '1px solid rgba(166,120,90,0.1)' }}>
                        <td style={{ padding: '0.55rem 0.75rem', color: C.cream, fontWeight: 600 }}>{u.name ?? <span style={{ color: C.lightBrown, fontWeight: 400, fontStyle: 'italic' }}>no profile yet</span>}</td>
                        <td style={{ padding: '0.55rem 0.75rem', color: C.lightBrown }}>{u.email}</td>
                        <td style={{ padding: '0.55rem 0.75rem' }}>{u.role ?? '—'}</td>
                        <td style={{ padding: '0.55rem 0.75rem' }}>{fmtDate(u.signed_up)}</td>
                        <td style={{ padding: '0.55rem 0.75rem' }}>{fmtDate(u.last_seen)}</td>
                        <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', color: u.animals ? C.cream : 'rgba(166,120,90,0.4)' }}>{u.animals || '—'}</td>
                        <td style={{ padding: '0.55rem 0.75rem', textAlign: 'right', color: u.cut_cards ? C.cream : 'rgba(166,120,90,0.4)' }}>{u.cut_cards || '—'}</td>
                        <td style={{ padding: '0.55rem 0.75rem', whiteSpace: 'nowrap' }}>
                          <span title={s.note} style={{ color: s.color, fontSize: '0.7rem', fontWeight: 700, border: `1px solid ${s.color}55`, borderRadius: 3, padding: '2px 6px' }}>{s.label}</span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.6rem', lineHeight: 1.6 }}>
              Animals counts harvest appointments booked under that person as producer. Cut cards counts cutting instructions filed
              <strong> through the portal</strong> — cards they filled in on the public form don&apos;t count here, and nothing submitted
              before 4 Aug 2026 does either, because until then the two doors were indistinguishable. Both columns key to the
              customer record, so anyone still stuck at setup reads as blank — the honest answer for an account that never finished.
            </div>
          </>
        )}
        <div style={{ height: '3rem' }} />
      </main>
    </div>
  )
}
