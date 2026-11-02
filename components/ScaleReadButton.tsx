'use client'

// "⚖ Read" — pulls the live gross weight off the Rice Lake rail scale into a
// weight field. Sits beside the input it fills. Renders nothing in browsers
// without Web Serial (Safari, Firefox, iPad), so those pages look as before.
//
// First click on a new machine opens Chrome's port picker: pick the Keyspan
// (COM5 on the harvest laptop). Chrome remembers the grant per site, so after
// that one pick the button reads straight away. See lib/riceLake.ts.

import { useEffect, useState } from 'react'
import { chooseScalePort, readWeight, reconnectScale, scaleStatus, ScaleStatus } from '@/lib/riceLake'

interface Props {
  onWeight: (lbs: number) => void
  /** Round the reading to this many decimals before handing it over. Default 1. */
  decimals?: number
  title?: string
}

type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  | { kind: 'moving' }      // read came back but the load was still swinging
  | { kind: 'error'; message: string }

const TAN = '#C9A882'
const YELLOW = '#D97706'
const RED = '#E53E3E'

export default function ScaleReadButton({ onWeight, decimals = 1, title }: Props) {
  const [status, setStatus] = useState<ScaleStatus>('unsupported')
  const [state, setState]   = useState<State>({ kind: 'idle' })

  useEffect(() => {
    let alive = true
    reconnectScale().then(() => { if (alive) setStatus(scaleStatus()) })
    return () => { alive = false }
  }, [])

  // Clear a transient message after a moment so the row goes back to normal.
  useEffect(() => {
    if (state.kind !== 'moving' && state.kind !== 'error') return
    const t = setTimeout(() => setState({ kind: 'idle' }), 4000)
    return () => clearTimeout(t)
  }, [state])

  if (status === 'unsupported') return null

  async function read() {
    if (state.kind === 'reading') return
    try {
      if (scaleStatus() === 'no-port') {
        const ok = await chooseScalePort()
        if (!ok) return                     // picker closed, nothing to report
        setStatus(scaleStatus())
      }
      setState({ kind: 'reading' })
      const r = await readWeight()
      const f = Math.pow(10, decimals)
      onWeight(Math.round(r.lbs * f) / f)
      setState(r.stable ? { kind: 'idle' } : { kind: 'moving' })
    } catch (e) {
      setState({ kind: 'error', message: e instanceof Error ? e.message : 'Scale read failed' })
    }
  }

  const busy  = state.kind === 'reading'
  const label = busy ? 'Reading…' : status === 'no-port' ? '⚖ Connect' : '⚖ Read'

  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-start', gap: '0.2rem' }}>
      <button type="button" onClick={read} disabled={busy}
        title={title ?? (status === 'no-port' ? 'Pick the scale’s serial port (Keyspan, COM5)' : 'Read the weight off the scale')}
        style={{
          background: 'rgba(201,168,130,0.14)', color: TAN, border: `1px solid ${TAN}66`, borderRadius: 3,
          padding: '0.5rem 0.75rem', fontSize: '0.82rem', fontWeight: 600, cursor: busy ? 'wait' : 'pointer',
          whiteSpace: 'nowrap', opacity: busy ? 0.7 : 1, letterSpacing: '0.03em',
        }}>
        {label}
      </button>
      {state.kind === 'moving' && (
        <span style={{ fontSize: '0.68rem', color: YELLOW, whiteSpace: 'nowrap' }}>Still moving — read again</span>
      )}
      {state.kind === 'error' && (
        <span style={{ fontSize: '0.68rem', color: RED, maxWidth: 220, lineHeight: 1.25 }}>{state.message}</span>
      )}
    </span>
  )
}
