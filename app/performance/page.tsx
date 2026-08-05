'use client'
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { dateLabel } from '@/lib/dates'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
}

// Series colors — validated for contrast + CVD separation on the dark surface.
const LBS_COLOR  = '#CE6A20'
const HEAD_COLOR = '#3E9D63'
const WARN_COLOR = '#FAB219'
const GRID       = 'rgba(166,120,90,0.15)'

// Head count is stacked by species: a beef is ten lambs by weight, so the head
// panel and the pounds panel move independently and the mix is the explanation.
// Fixed name→color mapping (never reordered, never assigned by volume) so
// changing the date range can't repaint a species. Orange is reserved for the
// pounds measure and deliberately absent here.
const SPECIES = ['Beef', 'Hog', 'Lamb', 'Goat', 'Other'] as const
type Species = (typeof SPECIES)[number]
const SPECIES_COLOR: Record<Species, string> = {
  Beef:  '#3987E5',
  Hog:   '#199E70',
  Lamb:  '#C98500',
  Goat:  '#D55181',
  Other: '#898781',
}

interface DayPoint { d: string; head: number; lbs: number; sp: Partial<Record<Species, number>> }
interface CoolerData {
  series:         DayPoint[]
  asOf:           string
  trackingStart:  string | null
  medianHangDays: number
  estimatedExits: number
  hanging:        { avgDays: number; maxDays: number }
  ytd:            { head: number; lbs: number; yearStart: string }
  stale:          { head: number; lbs: number; oldestDue: string | null }
  drawdown:       {
    days:      { d: string; head: number; lbs: number; cut: number; cutLbs: number }[]
    planDate:  string | null
    lastDay:   string | null
    unplanned: { head: number; lbs: number }
  }
}

const RANGES = [
  { key: '30',  label: '30 days', days: 30 },
  { key: '60',  label: '60 days', days: 60 },
  { key: '90',  label: '90 days', days: 90 },
  { key: 'all', label: 'All',     days: Infinity },
]

const fmt = (n: number) => n.toLocaleString('en-US')

/** Round `max` up to a clean axis ceiling (1/2/2.5/5 × 10^k). */
function niceCeil(max: number): number {
  if (max <= 0) return 1
  const pow  = Math.pow(10, Math.floor(Math.log10(max)))
  for (const m of [1, 2, 2.5, 5, 10]) {
    if (m * pow >= max) return m * pow
  }
  return 10 * pow
}

/** Clean tick values 0..just-past-max in ~`divisions` steps (ticks land on round numbers). */
function niceTicks(max: number, divisions = 4): number[] {
  const step  = niceCeil(Math.max(max, 1) / divisions)
  const top   = step * Math.ceil(Math.max(max, 1) / step)
  const ticks = []
  for (let v = 0; v <= top; v += step) ticks.push(v)
  return ticks
}

// ── Stat tile ─────────────────────────────────────────────────────────────────
function StatTile({ label, value, unit, sub, hero, accent }: {
  label: string; value: string; unit?: string; sub?: string; hero?: boolean; accent?: string
}) {
  return (
    <div style={{
      background: C.dark, border: '1px solid rgba(166,120,90,0.18)',
      borderLeft: accent ? `4px solid ${accent}` : '1px solid rgba(166,120,90,0.18)',
      borderRadius: 4, padding: '1rem 1.25rem', flex: '1 1 160px', minWidth: 150,
    }}>
      <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: '0.35rem' }}>
        {label}
      </div>
      <div style={{ fontSize: hero ? '2.6rem' : '1.6rem', fontWeight: 600, color: C.cream, lineHeight: 1.1 }}>
        {value}{unit && <span style={{ fontSize: '0.9rem', fontWeight: 600, color: C.tan, marginLeft: '0.35rem' }}>{unit}</span>}
      </div>
      {sub && <div style={{ fontSize: '0.72rem', color: C.lightBrown, marginTop: '0.35rem' }}>{sub}</div>}
    </div>
  )
}

