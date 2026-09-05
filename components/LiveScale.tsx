'use client'

import { useEffect, useState } from 'react'

// Live reading from a scale on the harvest kiosk, with a Capture button that hands the
// weight to the caller in pounds. Backed by /api/scale-readings (the kiosk agent upserts
// one row per scale about once a second). Renders nothing until the agent has ever
// reported that scale, so pages without a kiosk look exactly as before.

export type ScaleId = 'live_animal' | 'rail'

export interface ScaleReading {
  scale_id:   ScaleId
  kiosk:      string | null
  kg:         number | null
  lb:         number | null
  stable:     boolean
  stale:      boolean
  below_zero: boolean
  read_at:    string
  updated_at: string
  /** Set by the hook at fetch time: the kiosk agent hasn't touched this row recently. */
  agentGone:  boolean
}

// The agent is considered gone if its row hasn't been touched in this long.
const AGENT_TIMEOUT_MS = 15_000

export function useScaleReadings(pollMs = 1000): Record<string, ScaleReading> {
  const [readings, setReadings] = useState<Record<string, ScaleReading>>({})
  useEffect(() => {
    let alive = true
    async function tick() {
      try {
        const res  = await fetch('/api/scale-readings', { cache: 'no-store' })
        const rows = await res.json()
        if (alive && Array.isArray(rows)) {
          const now = Date.now()
          setReadings(Object.fromEntries(rows.map((r: ScaleReading) => [
            r.scale_id,
            { ...r, agentGone: now - new Date(r.updated_at).getTime() > AGENT_TIMEOUT_MS },
          ])))
        }
      } catch { /* keep the last reading; the widget shows staleness by timestamp */ }
    }
    tick()
    const id = setInterval(tick, pollMs)
    return () => { alive = false; clearInterval(id) }
  }, [pollMs])
  return readings
}

interface Props {
  reading:   ScaleReading | undefined
  label:     string                   // e.g. 'Live scale', 'Rail scale'
  decimals:  0 | 1                    // live animal: whole lb; carcass: tenths
  onCapture: (lb: number) => void
}

export function LiveScale({ reading, label, decimals, onCapture }: Props) {
  if (!reading) return null
  const agentGone = reading.agentGone
  const dead      = agentGone || reading.stale || reading.lb == null
  const lb        = reading.lb == null ? null : Number(reading.lb.toFixed(decimals))
  const canCapture = !dead && !reading.below_zero && lb != null && lb > 0

  const color = dead ? '#A6785A' : reading.stable ? '#4CAF50' : '#D97706'
  const status = agentGone ? 'kiosk offline'
    : reading.stale ? 'scale asleep'
    : reading.below_zero ? 'hook empty'
    : reading.stable ? 'stable' : 'settling…'

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginTop: '0.35rem', fontSize: '0.8rem' }}>
      <span style={{ color: '#A6785A' }}>⚖ {label}:</span>
      <span style={{ color, fontWeight: 700, fontVariantNumeric: 'tabular-nums', minWidth: '4.5rem' }}>
        {dead || lb == null ? '—' : `${lb.toFixed(decimals)} lb`}
      </span>
      <span style={{ color: '#A6785A', fontSize: '0.72rem' }}>{status}</span>
      <button type="button" disabled={!canCapture} onClick={() => lb != null && onCapture(lb)}
        title={reading.stable ? 'Copy the live reading into the field' : 'Wait for the reading to settle'}
        style={{
          marginLeft: 'auto', padding: '0.3rem 0.8rem', borderRadius: 3, fontWeight: 600, fontSize: '0.78rem',
          cursor: canCapture ? 'pointer' : 'not-allowed', opacity: canCapture ? 1 : 0.45,
          border: `1px solid ${reading.stable ? '#4CAF50' : 'rgba(166,120,90,0.4)'}`,
          background: reading.stable && canCapture ? 'rgba(76,175,80,0.15)' : 'rgba(255,255,255,0.04)',
          color: reading.stable && canCapture ? '#4CAF50' : '#C9A882',
        }}>
        Capture
      </button>
    </div>
  )
}
