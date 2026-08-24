'use client'
import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import type { CapacityResponse, CapacitySettings } from '@/app/api/capacity/route'
import { isoDate } from '@/lib/dates'
import { SPECIES_CLR, SPECIES_EMOJI } from '@/lib/cutSchedule'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  yellow:     '#F59E0B',
  red:        '#EF4444',
}


const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.88rem',
  outline: 'none', width: '100%', boxSizing: 'border-box',
}
const BTN = (bg: string, fg = C.dark): React.CSSProperties => ({
  background: bg, color: fg, border: 'none', borderRadius: 3,
  padding: '0.5rem 1.1rem', fontSize: '0.83rem', fontWeight: 600, cursor: 'pointer',
})

function loadColor(days: number, max: number): string {
  const ratio = days / max
  if (ratio >= 1)    return C.red
  if (ratio >= 0.75) return C.yellow
  return C.green
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

// ── Gauge bar ─────────────────────────────────────────────────────────────────
function GaugeBar({ days, max }: { days: number; max: number }) {
  const pct    = Math.min(100, (days / max) * 100)
  const color  = loadColor(days, max)
  const zones  = [
    { label: 'Good',    pct: 75,                bg: 'rgba(76,175,80,0.18)',  end: max * 0.75 },
    { label: 'Caution', pct: 25,                bg: 'rgba(245,158,11,0.18)', end: max },
    { label: 'Over',    pct: 0 /* overflow */,  bg: 'rgba(239,68,68,0.18)', end: max * 1.33 },
  ]
  void zones
  return (
    <div>
      {/* Tick labels */}
      <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 4, fontSize: '0.65rem', color: 'rgba(166,120,90,0.5)' }}>
        <span>0</span>
        <span style={{ color: C.yellow }}>Caution ({Math.round(max * 0.75)}d)</span>
        <span style={{ color: C.red }}>Max ({max}d)</span>
      </div>
      {/* Bar track */}
      <div style={{ position: 'relative', height: 28, background: 'rgba(255,255,255,0.05)', borderRadius: 4, overflow: 'hidden' }}>
        {/* Zone backgrounds */}
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '75%', background: 'rgba(76,175,80,0.1)' }} />
        <div style={{ position: 'absolute', left: '75%', top: 0, bottom: 0, width: '25%', background: 'rgba(245,158,11,0.1)' }} />
        {/* Fill */}
        <div style={{
          position: 'absolute', left: 0, top: 0, bottom: 0,
          width: `${pct}%`,
          background: `linear-gradient(90deg, ${color}99, ${color})`,
          borderRadius: 4,
          transition: 'width 0.5s ease',
        }} />
        {/* Label */}
        <div style={{
          position: 'absolute', inset: 0, display: 'flex', alignItems: 'center',
          justifyContent: 'center', fontWeight: 700, fontSize: '0.9rem',
          color: C.cream, textShadow: '0 1px 3px rgba(0,0,0,0.6)',
        }}>
          {days.toFixed(1)} days on hand
        </div>
      </div>
      {/* Zone labels */}
      <div style={{ display: 'flex', marginTop: 4 }}>
        <div style={{ width: '75%', fontSize: '0.62rem', color: C.green, textAlign: 'center' }}>● Clear</div>
        <div style={{ width: '25%', fontSize: '0.62rem', color: C.yellow, textAlign: 'center' }}>● Caution</div>
      </div>
    </div>
  )
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function CapacityPage() {
  const [data,         setData]         = useState<CapacityResponse | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [savingSettings, setSaving]     = useState(false)
  const [settingsDirty, setDirty]       = useState(false)
  const [settings,     setSettings]     = useState<CapacitySettings>({
    hogs_per_beef: 4, lambs_per_beef: 6, goats_per_beef: 6, beef_eq_per_day: 3, max_cooler_days: 6,
  })

  // Quick-add to cooler
  const today = isoDate()
  const emptyEntry = () => ({ species: 'Beef', carcass_tag: '', producer: '', harvest_date: today, sex: 'Steer', ear_tag: '', hot_carcass_weight_lbs: '', over_30_months: false })
  const [addModal,   setAddModal]   = useState(false)
  const [addEntries, setAddEntries] = useState([emptyEntry()])
  const [addSaving,  setAddSaving]  = useState(false)

  async function saveAddEntries() {
    setAddSaving(true)
    for (const e of addEntries) {
      if (!e.carcass_tag || !e.harvest_date) continue
      await fetch('/api/harvest', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          harvest_date:           e.harvest_date,
          species:                e.species,
          carcass_tag:            e.carcass_tag,
          producer:               e.producer,
          sex:                    e.sex,
          ear_tag:                e.ear_tag,
          hot_carcass_weight_lbs: e.hot_carcass_weight_lbs ? parseFloat(e.hot_carcass_weight_lbs) : null,
          over_30_months:         e.over_30_months,
          status:                 'chilling',
          carcasses: [{
            carcass_tag:            e.carcass_tag,
            sex:                    e.sex,
            ear_tag:                e.ear_tag,
            hot_carcass_weight_lbs: e.hot_carcass_weight_lbs ? parseFloat(e.hot_carcass_weight_lbs) : null,
            over_30_months:         e.over_30_months,
            intervention_applied:   false,
            ccp_pass:               true,
            is_verification:        false,
            direct_observation:     false,
          }],
        }),
      })
    }
    setAddSaving(false)
    setAddModal(false)
    setAddEntries([emptyEntry()])
    load()
  }

  async function removeCarcass(id: string) {
    if (!confirm('Remove this carcass from the cooler? (Marks it complete — it will no longer count toward capacity.)')) return
    await fetch('/api/harvest', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, status: 'complete' }),
    })
    load()
  }

  const load = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/capacity')
    const json: CapacityResponse = await res.json()
    setData(json)
    setSettings(json.settings)
    setLoading(false)
    setDirty(false)
  }, [])

  useEffect(() => { load() }, [load])

  function updateSetting(k: keyof CapacitySettings, v: string) {
    setSettings(p => ({ ...p, [k]: parseFloat(v) || 0 }))
    setDirty(true)
  }

  async function saveSettings() {
    setSaving(true)
    await fetch('/api/capacity', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    })
    await load()
    setSaving(false)
  }

  if (loading || !data) {
    return (
      <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <span style={{ color: C.tan, fontSize: '0.9rem' }}>Loading capacity data…</span>
      </div>
    )
  }

  const { cooler, upcoming, cooler_eq, upcoming_eq, total_eq, days_on_hand, available_eq } = data
  const max    = settings.max_cooler_days
  const color  = loadColor(days_on_hand, max)

  // Available-to-book breakdown by species
  const avail = available_eq > 0 ? {
    Beef: Math.floor(available_eq),
    Hog:  Math.floor(available_eq * settings.hogs_per_beef),
    Lamb: Math.floor(available_eq * settings.lambs_per_beef),
    Goat: Math.floor(available_eq * settings.goats_per_beef),
  } : null

  // Species counts in cooler
  const coolerBySpecies: Record<string, number> = {}
  for (const c of cooler) coolerBySpecies[c.species] = (coolerBySpecies[c.species] ?? 0) + 1

  // Upcoming by species
  const upcomingBySpecies: Record<string, number> = {}
  for (const u of upcoming) upcomingBySpecies[u.species] = (upcomingBySpecies[u.species] ?? 0) + u.head_count

  return (
    <div style={{ minHeight: '100vh', background: 'var(--dark-brown)', display: 'flex', flexDirection: 'column' }}>

      {/* Header */}
      <header style={{
        background: 'var(--dark)', borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: '64px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, fontSize: '0.82rem', textDecoration: 'none' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
          <span style={{ fontFamily: 'Georgia, serif', fontSize: '1rem', fontWeight: 700, color: C.cream, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Production Capacity
          </span>
        </div>
        <Link href="/schedule" style={{ color: C.lightBrown, fontSize: '0.82rem', textDecoration: 'none' }}>
          Open Schedule →
        </Link>
      </header>

      <main style={{ flex: 1, padding: '1.5rem 2rem', maxWidth: '1200px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 320px', gap: '1.25rem', alignItems: 'start' }}>

          {/* ── Left column ─────────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>

            {/* Gauge card */}
            <div style={{ background: C.dark, border: `1px solid ${color}44`, borderLeft: `4px solid ${color}`, borderRadius: 4, padding: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '1.25rem' }}>
                <div>
                  <div style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                    Cooler Load
                  </div>
                  <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.2rem' }}>
                    Current inventory + upcoming scheduled kills
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: '2.2rem', fontWeight: 800, color, lineHeight: 1 }}>
                    {days_on_hand.toFixed(1)}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>days of work</div>
                </div>
              </div>

              <GaugeBar days={days_on_hand} max={max} />

              {/* Species breakdown mini-row */}
              <div style={{ display: 'flex', gap: '1.5rem', marginTop: '1.25rem', paddingTop: '1rem', borderTop: '1px solid rgba(166,120,90,0.15)' }}>
                {/* Cooler */}
                <div>
                  <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.4rem' }}>
                    In Cooler Now &nbsp;<span style={{ fontStyle: 'normal' }}>({cooler.length} carcasses · {cooler_eq.toFixed(1)} BE)</span>
                  </div>
                  <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                    {Object.entries(coolerBySpecies).map(([sp, n]) => (
                      <span key={sp} style={{ fontSize: '0.82rem', color: SPECIES_CLR[sp] ?? C.tan }}>
                        {SPECIES_EMOJI[sp]} {n} {sp}
                      </span>
                    ))}
                    {cooler.length === 0 && <span style={{ fontSize: '0.82rem', color: 'rgba(166,120,90,0.4)' }}>Empty</span>}
                  </div>
                </div>

                {upcoming.length > 0 && (
                  <div style={{ borderLeft: '1px solid rgba(166,120,90,0.2)', paddingLeft: '1.5rem' }}>
                    <div style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.4rem' }}>
                      Booked Upcoming &nbsp;<span>({upcoming_eq.toFixed(1)} BE)</span>
                    </div>
                    <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
                      {Object.entries(upcomingBySpecies).map(([sp, n]) => (
                        <span key={sp} style={{ fontSize: '0.82rem', color: `${SPECIES_CLR[sp] ?? C.tan}99` }}>
                          {SPECIES_EMOJI[sp]} {n} {sp}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Available to book */}
            <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '1.25rem 1.5rem' }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: '0.95rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '0.85rem' }}>
                Available to Book
              </div>
              {avail ? (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '0.75rem' }}>
                  {(['Beef', 'Hog', 'Lamb', 'Goat'] as const).map(sp => (
                    <div key={sp} style={{
                      background: `${SPECIES_CLR[sp]}11`,
                      border: `1px solid ${SPECIES_CLR[sp]}33`,
                      borderRadius: 4, padding: '0.85rem 1rem', textAlign: 'center',
                    }}>
                      <div style={{ fontSize: '1.6rem', marginBottom: '0.2rem' }}>{SPECIES_EMOJI[sp]}</div>
                      <div style={{ fontSize: '1.8rem', fontWeight: 800, color: SPECIES_CLR[sp], lineHeight: 1 }}>
                        {avail[sp]}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.15rem' }}>{sp}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, padding: '1rem', textAlign: 'center' }}>
                  <span style={{ color: C.red, fontSize: '0.9rem', fontWeight: 600 }}>⚠ At or over capacity</span>
                  <p style={{ color: C.lightBrown, fontSize: '0.8rem', marginTop: '0.35rem', margin: '0.35rem 0 0' }}>
                    {Math.abs(available_eq).toFixed(1)} beef equivalents over your {max}-day target.
                    Process current inventory before booking more.
                  </p>
                </div>
              )}
              {avail && (
                <p style={{ fontSize: '0.72rem', color: 'rgba(166,120,90,0.5)', marginTop: '0.75rem' }}>
                  Remaining capacity: {available_eq.toFixed(2)} beef equivalents ·
                  At {settings.beef_eq_per_day} BE/day that&apos;s {(available_eq / settings.beef_eq_per_day).toFixed(1)} additional working days
                </p>
              )}
            </div>

            {/* Cooler inventory — age detail */}
            <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, overflow: 'hidden' }}>
              <div style={{ padding: '0.65rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.15)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Carcasses in Cooler
                  </span>
                  <button
                    onClick={() => setAddModal(true)}
                    style={{ ...BTN('rgba(201,168,130,0.15)', C.tan), border: '1px solid rgba(201,168,130,0.3)', fontSize: '0.75rem', padding: '0.3rem 0.8rem' }}
                  >
                    + Add to Cooler
                  </button>
                </div>
                <span style={{ fontSize: '0.72rem', color: 'rgba(166,120,90,0.5)' }}>
                  ≤3 days: safe &nbsp;·&nbsp; 4–5: monitor &nbsp;·&nbsp; 6+: priority cut
                </span>
              </div>

              {cooler.length === 0 ? (
                <p style={{ color: 'rgba(166,120,90,0.4)', fontSize: '0.85rem', padding: '1.5rem', textAlign: 'center' }}>
                  No carcasses currently in cooler
                </p>
              ) : (
                cooler.map(c => {
                  const ageColor = c.days_in_cooler >= 6 ? C.red : c.days_in_cooler >= 4 ? C.yellow : C.green
                  return (
                    <div key={c.id} style={{
                      display: 'grid', gridTemplateColumns: '36px 140px 1fr 110px 72px 60px 28px',
                      gap: '0 0.75rem', padding: '0.55rem 1.25rem',
                      borderBottom: '1px solid rgba(166,120,90,0.07)',
                      alignItems: 'center',
                      background: c.days_in_cooler >= 6 ? 'rgba(239,68,68,0.04)' : undefined,
                    }}>
                      <span style={{ fontSize: '1.1rem', textAlign: 'center' }}>{SPECIES_EMOJI[c.species] ?? '🐄'}</span>
                      <span style={{ fontSize: '0.82rem', color: C.tan, fontFamily: 'monospace' }}>{c.carcass_tag}</span>
                      <span style={{ fontSize: '0.82rem', color: C.lightBrown }}>{c.producer}</span>
                      <span style={{ fontSize: '0.78rem', color: 'rgba(166,120,90,0.6)' }}>Harvested {fmtDate(c.harvest_date)}</span>
                      <span style={{ fontSize: '0.85rem', fontWeight: 700, color: ageColor, textAlign: 'center' }}>
                        {c.days_in_cooler}d
                      </span>
                      <span style={{ fontSize: '0.72rem', color: 'rgba(166,120,90,0.45)', textAlign: 'right' }}>
                        {c.beef_eq.toFixed(2)} BE
                      </span>
                      <button
                        onClick={() => removeCarcass(c.id)}
                        title="Mark as processed — removes from cooler load"
                        style={{ background: 'none', border: 'none', color: 'rgba(76,175,80,0.4)', cursor: 'pointer', fontSize: '0.9rem', padding: 0, textAlign: 'center' }}
                      >✓</button>
                    </div>
                  )
                })
              )}
            </div>

            {/* Upcoming appointments */}
            {upcoming.length > 0 && (
              <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, overflow: 'hidden' }}>
                <div style={{ padding: '0.75rem 1.25rem', borderBottom: '1px solid rgba(166,120,90,0.15)' }}>
                  <span style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Upcoming Kills (Booked)
                  </span>
                </div>
                {upcoming.map(u => (
                  <div key={u.id} style={{
                    display: 'grid', gridTemplateColumns: '36px 100px 1fr 80px',
                    gap: '0 0.75rem', padding: '0.6rem 1.25rem',
                    borderBottom: '1px solid rgba(166,120,90,0.07)', alignItems: 'center',
                  }}>
                    <span style={{ fontSize: '1.1rem', textAlign: 'center' }}>{SPECIES_EMOJI[u.species] ?? '🐄'}</span>
                    <span style={{ fontSize: '0.8rem', color: C.tan }}>{fmtDate(u.harvest_date)}</span>
                    <span style={{ fontSize: '0.8rem', color: C.lightBrown }}>{u.head_count}× {u.species} — {u.source}</span>
                    <span style={{ fontSize: '0.72rem', color: 'rgba(166,120,90,0.5)', textAlign: 'right' }}>+{u.beef_eq.toFixed(2)} BE</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* ── Settings panel ───────────────────────────────────────────── */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>

            {/* Equivalency */}
            <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.25rem' }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: '0.88rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>
                Carcass Equivalency
              </div>
              <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginBottom: '1rem', lineHeight: 1.5 }}>
                How many of each species equal one Beef carcass in your cut room.
              </p>

              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.3rem' }}>
                  🐷 Hogs per 1 Beef
                </label>
                <input type="number" min="1" step="0.5" style={INPUT}
                  value={settings.hogs_per_beef}
                  onChange={e => updateSetting('hogs_per_beef', e.target.value)} />
                <div style={{ fontSize: '0.67rem', color: 'rgba(166,120,90,0.45)', marginTop: '0.2rem' }}>
                  1 Hog = {(1 / settings.hogs_per_beef).toFixed(3)} beef equivalents
                </div>
              </div>

              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.3rem' }}>
                  🐑 Lambs per 1 Beef
                </label>
                <input type="number" min="1" step="0.5" style={INPUT}
                  value={settings.lambs_per_beef}
                  onChange={e => updateSetting('lambs_per_beef', e.target.value)} />
                <div style={{ fontSize: '0.67rem', color: 'rgba(166,120,90,0.45)', marginTop: '0.2rem' }}>
                  1 Lamb = {(1 / settings.lambs_per_beef).toFixed(3)} beef equivalents
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.3rem' }}>
                  🐐 Goats per 1 Beef
                </label>
                <input type="number" min="1" step="0.5" style={INPUT}
                  value={settings.goats_per_beef}
                  onChange={e => updateSetting('goats_per_beef', e.target.value)} />
                <div style={{ fontSize: '0.67rem', color: 'rgba(166,120,90,0.45)', marginTop: '0.2rem' }}>
                  1 Goat = {(1 / settings.goats_per_beef).toFixed(3)} beef equivalents
                </div>
              </div>
            </div>

            {/* Throughput & capacity */}
            <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, padding: '1.25rem' }}>
              <div style={{ fontFamily: 'Georgia, serif', fontSize: '0.88rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: '0.2rem' }}>
                Throughput & Limits
              </div>
              <p style={{ fontSize: '0.72rem', color: C.lightBrown, marginBottom: '1rem', lineHeight: 1.5 }}>
                How many beef equivalents your team processes per working day, and your aging limit.
              </p>

              <div style={{ marginBottom: '0.75rem' }}>
                <label style={{ display: 'block', fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.3rem' }}>
                  🔪 Beef Equiv. per Day
                </label>
                <input type="number" min="0.5" step="0.5" style={INPUT}
                  value={settings.beef_eq_per_day}
                  onChange={e => updateSetting('beef_eq_per_day', e.target.value)} />
                <div style={{ fontSize: '0.67rem', color: 'rgba(166,120,90,0.45)', marginTop: '0.2rem' }}>
                  = {settings.beef_eq_per_day} Beef · {Math.round(settings.beef_eq_per_day * settings.hogs_per_beef)} Hog · {Math.round(settings.beef_eq_per_day * settings.lambs_per_beef)} Lamb per day
                </div>
              </div>

              <div>
                <label style={{ display: 'block', fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.3rem' }}>
                  📅 Max Cooler Days
                </label>
                <input type="number" min="1" max="14" step="1" style={INPUT}
                  value={settings.max_cooler_days}
                  onChange={e => updateSetting('max_cooler_days', e.target.value)} />
                <div style={{ fontSize: '0.67rem', color: 'rgba(166,120,90,0.45)', marginTop: '0.2rem' }}>
                  Maximum days of work to hold in cooler before aging concerns
                </div>
              </div>
            </div>

            {settingsDirty && (
              <button
                onClick={saveSettings}
                disabled={savingSettings}
                style={{ ...BTN(C.tan), width: '100%', padding: '0.65rem' }}
              >
                {savingSettings ? 'Saving…' : '✓ Save Settings'}
              </button>
            )}

            {/* Quick reference */}
            <div style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.15)', borderRadius: 4, padding: '1rem 1.25rem' }}>
              <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em', marginBottom: '0.6rem' }}>
                Current Equivalency Table
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    <th style={{ textAlign: 'left', color: 'rgba(166,120,90,0.5)', fontWeight: 'normal', paddingBottom: '0.3rem' }}>Species</th>
                    <th style={{ textAlign: 'center', color: 'rgba(166,120,90,0.5)', fontWeight: 'normal', paddingBottom: '0.3rem' }}>Per Beef</th>
                    <th style={{ textAlign: 'right', color: 'rgba(166,120,90,0.5)', fontWeight: 'normal', paddingBottom: '0.3rem' }}>BE Factor</th>
                  </tr>
                </thead>
                <tbody>
                  {[
                    { sp: 'Beef', perBeef: 1,                           factor: 1 },
                    { sp: 'Hog',  perBeef: settings.hogs_per_beef,      factor: 1 / settings.hogs_per_beef },
                    { sp: 'Lamb', perBeef: settings.lambs_per_beef,     factor: 1 / settings.lambs_per_beef },
                    { sp: 'Goat', perBeef: settings.goats_per_beef,     factor: 1 / settings.goats_per_beef },
                  ].map(row => (
                    <tr key={row.sp}>
                      <td style={{ color: SPECIES_CLR[row.sp], paddingBottom: '0.3rem' }}>
                        {SPECIES_EMOJI[row.sp]} {row.sp}
                      </td>
                      <td style={{ textAlign: 'center', color: C.tan, paddingBottom: '0.3rem' }}>
                        {row.perBeef === 1 ? '1 (base)' : `${row.perBeef}`}
                      </td>
                      <td style={{ textAlign: 'right', color: C.lightBrown, fontFamily: 'monospace', paddingBottom: '0.3rem' }}>
                        {row.factor.toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </main>

      <footer style={{ background: 'var(--dark)', borderTop: '1px solid rgba(166,120,90,0.2)', padding: '0.5rem 2rem', textAlign: 'center', fontSize: '0.72rem', color: 'var(--light-brown)' }}>
        Cowboy Meat Company · 1109 Front St, Forsyth MT · (406) 346-7660 · jill@cowboymeats.com
      </footer>

      {/* ── Add to Cooler Modal ────────────────────────────────────────── */}
      {addModal && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
          onClick={() => setAddModal(false)}>
          <div style={{ background: C.darkBrown, border: '1px solid rgba(166,120,90,0.4)', borderRadius: 6, padding: '1.75rem 2rem', width: '100%', maxWidth: 680, maxHeight: '90vh', overflowY: 'auto' }}
            onClick={e => e.stopPropagation()}>

            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '0.3rem' }}>
              <h3 style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', textTransform: 'uppercase', letterSpacing: '0.07em', margin: 0 }}>
                Add Carcasses to Cooler
              </h3>
              <button onClick={() => setAddModal(false)} style={{ background: 'none', border: 'none', color: C.lightBrown, cursor: 'pointer', fontSize: '1.1rem' }}>×</button>
            </div>
            <p style={{ color: C.lightBrown, fontSize: '0.78rem', margin: '0 0 1.25rem', lineHeight: 1.5 }}>
              Use this to load existing carcasses or catch up historical inventory. Each row becomes one carcass in the cooler. Only Tag and Date are required.
            </p>

            {/* Column headers */}
            <div style={{ display: 'grid', gridTemplateColumns: '90px 100px 1fr 90px 80px 110px 28px', gap: '0 0.6rem', marginBottom: '0.4rem' }}>
              {['Species', 'Tag #*', 'Producer', 'Sex', 'HCW (lbs)', 'Kill Date*', ''].map((h, i) => (
                <span key={i} style={{ fontSize: '0.65rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{h}</span>
              ))}
            </div>

            {addEntries.map((e, i) => (
              <div key={i} style={{ display: 'grid', gridTemplateColumns: '90px 100px 1fr 90px 80px 110px 28px', gap: '0.5rem 0.6rem', marginBottom: '0.5rem', alignItems: 'center' }}>
                <select
                  value={e.species}
                  onChange={ev => setAddEntries(p => p.map((r, ri) => ri === i ? { ...r, species: ev.target.value, sex: ev.target.value === 'Beef' ? 'Steer' : ev.target.value === 'Hog' ? 'Barrow' : 'Wether' } : r))}
                  style={{ ...INPUT, fontSize: '0.83rem' }}
                >
                  {['Beef','Hog','Lamb','Goat'].map(s => <option key={s}>{s}</option>)}
                </select>
                <input placeholder="e.g. CT-001" style={{ ...INPUT, fontSize: '0.83rem' }}
                  value={e.carcass_tag}
                  onChange={ev => setAddEntries(p => p.map((r, ri) => ri === i ? { ...r, carcass_tag: ev.target.value } : r))} />
                <input placeholder="Owner name" style={{ ...INPUT, fontSize: '0.83rem' }}
                  value={e.producer}
                  onChange={ev => setAddEntries(p => p.map((r, ri) => ri === i ? { ...r, producer: ev.target.value } : r))} />
                <select
                  value={e.sex}
                  onChange={ev => setAddEntries(p => p.map((r, ri) => ri === i ? { ...r, sex: ev.target.value } : r))}
                  style={{ ...INPUT, fontSize: '0.83rem' }}
                >
                  {(e.species === 'Beef' ? ['Steer','Heifer','Cow','Bull'] : e.species === 'Hog' ? ['Barrow','Gilt','Sow','Boar'] : ['Wether','Ewe','Ram']).map(s => <option key={s}>{s}</option>)}
                </select>
                <input type="number" step="1" placeholder="—" style={{ ...INPUT, fontSize: '0.83rem' }}
                  value={e.hot_carcass_weight_lbs}
                  onChange={ev => setAddEntries(p => p.map((r, ri) => ri === i ? { ...r, hot_carcass_weight_lbs: ev.target.value } : r))} />
                <input type="date" style={{ ...INPUT, fontSize: '0.83rem' }}
                  value={e.harvest_date}
                  onChange={ev => setAddEntries(p => p.map((r, ri) => ri === i ? { ...r, harvest_date: ev.target.value } : r))} />
                <button
                  onClick={() => setAddEntries(p => p.length > 1 ? p.filter((_, ri) => ri !== i) : p)}
                  style={{ background: 'none', border: 'none', color: 'rgba(166,120,90,0.35)', cursor: 'pointer', fontSize: '1rem', textAlign: 'center' }}
                >×</button>
              </div>
            ))}

            <button
              onClick={() => setAddEntries(p => [...p, emptyEntry()])}
              style={{ ...BTN('rgba(255,255,255,0.05)', C.lightBrown), border: '1px dashed rgba(166,120,90,0.3)', width: '100%', marginBottom: '1.25rem', fontSize: '0.82rem' }}
            >
              + Add another row
            </button>

            <div style={{ display: 'flex', gap: '0.75rem' }}>
              <button
                onClick={saveAddEntries}
                disabled={addSaving || addEntries.every(e => !e.carcass_tag)}
                style={{ ...BTN(C.tan), flex: 1, opacity: addEntries.every(e => !e.carcass_tag) ? 0.5 : 1 }}
              >
                {addSaving ? 'Saving…' : `Save ${addEntries.filter(e => e.carcass_tag).length} Carcass${addEntries.filter(e => e.carcass_tag).length !== 1 ? 'es' : ''}`}
              </button>
              <button onClick={() => setAddModal(false)} style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.3)' }}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
