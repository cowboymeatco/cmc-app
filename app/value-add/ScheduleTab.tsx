'use client'

// The smokehouse schedule board.
//
// The house is ONE lane (see lib/cookPredict.ts), so this is a queue, not a
// calendar grid: jobs run back to back in the order the crew sets, and every
// downstream time falls out of that order. Move a job up and everything after
// it shifts — which is exactly what happens on the floor.
import { useEffect, useState, useCallback, useMemo } from 'react'
import { ValueAddJob } from '@/lib/types'
import {
  CookProfile, CookSettings, DEFAULT_SETTINGS, PlannedJob,
  planHouse, fmtDuration, fmtClock, fmtDayClock,
} from '@/lib/cookPredict'
import { MIN_JOBS_FOR_SUGGESTION } from '@/lib/loadLearning'
import SmokehouseBookPanel from './SmokehouseBookPanel'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#E53E3E',
  yellow:     '#D97706',
  blue:       '#3B82F6',
  orange:     '#E8883A',
  purple:     '#A78BFA',
}

const BTN = (bg: string, color = C.dark): React.CSSProperties => ({
  background: bg, color, border: 'none', borderRadius: 3,
  padding: '0.5rem 1.1rem', fontSize: '0.83rem', fontWeight: 600,
  cursor: 'pointer', letterSpacing: '0.04em',
})
const INPUT: React.CSSProperties = {
  background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)',
  borderRadius: 3, padding: '0.4rem 0.6rem', color: C.cream, fontSize: '0.85rem',
  outline: 'none', boxSizing: 'border-box',
}
const LABEL: React.CSSProperties = {
  display: 'block', fontSize: '0.68rem', color: C.lightBrown,
  textTransform: 'uppercase', letterSpacing: '0.09em', marginBottom: '0.3rem',
}

const CONFIDENCE_COLOR = { high: C.green, medium: C.yellow, low: C.red } as const
const CONFIDENCE_NOTE = {
  high:   'Tight spread over many cooks',
  medium: 'Fewer cooks or a looser spread',
  low:    'Thin history — treat as a rough guess',
} as const

// ── Small pieces ─────────────────────────────────────────────────────────────

function Pill({ color, children, title }: { color: string; children: React.ReactNode; title?: string }) {
  return (
    <span title={title} style={{
      background: `${color}22`, border: `1px solid ${color}55`, color,
      fontSize: '0.68rem', fontWeight: 700, borderRadius: 99,
      padding: '2px 8px', whiteSpace: 'nowrap',
    }}>{children}</span>
  )
}

/** The recipe the controller actually runs, as a stacked bar. */
function StagePlanBar({ profile }: { profile: CookProfile }) {
  const plan = profile.stage_plan
  if (!plan || plan.length === 0) return null
  const total = plan.reduce((s, x) => s + x.minutes, 0)
  if (total <= 0) return null

  // Hotter stage = hotter color, so the shape of a cook reads at a glance.
  const temps = plan.map(p => p.sp_f)
  const hi = Math.max(...temps, 1)

  return (
    <div>
      <div style={{ display: 'flex', height: 10, borderRadius: 2, overflow: 'hidden', border: '1px solid rgba(166,120,90,0.25)' }}>
        {plan.map((s, i) => {
          const heat = Math.max(0, Math.min(1, s.sp_f / hi))
          return (
            <div
              key={i}
              title={`${s.sp_f}°F for ${fmtDuration(s.minutes)}`}
              style={{
                width: `${(s.minutes / total) * 100}%`,
                background: s.sp_f === 0
                  ? 'rgba(59,130,246,0.5)'                       // 0°F setpoint = the shower/chill step
                  : `rgba(${Math.round(120 + 135 * heat)},${Math.round(110 - 40 * heat)},40,0.85)`,
              }}
            />
          )
        })}
      </div>
      <div style={{ fontSize: '0.66rem', color: C.lightBrown, marginTop: '0.25rem' }}>
        {plan.map(s => (s.sp_f === 0 ? 'shower' : `${s.sp_f}°`)).join(' → ')}
      </div>
    </div>
  )
}

// ── Queue row ────────────────────────────────────────────────────────────────

