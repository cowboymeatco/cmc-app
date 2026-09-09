'use client'
// /pipeline — every account with animals in the building, as a Gantt.
//
// Charlie (2026-09-09): "Can I get a gantt chart of every account that is
// active in the facility? I want to see what stage they are in and how long
// they have been there. I need to be able to see what animals are closest to
// the finish line to get paid."
//
// One row per appointment that has been received and not picked up. The bar
// runs from the day it came in to today, coloured by what happened when:
// received → harvested → hanging → cutting → freezer. Rows sort with the
// finish line at the top, so the first screen is what to call about.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { STAGE_LABEL, STAGE_RANK, type AnimalStage } from '@/lib/animalProgress'
import type { PipelineRow } from '@/app/api/pipeline/route'

const C = {
  dark: '#1A0A04', darkBrown: '#351E0E', medBrown: '#75471B', lightBrown: '#A6785A',
  tan: '#C9A882', cream: '#F2E8D9', green: '#4CAF50', yellow: '#D97706', blue: '#3B82F6',
}

const DAY = 86400000
const dayOf = (iso: string | null) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).getTime() : null)
const fmt = (iso: string | null) => (iso ? new Date(iso.length === 10 ? iso + 'T12:00:00' : iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')
const daysAgo = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - (dayOf(iso) ?? Date.now())) / DAY)) : null)

// Colour of each stretch of the bar. The tail takes the current stage's colour.
const SEG_COLOR: Record<string, string> = {
  received: '#C9A882', hanging: '#3B82F6', cutting: '#75471B', smokehouse: '#E8883A', freezer: '#4CAF50', baker: '#B45309',
}

// What's next for this account, in the words the office would use.
function nextStep(r: PipelineRow): string {
  if (r.trail_cold) return 'Records stop after harvest — confirm it went home'
  switch (r.stage) {
    case 'received':   return 'Waiting on harvest'
    case 'harvested':
    case 'aging':      return r.cut_date ? `Cut ${r.cut_date_planned ? 'planned' : 'scheduled'} ${fmt(r.cut_date)}` : 'Needs a cut date'
    case 'cutting':    return 'On the cutting floor'
    case 'smokehouse': return 'Value add in progress'
    case 'freezing':   return r.ready_at ? `Freezing — ready ${fmt(r.ready_at)}` : 'Freezing down'
    case 'ready':      return 'In the freezer — call for pickup'
    case 'at_baker':   return 'At Baker Storage — bill storage, await pickup'
    default:           return ''
  }
}

// The bar as a list of [start, end, colour] stretches from the timestamps.
function segments(r: PipelineRow, now: number) {
  const pts: { t: number; key: string }[] = []
  const recv = dayOf(r.received_at) ?? dayOf(r.harvested_at) ?? dayOf(r.harvest_date)
  if (recv == null) return { start: now, segs: [] as { from: number; to: number; color: string; key: string }[] }
  pts.push({ t: recv, key: 'received' })
  const harv = dayOf(r.harvested_at) ?? (r.harvest_date ? dayOf(r.harvest_date) : null)
  if (harv != null && harv >= recv) pts.push({ t: harv, key: 'hanging' })
  const cut = !r.cut_date_planned ? dayOf(r.cut_date) : null
  if (cut != null && STAGE_RANK.indexOf(r.stage) >= STAGE_RANK.indexOf('cutting')) pts.push({ t: Math.max(cut, harv ?? cut), key: r.stage === 'smokehouse' ? 'smokehouse' : 'cutting' })
  const sess = dayOf(r.session_at)
  if (sess != null && (r.stage === 'freezing' || r.stage === 'ready' || r.stage === 'at_baker')) {
    pts.push({ t: Math.max(sess, pts[pts.length - 1].t), key: r.stage === 'at_baker' ? 'baker' : 'freezer' })
  }
  const segs = pts.map((p, i) => ({ from: p.t, to: i + 1 < pts.length ? pts[i + 1].t : now, color: SEG_COLOR[p.key], key: p.key }))
  return { start: recv, segs }
}

type Filter = 'all' | AnimalStage

