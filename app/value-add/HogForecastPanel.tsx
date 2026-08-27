'use client'

// How many smokehouse loads the booked hogs are going to take.
//
// This is the reason the rack sizes got counted at all (Charlie, 2026-08-27):
// "when we get a run of hogs we can predict how many smokehouse loads it is
// going to take." The board above says what's hanging now; this says what's
// coming, off the harvest schedule.
//
// Loads are counted KILL DAY BY KILL DAY, because that's how the house runs
// them — everything killed the same day cures together, and two dates a month
// apart can't share a part-full rack.
import { useEffect, useState, useCallback } from 'react'
import type { RunForecast, DayForecast } from '@/lib/hogForecast'

const C = {
  dark:       '#1A0A04',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  yellow:     '#D97706',
  blue:       '#3B82F6',
  orange:     '#E8883A',
}

const WINDOWS = [
  { days: 30,  label: '30 days' },
  { days: 90,  label: '90 days' },
  { days: 180, label: '6 months' },
  { days: 365, label: 'a year' },
]

// "2026-09-04" → "Fri Sep 4". Parsed as parts, not Date(string), so a date-only
// value can't slip a day on a UTC-behind machine.
function fmtDay(iso: string | null): string {
  if (!iso) return 'unscheduled'
  const [y, m, d] = iso.split('-').map(Number)
  if (!y || !m || !d) return iso
  return new Date(y, m - 1, d).toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

// "Bacon" → "bacons", "Hocks" → "hocks". A rate reads as a count of pieces,
// and "1.7 bacon a hog" reads like a typo.
const plural = (s: string) => {
  const l = s.toLowerCase()
  return l.endsWith('s') ? l : `${l}s`
}

function DayRow({ day }: { day: DayForecast }) {
  return (
    <div style={{
      display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap',
      padding: '0.55rem 0', borderTop: '1px dashed rgba(166,120,90,0.18)',
    }}>
      <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.85rem', minWidth: 110 }}>
        {fmtDay(day.date)}
      </span>
      <span style={{ color: C.tan, fontSize: '0.8rem', minWidth: 130 }}>
        {day.head} hog{day.head === 1 ? '' : 's'} · {day.bookings} booking{day.bookings === 1 ? '' : 's'}
      </span>
      <span style={{ color: C.orange, fontWeight: 700, fontSize: '0.85rem', minWidth: 70 }}>
        {day.loads != null ? `${day.loads} load${day.loads === 1 ? '' : 's'}` : '—'}
      </span>
      <span style={{ color: C.lightBrown, fontSize: '0.76rem' }}>
        {day.racks.filter(r => r.loads != null).map(r =>
          `${r.label.toLowerCase()} ${r.slots}/${r.unitsPerBatch} → ${r.loads}`
        ).join(' · ')}
        {day.racks.some(r => r.loads == null) && (
          <span style={{ color: C.lightBrown }}>
            {' · '}
            {day.racks.filter(r => r.loads == null).map(r => `${r.pieces} ${r.label.toLowerCase()}`).join(' · ')}
            {' (no counted size)'}
          </span>
        )}
      </span>
    </div>
  )
}

export default function HogForecastPanel() {
  const [days, setDays] = useState(90)
  const [data, setData] = useState<RunForecast | null>(null)
  const [busy, setBusy] = useState(true)
  const [err,  setErr]  = useState<string | null>(null)

  const load = useCallback(async (d: number) => {
    setBusy(true)
    try {
      const res = await fetch(`/api/hog-forecast?days=${d}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json?.error ?? 'load failed')
      setData(json)
      setErr(null)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not read the harvest schedule')
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => { load(days) }, [load, days])

  const rate = data?.rate

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(166,120,90,0.25)',
      borderRadius: 4, padding: '1rem 1.1rem',
    }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <span style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', letterSpacing: '0.04em' }}>
          🐖 Hogs on the books
        </span>
        <div style={{ display: 'flex', gap: '0.3rem', marginLeft: 'auto' }}>
          {WINDOWS.map(w => (
            <button
              key={w.days}
              onClick={() => setDays(w.days)}
              style={{
                background: days === w.days ? C.tan : 'transparent',
                border: `1px solid ${days === w.days ? C.tan : 'rgba(166,120,90,0.3)'}`,
                color: days === w.days ? C.dark : C.lightBrown,
                borderRadius: 3, cursor: 'pointer', fontSize: '0.72rem', padding: '0.2rem 0.6rem', fontWeight: 600,
              }}>
              {w.label}
            </button>
          ))}
        </div>
      </div>

      {err && <div style={{ color: C.yellow, fontSize: '0.8rem' }}>{err}</div>}
      {busy && !data && <div style={{ color: C.lightBrown, fontSize: '0.8rem' }}>Reading the harvest schedule…</div>}

      {data && data.head === 0 && (
        <div style={{ color: C.lightBrown, fontSize: '0.8rem', lineHeight: 1.7 }}>
          No hogs booked in the next {days} days. Bookings show up here from the
          harvest schedule the moment they&apos;re on it.
        </div>
      )}

      {data && data.head > 0 && (
        <>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: '0.5rem' }}>
            <div>
              <span style={{ color: C.orange, fontSize: '2rem', fontWeight: 700, fontFamily: 'Georgia, serif' }}>
                {data.loads ?? '—'}
              </span>
              <span style={{ color: C.tan, fontSize: '0.9rem' }}>
                {' '}load{data.loads === 1 ? '' : 's'} for {data.head} hog{data.head === 1 ? '' : 's'}
              </span>
              <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>
                counted kill day by kill day, over {data.days.length} day{data.days.length === 1 ? '' : 's'}
              </div>
            </div>
            {data.loadsIfCombined != null && data.loadsIfCombined !== data.loads && (
              <div>
                <span style={{ color: C.tan, fontSize: '1.2rem', fontWeight: 700 }}>{data.loadsIfCombined}</span>
                <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}> if it all cured at once</span>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>
                  a floor, not a plan — the dates have to be close enough to hold
                </div>
              </div>
            )}
          </div>

          <div style={{ marginTop: '0.5rem' }}>
            {data.days.map(d => <DayRow key={d.date ?? 'unscheduled'} day={d} />)}
          </div>

          {/* Where the numbers came from. A head with a sheet on file is read,
              not projected, and the split has to be visible to be trusted. */}
          <div style={{ marginTop: '0.85rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(166,120,90,0.2)', fontSize: '0.75rem', color: C.lightBrown, lineHeight: 1.7 }}>
            {data.headOnSheet > 0 && (
              <>
                <span style={{ color: C.green }}>{data.headOnSheet} head read straight off cut sheets</span>
                {data.headProjected > 0 && ', '}
              </>
            )}
            {data.headProjected > 0 && rate?.usable && (
              <>
                <span style={{ color: C.yellow }}>{data.headProjected} head with no sheet yet</span>, carried at{' '}
                {Object.entries(rate.perHog)
                  .filter(([, v]) => v >= 0.05)
                  .sort((a, b) => b[1] - a[1])
                  .map(([k, v]) => `${v.toFixed(1)} ${plural(k)}`)
                  .join(', ')}{' '}
                a hog — averaged over {Math.round(rate.hogs)}{' '}
                hogs&apos; worth of past sheets.
              </>
            )}
            {data.headProjected > 0 && !rate?.usable && (
              <span style={{ color: C.yellow }}>{rate?.reason}</span>
            )}
          </div>
        </>
      )}
    </div>
  )
}
