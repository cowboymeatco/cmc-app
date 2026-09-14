'use client'
// /pipeline — every account with animals in the building, as a Gantt.
//
// Charlie (2026-09-09): "Can I get a gantt chart of every account that is
// active in the facility? I want to see what stage they are in and how long
// they have been there. I need to be able to see what animals are closest to
// the finish line to get paid."
//
// Charlie (2026-09-13): drive what's closest to VALUE — "with X amount of
// effort we free up Y amount of dollars". The page leads with the dollars
// tied up by stage, and rows rank by dollars freed per hour of work left
// (lib/pipelineValue.ts). Finish line = paid AND picked up, so paid accounts
// still in the freezer sink to the bottom rather than leave.

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { STAGE_LABEL, STAGE_RANK } from '@/lib/animalProgress'
import type { PipelineResponse, PipelineRow } from '@/app/api/pipeline/route'
import type { MoneyBucket } from '@/lib/pipelineValue'
import InvoiceMatch from './InvoiceMatch'

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

// The money strip, in the order work flows toward cash.
const BUCKETS: { key: MoneyBucket; label: string; color: string; hint: string }[] = [
  { key: 'aging',          label: 'Hanging',            color: '#3B82F6', hint: 'received, killed or aging — not cut yet' },
  { key: 'cutting',        label: 'Cutting',            color: '#A6785A', hint: 'on the cutting floor' },
  { key: 'smokehouse',     label: 'Smokehouse',         color: '#E8883A', hint: 'value add in progress' },
  { key: 'ready_unbilled', label: 'Ready, not billed',  color: '#4CAF50', hint: 'done — needs an invoice' },
  { key: 'billed_unpaid',  label: 'Billed, unpaid',     color: '#D97706', hint: 'QuickBooks balance due' },
]

