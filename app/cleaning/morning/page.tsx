'use client'
import { useEffect, useState, useCallback } from 'react'
import { dateLabel } from '@/lib/dates'
import {
  fmtShopTime, type CleaningShiftItem, type Priority, type ShiftProgress,
} from '@/lib/cleaning'
import {
  C, TAP, useCrewMember, CrewPicker, CleaningHeader, Banner, BigButton, inputStyle, cardStyle,
} from '../ui'

// The morning list — for the first cutter in.
//
// Whatever P2/P3 the night crew didn't get to rolled here at close-out. The
// cutter works it before FSIS pre-op, ticks each one off under their own name,
// and the record says "completed AM" so nobody later reads it as night work.

interface Shift {
  id: string
  shift_date: string
  status: 'open' | 'closed'
  started_at: string | null
  closed_at: string | null
  closed_by: string | null
  p1_complete_at: string | null
  preop_time: string
}

interface Morning {
  shift: Shift | null
  crew: { id: string; name: string }[]
  rolled: CleaningShiftItem[]
  finished_am: CleaningShiftItem[]
  tiers: Record<Priority, ShiftProgress>
  hours: number | null
  preop_at: string
  past_preop: boolean
}

const PRIORITY_TONE: Record<Priority, string> = { 1: C.red, 2: C.amber, 3: C.blue }