function QueueRow({
  planned, index, count, onMove, onToggleLock, onSetProfile, profiles,
}: {
  planned:  PlannedJob
  index:    number
  count:    number
  onMove:   (from: number, to: number) => void
  onToggleLock: (job: ValueAddJob) => void
  onSetProfile: (job: ValueAddJob, key: string) => void
  profiles: CookProfile[]
}) {
  const { job, start, end, prediction, overnight } = planned
  const [open, setOpen] = useState(false)

  const locked = job.schedule_locked && !!job.scheduled_start
  const label  = job.output_item_name || job.description || 'Untitled job'
  const conf   = prediction?.confidence

  return (
    <div style={{
      background: C.dark,
      border: '1px solid rgba(166,120,90,0.2)',
      borderLeft: `4px solid ${locked ? C.purple : prediction ? C.orange : C.red}`,
      borderRadius: 4, padding: '0.7rem 0.9rem',
    }}>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
        {/* Order controls — the crew's priority IS the schedule */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
          <button
            onClick={() => onMove(index, index - 1)}
            disabled={index === 0 || locked}
            title="Move earlier"
            style={{
              background: 'transparent', border: '1px solid rgba(166,120,90,0.3)',
              color: index === 0 || locked ? 'rgba(166,120,90,0.3)' : C.tan,
              borderRadius: 2, cursor: index === 0 || locked ? 'default' : 'pointer',
              fontSize: '0.6rem', lineHeight: 1, padding: '2px 5px',
            }}>▲</button>
          <button
            onClick={() => onMove(index, index + 1)}
            disabled={index === count - 1 || locked}
            title="Move later"
            style={{
              background: 'transparent', border: '1px solid rgba(166,120,90,0.3)',
              color: index === count - 1 || locked ? 'rgba(166,120,90,0.3)' : C.tan,
              borderRadius: 2, cursor: index === count - 1 || locked ? 'default' : 'pointer',
              fontSize: '0.6rem', lineHeight: 1, padding: '2px 5px',
            }}>▼</button>
        </div>

        {/* Times — the whole point of the board */}
        <div style={{ minWidth: 132 }}>
          <div style={{ color: C.cream, fontWeight: 700, fontSize: '0.95rem', letterSpacing: '-0.01em' }}>
            {fmtClock(start)}
          </div>
          <div style={{ fontSize: '0.7rem', color: C.lightBrown }}>
            out {fmtDayClock(end, start)}
          </div>
        </div>

        {/* Identity */}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {label}
          </div>
          <div style={{ fontSize: '0.72rem', color: C.lightBrown, display: 'flex', gap: '0.5rem', flexWrap: 'wrap', marginTop: '0.15rem' }}>
            {job.customer_name && <span style={{ color: C.tan, fontWeight: 700 }}>👤 {job.customer_name}</span>}
            {job.weight_in_lbs != null && <span>{Number(job.weight_in_lbs).toFixed(0)} lbs in</span>}
            {job.tag_code && <span style={{ fontFamily: 'monospace' }}>{job.tag_code}</span>}
          </div>
        </div>

        {/* Prediction */}
        <div style={{ display: 'flex', gap: '0.4rem', alignItems: 'center', flexShrink: 0 }}>
          {prediction ? (
            <>
              <Pill color={C.orange}>{fmtDuration(prediction.minutes)}</Pill>
              {prediction.batches > 1 && <Pill color={C.blue}>{prediction.batches} loads</Pill>}
              {conf && (
                <Pill color={CONFIDENCE_COLOR[conf]}
                      title={`${CONFIDENCE_NOTE[conf]} · ${prediction.profile.n_observations} cooks · ${prediction.basis}`}>
                  {conf}
                </Pill>
              )}
            </>
          ) : (
            <Pill color={C.red} title="No cook profile matched this job — pick one so it can be scheduled">
              no profile
            </Pill>
          )}
          {overnight && <Pill color={C.purple} title="Comes out after hours — somebody has to pull it">🌙</Pill>}
          <button
            onClick={() => onToggleLock(job)}
            title={locked ? 'Unpin from this time' : 'Pin to this time'}
            style={{
              background: locked ? `${C.purple}22` : 'transparent',
              border: `1px solid ${locked ? C.purple : 'rgba(166,120,90,0.3)'}`,
              color: locked ? C.purple : C.lightBrown,
              borderRadius: 3, cursor: 'pointer', fontSize: '0.75rem', padding: '0.25rem 0.5rem',
            }}>{locked ? '📌' : '📍'}</button>
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              background: 'transparent', border: '1px solid rgba(166,120,90,0.3)',
              color: C.lightBrown, borderRadius: 3, cursor: 'pointer',
              fontSize: '0.75rem', padding: '0.25rem 0.5rem',
            }}>{open ? '▴' : '▾'}</button>
        </div>
      </div>

      {open && (
        <div style={{ marginTop: '0.75rem', paddingTop: '0.75rem', borderTop: '1px solid rgba(166,120,90,0.15)', display: 'grid', gap: '0.75rem' }}>
          <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div>
              <label style={LABEL}>Cook Profile</label>
              <select
                style={{ ...INPUT, minWidth: 220 }}
                value={prediction?.profile.profile_key ?? ''}
                onChange={e => onSetProfile(job, e.target.value)}
              >
                <option value="">— none —</option>
                {profiles.map(p => (
                  <option key={p.profile_key} value={p.profile_key}>
                    {p.display_name} · {fmtDuration(p.p50_minutes)}
                  </option>
                ))}
              </select>
            </div>
            {prediction && (
              <div style={{ fontSize: '0.75rem', color: C.lightBrown }}>
                <div>
                  Range <strong style={{ color: C.tan }}>{fmtDuration(prediction.optimistic)}</strong>
                  {' – '}
                  <strong style={{ color: C.tan }}>{fmtDuration(prediction.pessimistic)}</strong>
                  {' '}(p10–p90)
                </div>
                <div style={{ marginTop: '0.2rem' }}>
                  From <strong style={{ color: C.tan }}>{prediction.profile.n_observations}</strong> logged cooks · {prediction.basis}
                </div>
                {(prediction.setupMinutes > 0 || prediction.teardownMinutes > 0) && (
                  <div style={{ marginTop: '0.2rem' }}>
                    Includes {fmtDuration(prediction.setupMinutes)} prep + {fmtDuration(prediction.teardownMinutes)} pack out
                  </div>
                )}
              </div>
            )}
          </div>
          {prediction && <StagePlanBar profile={prediction.profile} />}
          {job.notes && (
            <div style={{ fontSize: '0.78rem', color: C.tan, fontStyle: 'italic' }}>{job.notes}</div>
          )}
        </div>
      )}
    </div>
  )
}