// What's next for this account, in the words the office would use.
function nextStep(r: PipelineRow): string {
  if (r.trail_cold) return r.harvested_at
    ? 'Records stop after harvest — confirm it went home'
    : 'No kill record — confirm it went home'
  if (r.value.kind === 'paid' && STAGE_RANK.indexOf(r.stage) >= STAGE_RANK.indexOf('freezing')) return 'Paid — call for pickup'
  const jobs = r.smokehouse_jobs
  if (jobs.packaging.length) return `Smoked — package ${jobs.packaging.map(j => j.item.toLowerCase()).join(', ')}`
  if (jobs.smoking.length) return `In the smokehouse — ${jobs.smoking.map(j => j.item.toLowerCase()).join(', ')}`
  if (jobs.queued.length) return `Waiting to smoke — ${jobs.queued.map(j => j.item.toLowerCase()).join(', ')}`
  if (r.value.bucket === 'ready_unbilled') return 'Done — send the invoice'
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

const money = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
const hrs = (h: number) => (h < 1 ? `${Math.round(h * 60)} min` : `${h.toFixed(h < 10 ? 1 : 0)} h`)

// The QuickBooks word on this animal, as a chip.
function BillingChip({ b }: { b: PipelineRow['billing'] }) {
  const base: React.CSSProperties = { display: 'inline-block', fontSize: '0.68rem', fontWeight: 700, borderRadius: 99, padding: '1px 8px', whiteSpace: 'nowrap' }
  const how = b.matched_by === 'manual' ? ' · matched by hand' : b.matched_by === 'booking' ? ' · QuickBooks customer on the booking' : b.matched_by === 'name' ? ' · matched by name — check it' : ''
  if (b.status === 'paid')    return <span title={`Invoice ${b.doc_numbers.join(', ')} · ${money(b.total)}${how}`} style={{ ...base, color: C.green, border: `1px solid ${C.green}66` }}>💵 Paid {money(b.total)}</span>
  if (b.status === 'open')    return <span title={`Invoice ${b.doc_numbers.join(', ')} · ${money(b.total)} total${how}`} style={{ ...base, color: C.yellow, border: `1px solid ${C.yellow}66` }}>💵 {money(b.balance)} due · #{b.doc_numbers[b.doc_numbers.length - 1]}</span>
  if (b.status === 'unknown') return <span style={{ ...base, color: C.lightBrown, border: '1px solid rgba(166,120,90,0.35)' }}>QuickBooks unavailable</span>
  return <span style={{ ...base, color: C.lightBrown, border: '1px solid rgba(166,120,90,0.35)' }}>Not invoiced</span>
}

// Dollars · hours left · dollars per hour, with where each came from.
function ValueCell({ r }: { r: PipelineRow }) {
  const v = r.value
  const title = v.basis.join('\n') + (v.labor_left != null ? `\n≈ ${money(v.labor_left)} of labor left` : '')
  if (v.kind === 'own')  return <div title={title} style={{ color: C.lightBrown, fontSize: '0.74rem' }}>Our animal</div>
  if (v.kind === 'paid') return <div title={title} style={{ color: C.green, fontSize: '0.74rem' }}>Paid — pickup only</div>
  if (v.dollars == null) return <div title={title} style={{ color: C.lightBrown, fontSize: '0.74rem' }}>{v.basis[0]}</div>
  return (
    <div title={title} style={{ cursor: 'help' }}>
      <span style={{ color: C.cream, fontWeight: 700, fontSize: '0.92rem' }}>{v.kind === 'open' ? '' : '~'}{money(v.dollars)}</span>
      {v.hours_left != null && <span style={{ color: C.lightBrown, fontSize: '0.74rem' }}> · {hrs(v.hours_left)} left</span>}
      {v.per_hour != null && <div style={{ color: C.tan, fontSize: '0.74rem', fontWeight: 700 }}>{money(v.per_hour)} per labor hour</div>}
    </div>
  )
}

export default function PipelinePage() {
  const [data, setData] = useState<PipelineResponse | null>(null)
  const [err, setErr] = useState('')
  const [q, setQ] = useState('')
  const [species, setSpecies] = useState('all')
  const [bucket, setBucket] = useState<'all' | MoneyBucket>('all')
  const [showCold, setShowCold] = useState(false)
  const [officeDraft, setOfficeDraft] = useState('')
  // The account whose invoice is being matched by hand (InvoiceMatch.tsx).
  const [matching, setMatching] = useState<string | null>(null)

  const load = () => fetch('/api/pipeline')
    .then(r => r.json())
    .then((d: PipelineResponse & { error?: string }) => { if (d.rows) { setData(d); setOfficeDraft(String(d.office_minutes)) } else setErr(d.error ?? 'Could not load') })
    .catch(() => setErr('Could not load'))
  useEffect(() => { load() }, [])

  const saveOffice = async () => {
    const n = Number(officeDraft)
    if (!Number.isFinite(n) || n === data?.office_minutes) return
    await fetch('/api/pipeline/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ office_minutes: n }) })
    load()
  }

  const rows = data?.rows ?? null
  const labor = data?.labor
  const now = Date.now()
  const live = useMemo(() => (rows ?? []).filter(r => showCold || !r.trail_cold), [rows, showCold])
  const shown = useMemo(() => live.filter(r =>
    (species === 'all' || r.species === species)
    && (bucket === 'all' || r.value.bucket === bucket)
    && (!q.trim() || `${r.account} ${r.customers.join(' ')}`.toLowerCase().includes(q.trim().toLowerCase()))
  ), [live, species, bucket, q])

  // Dollars tied up by stage — the strip the page leads with.
  const tally = useMemo(() => {
    const t: Record<string, { n: number; dollars: number; unpriced: number }> = {}
    for (const r of live) {
      const k = r.value.bucket
      t[k] = t[k] ?? { n: 0, dollars: 0, unpriced: 0 }
      t[k].n++
      if (r.value.dollars != null) t[k].dollars += r.value.dollars
      else if (k !== 'paid' && k !== 'own' && k !== 'none') t[k].unpriced++
    }
    return t
  }, [live])
  const tiedUp = BUCKETS.reduce((s, b) => s + (tally[b.key]?.dollars ?? 0), 0)

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

  const speciesList = useMemo(() => [...new Set((rows ?? []).map(r => r.species).filter(Boolean))].sort(), [rows])
  const coldCount = (rows ?? []).filter(r => r.trail_cold).length

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 2rem', height: 72, display: 'flex', alignItems: 'center', gap: '1rem' }}>
        <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
        <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
        <div>
          <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>In the Building</h1>
          <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>Money tied up · work left to free it</p>
        </div>
        <span style={{ marginLeft: 'auto', color: C.lightBrown, fontSize: '0.8rem' }}>
          {rows ? `${live.length} account${live.length !== 1 ? 's' : ''} in the building` : ''}
        </span>
      </header>

      <main style={{ padding: '1.5rem 2rem', maxWidth: 1400, margin: '0 auto' }}>
        {/* $ tied up by stage */}
        {rows && (
          <>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: '0.75rem', marginBottom: '0.5rem' }}>
              <span style={{ color: C.cream, fontFamily: 'Georgia, serif', fontSize: '1.6rem', fontWeight: 700 }}>{money(tiedUp)}</span>
              <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>tied up in the building, not yet collected</span>
              {bucket !== 'all' && <button onClick={() => setBucket('all')} style={{ marginLeft: 'auto', ...chip(false, C.tan) }}>Show all</button>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))', gap: '0.5rem', marginBottom: '0.6rem' }}>
              {BUCKETS.map(b => {
                const t = tally[b.key] ?? { n: 0, dollars: 0, unpriced: 0 }
                const on = bucket === b.key
                return (
                  <button key={b.key} onClick={() => setBucket(on ? 'all' : b.key)} title={b.hint}
                    style={{ textAlign: 'left', background: on ? `${b.color}33` : C.dark, borderStyle: 'solid', borderWidth: '3px 1px 1px 1px', borderColor: `${b.color} ${on ? b.color : 'rgba(166,120,90,0.25)'} ${on ? b.color : 'rgba(166,120,90,0.25)'} ${on ? b.color : 'rgba(166,120,90,0.25)'}`, borderRadius: 4, padding: '0.6rem 0.8rem', cursor: 'pointer' }}>
                    <div style={{ color: b.color, fontSize: '0.66rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{b.label}</div>
                    <div style={{ color: C.cream, fontSize: '1.15rem', fontWeight: 700 }}>{money(t.dollars)}</div>
                    <div style={{ color: C.lightBrown, fontSize: '0.7rem' }}>
                      {t.n} account{t.n !== 1 ? 's' : ''}{t.unpriced ? ` · ${t.unpriced} can't price yet` : ''}
                    </div>
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', gap: '0.4rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
              <button onClick={() => setBucket(bucket === 'paid' ? 'all' : 'paid')} style={chip(bucket === 'paid', C.green)}>Paid, still here · {tally.paid?.n ?? 0}</button>
              <button onClick={() => setBucket(bucket === 'own' ? 'all' : 'own')} style={chip(bucket === 'own', C.lightBrown)}>Our animals · {tally.own?.n ?? 0}</button>
            </div>

            {/* Where the labor number comes from — broad on purpose */}
            {labor && (
              <div style={{ background: 'rgba(26,10,4,0.6)', border: '1px solid rgba(166,120,90,0.2)', borderRadius: 4, padding: '0.55rem 0.9rem', marginBottom: '1rem', color: C.lightBrown, fontSize: '0.74rem', lineHeight: 1.5 }}>
                <strong style={{ color: C.tan }}>Labor:</strong>{' '}
                {labor.dollarsPerLb != null
                  ? <>
                      ${labor.dollarsPerLb.toFixed(2)} of payroll per hanging lb
                      {labor.hoursPerLb != null && labor.blendedHourly != null && <> · {(labor.hoursPerLb * 60).toFixed(1)} crew-min per lb at ${labor.blendedHourly.toFixed(2)}/hr</>}
                      {' '}— {money(labor.payroll)} payroll over {labor.hangingLbs.toLocaleString()} lb killed, {labor.weeksUsed} pay weeks {fmt(labor.from)}–{fmt(labor.to)}
                      {labor.weeksSkipped.length > 0 && <> ({labor.weeksSkipped.length} skipped: payroll but no carcass weighed)</>}
                      {labor.packOut != null && <> · pack-out {Math.round(labor.packOut * 100)}% of hanging</>}
                    </>
                  : 'no payroll weeks with kill records yet'}
                <span style={{ marginLeft: '0.75rem', whiteSpace: 'nowrap' }}>
                  · office per account{' '}
                  <input value={officeDraft} onChange={e => setOfficeDraft(e.target.value)} onBlur={saveOffice} onKeyDown={e => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur() }}
                    style={{ width: 40, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(166,120,90,0.35)', borderRadius: 3, color: C.cream, fontSize: '0.74rem', padding: '0 4px', textAlign: 'right' }} /> min (a guess)
                </span>
                <div>Whole-plant payroll, not measured per job — every row ranks on the same yardstick. Hover a row&apos;s money for the math.</div>
              </div>
            )}
          </>
        )}

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
              show {coldCount} whose records stop
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
            <div style={{ display: 'grid', gridTemplateColumns: '34px 270px minmax(260px, 1fr) 210px 230px', minWidth: 1000, borderBottom: '1px solid rgba(166,120,90,0.25)', position: 'sticky', top: 0, background: C.dark, zIndex: 2 }}>
              <div />
              <div style={{ padding: '0.5rem 0.6rem', color: C.lightBrown, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Account</div>
              <div style={{ position: 'relative', height: 30 }}>
                {weeks.map(t => (
                  <span key={t} style={{ position: 'absolute', left: pct(t), top: 8, transform: 'translateX(-50%)', color: C.lightBrown, fontSize: '0.66rem', whiteSpace: 'nowrap' }}>
                    {new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
                  </span>
                ))}
                <span style={{ position: 'absolute', left: pct(now), top: 6, transform: 'translateX(-50%)', color: C.cream, fontSize: '0.66rem', fontWeight: 700 }}>today</span>
              </div>
              <div style={{ padding: '0.5rem 0.9rem', color: C.lightBrown, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>$ · work left</div>
              <div style={{ padding: '0.5rem 0.9rem', color: C.lightBrown, fontSize: '0.68rem', textTransform: 'uppercase', letterSpacing: '0.12em' }}>Stage · next</div>
            </div>

            {shown.length === 0 && <p style={{ color: C.lightBrown, padding: '2rem', textAlign: 'center', margin: 0 }}>Nothing matches.</p>}

            {shown.map((r, i) => {
              const { segs } = segments(r, now)
              // Open smokehouse jobs put a "cutting" account in the smokehouse.
              const lab = r.stage === 'cutting' && (r.smokehouse_jobs.packaging.length + r.smokehouse_jobs.smoking.length + r.smokehouse_jobs.queued.length) > 0 ? STAGE_LABEL.smokehouse : STAGE_LABEL[r.stage]
              const stageSince = r.stage === 'ready' || r.stage === 'freezing' || r.stage === 'at_baker' ? r.session_at
                : r.stage === 'cutting' || r.stage === 'smokehouse' ? (r.cut_date_planned ? r.session_at : r.cut_date)
                : r.stage === 'aging' || r.stage === 'harvested' ? (r.harvested_at ?? r.harvest_date)
                : r.received_at
              const stageDays = daysAgo(stageSince)
              const ranked = r.value.per_hour != null
              return (
                <div key={r.id} style={{ display: 'grid', gridTemplateColumns: '34px 270px minmax(260px, 1fr) 210px 230px', minWidth: 1000, borderBottom: '1px solid rgba(166,120,90,0.12)', alignItems: 'center', opacity: r.trail_cold ? 0.55 : r.value.kind === 'paid' || r.value.kind === 'own' ? 0.7 : 1 }}>
                  <div style={{ color: ranked ? C.tan : 'transparent', fontSize: '0.72rem', fontWeight: 700, textAlign: 'right' }}>{ranked ? i + 1 : ''}</div>
                  <div style={{ padding: '0.55rem 0.6rem', minWidth: 0 }}>
                    <div style={{ color: C.cream, fontWeight: 700, fontSize: '0.88rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.account}</div>
                    <div style={{ color: C.lightBrown, fontSize: '0.72rem', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {r.species}{r.head_count > 1 ? ` ×${r.head_count}` : ''}
                      {r.hanging_weight_lbs ? ` · ${Math.round(r.hanging_weight_lbs)} lb` : ''}
                      {r.customers.length > 0 && r.customers.join(', ') !== r.account ? ` · ${r.customers.join(', ')}` : ''}
                    </div>
                  </div>
                  <div style={{ position: 'relative', height: 40 }}>
                    {weeks.map(t => <span key={t} style={{ position: 'absolute', left: pct(t), top: 0, bottom: 0, borderLeft: '1px solid rgba(166,120,90,0.1)' }} />)}
                    {segs.map((s, j) => (
                      <span key={j} title={`${s.key} · ${fmt(new Date(s.from).toISOString())} → ${fmt(new Date(s.to).toISOString())}`}
                        style={{ position: 'absolute', left: pct(s.from), width: `calc(${pct(s.to)} - ${pct(s.from)})`, top: 12, height: 16, background: s.color, borderRadius: j === 0 ? '3px 0 0 3px' : j === segs.length - 1 ? '0 3px 3px 0' : 0, minWidth: 2 }} />
                    ))}
                    <span style={{ position: 'absolute', left: pct(now), top: 0, bottom: 0, borderLeft: '1px dashed rgba(242,232,217,0.45)' }} />
                    {r.days_in != null && (
                      <span style={{ position: 'absolute', left: `calc(${pct(now)} + 6px)`, top: 12, color: C.cream, fontSize: '0.72rem', fontWeight: 700, whiteSpace: 'nowrap' }}>{r.days_in}d</span>
                    )}
                  </div>
                  <div style={{ padding: '0.4rem 0.9rem' }}><ValueCell r={r} /></div>
                  <div style={{ padding: '0.4rem 0.9rem' }}>
                    <span style={{ display: 'inline-block', fontSize: '0.68rem', fontWeight: 700, color: lab.color, border: `1px solid ${lab.color}66`, borderRadius: 99, padding: '1px 8px', marginBottom: 2 }}>
                      {r.trail_cold ? 'Records stop' : lab.label}{stageDays != null && !r.trail_cold ? ` · ${stageDays}d` : ''}
                    </span>
                    <div style={{ color: C.lightBrown, fontSize: '0.7rem', lineHeight: 1.3 }}>{nextStep(r)}</div>
                    <div style={{ marginTop: 3, display: 'flex', alignItems: 'center', gap: '0.35rem', flexWrap: 'wrap' }}>
                      <BillingChip b={r.billing} />
                      {r.value.kind !== 'own' || r.no_invoice_reason ? (
                        <button onClick={() => setMatching(r.id)}
                          title={r.billing.status === 'none' ? 'Find this animal’s QuickBooks invoice' : 'Wrong invoice? Match it by hand'}
                          style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: '0.68rem', color: r.billing.status === 'none' ? C.tan : C.lightBrown, textDecoration: 'underline' }}>
                          {r.billing.status === 'none' ? '🔗 match invoice' : r.no_invoice_reason ? 'no invoice ✎' : 'invoice ✎'}
                        </button>
                      ) : null}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </main>
      {matching && (
        <InvoiceMatch appointmentId={matching} onClose={() => setMatching(null)} onSaved={() => { setMatching(null); load() }} />
      )}
    </div>
  )
}

const chip = (on: boolean, color: string): React.CSSProperties => ({
  background: on ? color : 'transparent', color: on ? C.dark : color, border: `1px solid ${color}`,
  borderRadius: 99, padding: '0.25rem 0.7rem', fontSize: '0.74rem', fontWeight: 700, cursor: 'pointer',
})
