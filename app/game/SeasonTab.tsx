'use client'

import { useEffect, useMemo, useState } from 'react'
import type { GameIntake } from '@/lib/types'
import { C, INPUT, CARD, STATUS_META, money, daysHeld } from './ui'

// The season, in numbers.
//
// Wild game is a six-week business that pays for a quiet January, and nobody
// has ever been able to say afterwards how much of it there was. This tab is
// the answer to the four questions worth asking at the end of it: how many
// animals, of what, what did the work bill, and how many are still sitting in
// our freezer belonging to somebody who never came back.

export default function SeasonTab() {
  const [season, setSeason]   = useState('')
  const [rows, setRows]       = useState<GameIntake[]>([])
  const [loading, setLoading] = useState(true)

  // Seasons that actually exist, newest first — no point offering 2019.
  const [seasons, setSeasons] = useState<string[]>([])

  useEffect(() => {
    const qs = season ? `?season=${season}` : ''
    fetch(`/api/game${qs}`)
      .then(r => r.json())
      .then((d: GameIntake[]) => {
        const list = Array.isArray(d) ? d : []
        setRows(list)
        if (!season) {
          const found = Array.from(new Set(list.map(i => i.season))).sort().reverse()
          setSeasons(found)
          if (found.length) setSeason(found[0])
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [season])

  const stats = useMemo(() => {
    const total    = rows.length
    const billed   = rows.reduce((s, i) => s + (i.charge_total ?? 0), 0)
    const outLbs   = rows.reduce((s, i) => s + (i.output_lbs ?? 0), 0)
    const inLbs    = rows.reduce((s, i) => s + Number(i.weight_in_lbs ?? 0), 0)
    const pickedUp = rows.filter(i => i.status === 'picked_up').length
    // Uncollected is the number that costs money: freezer space, and eventually
    // a decision nobody wants to make.
    const uncollected = rows.filter(i =>
      i.status !== 'picked_up' && i.status !== 'abandoned' && daysHeld(i.received_at) >= 21)

    const bySpecies = new Map<string, { n: number; billed: number }>()
    for (const i of rows) {
      const cur = bySpecies.get(i.species) ?? { n: 0, billed: 0 }
      cur.n += 1
      cur.billed += i.charge_total ?? 0
      bySpecies.set(i.species, cur)
    }

    const byStatus = new Map<string, number>()
    for (const i of rows) byStatus.set(i.status, (byStatus.get(i.status) ?? 0) + 1)

    return {
      total, billed, outLbs, inLbs, pickedUp, uncollected,
      perAnimal: total ? billed / total : 0,
      yieldPct: inLbs > 0 ? Math.round((outLbs / inLbs) * 1000) / 10 : null,
      bySpecies: Array.from(bySpecies.entries()).sort((a, b) => b[1].n - a[1].n),
      byStatus:  Array.from(byStatus.entries()).sort((a, b) => b[1] - a[1]),
    }
  }, [rows])

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
        <select value={season} style={{ ...INPUT, width: 'auto' }}
          onChange={e => { setLoading(true); setSeason(e.target.value) }}>
          {seasons.map(s => <option key={s} value={s}>{s} season</option>)}
          {!seasons.length && <option value="">No seasons yet</option>}
        </select>
        {loading && <span style={{ color: C.lightBrown, fontSize: '0.82rem' }}>Loading…</span>}
      </div>

      {!loading && !rows.length && (
        <div style={{ color: C.lightBrown, padding: '2rem', textAlign: 'center' }}>
          Nothing recorded for this season yet.
        </div>
      )}

      {rows.length > 0 && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.75rem' }}>
            <Stat label="Animals in"     value={String(stats.total)} />
            <Stat label="Billed"         value={money(stats.billed)} color={C.green} />
            <Stat label="Per animal"     value={money(stats.perAnimal)} />
            <Stat label="Pounds out"     value={`${Math.round(stats.outLbs)}`} />
            <Stat label="Take-home yield"
              value={stats.yieldPct == null ? '—' : `${stats.yieldPct}%`}
              hint="Across every animal with a weight in" />
            <Stat label="Collected"      value={`${stats.pickedUp} / ${stats.total}`} />
            <Stat label="Sitting 21+ days"
              value={String(stats.uncollected.length)}
              color={stats.uncollected.length ? C.red : undefined}
              hint="Freezer space belonging to somebody who has not come back" />
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '1rem', marginTop: '1.25rem' }}>
            <div style={CARD}>
              <div style={{
                fontSize: '0.72rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.14em',
                fontWeight: 700, marginBottom: '0.7rem',
              }}>By species</div>
              {stats.bySpecies.map(([sp, v]) => (
                <Bar key={sp} label={sp} n={v.n} max={stats.bySpecies[0][1].n}
                  right={money(v.billed)} />
              ))}
            </div>

            <div style={CARD}>
              <div style={{
                fontSize: '0.72rem', color: C.tan, textTransform: 'uppercase', letterSpacing: '0.14em',
                fontWeight: 700, marginBottom: '0.7rem',
              }}>Where they are</div>
              {stats.byStatus.map(([st, n]) => (
                <Bar key={st} label={STATUS_META[st]?.label ?? st} n={n}
                  max={stats.byStatus[0][1]} color={STATUS_META[st]?.color} />
              ))}
            </div>
          </div>

          {stats.uncollected.length > 0 && (
            <div style={{ ...CARD, marginTop: '1rem', borderColor: C.red, background: 'rgba(229,62,62,0.06)' }}>
              <div style={{ fontSize: '0.85rem', color: C.red, fontWeight: 700, marginBottom: '0.5rem' }}>
                Uncollected — {stats.uncollected.length} animals, {money(
                  stats.uncollected.reduce((s, i) => s + (i.charge_total ?? 0), 0))} of work done and not paid for
              </div>
              {stats.uncollected.slice(0, 12).map(i => (
                <div key={i.id} style={{
                  display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem',
                  color: C.cream, padding: '0.25rem 0',
                }}>
                  <span>
                    <span style={{ fontFamily: 'monospace', color: C.tan }}>{i.tag_number}</span>
                    {' '}{i.hunter_name}
                    <span style={{ color: C.lightBrown }}> · {i.hunter_phone || 'no phone'}</span>
                  </span>
                  <span style={{ color: C.red }}>{daysHeld(i.received_at)}d</span>
                </div>
              ))}
              {stats.uncollected.length > 12 && (
                <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginTop: '0.3rem' }}>
                  …and {stats.uncollected.length - 12} more
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color, hint }: { label: string; value: string; color?: string; hint?: string }) {
  return (
    <div style={CARD}>
      <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: color ?? C.cream, marginTop: '0.2rem' }}>
        {value}
      </div>
      {hint && <div style={{ fontSize: '0.68rem', color: C.lightBrown, marginTop: '0.25rem', lineHeight: 1.4 }}>{hint}</div>}
    </div>
  )
}

function Bar({ label, n, max, right, color }: {
  label: string; n: number; max: number; right?: string; color?: string
}) {
  const pct = max > 0 ? (n / max) * 100 : 0
  return (
    <div style={{ marginBottom: '0.5rem' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: C.cream }}>
        <span>{label}</span>
        <span style={{ color: C.tan }}>{n}{right ? ` · ${right}` : ''}</span>
      </div>
      <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, marginTop: '0.25rem' }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color ?? C.tan, borderRadius: 3 }} />
      </div>
    </div>
  )
}
