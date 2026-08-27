'use client'

// The smokehouse book — everything the house is committed to, and what it costs.
//
// Charlie asked for a schedule "for the entire smokehouse enterprise", like the
// processing room has. The demand side is complete: every booked animal of every
// species, read off its cut sheet where one exists and off a per-species rate
// where it doesn't. The capacity side is not, and this panel is deliberately
// blunt about that — the sausage products have no load size, so their pounds are
// shown and their loads are left empty rather than invented.
//
// The unsized list is the point of the panel as much as the totals are: it is
// the exact counting job standing between here and a schedule that covers
// everything.
import { useEffect, useState, useCallback } from 'react'
import { fmtDuration } from '@/lib/cookPredict'
import type { Book, DayBook } from '@/lib/smokehouseBook'

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

const SPECIES_ICON: Record<string, string> = {
  Beef: '🐄', Hog: '🐖', Lamb: '🐑', Goat: '🐐',
}

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

const headLine = (head: Record<string, number>) =>
  Object.entries(head)
    .sort((a, b) => b[1] - a[1])
    .map(([sp, n]) => `${SPECIES_ICON[sp] ?? ''}${n} ${sp.toLowerCase()}`)
    .join(' · ')

function DayRow({ day }: { day: DayBook }) {
  const sized = [
    ...day.racks.filter(r => r.loads != null).map(r =>
      `${r.label.toLowerCase()} ${r.slots}/${r.unitsPerBatch} → ${r.loads}`),
    ...day.weights.filter(w => w.loads != null).map(w =>
      `${w.product.toLowerCase()} ${w.lbs}/${w.lbsPerBatch} lb → ${w.loads}`),
  ]
  const unsized = day.unsized.map(u =>
    u.lbs != null ? `${u.lbs} lb ${u.product.toLowerCase()}` : `${u.pieces} ${u.product.toLowerCase()}`)

  return (
    <div style={{ padding: '0.55rem 0', borderTop: '1px dashed rgba(166,120,90,0.18)' }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'baseline', flexWrap: 'wrap' }}>
        <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.85rem', minWidth: 105 }}>
          {fmtDay(day.date)}
        </span>
        <span style={{ color: C.tan, fontSize: '0.8rem', minWidth: 150 }}>
          {headLine(day.head)}
        </span>
        <span style={{ color: C.orange, fontWeight: 700, fontSize: '0.85rem', minWidth: 62 }}>
          {day.loads != null ? `${day.loads} load${day.loads === 1 ? '' : 's'}` : '—'}
        </span>
        <span style={{ color: C.blue, fontSize: '0.8rem', minWidth: 72 }}>
          {day.houseMinutes != null ? fmtDuration(day.houseMinutes) : ''}
        </span>
        <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>{sized.join(' · ')}</span>
      </div>
      {unsized.length > 0 && (
        <div style={{ color: C.yellow, fontSize: '0.73rem', marginTop: '0.2rem', marginLeft: 105 }}>
          + {unsized.join(' · ')} — no load size
        </div>
      )}
    </div>
  )
}

