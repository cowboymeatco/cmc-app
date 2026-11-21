'use client'
// The crew's sign-in for the carcass QR page and the staging list. It is the
// handbook's session (time clock PIN, /api/handbook/session), kept in this
// browser for a few minutes so a cutter scanning three carcasses in a row
// enters the PIN once, not three times. Short on purpose: the harvest laptop
// is shared, and the next person must not move a carcass under someone else's
// name. The server session runs out on its own after 30 idle minutes.

const KEY = 'cmc_floor_session'
export const FLOOR_IDLE_MS = 10 * 60_000

export interface FloorSession { token: string; id: string; name: string; at: number }

export function getFloorSession(): FloorSession | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const s = JSON.parse(raw) as FloorSession
    if (!s?.token || Date.now() - s.at > FLOOR_IDLE_MS) { localStorage.removeItem(KEY); return null }
    return s
  } catch { return null }
}

export function saveFloorSession(s: Omit<FloorSession, 'at'>): FloorSession {
  const full = { ...s, at: Date.now() }
  try { localStorage.setItem(KEY, JSON.stringify(full)) } catch { /* private window: memory only */ }
  return full
}

export function touchFloorSession(): void {
  const s = getFloorSession()
  if (s) saveFloorSession(s)
}

export function clearFloorSession(): void {
  const s = getFloorSession()
  try { localStorage.removeItem(KEY) } catch { /* nothing stored */ }
  if (s) fetch('/api/handbook/session', { method: 'DELETE', headers: { 'x-handbook-token': s.token } }).catch(() => {})
}

/** A floor action as the signed-in person. Throws with the server's message; status 401 = signed out. */
export async function floorAction<T = unknown>(path: string, token: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-handbook-token': token },
    body: JSON.stringify(body),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) {
    if (res.status === 401) { try { localStorage.removeItem(KEY) } catch { /* ignore */ } }
    const err = new Error(data.message || data.error || `Request failed (${res.status})`) as Error & { status?: number }
    err.status = res.status
    throw err
  }
  touchFloorSession()
  return data as T
}
