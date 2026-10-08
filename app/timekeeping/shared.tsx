// Shared pieces of /timekeeping: palette, the small UI bits every tab uses,
// and the fetch helper. Not a page — page.tsx can only export the page.

import { BREAK_RULES, Shift, ShiftCalc } from '@/lib/timekeeping'

export const C = {
  dark: '#1A0A04', darkBrown: '#351E0E', medBrown: '#75471B', lightBrown: '#A6785A',
  tan: '#C9A882', cream: '#F2E8D9', green: '#4CAF50', amber: '#F59E0B', red: '#EF4444', blue: '#60A5FA',
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

export function BreakPills({ c }: { c: ShiftCalc }) {
  const allowance = c.owed.paidBreaks * BREAK_RULES.paidBreakMinutes
  if (allowance === 0 && !c.owed.lunch && c.breakMinutes === 0) return <span style={{ color: C.lightBrown, fontSize: '0.8rem' }}>none yet</span>
  const tookLunch = c.lunchUnpaid && c.lunchMinutes > 0
  return (
    <>
      {(allowance > 0 || c.breakMinutes > 0) && (
        <Pill color={c.uptoMinutes > 0 ? C.red : c.breakMinutes === allowance ? C.green : C.amber}>
          Breaks {c.breakMinutes}/{allowance} min
        </Pill>
      )}
      {c.uptoMinutes > 0 && <Pill color={C.red}>{c.uptoMinutes} min UPTO</Pill>}
      {c.owed.lunch && <Pill color={tookLunch ? C.green : C.amber}>Lunch {tookLunch ? '✓' : 'owed'}</Pill>}
    </>
  )
}

/** "09:30–09:45, 14:00–14:15" */
export function breakTimes(s: Shift): string {
  return s.breaks.length ? s.breaks.map(b => `${b.start}–${b.end ?? '…'}`).join(', ') : '—'
}

/**
 * JSON fetch that throws the server's message on failure. `status` rides on
 * the error so callers can tell "signed out" (401) from a real problem.
 */
export async function api<T = unknown>(path: string, init: RequestInit & { token?: string } = {}): Promise<T> {
  const { token, headers, ...rest } = init
  const res = await fetch(path, {
    ...rest,
    headers: {
      ...(rest.body && !(rest.body instanceof FormData) ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { 'x-timeclock-token': token } : {}),
      ...headers,
    },
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(data.message || data.error || `Request failed (${res.status})`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  return data as T
}
