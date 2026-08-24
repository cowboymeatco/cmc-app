'use client'
import { useEffect, useState, useCallback, useRef } from 'react'
import { C, Banner, BigButton, PhotoButton, cardStyle } from '../ui'

// Drag the rooms until the map looks like the building.
//
// Pointer events rather than mouse events, because this gets used on the phone
// people are already holding — and because a floor plan is easiest to trace
// standing in the room it describes.
//
// Everything is stored as plain numbers on the area, so a layout drawn here by
// hand and a layout traced over a real floor plan are the same thing to every
// other screen.

interface Room {
  id: string
  name: string
  x: number | null; y: number | null; w: number | null; h: number | null
  positioned: boolean
}

interface Settings {
  background_url: string | null
  background_alpha: number
  canvas_w: number
  canvas_h: number
}

type Placed = Room & { x: number; y: number; w: number; h: number }

const GRID = 10

/** Break a name into two lines as evenly as the words allow. */
function splitLines(words: string[]): string[] {
  const total = words.join(' ').length
  let best = 1
  let bestGap = Infinity
  for (let i = 1; i < words.length; i++) {
    const head = words.slice(0, i).join(' ').length
    const gap  = Math.abs(head - (total - head - 1))
    if (gap < bestGap) { bestGap = gap; best = i }
  }
  return [words.slice(0, best).join(' '), words.slice(best).join(' ')]
}

