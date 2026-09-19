'use client'
import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { crewMinutesByStep, type Segment, type StudyProduct } from '@/lib/laborStudy'

// Timing study — Charlie's phone on the floor. Pick the cut day the bellies
// came off, start the study, and tap each hands-on step as it starts and
// stops with how many people are on it. Finished pounds fill in from the
// packing scans; nobody has to weigh anything. See lib/laborStudy.

const C = {
  dark: '#1A0A04', darkBrown: '#351E0E', medBrown: '#75471B',
  lightBrown: '#A6785A', tan: '#C9A882', cream: '#F2E8D9',
}
const GO = '#3E9D63'
const STOP = '#CE6A20'

interface CutDaySummary {
  date: string; tags: number; tagsDone: number; weighed: number; weighedLbs: number
  customers: { name: string; tags: number }[]; head: number; carcassLbs: number; finishedSoFar: number
}
interface History { lbPerTag: number; runs: number; tags: number }
interface Study {
  id: string; product: string; cut_date: string; customers: string[]; tag_count: number
  green_lbs: number | null; notes: string | null; status: 'open' | 'closed'; created_at: string
  segments: (Segment & { id: string })[]; finishedLbs: number
}
interface Payload { product: StudyProduct; cutDays: { date: string; tags: number }[]; history: History | null; studies: Study[] }

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const dayLabel = (iso: string) => `${WEEKDAY[new Date(`${iso}T12:00:00`).getDay()]} ${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}`
const f1 = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 1 })
const clock = (mins: number) => { const s = Math.floor(mins * 60); return `${Math.floor(s / 3600)}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}` }

const card: React.CSSProperties = { background: C.dark, border: '1px solid rgba(166,120,90,0.2)', borderRadius: 6, padding: '1rem', marginBottom: '0.9rem' }
const label: React.CSSProperties = { fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }
const btn = (bg: string): React.CSSProperties => ({ background: bg, color: C.cream, border: 'none', borderRadius: 6, padding: '0.7rem 1rem', fontSize: '1rem', fontWeight: 700, cursor: 'pointer' })

export default function StudyPage() {
  const [data, setData] = useState<Payload | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [unauth, setUnauth] = useState(false)
  const [pick, setPick] = useState('')
  const [day, setDay] = useState<CutDaySummary | null>(null)
  const [crew, setCrew] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [, tick] = useState(0)

  const load = useCallback(async () => {
    const r = await fetch('/api/exec/study?product=bacon')
    if (r.status === 401) { setUnauth(true); return }
    const d = await r.json()
    if (d.error) { setErr(d.error); return }
    setErr(null); setData(d)
    setPick(p => p || d.cutDays[0]?.date || '')
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { const t = setInterval(() => tick(n => n + 1), 1000); return () => clearInterval(t) }, [])
  useEffect(() => {
    if (!pick) { setDay(null); return }
    fetch(`/api/exec/study?product=bacon&date=${pick}`).then(r => r.json()).then(d => setDay(d.day ?? null))
  }, [pick])

  const act = async (body: Record<string, unknown>) => {
    setBusy(true)
    try {
      const r = await fetch('/api/exec/study', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const d = await r.json()
      if (d.error) setErr(d.error)
      await load()
    } finally { setBusy(false) }
  }

  if (unauth) return (
    <main style={{ minHeight: '100vh', background: C.darkBrown, color: C.cream, padding: '2rem 1rem', fontFamily: 'system-ui, sans-serif' }}>
      Sign in on the <Link href="/exec" style={{ color: C.tan }}>exec dashboard</Link> first, then come back here.
    </main>
  )

  const open = data?.studies.find(s => s.status === 'open') ?? null
  const past = data?.studies.filter(s => s.status === 'closed') ?? []
  const history = data?.history ?? null

  return (
    <main style={{ minHeight: '100vh', background: C.darkBrown, color: C.tan, padding: '1rem', fontFamily: 'system-ui, sans-serif', maxWidth: 560, margin: '0 auto' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '0.75rem' }}>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.2rem', color: C.cream, margin: 0, textTransform: 'uppercase', letterSpacing: '0.06em' }}>Timing study · Bacon</h1>
        <Link href="/exec" style={{ color: C.lightBrown, fontSize: '0.8rem' }}>← exec</Link>
      </div>
      <p style={{ fontSize: '0.82rem', lineHeight: 1.45, marginTop: 0 }}>
        Time the hands-on work only — not the hold in the cooler or the cook. Tap Start when people pick up the job and Stop when they put it down; change the crew count by stopping and starting again.
      </p>
      {err && <div style={{ ...card, borderColor: STOP, color: C.cream }}>{err}</div>}
      {!data ? <div>Loading…</div> : open ? (
        <OpenStudy s={open} product={data.product} history={history} crew={crew} setCrew={setCrew} busy={busy} act={act} />
      ) : (
        <div style={card}>
          <div style={label}>Which cut day did the bellies come off?</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, margin: '0.6rem 0' }}>
            {data.cutDays.slice(0, 8).map(c => (
              <button key={c.date} onClick={() => setPick(c.date)} style={{
                ...btn(pick === c.date ? C.medBrown : 'transparent'), border: `1px solid ${C.medBrown}`, fontSize: '0.85rem', padding: '0.45rem 0.7rem', fontWeight: 600,
              }}>{dayLabel(c.date)} · {c.tags}</button>
            ))}
          </div>
          <input type="date" value={pick} onChange={e => setPick(e.target.value)}
            style={{ background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 6, padding: '0.5rem', fontSize: '1rem' }} />
          {day && <DaySummary day={day} history={history} />}
          <button disabled={busy || !day || day.tags === 0} onClick={() => act({ action: 'create', product: 'bacon', cut_date: pick })}
            style={{ ...btn(GO), width: '100%', marginTop: '0.9rem', opacity: !day || day.tags === 0 ? 0.4 : 1 }}>
            Start a study on {pick ? dayLabel(pick) : '…'}
          </button>
        </div>
      )}

      {past.length > 0 && data && (
        <>
          <div style={{ ...label, margin: '1.5rem 0 0.5rem' }}>Finished studies</div>
          {past.map(s => <Results key={s.id} s={s} product={data.product} act={act} />)}
        </>
      )}
    </main>
  )
}