export default function SmokehouseBookPanel() {
  const [days, setDays] = useState(90)
  const [data, setData] = useState<Book | null>(null)
  const [busy, setBusy] = useState(true)
  const [err,  setErr]  = useState<string | null>(null)

  const load = useCallback(async (d: number) => {
    setBusy(true)
    try {
      const res  = await fetch(`/api/smokehouse-book?days=${d}`)
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

  return (
    <div style={{
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(166,120,90,0.25)',
      borderRadius: 4, padding: '1rem 1.1rem',
    }}>
      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.75rem' }}>
        <span style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1rem', letterSpacing: '0.04em' }}>
          📖 The Smokehouse Book
        </span>
        <span style={{ color: C.lightBrown, fontSize: '0.75rem' }}>
          what&apos;s booked, and what it costs the house
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

      {data && data.headTotal === 0 && (
        <div style={{ color: C.lightBrown, fontSize: '0.8rem', lineHeight: 1.7 }}>
          Nothing booked in the next {days} days.
        </div>
      )}

      {data && data.headTotal > 0 && (
        <>
          <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', alignItems: 'baseline', marginBottom: '0.6rem' }}>
            <div>
              <span style={{ color: C.orange, fontSize: '2rem', fontWeight: 700, fontFamily: 'Georgia, serif' }}>
                {data.loads ?? '—'}
              </span>
              <span style={{ color: C.tan, fontSize: '0.9rem' }}>
                {' '}load{data.loads === 1 ? '' : 's'} the house can count
              </span>
              <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>
                kill day by kill day · {headLine(data.head)}
              </div>
            </div>
            {data.houseMinutes != null && (
              <div>
                <span style={{ color: C.blue, fontSize: '1.2rem', fontWeight: 700 }}>
                  {fmtDuration(data.houseMinutes)}
                </span>
                <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}> in the house</span>
                <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>
                  fitted cook times, back to back, {data.changeoverMinutes}m between loads
                </div>
              </div>
            )}
          </div>

          {/* The gap. Named products and the demand riding on each, because this
              is the counting job that finishes the schedule. */}
          {data.unsized.length > 0 && (
            <div style={{
              background: 'rgba(217,119,6,0.1)', border: '1px solid rgba(217,119,6,0.35)',
              borderRadius: 4, padding: '0.75rem 1rem', margin: '0.6rem 0',
              fontSize: '0.8rem', lineHeight: 1.7,
            }}>
              <strong style={{ color: C.yellow }}>
                {data.unsized.length} product{data.unsized.length === 1 ? '' : 's'}{' '}
                can&apos;t be turned into loads yet.
              </strong>
              <div style={{ color: C.tan, marginTop: '0.25rem' }}>
                {data.unsized.map(u => (
                  <span key={`${u.product}-${u.lbs ?? u.pieces}`} style={{ display: 'inline-block', marginRight: '1rem' }}>
                    <strong style={{ color: C.cream }}>{u.product}</strong>{' '}
                    {u.lbs != null ? `${u.lbs} lb` : `${u.pieces} pieces`}
                  </span>
                ))}
              </div>
              <div style={{ color: C.lightBrown, marginTop: '0.4rem', fontSize: '0.76rem' }}>
                Hams and bacon schedule because somebody counted the rack. These
                need the same one number each — how much goes in one load — set
                under 🌡️ Cook Profiles below. Until then their pounds are real
                and their loads are blank; nothing here guesses a batch size.
              </div>
            </div>
          )}

          <div>{data.days.map(d => <DayRow key={d.date ?? 'unscheduled'} day={d} />)}</div>

          <div style={{ marginTop: '0.85rem', paddingTop: '0.6rem', borderTop: '1px solid rgba(166,120,90,0.2)', fontSize: '0.75rem', color: C.lightBrown, lineHeight: 1.7 }}>
            {data.headOnSheet > 0 && (
              <>
                <span style={{ color: C.green }}>{data.headOnSheet} head read straight off cut sheets</span>
                {data.headProjected > 0 && ', '}
              </>
            )}
            {data.headProjected > 0 && (
              <>
                <span style={{ color: C.yellow }}>{data.headProjected} head with no sheet yet</span>, carried at
                what each species has historically ordered:{' '}
                {Object.values(data.rates)
                  .filter(r => r.usable)
                  .map(r => {
                    const parts = [
                      ...Object.entries(r.perHead.pieces).filter(([, v]) => v >= 0.05)
                        .map(([k, v]) => `${v.toFixed(1)} ${k.toLowerCase()}`),
                      ...Object.entries(r.perHead.lbs).filter(([, v]) => v >= 0.5)
                        .map(([k, v]) => `${v.toFixed(0)} lb ${k.toLowerCase()}`),
                    ]
                    return parts.length ? `${r.species.toLowerCase()} ${parts.join(', ')}` : null
                  })
                  .filter(Boolean)
                  .join(' · ')}
                .
              </>
            )}
          </div>
        </>
      )}
    </div>
  )
}