// ── Cooler chart: pounds panel + head-count panel on a shared time axis ───────
function CoolerChart({ data }: { data: CoolerData }) {
  const wrapRef = useRef<HTMLDivElement>(null)
  const [width, setWidth]   = useState(900)
  const [hover, setHover]   = useState<number | null>(null)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(entries => setWidth(entries[0].contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const s = data.series
  const n = s.length

  const M = { top: 14, right: 18, bottom: 24, left: 52 }
  const LBS_H = 240, GAP = 30, HEAD_H = 130
  const SEG_GAP = 2 // surface gap between stacked species segments
  const plotW  = Math.max(width - M.left - M.right, 50)
  const height = M.top + LBS_H + GAP + HEAD_H + M.bottom
  const headTop = M.top + LBS_H + GAP

  const geom = useMemo(() => {
    if (!n) return null
    const step   = plotW / n
    const xMid   = (i: number) => M.left + step * (i + 0.5)
    const lbsTicks  = niceTicks(Math.max(...s.map(p => p.lbs)))
    const headTicks = niceTicks(Math.max(...s.map(p => p.head)), 2)
    const lbsMax  = lbsTicks[lbsTicks.length - 1]
    const headMax = headTicks[headTicks.length - 1]
    const yLbs  = (v: number) => M.top + LBS_H - (v / lbsMax) * LBS_H
    const yHead = (v: number) => headTop + HEAD_H - (v / headMax) * HEAD_H
    const barW  = Math.min(24, Math.max(step - 2, 1))

    // Split the pounds line where exact cut tracking begins — the earlier
    // stretch is drawn dashed because its exits are estimated.
    const splitIdx = data.trackingStart ? s.findIndex(p => p.d >= data.trackingStart!) : 0
    const pt   = (p: DayPoint, i: number) => `${xMid(i).toFixed(1)},${yLbs(p.lbs).toFixed(1)}`
    const path = (from: number, to: number) =>
      s.slice(from, to + 1).map((p, j) => `${j === 0 ? 'M' : 'L'}${pt(p, from + j)}`).join('')
    const estPath   = splitIdx > 0 ? path(0, Math.min(splitIdx, n - 1)) : ''
    const exactPath = splitIdx < n ? path(Math.max(splitIdx, 0), n - 1) : ''
    const areaPath  = s.map((p, i) => `${i === 0 ? 'M' : 'L'}${pt(p, i)}`).join('')
      + `L${xMid(n - 1).toFixed(1)},${(M.top + LBS_H).toFixed(1)}`
      + `L${xMid(0).toFixed(1)},${(M.top + LBS_H).toFixed(1)}Z`

    // ~6 x labels.
    const xEvery  = Math.max(1, Math.ceil(n / 6))
    const xTicks  = s.map((p, i) => ({ i, d: p.d })).filter(t => t.i % xEvery === 0)

    // Species actually present in this range, in the fixed order — drives both
    // the stack order and the legend, so neither can drift from the other.
    const present = SPECIES.filter(sp => s.some(p => (p.sp?.[sp] ?? 0) > 0))

    return { step, xMid, yLbs, yHead, barW, estPath, exactPath, areaPath, xTicks, lbsTicks, headTicks, splitIdx, present }
  }, [s, n, plotW, headTop, data.trackingStart, M.left, M.top])

  if (!n || !geom) {
    return <div style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '2rem' }}>No harvest data yet.</div>
  }

  const setHoverFromX = (clientX: number) => {
    const rect = wrapRef.current?.getBoundingClientRect()
    if (!rect) return
    const x = clientX - rect.left - M.left
    setHover(Math.max(0, Math.min(n - 1, Math.floor(x / geom.step))))
  }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft')  { setHover(h => Math.max(0, (h ?? n - 1) - 1)); e.preventDefault() }
    if (e.key === 'ArrowRight') { setHover(h => Math.min(n - 1, (h ?? 0) + 1)); e.preventDefault() }
  }

  // Clamp: a range switch can shrink the series below a lingering hover index.
  const hi = hover !== null ? Math.min(hover, n - 1) : null
  const hp = hi !== null ? s[hi] : null
  const tipX = hi !== null ? geom.xMid(hi) : 0
  const TIP_W = 188
  const tipLeft = tipX > width * 0.6 ? tipX - (TIP_W + 14) : tipX + 14

  return (
    <div ref={wrapRef} style={{ position: 'relative', width: '100%' }}
      onPointerMove={e => setHoverFromX(e.clientX)}
      onPointerLeave={() => setHover(null)}
      onKeyDown={onKey}
      tabIndex={0}
      role="img"
      aria-label={
        `Cooler inventory chart, ${fmt(s[n - 1].lbs)} pounds and ${s[n - 1].head} head as of ${dateLabel(data.asOf)}` +
        (s[n - 1].head
          ? ` — ${geom.present.map(sp => `${s[n - 1].sp?.[sp] ?? 0} ${sp}`).filter(t => !t.startsWith('0 ')).join(', ')}`
          : '')
      }
    >
      <svg width={width} height={height} style={{ display: 'block', outline: 'none' }}>
        {/* gridlines + y ticks — pounds panel */}
        {geom.lbsTicks.map(v => (
          <g key={`gl${v}`}>
            <line x1={M.left} x2={width - M.right} y1={geom.yLbs(v)} y2={geom.yLbs(v)} stroke={GRID} strokeWidth={1} />
            <text x={M.left - 8} y={geom.yLbs(v) + 3.5} textAnchor="end" fontSize={10.5} fill={C.lightBrown}>{fmt(v)}</text>
          </g>
        ))}
        {/* gridlines + y ticks — head panel */}
        {geom.headTicks.map(v => (
          <g key={`gh${v}`}>
            <line x1={M.left} x2={width - M.right} y1={geom.yHead(v)} y2={geom.yHead(v)} stroke={GRID} strokeWidth={1} />
            <text x={M.left - 8} y={geom.yHead(v) + 3.5} textAnchor="end" fontSize={10.5} fill={C.lightBrown}>{fmt(v)}</text>
          </g>
        ))}

        {/* panel titles */}
        <text x={M.left} y={M.top - 3} fontSize={11} fontWeight={700} fill={C.tan} letterSpacing="0.08em">POUNDS HANGING</text>
        <text x={M.left} y={headTop - 6} fontSize={11} fontWeight={700} fill={C.tan} letterSpacing="0.08em">HEAD COUNT</text>

        {/* pounds: area wash + line (dashed = estimated exits) + end dot */}
        <path d={geom.areaPath} fill={LBS_COLOR} opacity={0.1} />
        {geom.estPath && <path d={geom.estPath} fill="none" stroke={LBS_COLOR} strokeWidth={2} strokeDasharray="5 4" strokeLinejoin="round" strokeLinecap="round" />}
        {geom.exactPath && <path d={geom.exactPath} fill="none" stroke={LBS_COLOR} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />}
        <circle cx={geom.xMid(n - 1)} cy={geom.yLbs(s[n - 1].lbs)} r={4.5} fill={LBS_COLOR} stroke={C.dark} strokeWidth={2} />
        <text x={Math.min(geom.xMid(n - 1) + 8, width - M.right)} y={geom.yLbs(s[n - 1].lbs) - 8}
          textAnchor="end" fontSize={12} fontWeight={700} fill={C.cream}>
          {fmt(s[n - 1].lbs)} lbs
        </text>

        {/* head-count bars, stacked by species (fixed order, bottom → top) */}
        {s.map((p, i) => {
          if (p.head === 0) return null
          const x = geom.xMid(i) - geom.barW / 2
          const segs: { sp: Species; top: number; bottom: number }[] = []
          let acc = 0
          for (const sp of geom.present) {
            const v = p.sp?.[sp] ?? 0
            if (!v) continue
            segs.push({ sp, top: geom.yHead(acc + v), bottom: geom.yHead(acc) })
            acc += v
          }
          return (
            <g key={p.d} opacity={hi === i ? 1 : 0.85}>
              {segs.map((seg, k) => {
                // 2px surface gap between segments (none under the lowest one,
                // which sits on the baseline); rounded cap only on the top of
                // the whole stack, square everywhere else.
                const bottom = seg.bottom - (k === 0 ? 0 : SEG_GAP)
                const h = Math.max(bottom - seg.top, 1)
                const y = bottom - h
                const r = k === segs.length - 1 ? Math.min(4, geom.barW / 2, h) : 0
                return (
                  <path key={seg.sp}
                    d={`M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + geom.barW - r},${y} Q${x + geom.barW},${y} ${x + geom.barW},${y + r} L${x + geom.barW},${y + h}Z`}
                    fill={SPECIES_COLOR[seg.sp]}
                  />
                )
              })}
            </g>
          )
        })}

        {/* x labels (shared axis) */}
        {geom.xTicks.map(t => (
          <text key={t.d} x={geom.xMid(t.i)} y={height - 8} textAnchor="middle" fontSize={10.5} fill={C.lightBrown}>
            {dateLabel(t.d, { month: 'short', day: 'numeric' })}
          </text>
        ))}

        {/* crosshair */}
        {hp && (
          <g pointerEvents="none">
            <line x1={tipX} x2={tipX} y1={M.top} y2={headTop + HEAD_H} stroke={C.tan} strokeWidth={1} opacity={0.5} />
            <circle cx={tipX} cy={geom.yLbs(hp.lbs)} r={4.5} fill={LBS_COLOR} stroke={C.dark} strokeWidth={2} />
          </g>
        )}
      </svg>

      {/* tooltip — totals, then the species mix that explains them */}
      {hp && (
        <div style={{
          position: 'absolute', left: tipLeft, top: 30, width: TIP_W, pointerEvents: 'none',
          background: 'rgba(26,10,4,0.96)', border: '1px solid rgba(166,120,90,0.4)',
          borderRadius: 4, padding: '0.5rem 0.7rem', zIndex: 5,
        }}>
          <div style={{ fontSize: '0.68rem', color: C.lightBrown, marginBottom: '0.3rem' }}>
            {dateLabel(hp.d, { weekday: 'short', month: 'short', day: 'numeric' })}
            {data.trackingStart && hp.d < data.trackingStart ? ' · estimated' : ''}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
            <span style={{ width: 12, height: 2, background: LBS_COLOR, flexShrink: 0 }} />
            <span style={{ fontSize: '0.92rem', fontWeight: 700, color: C.cream }}>{fmt(hp.lbs)}</span>
            <span style={{ fontSize: '0.7rem', color: C.tan }}>lbs</span>
          </div>
          {/* No swatch: the head panel is multi-coloured now, so a single
              colour key here would misname the species dots below. */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 18 }}>
            <span style={{ fontSize: '0.92rem', fontWeight: 700, color: C.cream }}>{fmt(hp.head)}</span>
            <span style={{ fontSize: '0.7rem', color: C.tan }}>head</span>
          </div>

          {hp.head > 0 && (
            <div style={{ marginTop: '0.45rem', paddingTop: '0.4rem', borderTop: `1px solid ${GRID}` }}>
              {geom.present.map(sp => {
                const v = hp.sp?.[sp] ?? 0
                if (!v) return null
                return (
                  <div key={sp} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 1 }}>
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: SPECIES_COLOR[sp], flexShrink: 0 }} />
                    <span style={{ fontSize: '0.72rem', color: C.tan, flex: 1 }}>{sp}</span>
                    <span style={{ fontSize: '0.75rem', fontWeight: 700, color: C.cream, fontVariantNumeric: 'tabular-nums' }}>{fmt(v)}</span>
                  </div>
                )
              })}
              <div style={{ fontSize: '0.68rem', color: C.lightBrown, marginTop: '0.35rem' }}>
                {fmt(Math.round(hp.lbs / hp.head))} lbs per head
              </div>
            </div>
          )}
        </div>
      )}

      {/* legend — identity never rests on color alone */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.25rem 1rem', marginTop: '0.5rem', paddingLeft: M.left }}>
        {geom.present.map(sp => (
          <span key={sp} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: SPECIES_COLOR[sp], flexShrink: 0 }} />
            <span style={{ fontSize: '0.72rem', color: C.tan }}>{sp}</span>
          </span>
        ))}
      </div>
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────
export default function PerformancePage() {
  const [data, setData]   = useState<CoolerData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [range, setRange] = useState('60')

  useEffect(() => {
    fetch('/api/performance/cooler')
      .then(r => r.json())
      .then(d => {
        if (d.error) setError(String(d.error))
        else setData(d as CoolerData)
      })
      .catch(() => setError('Could not load cooler data'))
  }, [])

  const view = useMemo(() => {
    if (!data) return null
    const days = RANGES.find(r => r.key === range)?.days ?? Infinity
    const series = days === Infinity ? data.series : data.series.slice(-days)
    return { ...data, series }
  }, [data, range])

  const now = data?.series[data.series.length - 1]

  // Same fixed order the chart stacks in, narrowed to what's in the range.
  const tableSpecies = useMemo(
    () => SPECIES.filter(sp => (view?.series ?? []).some(p => (p.sp?.[sp] ?? 0) > 0)),
    [view],
  )

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>

      {/* Header */}
      <header style={{
        background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)',
        padding: '0 2rem', height: '72px',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
          <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
          <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
          <div>
            <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>
              Performance
            </h1>
            <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>
              Cooler inventory · How the crew is keeping up
            </p>
          </div>
        </div>
      </header>

      <main style={{ padding: '2rem', maxWidth: '1100px', margin: '0 auto', boxSizing: 'border-box' }}>

        {error && (
          <div style={{ background: C.dark, border: '1px solid #E8883A', borderRadius: 4, padding: '1rem', color: '#E8883A', fontSize: '0.85rem', marginBottom: '1.5rem' }}>
            {error}
          </div>
        )}

        {/* Stat tiles — current state */}
        <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.5rem' }}>
          Right now
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <StatTile hero label="In the cooler" value={now ? fmt(now.lbs) : '—'} unit="lbs"
            sub={data ? `as of ${dateLabel(data.asOf, { weekday: 'long', month: 'short', day: 'numeric' })}` : undefined} />
          <StatTile label="Head hanging" value={now ? fmt(now.head) : '—'} unit="head" />
          <StatTile label="Average hang time" value={data ? String(data.hanging.avgDays) : '—'} unit="days"
            sub={data && data.hanging.maxDays > 0 ? `oldest: ${data.hanging.maxDays} days` : undefined} />
          <StatTile label="Typical hang to cut" value={data ? String(data.medianHangDays) : '—'} unit="days"
            sub="median, from the cut schedule" />
        </div>

        {/* Year to date — the scoreboard */}
        <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.15em', marginBottom: '0.5rem' }}>
          {data ? `${data.asOf.slice(0, 4)} so far` : 'This year so far'}
        </div>
        <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', marginBottom: '1.5rem' }}>
          <StatTile hero accent={LBS_COLOR} label="Pounds processed" value={data ? fmt(data.ytd.lbs) : '—'} unit="lbs"
            sub="carcass weight cut since Jan 1" />
          <StatTile hero accent={HEAD_COLOR} label="Head processed" value={data ? fmt(data.ytd.head) : '—'} unit="head"
            sub="carcasses cut since Jan 1" />
        </div>

        {/* Carcasses the cut schedule says are done but nobody marked cut. They
            never leave the chart, so both panels read high until someone does. */}
        {data && data.stale.head > 0 && (
          <div style={{
            background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderLeft: `4px solid ${WARN_COLOR}`,
            borderRadius: 4, padding: '0.85rem 1rem', marginBottom: '1.5rem',
            display: 'flex', alignItems: 'flex-start', gap: '0.6rem',
          }}>
            <span aria-hidden style={{ color: WARN_COLOR, fontSize: '1rem', lineHeight: 1.3 }}>⚠</span>
            <div style={{ fontSize: '0.8rem', color: C.cream, lineHeight: 1.5 }}>
              <strong style={{ color: WARN_COLOR }}>Still marked chilling:</strong>{' '}
              {fmt(data.stale.head)} head ({fmt(data.stale.lbs)} lbs) were scheduled to be cut
              {data.stale.oldestDue ? ` starting ${dateLabel(data.stale.oldestDue, { month: 'short', day: 'numeric' })}` : ''},
              but are still hanging on the harvest log — so this chart still counts them in the cooler.{' '}
              <Link href="/processing" style={{ color: C.tan, textDecoration: 'underline' }}>
                Mark them cut on the cut schedule
              </Link>{' '}
              to bring it back in line.
            </div>
          </div>
        )}

        {/* Range presets */}
        <div style={{ display: 'flex', gap: '0.5rem', marginBottom: '0.75rem' }}>
          {RANGES.map(r => (
            <button key={r.key} onClick={() => setRange(r.key)} style={{
              background: range === r.key ? C.medBrown : 'rgba(255,255,255,0.05)',
              color: range === r.key ? C.cream : C.lightBrown,
              border: `1px solid ${range === r.key ? C.medBrown : 'rgba(166,120,90,0.25)'}`,
              borderRadius: 3, padding: '0.35rem 0.9rem', fontSize: '0.78rem', fontWeight: 600, cursor: 'pointer',
            }}>
              {r.label}
            </button>
          ))}
        </div>

        {/* Chart card */}
        <div style={{ background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '1.25rem' }}>
          {view
            ? <CoolerChart data={view} />
            : !error && <div style={{ color: C.lightBrown, fontSize: '0.85rem', padding: '2rem' }}>Loading…</div>}
          {data?.trackingStart && data.estimatedExits > 0 && (
            <p style={{ fontSize: '0.72rem', color: C.lightBrown, margin: '0.75rem 0 0', lineHeight: 1.5 }}>
              Dashed stretch = before {dateLabel(data.trackingStart, { month: 'short', day: 'numeric' })}, when the cut
              schedule started recording exact cut dates. {data.estimatedExits} earlier carcasses are shown leaving the
              cooler {data.medianHangDays} days after harvest (the typical hang time) — treat that stretch as an estimate.
            </p>
          )}
        </div>

        {/* Projected draw-down — the cooler emptying as the current plan is cut.
            Everything above this point is history; this is the only forward
            look, so it's labelled a plan rather than a measurement. */}
        {data && data.drawdown.days.length > 1 && (() => {
          const days   = data.drawdown.days
          const maxLbs = Math.max(...days.map(p => p.lbs), 1)
          const start  = days[0]
          return (
            <div style={{ marginTop: '1rem', background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4, padding: '1.25rem' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: '1rem', flexWrap: 'wrap', marginBottom: '0.9rem' }}>
                <div>
                  <div style={{ fontSize: '0.72rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                    Projected draw-down
                  </div>
                  <div style={{ fontSize: '0.78rem', color: C.tan, marginTop: '0.25rem' }}>
                    If the cut schedule runs as laid out
                    {data.drawdown.planDate && <> · plan saved {dateLabel(data.drawdown.planDate, { month: 'short', day: 'numeric' })}</>}
                  </div>
                </div>
                {/* End-of-day, not right-now — today's cutting is already taken
                    off, so this is deliberately lower than the "In the cooler"
                    tile above and says so. */}
                <div style={{ fontSize: '0.78rem', color: C.lightBrown }}>
                  after today: <strong style={{ color: C.cream }}>{fmt(start.head)} head</strong> / {fmt(start.lbs)} lbs
                  {data.drawdown.lastDay && <> → empty {dateLabel(data.drawdown.lastDay, { weekday: 'short', month: 'short', day: 'numeric' })}</>}
                </div>
              </div>

              <div style={{ display: 'flex', gap: '0.35rem', alignItems: 'flex-end', height: 130 }}>
                {days.map((p, i) => {
                  const prev  = i > 0 ? days[i - 1] : null
                  // A day nothing comes off — a weekend, or a break nobody dated.
                  const idle  = !!prev && prev.lbs === p.lbs
                  return (
                    <div key={p.d} style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', height: '100%' }}>
                      <div style={{ fontSize: '0.62rem', color: C.cream, textAlign: 'center', marginBottom: 3, fontVariantNumeric: 'tabular-nums' }}>
                        {p.head}
                      </div>
                      <div
                        title={`${dateLabel(p.d, { weekday: 'long', month: 'short', day: 'numeric' })} — ${fmt(p.head)} head / ${fmt(p.lbs)} lbs still hanging${idle ? ' (nothing scheduled to come off)' : ''}`}
                        style={{
                          height: `${Math.max((p.lbs / maxLbs) * 100, p.lbs > 0 ? 2 : 0)}%`,
                          background: idle ? 'rgba(206,106,32,0.35)' : LBS_COLOR,
                          borderRadius: '2px 2px 0 0', minHeight: p.lbs > 0 ? 2 : 0,
                        }}
                      />
                    </div>
                  )
                })}
              </div>

              <div style={{ display: 'flex', gap: '0.35rem', marginTop: '0.35rem' }}>
                {days.map(p => (
                  <div key={p.d} style={{ flex: 1, minWidth: 0, textAlign: 'center', fontSize: '0.6rem', color: C.lightBrown, whiteSpace: 'nowrap', overflow: 'hidden' }}>
                    {dateLabel(p.d, { weekday: 'short' })}
                  </div>
                ))}
              </div>

              <p style={{ fontSize: '0.72rem', color: C.lightBrown, margin: '0.85rem 0 0', lineHeight: 1.5 }}>
                Bar = pounds still hanging at the end of that day, number above = head.
                Faded bars are days the plan takes nothing off.
                {data.drawdown.unplanned.head > 0 ? (
                  <>
                    {' '}<strong style={{ color: WARN_COLOR }}>
                      {fmt(data.drawdown.unplanned.head)} head ({fmt(data.drawdown.unplanned.lbs)} lbs) have no cut day
                    </strong>{' '}
                    and never come off this projection —{' '}
                    <Link href="/processing" style={{ color: C.tan, textDecoration: 'underline' }}>give them a day</Link>{' '}
                    and the line reaches the floor.
                  </>
                ) : (
                  <> Every carcass in the cooler has a day, so the plan clears it out.</>
                )}
              </p>
            </div>
          )
        })()}

        {/* Table view — same numbers without hovering */}
        {view && view.series.length > 0 && (
          <details style={{ marginTop: '1rem' }}>
            <summary style={{ color: C.tan, fontSize: '0.8rem', cursor: 'pointer', fontWeight: 600 }}>
              Show data table
            </summary>
            <div style={{ maxHeight: 320, overflowY: 'auto', marginTop: '0.75rem', background: C.dark, border: '1px solid rgba(166,120,90,0.18)', borderRadius: 4 }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.78rem' }}>
                <thead>
                  <tr>
                    {['Date', 'Head', ...tableSpecies, 'Pounds', 'Lbs/head'].map((h, i) => (
                      <th key={h} style={{ position: 'sticky', top: 0, background: C.dark, color: C.tan, textAlign: i === 0 ? 'left' : 'right', padding: '0.5rem 0.9rem', borderBottom: '1px solid rgba(166,120,90,0.3)', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody style={{ fontVariantNumeric: 'tabular-nums' }}>
                  {[...view.series].reverse().map(p => {
                    const cell = { color: C.cream, textAlign: 'right' as const, padding: '0.35rem 0.9rem', borderBottom: `1px solid ${GRID}` }
                    return (
                      <tr key={p.d}>
                        <td style={{ ...cell, textAlign: 'left', whiteSpace: 'nowrap' }}>{dateLabel(p.d, { month: 'short', day: 'numeric', year: 'numeric' })}</td>
                        <td style={cell}>{fmt(p.head)}</td>
                        {tableSpecies.map(sp => <td key={sp} style={cell}>{fmt(p.sp?.[sp] ?? 0)}</td>)}
                        <td style={cell}>{fmt(p.lbs)}</td>
                        <td style={cell}>{p.head ? fmt(Math.round(p.lbs / p.head)) : '—'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </details>
        )}

      </main>
    </div>
  )
}