function DaySummary({ day, history }: { day: CutDaySummary; history: History | null }) {
  const expected = history ? day.tags * history.lbPerTag : null
  return (
    <div style={{ marginTop: '0.75rem', fontSize: '0.88rem', lineHeight: 1.6 }}>
      <div style={{ color: C.cream, fontSize: '1.05rem', fontWeight: 600 }}>
        {day.tags} {day.tags === 1 ? 'belly' : 'bellies'} into cure · {day.customers.length} customers
      </div>
      {day.head > 0 && <div>{day.head} hogs cut, {f1(day.carcassLbs)} lb carcass</div>}
      {expected != null && (
        <div>Expect about <b style={{ color: C.cream }}>{f1(expected)} lb</b> finished bacon
          <span style={{ color: C.lightBrown }}> ({f1(history!.lbPerTag)} lb per belly over the last {history!.runs} finished cut days)</span></div>
      )}
      {day.weighed > 0 && <div>{day.weighed} of {day.tags} tags weighed: {f1(day.weighedLbs)} lb green</div>}
      {day.finishedSoFar > 0 && <div>{f1(day.finishedSoFar)} lb already packed</div>}
      <div style={{ color: C.lightBrown, fontSize: '0.78rem' }}>{day.customers.map(c => `${c.name}${c.tags > 1 ? ` ×${c.tags}` : ''}`).join(' · ')}</div>
    </div>
  )
}

