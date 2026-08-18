'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import { dateLabel } from '@/lib/dates'
import { AREA_STATE_COLOR, AREA_STATE_LABEL, type AreaState } from '@/lib/cleaning'
import { C, CleaningHeader, Banner, cardStyle } from '../ui'

// The plant at a glance.
//
// One screen that answers "where does the work still need doing" without
// reading a list. It's the same shift data the checklist uses, drawn in the
// shape of the building — so a lead standing in the doorway can see the room
// that hasn't been touched instead of scrolling.

interface Room {
  id: string
  name: string
  x: number | null; y: number | null; w: number | null; h: number | null
  color: string | null
  state: AreaState
  total: number
  pending: number
  flagged: number
  in_use: boolean
  positioned: boolean
}

interface MapData {
  date: string
  shift: { id: string; status: string; production_seen: string[] } | null
  rooms: Room[]
  settings: { background_url: string | null; background_alpha: number; canvas_w: number; canvas_h: number }
}

export default function PlantMap() {
  const [data,     setData]     = useState<MapData | null>(null)
  const [error,    setError]    = useState<string | null>(null)
  const [selected, setSelected] = useState<Room | null>(null)

  // The map has to fit the screen — a plant you have to scroll sideways can't
  // be glanced at, which is the whole reason it exists. Fitting a 1000-unit
  // plan onto a 375px phone is a 0.375 scale though, and text drawn in canvas
  // units would shrink to nothing with it. So the container is measured and
  // label sizes are divided by that scale, which keeps them a constant size in
  // real screen pixels whatever the width.
  const boxRef = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)

  const load = useCallback(() => {
    fetch('/api/cleaning/map')
      .then(r => r.json().then(b => ({ ok: r.ok, b })))
      .then(({ ok, b }) => { if (!ok) setError(b?.error ?? 'Could not load the map.'); else setData(b) })
      .catch(() => setError('No connection — the map can’t load right now.'))
  }, [])

  useEffect(() => { load() }, [load])

  // Track how wide the drawing actually renders, so label sizes can compensate.
  useEffect(() => {
    const el = boxRef.current
    if (!el || !data) return
    const measure = () => {
      const w = el.clientWidth - 16   // padding
      if (w > 0) setScale(w / data.settings.canvas_w)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [data])

  if (error) return (
    <>
      <CleaningHeader title="Plant map" back="/cleaning" />
      <div style={{ padding: 16 }}><Banner tone="error">{error}</Banner></div>
    </>
  )

  if (!data) return (
    <>
      <CleaningHeader title="Plant map" back="/cleaning" />
      <div style={{ padding: 24, color: C.tan }}>Loading…</div>
    </>
  )

  const { canvas_w: cw, canvas_h: ch } = data.settings

  // Anything nobody has placed yet gets parked in a row along the bottom so it
  // is visible and draggable rather than silently missing from the plant.
  const unplaced = data.rooms.filter(r => !r.positioned)
  const placed   = data.rooms.filter(r => r.positioned)
  const parked   = unplaced.map((r, i) => ({
    ...r,
    x: 40 + (i % 5) * 190, y: ch + 30 + Math.floor(i / 5) * 90, w: 170, h: 70,
  }))
  const viewH = unplaced.length ? ch + 30 + Math.ceil(unplaced.length / 5) * 90 : ch
  const all   = [...placed, ...parked] as (Room & { x: number; y: number; w: number; h: number })[]

  return (
    <div style={{ paddingBottom: 40 }}>
      <CleaningHeader title="Plant map" back="/cleaning" />

      <div style={{ padding: 16, maxWidth: 1100, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 12 }}>
          <span style={{ color: C.cream, fontSize: 16, fontWeight: 700 }}>
            {dateLabel(data.date)}
          </span>
          {data.shift?.production_seen && data.shift.production_seen.length > 0 && (
            <span style={{ color: C.tan, fontSize: 12 }}>
              ran today: {data.shift.production_seen.join(' · ')}
            </span>
          )}
        </div>

        {!data.shift && (
          <Banner tone="info">
            Tonight&apos;s list hasn&apos;t been started, so nothing is scheduled yet.{' '}
            <Link href="/cleaning/shift" style={{ color: C.amber }}>Open it</Link> to see the
            rooms light up.
          </Banner>
        )}

        {/* The map */}
        <div
          ref={boxRef}
          style={{
            background: C.dark, border: `1px solid ${C.medBrown}`,
            borderRadius: 12, padding: 8,
          }}
        >
          <svg
            viewBox={`0 0 ${cw} ${viewH}`}
            style={{ width: '100%', height: 'auto', display: 'block' }}
            role="img"
            aria-label="Plant map showing cleaning status by area"
          >
            {data.settings.background_url && (
              <image
                href={data.settings.background_url}
                x={0} y={0} width={cw} height={ch}
                opacity={data.settings.background_alpha}
                preserveAspectRatio="xMidYMid meet"
              />
            )}

            {all.map(r => {
              const fill = r.color ?? AREA_STATE_COLOR[r.state]
              // Untracked rooms sit back so the eye goes to real work.
              const dim  = r.state === 'untracked'
              // Canvas units that render as a fixed number of screen pixels.
              const px   = (n: number) => n / scale
              const pad  = px(10)
              const inner = Math.max(px(20), r.w - pad * 2)
              // Shrink a long name until it fits its room instead of letting it
              // run across the neighbour. ~0.58em average glyph width is close
              // enough for a sans label, and the clip below is the guarantee.
              const fit = (text: string, ideal: number, floor: number) =>
                Math.max(px(floor), Math.min(px(ideal), inner / (0.58 * Math.max(text.length, 1))))
              const nameSize   = fit(r.name, 14, 8)
              const statusText = r.total === 0
                ? AREA_STATE_LABEL.untracked
                : r.flagged > 0
                  ? `⚠ ${r.flagged} flagged`
                  : r.pending > 0
                    ? `${r.pending} of ${r.total} left`
                    : `✓ all ${r.total} done`
              const statusSize = fit(statusText, 11, 7)
              return (
                <g
                  key={r.id}
                  onClick={() => setSelected(r)}
                  style={{ cursor: 'pointer' }}
                  role="button"
                  aria-label={`${r.name}: ${AREA_STATE_LABEL[r.state]}`}
                >
                  <rect
                    x={r.x} y={r.y} width={r.w} height={r.h} rx={10}
                    fill={fill}
                    fillOpacity={dim ? 0.25 : 0.65}
                    stroke={selected?.id === r.id ? C.cream : fill}
                    strokeWidth={selected?.id === r.id ? 3 : 1.5}
                  />

                  {/* In-use stripe: production ran in here today, so it is
                      dirtier than the schedule alone implies. Kept as a shape
                      rather than only text, so it survives at any scale. */}
                  {r.in_use && (
                    <rect
                      x={r.x} y={r.y} width={r.w} height={px(5)} rx={px(2.5)}
                      fill={C.amber}
                    />
                  )}

                  {/* Hard guarantee that nothing escapes its room, whatever
                      the estimate above got wrong about glyph widths. */}
                  <clipPath id={`clip-${r.id}`}>
                    <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={10} />
                  </clipPath>

                  <g clipPath={`url(#clip-${r.id})`} style={{ pointerEvents: 'none' }}>
                    <text
                      x={r.x + pad} y={r.y + px(22)}
                      fill={C.cream} fontSize={nameSize} fontWeight={700}
                    >
                      {r.name}
                    </text>

                    {/* Colour is never the only signal — every room states its
                        status in words for anyone who can't separate the hues. */}
                    <text
                      x={r.x + pad} y={r.y + px(38)}
                      fill={C.cream} fontSize={statusSize} opacity={0.9}
                    >
                      {statusText}
                    </text>
                  </g>

                  {/* Dropped on very small rooms rather than allowed to spill
                      past the edge — the stripe already carries the meaning. */}
                  {r.in_use && r.h > px(58) && (
                    <text
                      x={r.x + pad} y={r.y + px(53)}
                      fill={C.amber} fontSize={px(10)} fontWeight={700}
                      style={{ pointerEvents: 'none' }}
                    >
                      RAN TODAY
                    </text>
                  )}
                </g>
              )
            })}
          </svg>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', margin: '14px 0 4px' }}>
          {(['pending', 'partial', 'done', 'flagged', 'untracked'] as AreaState[]).map(s => (
            <span key={s} style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.tan, fontSize: 12 }}>
              <span style={{
                width: 12, height: 12, borderRadius: 3,
                background: AREA_STATE_COLOR[s], display: 'inline-block',
              }} />
              {AREA_STATE_LABEL[s]}
            </span>
          ))}
          <span style={{ display: 'flex', alignItems: 'center', gap: 6, color: C.tan, fontSize: 12 }}>
            <span style={{ width: 12, height: 4, borderRadius: 2, background: C.amber, display: 'inline-block' }} />
            Production ran there today
          </span>
        </div>

        {unplaced.length > 0 && (
          <div style={{ color: C.lightBrown, fontSize: 12, marginTop: 8 }}>
            {unplaced.length} {unplaced.length === 1 ? 'area is' : 'areas are'} parked below the
            plan — drag them into place in{' '}
            <Link href="/cleaning/admin" style={{ color: C.amber }}>Manage → Map</Link>.
          </div>
        )}

        {/* Tapped room */}
        {selected && (
          <div style={{ ...cardStyle, marginTop: 16 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
              <span style={{ color: C.cream, fontSize: 17, fontWeight: 700 }}>{selected.name}</span>
              <button
                onClick={() => setSelected(null)}
                style={{ background: 'none', border: 'none', color: C.tan, fontSize: 18, cursor: 'pointer' }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
              <span style={{
                fontSize: 12, fontWeight: 700, padding: '3px 8px', borderRadius: 4,
                color: C.cream, background: AREA_STATE_COLOR[selected.state],
              }}>
                {AREA_STATE_LABEL[selected.state]}
              </span>
              {selected.in_use && (
                <span style={{
                  fontSize: 12, color: C.amber, border: `1px solid ${C.amber}`,
                  borderRadius: 4, padding: '3px 8px',
                }}>
                  Production ran here today
                </span>
              )}
            </div>

            <div style={{ color: C.tan, fontSize: 14, marginBottom: 14 }}>
              {selected.total === 0
                ? 'Nothing on tonight’s list for this area.'
                : `${selected.total} item${selected.total === 1 ? '' : 's'} tonight · ${selected.pending} still to do${selected.flagged ? ` · ${selected.flagged} flagged` : ''}`}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <Link href="/cleaning/shift" style={{ flex: 1, textDecoration: 'none' }}>
                <div style={{
                  minHeight: 46, borderRadius: 8, background: C.medBrown, color: C.cream,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15, fontWeight: 700,
                }}>
                  Open the list
                </div>
              </Link>
              <Link href="/cleaning/equipment" style={{ flex: 1, textDecoration: 'none' }}>
                <div style={{
                  minHeight: 46, borderRadius: 8, background: C.dark,
                  border: `1px solid ${C.medBrown}`, color: C.tan,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 15,
                }}>
                  Equipment
                </div>
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