export default function PipelinePage() {
  const [rows, setRows] = useState<PipelineRow[] | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [species, setSpecies] = useState('all')
  const [stage, setStage] = useState<Filter>('all')
  const [showCold, setShowCold] = useState(false)

  useEffect(() => {
    fetch('/api/pipeline')
      .then(r => r.json())
      .then((d: { rows?: PipelineRow[]; error?: string }) => { if (d.rows) setRows(d.rows); else setErr(d.error ?? 'Could not load') })
      .catch(() => setErr('Could not load'))
  }, [])

  const now = Date.now()
  const live = useMemo(() => (rows ?? []).filter(r => showCold || !r.trail_cold), [rows, showCold])
  const shown = useMemo(() => live.filter(r =>
    (species === 'all' || r.species === species)
    && (stage === 'all' || r.stage === stage)
    && (!q.trim() || `${r.account} ${r.customers.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
  ), [live, species, stage, q])

  // Time axis: from the oldest arrival on screen to today, in whole weeks.
  const axisStart = useMemo(() => {
    const starts = shown.map(r => segments(r, now).start)
    const min = starts.length ? Math.min(...starts) : now - 30 * DAY
    return Math.min(min, now - 14 * DAY)
  }, [shown, now])
  const axisEnd = now + 2 * DAY
  const span = axisEnd - axisStart
  const pct = (t: number) => `${Math.max(0, Math.min(100, ((t - axisStart) / span) * 100))}%`
  const weeks: number[] = []
  for (let t = axisStart; t <= axisEnd; t += 7 * DAY) weeks.push(t)

  const counts = useMemo(() => {
    const c: Partial<Record<AnimalStage, number>> = {}
    for (const r of live) c[r.stage] = (c[r.stage] ?? 0) + 1
    return c
  }, [live])
  const speciesList = useMemo(() => [...new Set((rows ?? []).map(r => r.species).filter(Boolean))].sort(), [rows])
  const coldCount = (rows ?? []).filter(r => r.trail_cold).length

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>In the Building</h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>Every account · where it is · how long it has been here</p>
        </div>
        <span style={{ marginLeft: 'auto', color: C.lightBrown, fontSize: '0.8rem' }}>
          {rows ? `${live.length} account${live.length !== 1 ? 's' : ''} in the building` : ''}
        </span>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 1400, margin: '0 auto' }}>
        {/* Stage tally — the finish line is on the left */}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.4rem', marginBottom: '1rem' }}>
          <button onClick={() => setStage('all')} style={chip(stage === 'all', C.tan)}>All · {live.length}</button>
          {[...STAGE_RANK].reverse().filter(s => s !== 'picked_up' && s !== 'scheduled').map(s => (
            <button key={s} onClick={() => setStage(stage === s ? 'all' : s)} style={chip(stage === s, STAGE_LABEL[s].color)}>
              {STAGE_LABEL[s].label} · {counts[s] ?? 0}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', marginBottom: '1rem', flexWrap: 'wrap' }}>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search account or customer"
            style={{ background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, padding: '0.45rem 0.7rem', color: C.cream, fontSize: '0.85rem', outline: 'none', width: 260 }} />
          <select value={species} onChange={e => setSpecies(e.target.value)}
            style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, padding: '0.45rem 0.6rem', color: C.cream, fontSize: '0.85rem' }}>
            <option value="all">All species</option>
            {speciesList.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
          {coldCount > 0 && (
            <label style={{ color: C.lightBrown, fontSize: '0.78rem', display: 'flex', alignItems: 'center', gap: '0.35rem', cursor: 'pointer' }}>
              <input type="checkbox" checked={showCold} onChange={e => setShowCold(e.target.checked)} />
              show {coldCount} whose records stop after harvest
            </label>
          )}
          <span style={{ marginLeft: 'auto', color: C.lightBrown, fontSize: '0.74rem' }}>
            {Object.entries(SEG_COLOR).map(([k, col]) => (
              <span key={k} style={{ marginLeft: '0.7rem' }}><span style={{ display: 'inline-block', width: 10, height: 10, background: col, borderRadius: 2, marginRight: 4, verticalAlign: 'middle' }} />{k}</span>
            ))}
          </span>
        </div>

        {err && <p style={{ color: '#fca5a5' }}>{err}</p>}
        {!rows && !err && <p style={{ color: C.lightBrown }}>Loading…</p>}

        {rows && (
          <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.25)', borderRadius: 4, overflowX: 'auto' }}>
            {/* Axis */}
            <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr 190px', borderBottom: '1px solid rgba(166,120,90,0.25)', position: 'sticky', top: 0, background: C.dark, zIndex: 2 }}>
              <div style={{ padding: '0.5rem 0.9rem', color: C.lightBrown, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Account</div>
              <div style={{ position: 'relative', height: 30 }}>
                {weeks.map(t => (
                  <span key={t} style={{ position: 'absolute', left: pct(t), top: 8, transform: 'translateX(-50%)', color: C.lightBrown, fontSize: '0.66rem', whiteSpace: 'nowrap' }}>
                    {new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                ))}
                <span style={{ position: 'absolute', left: pct(now), top: 6, transform: 'translateX(-50%)', color: C.cream, fontSize: '0.66rem', fontWeight: 700 }}>today</span>
              </div>
              <div style={{ padding: '0.5rem 0.9rem', color: C.lightBrown, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Next</div>
            </div>

            {shown.length === 0 && <p style={{ color: C.lightBrown, padding: '2rem', textAlign: 'center', margin: 0 }}>Nothing matches.</p>}

            {shown.map(r => {
              const { segs } = segments(r, now)
              const lab = STAGE_LABEL[r.stage]
              const stageSince = r.stage === 'ready' || r.stage === 'freezing' || r.stage === 'at_baker' ? r.session_at
                : r.stage === 'cutting' || r.stage === 'smokehouse' ? (r.cut_date_planned ? r.session_at : r.cut_date)
                : r.stage === 'aging' || r.stage === 'harvested' ? (r.harvested_at ?? r.harvest_date)
                : r.received_at
              const stageDays = daysAgo(stageSince)
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '300px 1fr 190px', borderBottom: '1px solid rgba(166,120,90,0.12)', alignItems: 'center', opacity: r.trail_cold ? 0.55 : 1 }}>
                  <div style={{ padding: '0.55rem 0.9rem', minWidth: 0 }}>
                    <div style={{ color: C.cream, fontWeight: 700, fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.account}</div>
                    <div style={{ color: C.lightBrown, fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.species}{r.head_count > 1 ? ` ×${r.head_count}` : ''}
                      {r.hanging_weight_lbs ? ` · ${Math.round(r.hanging_weight_lbs)} lb` : ''}
                      {r.customers.length > 0 && r.customers.join(', ') !== r.account ? ` · ${r.customers.join(', ')}` : ''}
                    </div>
                  </div>
                  <div style={{ position: 'relative', height: 40 }}>
                    {weeks.map(t => <span key={t} style={{ position: 'absolute', left: pct(t), top: 0, bottom: 0, borderLeft: '1px solid rgba(166,120,90,0.1)' }} />)}
                    {segs.map((s, i) => (
                      <span key={i} title={`${s.key} · ${fmt(new Date(s.from).toISOString())} → ${fmt(new Date(s.to).toISOString())}`}
                        style={{ position: 'absolute', left: pct(s.from), width: `calc(${pct(s.to)} - ${pct(s.from)})`, top: 12, height: 16, background: s.color, borderRadius: i === 0 ? '3px 0 0 3px' : i === segs.length - 1 ? '0 3px 3px 0' : 0, minWidth: 2 }} />
                    ))}
                    <span style={{ position: 'absolute', left: pct(now), top: 0, bottom: 0, borderLeft: '1px dashed rgba(242,232,217,0.45)' }} />
                    {r.days_in != null && (
                      <span style={{ position: 'absolute', left: `calc(${pct(now)} + 6px)`, top: 12, color: C.cream, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.days_in}d</span>
                    )}
                  </div>
                  <div style={{ padding: '0.4rem 0.9rem' }}>
                    <span style={{ display: 'inline-block', fontSize: '0.68rem', fontWeight: 700, color: lab.color, border: `1px solid ${lab.color}66`, borderRadius: 99, padding: '1px 8px', marginBottom: 2 }}>
                      {r.trail_cold ? 'Records stop' : lab.label}{stageDays != null && !r.trail_cold ? ` · ${stageDays}d` : ''}
                    </span>
                    <div style={{ color: C.lightBrown, fontSize: '0.7rem', lineHeight: 1.3 }}>{nextStep(r)}</div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
    </div>
  )
}

const chip = (on: boolean, color: string): React.CSSProperties => ({
  background: on ? color : 'transparent', color: on ? C.dark : color, border: `1px solid ${color}`,
  borderRadius: 99, padding: '0.25rem 0.7rem', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer',
})