function OpenStudy({ s, product, history, crew, setCrew, busy, act }: {
  s: Study; product: StudyProduct; history: History | null
  crew: Record<string, number>; setCrew: (f: (c: Record<string, number>) => Record<string, number>) => void
  busy: boolean; act: (b: Record<string, unknown>) => Promise<void>
}) {
  const mins = crewMinutesByStep(s.segments)
  const expected = history ? s.tag_count * history.lbPerTag : null
  return (
    <>
      <div style={card}>
        <div style={label}>Study open · cut day {dayLabel(s.cut_date)}</div>
        <div style={{ color: C.cream, fontSize: '1.05rem', fontWeight: 600, margin: '0.3rem 0' }}>
          {s.tag_count} bellies · {s.finishedLbs > 0 ? `${f1(s.finishedLbs)} lb packed so far` : expected != null ? `expect ~${f1(expected)} lb finished` : 'finished lb fills in at packing'}
        </div>
        <label style={{ fontSize: '0.8rem' }}>Green weight if you weighed (optional):{' '}
          <input type="number" inputMode="decimal" defaultValue={s.green_lbs ?? ''} placeholder="lb"
            onBlur={e => act({ action: 'update', study_id: s.id, green_lbs: e.target.value })}
            style={{ width: 90, background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 6, padding: '0.35rem', fontSize: '1rem' }} />
        </label>
      </div>

      {product.steps.map(step => {
        const running = s.segments.find(g => g.step === step.key && !g.ended_at)
        const n = crew[step.key] ?? running?.crew ?? 1
        return (
          <div key={step.key} style={{ ...card, borderLeft: `4px solid ${running ? GO : 'rgba(166,120,90,0.2)'}` }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <div style={{ color: C.cream, fontSize: '1.1rem', fontWeight: 700 }}>{step.label}</div>
              <div style={{ fontVariantNumeric: 'tabular-nums', color: running ? GO : C.tan }}>
                {mins[step.key] ? `${f1(mins[step.key])} crew-min` : '—'}
              </div>
            </div>
            <div style={{ fontSize: '0.78rem', color: C.lightBrown, marginBottom: '0.6rem' }}>{step.hint}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <button disabled={!!running} onClick={() => setCrew(c => ({ ...c, [step.key]: Math.max(1, n - 1) }))} style={{ ...btn(C.medBrown), padding: '0.55rem 0.9rem', opacity: running ? 0.4 : 1 }}>−</button>
              <div style={{ minWidth: 64, textAlign: 'center', color: C.cream }}>{n} {n === 1 ? 'person' : 'people'}</div>
              <button disabled={!!running} onClick={() => setCrew(c => ({ ...c, [step.key]: Math.min(20, n + 1) }))} style={{ ...btn(C.medBrown), padding: '0.55rem 0.9rem', opacity: running ? 0.4 : 1 }}>+</button>
              <button disabled={busy} onClick={() => act(running ? { action: 'stop', study_id: s.id, step: step.key } : { action: 'start', study_id: s.id, step: step.key, crew: n })}
                style={{ ...btn(running ? STOP : GO), marginLeft: 'auto', minWidth: 110 }}>
                {running ? `Stop ${clock((Date.now() - Date.parse(running.started_at)) / 60000)}` : 'Start'}
              </button>
            </div>
          </div>
        )
      })}

      <Results s={s} product={product} act={act} live />
    </>
  )
}

function Results({ s, product, act, live }: { s: Study; product: StudyProduct; act: (b: Record<string, unknown>) => Promise<void>; live?: boolean }) {
  const mins = crewMinutesByStep(s.segments)
  const total = Object.values(mins).reduce((a, b) => a + b, 0)
  const lbs = s.finishedLbs
  return (
    <div style={card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
        <div style={label}>{live ? 'So far' : `Cut day ${dayLabel(s.cut_date)} · ${s.tag_count} bellies`}</div>
        <div style={{ fontSize: '0.8rem' }}>{lbs > 0 ? `${f1(lbs)} lb finished` : 'not packed yet'}{s.green_lbs ? ` · ${f1(s.green_lbs)} lb green` : ''}</div>
      </div>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginTop: '0.5rem' }}>
        <thead>
          <tr style={{ ...label, fontSize: '0.62rem' }}>
            <th style={{ textAlign: 'left', padding: '0.3rem 0' }}>Step</th>
            <th style={{ textAlign: 'right' }}>Crew-min</th>
            <th style={{ textAlign: 'right' }}>Share</th>
            <th style={{ textAlign: 'right' }}>Min / 100 lb</th>
          </tr>
        </thead>
        <tbody>
          {product.steps.map(st => (
            <tr key={st.key} style={{ borderTop: '1px solid rgba(166,120,90,0.12)' }}>
              <td style={{ padding: '0.3rem 0', color: C.cream }}>{st.label}</td>
              <td style={{ textAlign: 'right' }}>{mins[st.key] ? f1(mins[st.key]) : '—'}</td>
              <td style={{ textAlign: 'right' }}>{total && mins[st.key] ? `${Math.round(mins[st.key] / total * 100)}%` : '—'}</td>
              <td style={{ textAlign: 'right' }}>{lbs > 0 && mins[st.key] ? f1(mins[st.key] / lbs * 100) : '—'}</td>
            </tr>
          ))}
          <tr style={{ borderTop: '1px solid rgba(166,120,90,0.3)', color: C.cream, fontWeight: 700 }}>
            <td style={{ padding: '0.3rem 0' }}>Total</td>
            <td style={{ textAlign: 'right' }}>{total ? f1(total) : '—'}</td>
            <td />
            <td style={{ textAlign: 'right' }}>{lbs > 0 && total ? f1(total / lbs * 100) : '—'}</td>
          </tr>
        </tbody>
      </table>
      <div style={{ display: 'flex', gap: 8, marginTop: '0.8rem', flexWrap: 'wrap' }}>
        {live ? (
          <button onClick={() => { if (confirm('Close this study? Any running step stops now.')) act({ action: 'close', study_id: s.id }) }} style={btn(C.medBrown)}>Close study</button>
        ) : (
          <button onClick={() => act({ action: 'reopen', study_id: s.id })} style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, fontSize: '0.8rem', padding: '0.4rem 0.7rem' }}>Reopen</button>
        )}
        <button onClick={() => { if (confirm('Delete this study for good?')) act({ action: 'delete', study_id: s.id }) }}
          style={{ ...btn('transparent'), border: `1px solid ${C.medBrown}`, fontSize: '0.8rem', padding: '0.4rem 0.7rem', color: C.lightBrown }}>Delete</button>
      </div>
    </div>
  )
}
