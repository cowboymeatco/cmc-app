'use client'
import { useCallback, useSyncExternalStore } from 'react'
import Link from 'next/link'
import { C, Banner, BigButton, inputStyle, cardStyle, TAP } from '../cleaning/ui'

// Shared furniture for the kanban screens. The colours, banner, buttons and
// inputs are the cleaning module's — same phone, same gloves, same plant.
export { C, Banner, BigButton, inputStyle, cardStyle, TAP }

// ── Who's tapping ───────────────────────────────────────────────────────
// Kanban is plant-wide, so it can't lean on the cleaning roster: a name typed
// once and remembered on the device, stamped onto every pull and order.
const WHO_KEY = 'kanbanWho'
const listeners = new Set<() => void>()

function readWho(): string {
  try { return localStorage.getItem(WHO_KEY) ?? '' } catch { return '' }
}
function subscribeWho(cb: () => void) {
  listeners.add(cb)
  window.addEventListener('storage', cb)
  return () => { listeners.delete(cb); window.removeEventListener('storage', cb) }
}

export function useWho(): [string, (name: string) => void] {
  const who = useSyncExternalStore(subscribeWho, readWho, () => '')
  const setWho = useCallback((name: string) => {
    try { localStorage.setItem(WHO_KEY, name) } catch { /* private browsing */ }
    listeners.forEach(l => l())
  }, [])
  return [who, setWho]
}

export function WhoField({ who, setWho }: { who: string; setWho: (s: string) => void }) {
  return (
    <input
      value={who}
      onChange={e => setWho(e.target.value)}
      placeholder="Your name"
      style={{ ...inputStyle, minHeight: 40, width: 170, fontSize: 15, padding: '6px 10px' }}
    />
  )
}

export function KanbanHeader({ title, back = '/', right }: {
  title: string
  back?: string
  right?: React.ReactNode
}) {
  return (
    <header style={{
      background: C.dark, borderBottom: `1px solid ${C.medBrown}`,
      padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12,
      position: 'sticky', top: 0, zIndex: 50, flexWrap: 'wrap',
    }}>
      <Link href={back} style={{ color: C.tan, fontSize: 26, textDecoration: 'none', lineHeight: 1, padding: '4px 8px 8px 0' }}>
        ‹
      </Link>
      <h1 style={{ color: C.cream, fontSize: 18, fontWeight: 700, flex: 1, margin: 0, minWidth: 140 }}>{title}</h1>
      {right}
    </header>
  )
}

export function Pill({ color, children, solid }: { color: string; children: React.ReactNode; solid?: boolean }) {
  return (
    <span style={{
      fontSize: 11, fontWeight: 700, color: solid ? C.dark : color,
      background: solid ? color : `${color}1A`, border: `1px solid ${color}`,
      borderRadius: 4, padding: '1px 6px', whiteSpace: 'nowrap',
    }}>
      {children}
    </span>
  )
}

export const smallBtn = (color: string): React.CSSProperties => ({
  minHeight: 38, padding: '0 12px', background: C.dark, border: `1px solid ${color}`,
  borderRadius: 8, color, fontSize: 13, fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap',
})

export const labelStyle: React.CSSProperties = {
  display: 'block', color: C.tan, fontSize: 12, marginBottom: 4, fontWeight: 600,
}

/** Number input value → what the API wants ('' stays '', meaning blank). */
export function num(v: string): string | number {
  return v.trim() === '' ? '' : Number(v)
}

/** Age of a timestamp in words, for "pulled 3 days ago". */
export function ago(ts: string | null): string {
  if (!ts) return ''
  const mins = Math.round((Date.now() - new Date(ts).getTime()) / 60000)
  if (mins < 60) return `${Math.max(1, mins)}m ago`
  const h = Math.round(mins / 60)
  if (h < 36) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}