export default function MapEditor({ onError }: { onError: (e: string) => void }) {
  const [rooms,    setRooms]    = useState<Placed[]>([])
  const [settings, setSettings] = useState<Settings | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [dirty,    setDirty]    = useState(false)
  const [saving,   setSaving]   = useState(false)
  const [saved,    setSaved]    = useState(false)

  const svgRef  = useRef<SVGSVGElement | null>(null)
  // The plan is drawn in canvas units and squeezed to whatever width the panel
  // gets, so a label written in canvas units is a different size on every
  // screen. Measure the squeeze and divide by it, the way the crew map does,
  // so what's laid out here reads the same as what the crew ends up looking at.
  const boxRef  = useRef<HTMLDivElement | null>(null)
  const [scale, setScale] = useState(1)
  // Where in the room the finger landed, so a drag doesn't snap the room's
  // corner to the fingertip.
  const dragRef = useRef<{ id: string; dx: number; dy: number; mode: 'move' | 'resize' } | null>(null)

  const load = useCallback(() => {
    fetch('/api/cleaning/map')
      .then(r => r.json())
      .then(d => {
        setSettings(d.settings)
        const ch = d.settings.canvas_h
        setRooms((d.rooms as Room[]).map((r, i) => ({
          ...r,
          // Unplaced rooms get parked in a row rather than stacking at 0,0
          // where they'd be impossible to pull apart.
          x: r.x ?? 40 + (i % 5) * 190,
          y: r.y ?? ch + 30 + Math.floor(i / 5) * 90,
          w: r.w ?? 170,
          h: r.h ?? 70,
        })))
      })
      .catch(() => onError('Could not load the map.'))
  }, [onError])

  useEffect(() => { load() }, [load])

  useEffect(() => {
    const el = boxRef.current
    if (!el || !settings) return
    const measure = () => {
      const w = el.clientWidth - 16   // padding
      if (w > 0) setScale(w / settings.canvas_w)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [settings])

  /** Pointer position in SVG user units, which is what the geometry is in. */
  function toSvg(e: React.PointerEvent): { x: number; y: number } {
    const svg = svgRef.current
    if (!svg) return { x: 0, y: 0 }
    const pt = svg.createSVGPoint()
    pt.x = e.clientX
    pt.y = e.clientY
    const ctm = svg.getScreenCTM()
    if (!ctm) return { x: 0, y: 0 }
    const p = pt.matrixTransform(ctm.inverse())
    return { x: p.x, y: p.y }
  }

  const snap = (n: number) => Math.round(n / GRID) * GRID

  function onDown(e: React.PointerEvent, room: Placed, mode: 'move' | 'resize') {
    e.stopPropagation()
    // Capture so a fast drag that leaves the shape keeps tracking.
    ;(e.target as Element).setPointerCapture?.(e.pointerId)
    const p = toSvg(e)
    dragRef.current = {
      id: room.id, mode,
      dx: mode === 'move' ? p.x - room.x : p.x - (room.x + room.w),
      dy: mode === 'move' ? p.y - room.y : p.y - (room.y + room.h),
    }
    setSelected(room.id)
  }

  function onMove(e: React.PointerEvent) {
    const d = dragRef.current
    if (!d) return
    e.preventDefault()
    const p = toSvg(e)
    setRooms(prev => prev.map(r => {
      if (r.id !== d.id) return r
      if (d.mode === 'move') {
        return { ...r, x: Math.max(0, snap(p.x - d.dx)), y: Math.max(0, snap(p.y - d.dy)) }
      }
      return {
        ...r,
        w: Math.max(60, snap(p.x - d.dx - r.x)),
        h: Math.max(50, snap(p.y - d.dy - r.y)),
      }
    }))
    setDirty(true)
    setSaved(false)
  }

  function onUp() { dragRef.current = null }

  async function save() {
    setSaving(true)
    try {
      const res = await fetch('/api/cleaning/map', {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rooms: rooms.map(r => ({ id: r.id, x: r.x, y: r.y, w: r.w, h: r.h })),
        }),
      })
      const body = await res.json()
      if (!res.ok) { onError(body?.error ?? 'Could not save the layout.'); return }
      setDirty(false)
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      onError('Could not save — check your connection.')
    } finally {
      setSaving(false)
    }
  }

  async function saveSettings(patch: Partial<Settings>) {
    setSettings(s => (s ? { ...s, ...patch } : s))
    const res = await fetch('/api/cleaning/map', {
      method:  'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ settings: patch }),
    })
    if (!res.ok) onError('Could not save the map settings.')
  }

  if (!settings) return <p style={{ color: C.tan }}>Loading…</p>

  const cw = settings.canvas_w
  // Grow the canvas to include anything parked below it, so nothing is
  // stranded off-screen where it can't be dragged back.
  const maxY  = Math.max(settings.canvas_h, ...rooms.map(r => r.y + r.h + 40))
  const sel   = rooms.find(r => r.id === selected)

  return (
    <>
      <div style={{ color: C.tan, fontSize: 13, lineHeight: 1.5, marginBottom: 12 }}>
        Drag a room to move it, drag its bottom-right corner to resize. Upload a floor
        plan and the rooms sit on top of it, so the map can match the real building.
      </div>

      <div ref={boxRef} style={{
        background: C.dark, border: `1px solid ${C.medBrown}`,
        borderRadius: 12, padding: 8, marginBottom: 12,
      }}>
        <svg
          ref={svgRef}
          viewBox={`0 0 ${cw} ${maxY}`}
          onPointerMove={onMove}
          onPointerUp={onUp}
          onPointerLeave={onUp}
          onClick={() => setSelected(null)}
          style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        >
          {settings.background_url && (
            <image
              href={settings.background_url}
              x={0} y={0} width={cw} height={settings.canvas_h}
              opacity={settings.background_alpha}
              preserveAspectRatio="xMidYMid meet"
            />
          )}

          {/* Grid, so rooms line up without needing a ruler */}
          {Array.from({ length: Math.ceil(cw / 100) + 1 }, (_, i) => (
            <line key={`v${i}`} x1={i * 100} y1={0} x2={i * 100} y2={maxY}
                  stroke={C.medBrown} strokeOpacity={0.25} strokeWidth={1} />
          ))}
          {Array.from({ length: Math.ceil(maxY / 100) + 1 }, (_, i) => (
            <line key={`h${i}`} x1={0} y1={i * 100} x2={cw} y2={i * 100}
                  stroke={C.medBrown} strokeOpacity={0.25} strokeWidth={1} />
          ))}

          {/* Where the plan ends and the parking area begins */}
          {maxY > settings.canvas_h && (
            <line x1={0} y1={settings.canvas_h} x2={cw} y2={settings.canvas_h}
                  stroke={C.amber} strokeDasharray="8 6" strokeWidth={2} />
          )}

          {rooms.map(r => {
            const on = selected === r.id
            // A name written at one fixed size ran clean out of a narrow room
            // and across its neighbour's title — the showroom coolers are 75
            // units wide and "Showroom Freezer" is nearly twice that (Charlie,
            // 2026-08-23). Long names now break at a space and shrink until
            // they fit the room they belong to, with a clip as the guarantee.
            const px    = (n: number) => n / scale
            // A closet can't spare the same margin a kill floor can.
            const pad   = Math.min(px(10), r.w * 0.12)
            const inner = Math.max(px(14), r.w - pad * 2)
            const fit   = (text: string) =>
              Math.max(px(6), Math.min(px(15), inner / (0.58 * Math.max(text.length, 1))))
            // Two lines only when one line genuinely doesn't fit the width and
            // the room is tall enough to hold both — a name that already fits
            // stays on one line rather than being broken for no reason.
            const wide    = (text: string, size: number) => 0.58 * text.length * size
            const words   = r.name.split(' ')
            const oneLine = fit(r.name)
            let   lines   = [r.name]
            let   size    = oneLine
            if (words.length > 1 && wide(r.name, oneLine) > inner) {
              const cand     = splitLines(words)
              const candSize = Math.min(...cand.map(fit))
              if (candSize >= oneLine && pad + candSize * 2 <= r.h) {
                lines = cand
                size  = candSize
              }
            }
            return (
              <g key={r.id}>
                <rect
                  x={r.x} y={r.y} width={r.w} height={r.h} rx={10}
                  fill={C.medBrown} fillOpacity={on ? 0.85 : 0.55}
                  stroke={on ? C.amber : C.lightBrown} strokeWidth={on ? 3 : 1.5}
                  onPointerDown={e => onDown(e, r, 'move')}
                  style={{ cursor: 'move' }}
                />
                <clipPath id={`edit-clip-${r.id}`}>
                  <rect x={r.x} y={r.y} width={r.w} height={r.h} rx={10} />
                </clipPath>
                {/* Rooms too small to spell out still answer on hover, and the
                    readout under the map names whichever one is selected. */}
                <title>{r.name}</title>
                <g clipPath={`url(#edit-clip-${r.id})`} style={{ pointerEvents: 'none' }}>
                  {lines.map((line, i) => (
                    <text
                      key={i}
                      x={r.x + pad} y={r.y + pad + size * (i + 1)}
                      fill={C.cream} fontSize={size} fontWeight={700}
                    >
                      {line}
                    </text>
                  ))}
                </g>
                {/* Resize grip, sized for a fingertip rather than a mouse */}
                <rect
                  x={r.x + r.w - 22} y={r.y + r.h - 22} width={22} height={22} rx={5}
                  fill={on ? C.amber : C.lightBrown}
                  onPointerDown={e => onDown(e, r, 'resize')}
                  style={{ cursor: 'nwse-resize' }}
                />
              </g>
            )
          })}
        </svg>
      </div>

      {sel && (
        <div style={{ color: C.tan, fontSize: 12, marginBottom: 10 }}>
          {sel.name} — {sel.w}×{sel.h} at {sel.x},{sel.y}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        <BigButton
          label={saving ? 'Saving…' : saved ? '✓ Layout saved' : dirty ? 'Save layout' : 'Nothing to save'}
          tone={saved ? C.green : C.medBrown}
          onClick={save}
          disabled={!dirty || saving}
        />
      </div>

      <div style={{ ...cardStyle, display: 'flex', flexDirection: 'column', gap: 12 }}>
        <div style={{ color: C.tan, fontSize: 13, fontWeight: 700 }}>Floor plan background</div>

        {settings.background_url ? (
          <>
            <Banner tone="ok">A floor plan is set. Rooms draw on top of it.</Banner>
            <label style={{ color: C.tan, fontSize: 13 }}>
              How strongly it shows: {Math.round(settings.background_alpha * 100)}%
            </label>
            <input
              type="range" min={0} max={1} step={0.05}
              value={settings.background_alpha}
              onChange={e => setSettings(s => (s ? { ...s, background_alpha: Number(e.target.value) } : s))}
              onPointerUp={() => saveSettings({ background_alpha: settings.background_alpha })}
              style={{ width: '100%' }}
            />
            <button
              onClick={() => saveSettings({ background_url: null, background_path: null } as Partial<Settings>)}
              style={{
                minHeight: 44, background: C.dark, border: `1px solid ${C.medBrown}`,
                borderRadius: 8, color: C.lightBrown, fontSize: 14, cursor: 'pointer',
              }}
            >
              Remove floor plan
            </button>
          </>
        ) : (
          <div style={{ color: C.lightBrown, fontSize: 13, lineHeight: 1.5 }}>
            No floor plan yet. A photo of the one on the wall works — the rooms just
            need to sit roughly where they really are.
          </div>
        )}

        <PhotoButton
          label={settings.background_url ? 'Replace floor plan' : 'Upload a floor plan'}
          extra={{ kind: 'reference' }}
          onUploaded={(url, raw) =>
            saveSettings({
              background_url:  url,
              background_path: (raw as { storage_path?: string }).storage_path,
            } as Partial<Settings>)
          }
        />
      </div>
    </>
  )
}