export default function MorningPage() {
  const { member, setMember } = useCrewMember()
  const [picking, setPicking] = useState(false)
  const [data,    setData]    = useState<Morning | null>(null)
  const [loading, setLoading] = useState(true)
  const [error,   setError]   = useState<string | null>(null)
  const [preop,   setPreop]   = useState<string>('')

  const load = useCallback(() => {
    fetch('/api/cleaning/morning')
      .then(res => res.json().then(body => ({ ok: res.ok, body })))
      .then(({ ok, body }) => {
        if (!ok) { setError(body?.error ?? 'Could not load last night.'); return }
        setData(body)
        setPreop((body.shift?.preop_time ?? '06:00').slice(0, 5))
        setError(null)
      })
      .catch(() => setError('No connection — the list can’t load right now.'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { load() }, [load])

  async function finish(item: CleaningShiftItem, status: 'done' | 'na') {
    if (!member) { setPicking(true); return }
    const res = await fetch('/api/cleaning/shift-items', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: item.id, status, by: member.name, by_id: member.id, note: 'completed AM',
      }),
    })
    const body = await res.json()
    if (!res.ok) { setError(body?.error ?? 'That didn’t save.'); return }
    setError(null)
    load()
  }

  async function savePreop(value: string) {
    if (!data?.shift || !/^\d{2}:\d{2}$/.test(value)) return
    const res = await fetch('/api/cleaning/shift', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ shift_id: data.shift.id, action: 'update', preop_time: value }),
    })
    if (!res.ok) { setError('Could not save the pre-op time.'); return }
    load()
  }

  if (picking) {
    return (
      <>
        <CleaningHeader title="Morning list" back="/cleaning" />
        <CrewPicker
          onPick={m => { setMember(m); setPicking(false) }}
          onCancel={() => setPicking(false)}
        />
      </>
    )
  }

  const shift = data?.shift ?? null

  return (
    <div style={{ paddingBottom: 80 }}>
      <CleaningHeader
        title="Morning list"
        back="/cleaning"
        member={member}
        onSwitch={() => setPicking(true)}
      />

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        {error && <Banner tone="error">{error}</Banner>}

        {loading && <div style={{ color: C.tan }}>Loading last night…</div>}

        {!loading && !shift && (
          <div style={{ ...cardStyle, color: C.tan }}>No cleaning shift on file yet.</div>
        )}

        {shift && data && (
          <>
            {!member && (
              <button
                onClick={() => setPicking(true)}
                style={{
                  ...cardStyle, width: '100%', minHeight: TAP, marginBottom: 14,
                  color: C.cream, fontSize: 16, cursor: 'pointer', textAlign: 'left',
                }}
              >
                👤 <strong>Tap to sign in</strong>
                <div style={{ color: C.tan, fontSize: 13, marginTop: 2 }}>
                  So what you finish is recorded under your name
                </div>
              </button>
            )}

            {shift.status === 'open' && (
              <Banner tone="warn">
                Last night&apos;s shift is still open — it closes itself at 3:00 AM and rolls whatever is left here.
              </Banner>
            )}

            {data.past_preop && (
              <Banner tone="error">
                Pre-op was {fmtShopTime(data.preop_at)} and {data.rolled.length} rolled item{data.rolled.length === 1 ? ' is' : 's are'} still open.
                Reassembly has to beat the inspector.
              </Banner>
            )}

            {/* Last night in one card */}
            <div style={{ ...cardStyle, marginBottom: 14 }}>
              <div style={{ color: C.cream, fontSize: 18, fontWeight: 800, marginBottom: 8 }}>
                Last night — {dateLabel(shift.shift_date)}
              </div>
              <Row label="Crew" value={data.crew.length ? data.crew.map(c => c.name).join(', ') : '—'} />
              <Row
                label="Hours"
                value={
                  shift.started_at
                    ? `${fmtShopTime(shift.started_at)} → ${shift.closed_at ? fmtShopTime(shift.closed_at) : 'still open'}`
                      + (data.hours != null ? ` · ${data.hours} h` : '')
                      + (shift.closed_by === 'system' ? ' · closed by the clock' : '')
                    : '—'
                }
              />
              <Row
                label="P1"
                value={shift.p1_complete_at
                  ? `complete at ${fmtShopTime(shift.p1_complete_at)}`
                  : `${data.tiers[1].done + data.tiers[1].na} of ${data.tiers[1].total} — NOT finished`}
                tone={shift.p1_complete_at ? C.green : C.red}
              />
              <Row label="P2" value={`${data.tiers[2].done + data.tiers[2].na} of ${data.tiers[2].total}`} />
              <Row label="P3" value={`${data.tiers[3].done + data.tiers[3].na} of ${data.tiers[3].total}`} />
              <Row label="Rolled here" value={`${data.rolled.length}`} tone={data.rolled.length ? C.blue : undefined} />

              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 10, flexWrap: 'wrap' }}>
                <span style={{ color: C.tan, fontSize: 13 }}>Pre-op this morning</span>
                <input
                  type="time"
                  value={preop}
                  onChange={e => setPreop(e.target.value)}
                  onBlur={() => preop !== shift.preop_time.slice(0, 5) && savePreop(preop)}
                  style={{ ...inputStyle, width: 130 }}
                />
                <span style={{ color: C.lightBrown, fontSize: 12 }}>Rolled items must be done before this.</span>
              </div>
            </div>

            {/* Rolled items */}
            {data.rolled.length === 0 ? (
              <div style={{ ...cardStyle, color: C.green, fontSize: 15, fontWeight: 700 }}>
                ✓ Nothing rolled over. Nothing to do before pre-op.
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {data.rolled.map(item => (
                  <div key={item.id} style={{
                    ...cardStyle, borderColor: PRIORITY_TONE[item.priority],
                    display: 'flex', flexDirection: 'column', gap: 8,
                  }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'baseline' }}>
                      <span style={{ color: PRIORITY_TONE[item.priority], fontSize: 12, fontWeight: 800 }}>P{item.priority}</span>
                      <span style={{ color: C.tan, fontSize: 12 }}>{item.area_name}{item.equipment_name ? ` · ${item.equipment_name}` : ''}</span>
                    </div>
                    <div style={{ color: C.cream, fontSize: 16, fontWeight: 600 }}>{item.title}</div>
                    {item.detail && <div style={{ color: C.tan, fontSize: 13 }}>{item.detail}</div>}
                    <div style={{ display: 'flex', gap: 8 }}>
                      <div style={{ flex: 2 }}>
                        <BigButton label="✓ Done" tone={C.green} onClick={() => finish(item, 'done')} />
                      </div>
                      <button
                        onClick={() => finish(item, 'na')}
                        style={{
                          flex: 1, minHeight: TAP, background: C.dark,
                          border: `1px solid ${C.medBrown}`, borderRadius: 10,
                          color: C.cream, fontSize: 14, cursor: 'pointer',
                        }}
                      >
                        Didn&apos;t apply
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {data.finished_am.length > 0 && (
              <div style={{ marginTop: 18 }}>
                <div style={{ color: C.tan, fontSize: 13, fontWeight: 700, marginBottom: 6 }}>
                  Finished this morning
                </div>
                {data.finished_am.map(item => (
                  <div key={item.id} style={{ color: C.lightBrown, fontSize: 14, padding: '4px 0', textDecoration: 'line-through' }}>
                    {item.area_name} · {item.title}
                    <span style={{ textDecoration: 'none', color: C.lightBrown, fontSize: 12 }}> — {item.done_by}</span>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function Row({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div style={{ display: 'flex', gap: 10, fontSize: 14, padding: '3px 0' }}>
      <span style={{ color: C.tan, minWidth: 90 }}>{label}</span>
      <span style={{ color: tone ?? C.cream, fontWeight: tone ? 700 : 400 }}>{value}</span>
    </div>
  )
}
