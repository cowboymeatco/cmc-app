// Shared pieces of the /timekeeping mockup: palette, made-up employees and the
// small UI bits every tab uses. Not a page — page.tsx can only export the page.

import { addDaysISO } from '@/lib/dates'
import { WeekHours, ptoEarned } from '@/lib/timekeeping'

export const C = {
  dark: '#1A0A04', darkBrown: '#351E0E', medBrown: '#75471B', lightBrown: '#A6785A',
  tan: '#C9A882', cream: '#F2E8D9', green: '#4CAF50', amber: '#F59E0B', red: '#EF4444', blue: '#60A5FA',
}

// ── Mock data ───────────────────────────────────────────────────────────────

export interface Employee {
  id: string; name: string; role: string; hireDate: string; wage: number
  weeklyHours: number   // typical week, drives the made-up history
  ptoUsed: number       // PTO hours used this year
  pin: string           // personal punch PIN — mockup only; a real build stores a hash
}

export const EMPLOYEES: Employee[] = [
  { id: 'e1', name: 'Sample Employee A', role: 'Cutter',          hireDate: '2025-03-10', wage: 19,   weeklyHours: 40,   ptoUsed: 16, pin: '1111' },
  { id: 'e2', name: 'Sample Employee B', role: 'Lead Cutter',     hireDate: '2019-06-03', wage: 24,   weeklyHours: 46.2, ptoUsed: 40, pin: '2222' },
  { id: 'e3', name: 'Sample Employee C', role: 'Wrap & Pack',     hireDate: '2023-11-15', wage: 17,   weeklyHours: 30.8, ptoUsed: 8, pin: '3333' },
  { id: 'e4', name: 'Sample Employee D', role: 'Harvest Floor',   hireDate: '2011-04-18', wage: 26,   weeklyHours: 40,   ptoUsed: 64, pin: '4444' },
  { id: 'e5', name: 'Sample Employee E', role: 'Cleaning (PT)',   hireDate: '2026-05-01', wage: 16.5, weeklyHours: 20,   ptoUsed: 0, pin: '5555' },
]

// Deterministic wobble so the history looks like real weeks without Math.random
// (which would also break hydration).
function wobble(seed: number): number {
  const x = Math.sin(seed * 9301 + 49297) * 233280
  return (x - Math.floor(x)) - 0.5
}

/** 52 weeks of made-up hours ending last week, skipping weeks before hire. */
export function mockHistory(e: Employee, thisMonday: string): WeekHours[] {
  const weeks: WeekHours[] = []
  for (let i = 52; i >= 1; i--) {
    const weekStart = addDaysISO(thisMonday, -7 * i)
    if (weekStart < e.hireDate) continue
    const hours = Math.max(0, Math.round((e.weeklyHours + wobble(i * 7 + e.id.charCodeAt(1)) * 6) * 4) / 4)
    weeks.push({ weekStart, hours })
  }
  return weeks
}

export const card: React.CSSProperties = { background: C.dark, border: '1px solid rgba(166,120,90,0.3)', borderRadius: 4, padding: '1rem 1.1rem', marginBottom: '1rem' }
export const h2: React.CSSProperties = { fontFamily: 'Georgia, serif', fontSize: '0.95rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.06em', margin: '0 0 0.6rem' }
export const th: React.CSSProperties = { textAlign: 'left', padding: '0.4rem 0.5rem', color: C.lightBrown, fontSize: '0.7rem', textTransform: 'uppercase', letterSpacing: '0.08em', borderBottom: '1px solid rgba(166,120,90,0.3)', whiteSpace: 'nowrap' }
export const td: React.CSSProperties = { padding: '0.45rem 0.5rem', color: C.cream, fontSize: '0.85rem', borderBottom: '1px solid rgba(166,120,90,0.12)', verticalAlign: 'top' }
export const btn = (color: string): React.CSSProperties => ({ background: color, color: '#fff', border: 'none', borderRadius: 4, padding: '0.55rem 0.9rem', fontWeight: 700, fontSize: '0.85rem', cursor: 'pointer' })
// Gloved-finger size for the iPad kiosk.
export const bigBtn = (color: string): React.CSSProperties => ({ ...btn(color), padding: '1rem 1.4rem', fontSize: '1.1rem', borderRadius: 8, minHeight: 56 })

export function Pill({ color, children }: { color: string; children: React.ReactNode }) {
  return <span style={{ display: 'inline-block', background: `${color}22`, color, border: `1px solid ${color}66`, borderRadius: 999, padding: '0.05rem 0.5rem', fontSize: '0.72rem', fontWeight: 700, marginRight: 4, whiteSpace: 'nowrap' }}>{children}</span>
}

export function Stat({ label, value, sub, color = C.cream }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{ flex: '1 1 140px', background: C.darkBrown, borderRadius: 4, padding: '0.6rem 0.8rem' }}>
      <div style={{ fontSize: '0.68rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{label}</div>
      <div style={{ fontSize: '1.35rem', fontWeight: 700, color, fontVariantNumeric: 'tabular-nums' }}>{value}</div>
      {sub && <div style={{ fontSize: '0.72rem', color: C.tan }}>{sub}</div>}
    </div>
  )
}

/** PTO balance through last week (mock: 52 weeks of history minus hours used). */
export function ptoBalance(e: Employee, thisMonday: string): number {
  return ptoEarned(e.hireDate, mockHistory(e, thisMonday)) - e.ptoUsed
}