// ── Day ruler ────────────────────────────────────────────────────────────────

/** One horizontal bar per calendar day showing what the house is doing. */
function DayStrip({ planned, settings }: { planned: PlannedJob[]; settings: CookSettings }) {
  const days = useMemo(() => {
    const map = new Map<string, PlannedJob[]>()
    for (const p of planned) {
      // A cook that runs past midnight belongs to every day it touches, or the
      // strip would show an empty morning after an overnight snack-stick run.
      const cur = new Date(p.start); cur.setHours(0, 0, 0, 0)
      const last = new Date(p.end);  last.setHours(0, 0, 0, 0)
      while (cur <= last) {
        const k = cur.toDateString()
        const b = map.get(k); if (b) b.push(p); else map.set(k, [p])
        cur.setDate(cur.getDate() + 1)
      }
    }
    return Array.from(map.entries()).slice(0, 7)
  }, [planned])

  if (days.length === 0) return null

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
      {days.map(([key, jobs]) => {
        const day = new Date(key)
        const dayStart = new Date(day); dayStart.setHours(0, 0, 0, 0)
        const span = 24 * 60

        const busy = jobs.reduce((s, p) => {
          const a = Math.max(p.start.getTime(), dayStart.getTime())
          const b = Math.min(p.end.getTime(), dayStart.getTime() + span * 60000)
          return s + Math.max(0, (b - a) / 60000)
        }, 0)

        return (
          <div key={key}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.72rem', color: C.lightBrown, marginBottom: '0.25rem' }}>
              <span style={{ color: C.tan, fontWeight: 700 }}>
                {day.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}
              </span>
              <span>{Math.round(busy / 60)}h in the house · {Math.round(busy / span * 100)}% utilized</span>
            </div>
            <div style={{ position: 'relative', height: 26, background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 3, overflow: 'hidden' }}>
              {/* shift shading */}
              <div style={{
                position: 'absolute',
                left:  `${settings.day_start_hour / 24 * 100}%`,
                width: `${(settings.day_end_hour - settings.day_start_hour) / 24 * 100}%`,
                top: 0, bottom: 0, background: 'rgba(255,255,255,0.04)',
              }} />
              {jobs.map((p, i) => {
                const a = Math.max(p.start.getTime(), dayStart.getTime())
                const b = Math.min(p.end.getTime(), dayStart.getTime() + span * 60000)
                const left = (a - dayStart.getTime()) / 60000 / span * 100
                const width = Math.max(0.6, (b - a) / 60000 / span * 100)
                return (
                  <div
                    key={i}
                    title={`${p.job.output_item_name || p.job.description} · ${fmtClock(p.start)} → ${fmtClock(p.end)}`}
                    style={{
                      position: 'absolute', left: `${left}%`, width: `${width}%`,
                      top: 3, bottom: 3, borderRadius: 2,
                      background: p.job.schedule_locked ? C.purple : C.orange,
                      opacity: 0.85, overflow: 'hidden',
                      fontSize: '0.62rem', color: C.dark, fontWeight: 700,
                      padding: '0 4px', lineHeight: '20px', whiteSpace: 'nowrap',
                    }}>
                    {width > 8 ? (p.job.output_item_name || p.job.description) : ''}
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── Main tab ─────────────────────────────────────────────────────────────────

function roundToNextQuarter(d: Date): Date {
  const x = new Date(d)
  x.setSeconds(0, 0)
  x.setMinutes(Math.ceil(x.getMinutes() / 15) * 15)
  return x
}

/** <input type="datetime-local"> wants local wall time, not an ISO instant. */
function toLocalInput(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`
}

export default function ScheduleTab() {
  const [jobs,     setJobs]     = useState<ValueAddJob[]>([])
  const [profiles, setProfiles] = useState<CookProfile[]>([])
  const [settings, setSettings] = useState<CookSettings>(DEFAULT_SETTINGS)
  const [order,    setOrder]    = useState<string[]>([])
  const [startAt,  setStartAt]  = useState(() => toLocalInput(roundToNextQuarter(new Date())))
  const [loading,  setLoading]  = useState(true)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState<string | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [dirty,    setDirty]    = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [jobRes, profRes] = await Promise.all([
        fetch('/api/value-add').then(r => r.json()),
        fetch('/api/cook-profile').then(r => r.json()),
      ])
      const open = Array.isArray(jobRes)
        ? (jobRes as ValueAddJob[]).filter(j => j.status !== 'complete')
        : []
      setJobs(open)
      setProfiles(Array.isArray(profRes?.profiles) ? profRes.profiles : [])
      if (profRes?.settings) setSettings(profRes.settings as CookSettings)

      // Start from whatever was last published: scheduled jobs in their saved
      // order, then anything new that has never been placed.
      const placed = open.filter(j => j.scheduled_start)
        .sort((a, b) => String(a.scheduled_start).localeCompare(String(b.scheduled_start)))
      const fresh = open.filter(j => !j.scheduled_start)
      setOrder([...placed, ...fresh].map(j => j.id))
      setDirty(false)
    } catch {
      setError('Could not load the schedule.')
    }
    setLoading(false)
  }, [])

  useEffect(() => { load() }, [load])

  const ordered = useMemo(() => {
    const byId = new Map(jobs.map(j => [j.id, j]))
    return order.map(id => byId.get(id)).filter((j): j is ValueAddJob => !!j)
  }, [jobs, order])

  const plan = useMemo(() => {
    const from = startAt ? new Date(startAt) : new Date()
    return planHouse(ordered, profiles, settings, from)
  }, [ordered, profiles, settings, startAt])

  function move(from: number, to: number) {
    if (to < 0 || to >= order.length) return
    setOrder(prev => {
      const next = [...prev]
      const [x] = next.splice(from, 1)
      next.splice(to, 0, x)
      return next
    })
    setDirty(true)
  }

  function toggleLock(job: ValueAddJob) {
    // Pinning uses the time the board currently shows for that job, so what
    // you see is what gets frozen.
    const placed = plan.scheduled.find(p => p.job.id === job.id)
    setJobs(prev => prev.map(j => j.id === job.id
      ? {
        ...j,
        schedule_locked: !job.schedule_locked,
        scheduled_start: !job.schedule_locked
          ? (placed?.start ?? new Date()).toISOString()
          : j.scheduled_start,
      }
      : j))
    setDirty(true)
  }

  function setProfile(job: ValueAddJob, key: string) {
    setJobs(prev => prev.map(j => j.id === job.id ? { ...j, profile_key: key || null } : j))
    setDirty(true)
  }

  async function publish() {
    setSaving(true)
    setError(null)
    const payload = plan.scheduled.map(p => ({
      id:                p.job.id,
      scheduled_start:   p.start.toISOString(),
      predicted_minutes: Math.round((p.end.getTime() - p.start.getTime()) / 60000),
      profile_key:       p.prediction?.profile.profile_key ?? p.job.profile_key ?? null,
      batch_count:       p.prediction?.batches ?? null,
      resource:          'smokehouse',
      schedule_locked:   p.job.schedule_locked ?? false,
    }))

    try {
      const res = await fetch('/api/value-add', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ schedule: payload }),
      })
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        throw new Error(body?.error ?? 'save failed')
      }
      setSaved(`Published ${payload.length} job${payload.length === 1 ? '' : 's'} to the house schedule`)
      setDirty(false)
      setTimeout(() => setSaved(null), 5000)
      await load()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not publish the schedule.')
    }
    setSaving(false)
  }

  const totalMinutes = plan.scheduled.reduce(
    (s, p) => s + (p.end.getTime() - p.start.getTime()) / 60000, 0)

  if (loading) {
    return <div style={{ color: C.lightBrown, padding: '2rem', textAlign: 'center' }}>Loading schedule…</div>
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.25rem' }}>
      {/* Controls */}
      <div style={{
        background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4,
        padding: '1rem 1.25rem', display: 'flex', gap: '1.25rem', alignItems: 'flex-end', flexWrap: 'wrap',
      }}>
        <div>
          <label style={LABEL}>House free from</label>
          <input
            type="datetime-local"
            style={{ ...INPUT, width: 210 }}
            value={startAt}
            onChange={e => { setStartAt(e.target.value); setDirty(true) }}
          />
        </div>
        <div style={{ fontSize: '0.75rem', color: C.lightBrown, lineHeight: 1.7 }}>
          <div>
            <strong style={{ color: C.tan }}>{settings.houses}</strong> smokehouse ·
            {' '}<strong style={{ color: C.tan }}>{settings.changeover_minutes}m</strong> changeover between cooks
          </div>
          <div>
            <strong style={{ color: C.tan }}>{plan.scheduled.length}</strong> queued ·
            {' '}<strong style={{ color: C.tan }}>{fmtDuration(totalMinutes)}</strong> of house time
            {plan.houseEnd && <> · clear by <strong style={{ color: C.tan }}>{fmtDayClock(plan.houseEnd)}</strong></>}
          </div>
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', gap: '0.6rem', alignItems: 'center' }}>
          <button style={{ ...BTN('transparent', C.lightBrown), border: '1px solid rgba(166,120,90,0.35)' }}
                  onClick={load} disabled={saving}>
            Reset
          </button>
          <button style={{ ...BTN(dirty ? C.green : C.medBrown, dirty ? C.dark : C.lightBrown) }}
                  onClick={publish} disabled={saving || plan.scheduled.length === 0}>
            {saving ? 'Publishing…' : '📤 Publish Schedule'}
          </button>
        </div>
      </div>

      {saved && (
        <div style={{ background: 'rgba(76,175,80,0.15)', border: '1px solid rgba(76,175,80,0.4)', borderRadius: 4, padding: '0.7rem 1rem', color: C.green, fontSize: '0.85rem' }}>
          ✓ {saved}
        </div>
      )}
      {error && (
        <div style={{ background: 'rgba(229,62,62,0.15)', border: '1px solid rgba(229,62,62,0.4)', borderRadius: 4, padding: '0.7rem 1rem', color: C.red, fontSize: '0.85rem' }}>
          {error}
        </div>
      )}

      {plan.scheduled.length === 0 && plan.unplannable.length === 0 && (
        <div style={{ color: C.lightBrown, fontSize: '0.9rem', padding: '3rem', textAlign: 'center', background: C.dark, borderRadius: 4, border: '1px solid rgba(166,120,90,0.2)' }}>
          Nothing in the queue — open jobs show up here automatically.
        </div>
      )}

      {plan.scheduled.length > 0 && (
        <>
          <div>
            <div style={{ fontSize: '0.72rem', color: C.orange, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: '0.6rem' }}>
              🔥 House Queue · {plan.scheduled.length}
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              {plan.scheduled.map((p, i) => (
                <QueueRow
                  key={p.job.id}
                  planned={p}
                  index={i}
                  count={plan.scheduled.length}
                  onMove={move}
                  onToggleLock={toggleLock}
                  onSetProfile={setProfile}
                  profiles={profiles}
                />
              ))}
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: '0.6rem' }}>
              📅 Days
            </div>
            <DayStrip planned={plan.scheduled} settings={settings} />
          </div>
        </>
      )}

      {plan.unplannable.length > 0 && (
        <div>
          <div style={{ fontSize: '0.72rem', color: C.red, textTransform: 'uppercase', letterSpacing: '0.12em', fontWeight: 700, marginBottom: '0.6rem' }}>
            ⚠️ Needs a cook profile · {plan.unplannable.length}
          </div>
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginBottom: '0.6rem' }}>
            Nothing in the cook history matches these, so the board can&apos;t time them. Pick a profile and they join the queue.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            {plan.unplannable.map(job => (
              <div key={job.id} style={{
                background: C.dark, border: '1px solid rgba(229,62,62,0.3)', borderLeft: `4px solid ${C.red}`,
                borderRadius: 4, padding: '0.7rem 0.9rem', display: 'flex', gap: '0.75rem', alignItems: 'center',
              }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: C.cream, fontWeight: 600, fontSize: '0.9rem' }}>
                    {job.output_item_name || job.description || 'Untitled job'}
                  </div>
                  <div style={{ fontSize: '0.72rem', color: C.lightBrown }}>
                    {job.customer_name ?? 'CMC shelf stock'}
                    {job.tag_code && <span style={{ fontFamily: 'monospace' }}> · {job.tag_code}</span>}
                  </div>
                </div>
                <select
                  style={{ ...INPUT, minWidth: 210 }}
                  value={job.profile_key ?? ''}
                  onChange={e => setProfile(job, e.target.value)}
                >
                  <option value="">— pick a cook profile —</option>
                  {profiles.map(p => (
                    <option key={p.profile_key} value={p.profile_key}>
                      {p.display_name} · {fmtDuration(p.p50_minutes)}
                    </option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* What the house is committed to, ahead of the queue it's laid into. */}
      <SmokehouseBookPanel />

      <ProfilePanel profiles={profiles} settings={settings} onChanged={load} />
    </div>
  )
}

// ── Profile reference / tuning ───────────────────────────────────────────────

interface LoadObservation {
  profile_key:   string
  display_name:  string
  jobs:          number
  maxLoadLbs:    number | null
  medianLoadLbs: number | null
  suggestion:    number | null
  confidence:    'none' | 'low' | 'medium' | 'high'
  jobsNeeded:    number
  reason:        string
  current_lbs_per_batch: number | null
  yield:         { n: number; medianYieldPct: number | null }
}

// What the jobs run so far say about how much goes into a load. The controller
// logs never recorded it, so this is the only route to the number — and it only
// speaks up once there is enough behind it to mean something.
function ObservedLoad({ obs, onApply }: { obs: LoadObservation; onApply: (lbs: number) => void }) {
  // Nothing to say yet, and no stored value to explain — stay out of the way.
  if (obs.jobs === 0 && obs.yield.n === 0 && obs.current_lbs_per_batch == null) return null

  const color = obs.suggestion ? C.green : obs.jobs > 0 ? C.yellow : C.lightBrown

  return (
    <div style={{ marginTop: '0.5rem', paddingTop: '0.5rem', borderTop: '1px dashed rgba(166,120,90,0.2)', fontSize: '0.72rem' }}>
      <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
        <span style={{ color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', fontSize: '0.65rem' }}>
          Learned load size
        </span>
        {obs.jobs > 0 && (
          <span style={{ color: C.tan }}>
            {obs.jobs} single-load job{obs.jobs === 1 ? '' : 's'} · biggest {obs.maxLoadLbs} lbs in
          </span>
        )}
        {obs.yield.n > 0 && obs.yield.medianYieldPct != null && (
          <Pill color={C.blue} title={`From ${obs.yield.n} job${obs.yield.n === 1 ? '' : 's'} with both weights recorded`}>
            {obs.yield.medianYieldPct}% yield
          </Pill>
        )}
        {obs.suggestion != null && (
          <button
            style={{ ...BTN(C.green), fontSize: '0.72rem', padding: '0.2rem 0.6rem' }}
            onClick={() => onApply(obs.suggestion as number)}
          >
            Use {obs.suggestion} lbs/load
          </button>
        )}
      </div>
      <div style={{ color, marginTop: '0.25rem' }}>
        {obs.reason}
        {obs.jobsNeeded > 0 && obs.jobs > 0 &&
          ` ${obs.jobsNeeded} more single-load job${obs.jobsNeeded === 1 ? '' : 's'} and this can set the load size.`}
      </div>
    </div>
  )
}

function ProfilePanel({
  profiles, settings, onChanged,
}: { profiles: CookProfile[]; settings: CookSettings; onChanged: () => void }) {
  const [open, setOpen] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [draft, setDraft] = useState<{ setup: string; teardown: string; lbs: string; units: string; unitLabel: string }>(
    { setup: '', teardown: '', lbs: '', units: '', unitLabel: '' })
  const [busy, setBusy] = useState(false)
  const [observed, setObserved] = useState<Map<string, LoadObservation>>(new Map())

  // Only fetched once the panel is opened — it reads every box scan, which is
  // far too much work to do behind a collapsed section nobody has expanded.
  useEffect(() => {
    if (!open) return
    fetch('/api/cook-profile/observed')
      .then(r => r.json())
      .then((d: { observations?: LoadObservation[] }) => {
        if (Array.isArray(d?.observations)) {
          setObserved(new Map(d.observations.map(o => [o.profile_key, o])))
        }
      })
      .catch(() => {})
  }, [open])

  async function applyLearned(p: CookProfile, lbs: number) {
    setBusy(true)
    await fetch('/api/cook-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: p.id, lbs_per_batch: lbs }),
    })
    setBusy(false)
    onChanged()
  }

  function startEdit(p: CookProfile) {
    setEditing(p.id)
    setDraft({
      setup:    String(p.setup_minutes ?? 0),
      teardown: String(p.teardown_minutes ?? 0),
      lbs:      p.lbs_per_batch   != null ? String(p.lbs_per_batch)   : '',
      units:    p.units_per_batch != null ? String(p.units_per_batch) : '',
      unitLabel: p.unit_label ?? '',
    })
  }

  async function save(p: CookProfile) {
    setBusy(true)
    await fetch('/api/cook-profile', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: p.id,
        setup_minutes:    parseInt(draft.setup, 10) || 0,
        teardown_minutes: parseInt(draft.teardown, 10) || 0,
        lbs_per_batch:    draft.lbs   ? parseFloat(draft.lbs)     : null,
        units_per_batch:  draft.units ? parseInt(draft.units, 10) : null,
        unit_label:       draft.unitLabel.trim() || null,
      }),
    })
    setBusy(false)
    setEditing(null)
    onChanged()
  }

  // Either basis counts — a profile with 24 hams to a load knows its capacity
  // even with no pounds figure behind it.
  const needsInput = profiles.filter(p => !p.lbs_per_batch && !p.units_per_batch).length

  return (
    <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          width: '100%', background: 'transparent', border: 'none', cursor: 'pointer',
          padding: '0.85rem 1.1rem', display: 'flex', alignItems: 'center', gap: '0.6rem',
          color: C.tan, fontSize: '0.8rem', fontWeight: 700, letterSpacing: '0.06em',
          textTransform: 'uppercase', textAlign: 'left',
        }}>
        <span>{open ? '▾' : '▸'}</span>
        <span>🌡️ Cook Profiles · {profiles.length}</span>
        {needsInput > 0 && (
          <span style={{ marginLeft: 'auto', textTransform: 'none', letterSpacing: 0, fontWeight: 600, fontSize: '0.72rem', color: C.yellow }}>
            {needsInput} missing a batch size
          </span>
        )}
      </button>

      {open && (
        <div style={{ padding: '0 1.1rem 1.1rem' }}>
          <div style={{ fontSize: '0.75rem', color: C.lightBrown, marginBottom: '0.85rem', lineHeight: 1.6 }}>
            Durations are fitted from <strong style={{ color: C.tan }}>1,048 logged cook cycles</strong> off the
            smokehouse controller. The house runs one cook at a time with about{' '}
            <strong style={{ color: C.tan }}>{settings.changeover_minutes} minutes</strong> between loads.
            <br />
            <strong style={{ color: C.yellow }}>Prep, pack-out, and batch size are not in the controller log</strong> —
            they start at zero, and the schedule only accounts for them once you set them here.
            <br />
            Load size is also being <strong style={{ color: C.tan }}>learned from the jobs you run</strong>: each
            completed job records the pounds that went in, and once a product has{' '}
            {MIN_JOBS_FOR_SUGGESTION} single-load jobs behind it, the figure below can set it for you.
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
            {profiles.map(p => (
              <div key={p.id} style={{
                background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(166,120,90,0.15)',
                borderRadius: 3, padding: '0.6rem 0.8rem',
              }}>
                <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'center', flexWrap: 'wrap' }}>
                  <span style={{ color: C.cream, fontWeight: 600, fontSize: '0.85rem', minWidth: 150 }}>
                    {p.display_name}
                  </span>
                  <Pill color={C.orange}>{fmtDuration(p.p50_minutes)}</Pill>
                  <span style={{ fontSize: '0.7rem', color: C.lightBrown }}>
                    {fmtDuration(p.p10_minutes)}–{fmtDuration(p.p90_minutes)}
                  </span>
                  <span style={{ fontSize: '0.7rem', color: C.lightBrown }}>
                    {p.n_observations} cooks
                  </span>
                  {p.units_per_batch != null && (
                    <Pill color={C.tan} title="Counted on the floor, not fitted from the logs">
                      {p.units_per_batch} {p.unit_label ?? 'per load'}{p.unit_label ? '/load' : ''}
                    </Pill>
                  )}
                  {p.target_core_f != null && <Pill color={C.red}>{Math.round(Number(p.target_core_f))}°F core</Pill>}
                  {p.typical_start_hour != null && (
                    <span style={{ fontSize: '0.7rem', color: C.lightBrown }}>
                      usually in at {p.typical_start_hour}:00
                    </span>
                  )}
                  {(p.overnight_pct ?? 0) >= 50 && <Pill color={C.purple}>🌙 overnight</Pill>}
                  {p.source === 'manual' && <Pill color={C.blue} title="Hand-tuned — a reseed from the logs will leave it alone">tuned</Pill>}
                  {p.basis && p.basis !== 'all history' && (
                    <Pill color={C.yellow} title="Recipe changed, so older cooks were dropped from the fit">{p.basis}</Pill>
                  )}
                  <button
                    onClick={() => (editing === p.id ? setEditing(null) : startEdit(p))}
                    style={{
                      marginLeft: 'auto', background: 'transparent',
                      border: '1px solid rgba(166,120,90,0.3)', color: C.lightBrown,
                      borderRadius: 3, cursor: 'pointer', fontSize: '0.72rem', padding: '0.2rem 0.6rem',
                    }}>
                    {editing === p.id ? 'Cancel' : '✎ Tune'}
                  </button>
                </div>

                {editing === p.id && (
                  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', marginTop: '0.7rem', flexWrap: 'wrap' }}>
                    <div>
                      <label style={LABEL}>Prep before (min)</label>
                      <input type="number" min="0" style={{ ...INPUT, width: 120 }}
                             value={draft.setup} onChange={e => setDraft(d => ({ ...d, setup: e.target.value }))} />
                    </div>
                    <div>
                      <label style={LABEL}>Pack out after (min)</label>
                      <input type="number" min="0" style={{ ...INPUT, width: 130 }}
                             value={draft.teardown} onChange={e => setDraft(d => ({ ...d, teardown: e.target.value }))} />
                    </div>
                    <div>
                      <label style={LABEL}>Lbs per load</label>
                      <input type="number" min="0" step="1" style={{ ...INPUT, width: 120 }}
                             placeholder="one load"
                             value={draft.lbs} onChange={e => setDraft(d => ({ ...d, lbs: e.target.value }))} />
                    </div>
                    {/* The floor counts hams, not pounds of ham. Either basis can
                        size a load; whichever needs more loads wins. */}
                    <div>
                      <label style={LABEL}>Pieces per load</label>
                      <input type="number" min="0" step="1" style={{ ...INPUT, width: 120 }}
                             placeholder="not counted"
                             value={draft.units} onChange={e => setDraft(d => ({ ...d, units: e.target.value }))} />
                    </div>
                    <div>
                      <label style={LABEL}>Called</label>
                      <input type="text" style={{ ...INPUT, width: 120 }}
                             placeholder="hams"
                             value={draft.unitLabel} onChange={e => setDraft(d => ({ ...d, unitLabel: e.target.value }))} />
                    </div>
                    <button style={{ ...BTN(C.green), padding: '0.4rem 0.9rem', fontSize: '0.78rem' }}
                            onClick={() => save(p)} disabled={busy}>
                      {busy ? '…' : 'Save'}
                    </button>
                    <span style={{ fontSize: '0.7rem', color: C.lightBrown, maxWidth: 260 }}>
                      A job heavier — or with more pieces — than one load is scheduled as
                      back-to-back cooks.
                    </span>
                  </div>
                )}

                {editing === p.id && <div style={{ marginTop: '0.6rem' }}><StagePlanBar profile={p} /></div>}

                {observed.get(p.profile_key) && (
                  <ObservedLoad
                    obs={observed.get(p.profile_key) as LoadObservation}
                    onApply={lbs => applyLearned(p, lbs)}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
