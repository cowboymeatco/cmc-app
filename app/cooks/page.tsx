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

interface RhFault {
  stuck_value: number; stuck_samples: number
  stuck_started_at: string; mean_abs_rh_err: number
}
interface Cook {
  id: string; started_at: string | null; ended_at: string | null
  hours: number | null; profile_key: string | null; recipe: string | null; operator: string | null
  rh_fault: RhFault | null
}
interface Profile { profile_key: string; display_name: string }

interface Alarm {
  id: string; raised_at: string; cleared_at: string | null
  code: string | null; message: string | null
  severity: string | null; channel: string | null
  value_f: number | null; setpoint_f: number | null
  cook_id: string | null; cook_file: string | null
}
interface AlarmFeed {
  everImported: boolean; total: number; faults: number; comms: number
  byChannel: Record<string, number>; byCook: Record<string, number>
  alarms: Alarm[]
}

const CHANNEL_LABEL: Record<string, string> = {
  wet_bulb: 'Wet bulb', dry_bulb: 'Dry bulb', rh: 'Humidity',
  core: 'Product core', damper: 'Damper', other: 'Other',
}

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
  const [alarms, setAlarms] = useState<AlarmFeed | null>(null)
  const [openAlarms, setOpenAlarms] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    Promise.all([
      fetch('/api/cooks?days=60').then(r => r.json()),
      fetch('/api/cook-profile').then(r => r.json()),
      // Alarm log is optional — it only has data once alarm_import.py is running
      // on the kiosk, so a failure here must not take the tagging page down.
      fetch('/api/smokehouse-alarms?days=60').then(r => r.json()).catch(() => null),
    ]).then(([c, p, a]) => {
      if (cancelled) return
      setCooks(Array.isArray(c?.cooks) ? c.cooks : [])
      setProfiles(Array.isArray(p?.profiles) ? p.profiles.map((x: Profile) => ({ profile_key: x.profile_key, display_name: x.display_name })) : [])
      setAlarms(a && Array.isArray(a.alarms) ? a as AlarmFeed : null)
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

  // Sensor faults only. Routine events would drown the signal, and 'comms'
  // (FTP/network/email) is plumbing — every wet bulb alarm is trailed by an
  // "Email Error" because the controller tries to mail it and fails, which
  // would double every cook's badge for no reason.
  const isSensorFault = (a: Alarm) =>
    (a.severity === 'alarm' || a.severity === 'warning') && a.channel !== 'comms'

  const alarmsByCook = useMemo(() => {
    const map = new Map<string, Alarm[]>()
    for (const a of alarms?.alarms ?? []) {
      if (!a.cook_id) continue
      if (!isSensorFault(a)) continue
      const list = map.get(a.cook_id)
      if (list) list.push(a); else map.set(a.cook_id, [a])
    }
    // The feed is newest-first, but inside a single cook you read the alarms
    // forward to follow how it went wrong.
    for (const list of map.values()) list.sort((x, y) => x.raised_at.localeCompare(y.raised_at))
    return map
  }, [alarms])

  const channelRanking = useMemo(() =>
    Object.entries(alarms?.byChannel ?? {}).sort((a, b) => b[1] - a[1]),
    [alarms])

  const unlinkedFaults = useMemo(() =>
    (alarms?.alarms ?? []).filter(a => !a.cook_id && isSensorFault(a)).length,
    [alarms])

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
        {/* Controller alarm log. Empty until alarm_import.py runs on the kiosk —
            say so plainly rather than showing a convincing-looking zero. */}
        <section style={{
          background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 6,
          padding: '0.9rem 1rem', marginBottom: '1rem',
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.6rem', flexWrap: 'wrap' }}>
            <span style={{ color: C.cream, fontSize: '0.82rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
              Controller alarms
            </span>
            <span style={{ color: C.lightBrown, fontSize: '0.72rem' }}>last 60 days</span>
          </div>

          {!alarms || !alarms.everImported ? (
            <p style={{ color: C.lightBrown, fontSize: '0.75rem', margin: '0.5rem 0 0', lineHeight: 1.6 }}>
              No alarm log imported yet. Run <code style={{ color: C.tan }}>alarm_import.py</code> on the
              packaging kiosk to start feeding it.
            </p>
          ) : alarms.faults === 0 ? (
            <p style={{ color: C.lightBrown, fontSize: '0.75rem', margin: '0.5rem 0 0' }}>
              {alarms.total > 0 ? `${alarms.total} events logged, none of them faults.` : 'No alarms logged.'}
            </p>
          ) : (
            <>
              <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.6rem' }}>
                {channelRanking.map(([ch, n], i) => (
                  <div key={ch} style={{
                    background: i === 0 ? 'rgba(251,146,60,0.14)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${i === 0 ? 'rgba(251,146,60,0.45)' : 'rgba(166,120,90,0.25)'}`,
                    borderRadius: 4, padding: '0.35rem 0.7rem',
                  }}>
                    <div style={{ color: i === 0 ? C.orange : C.cream, fontSize: '1rem', fontWeight: 700, lineHeight: 1.1 }}>{n}</div>
                    <div style={{ color: C.lightBrown, fontSize: '0.66rem', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      {CHANNEL_LABEL[ch] ?? ch}
                    </div>
                  </div>
                ))}
              </div>
              <p style={{ color: C.lightBrown, fontSize: '0.72rem', margin: '0.6rem 0 0', lineHeight: 1.6 }}>
                {alarms.faults} sensor faults across {alarms.total} logged events.
                {unlinkedFaults > 0 && ` ${unlinkedFaults} fell outside any cook (idle house).`}
                {alarms.comms > 0 && ` ${alarms.comms} network/FTP warnings counted separately.`}
                {channelRanking.length > 0 && channelRanking[0][1] >= alarms.faults * 0.5 && (
                  <> One channel — <strong style={{ color: C.orange }}>{CHANNEL_LABEL[channelRanking[0][0]] ?? channelRanking[0][0]}</strong> — is
                  raising most of them, which points at that sensor rather than the process.</>
                )}
              </p>
            </>
          )}
        </section>

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
            {shown.map((c, i) => {
              const cookAlarms = alarmsByCook.get(c.id) ?? []
              return (
              <div key={c.id} style={{ borderTop: i === 0 ? 'none' : '1px solid rgba(166,120,90,0.1)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '1rem', padding: '0.7rem 1rem',
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
                {c.rh_fault && (
                  <span
                    title={`Humidity read exactly ${c.rh_fault.stuck_value}% for ${c.rh_fault.stuck_samples} straight readings (~${Math.round(c.rh_fault.stuck_samples / 60 * 10) / 10}h) while humidity control was active. A working sensor jitters; this one stopped moving.`}
                    style={{
                      background: 'rgba(239,68,68,0.14)', border: '1px solid rgba(239,68,68,0.5)',
                      borderRadius: 4, padding: '0.25rem 0.55rem', color: '#F87171',
                      fontSize: '0.7rem', fontWeight: 700, whiteSpace: 'nowrap', cursor: 'help',
                    }}
                  >RH stuck {c.rh_fault.stuck_value}%</span>
                )}
                {cookAlarms.length > 0 && (
                  <button
                    onClick={() => setOpenAlarms(prev => prev === c.id ? null : c.id)}
                    title={`${cookAlarms.length} alarm${cookAlarms.length === 1 ? '' : 's'} during this cook`}
                    style={{
                      background: 'rgba(251,146,60,0.14)', border: '1px solid rgba(251,146,60,0.45)',
                      borderRadius: 4, padding: '0.25rem 0.55rem', color: C.orange,
                      fontSize: '0.72rem', fontWeight: 700, cursor: 'pointer', whiteSpace: 'nowrap',
                    }}
                  >⚠ {cookAlarms.length} {openAlarms === c.id ? '▴' : '▾'}</button>
                )}
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

              {openAlarms === c.id && (
                <div style={{ padding: '0 1rem 0.8rem 2.1rem', background: 'rgba(0,0,0,0.18)' }}>
                  {cookAlarms.map(a => (
                    <div key={a.id} style={{
                      display: 'flex', gap: '0.7rem', alignItems: 'baseline',
                      padding: '0.3rem 0', fontSize: '0.75rem', borderBottom: '1px solid rgba(166,120,90,0.08)',
                    }}>
                      <span style={{ color: C.lightBrown, minWidth: 62, fontVariantNumeric: 'tabular-nums' }}>
                        {new Date(a.raised_at).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' })}
                      </span>
                      <span style={{
                        color: a.channel === 'wet_bulb' ? C.orange : C.tan,
                        minWidth: 82, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.05em',
                      }}>{CHANNEL_LABEL[a.channel ?? 'other'] ?? a.channel}</span>
                      <span style={{ color: C.cream, flex: 1 }}>{a.message ?? a.code ?? '—'}</span>
                      {a.value_f != null && (
                        <span style={{ color: C.lightBrown, fontVariantNumeric: 'tabular-nums' }}>
                          {a.value_f}{a.setpoint_f != null ? ` / sp ${a.setpoint_f}` : ''}
                        </span>
                      )}
                      <span style={{ color: a.cleared_at ? C.green : C.orange, fontSize: '0.68rem', minWidth: 54, textAlign: 'right' }}>
                        {a.cleared_at ? 'cleared' : 'open'}
                      </span>
                    </div>
                  ))}
                </div>
              )}
              </div>
              )
            })}
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
