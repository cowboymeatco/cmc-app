import type { NextRequest } from 'next/server'

// The office app's front door. Read proxy.ts alongside this — that's where it
// is enforced; this file only knows how to mint and check the token.
//
// WHY ONE SHARED PASSPHRASE AND NOT PER-PERSON LOGINS. cmc-app runs on shared
// shop hardware — the scanner, the packaging kiosk, the office desktop — where
// whoever is standing there types it. A per-user login on those devices would
// be one crew member's account left signed in all day, which is worse than
// honest anonymity: it would put a name on someone else's work. So this gate
// answers "is this the plant?", not "who is this?". Identity, where it is
// actually needed, is a narrower second door: /exec's own passphrase, and the
// inspector portal's name sign-in.
//
// WHY THE COOKIE IS SIGNED, NOT A SESSIONS ROW. proxy.ts checks this on every
// request in the building. lib/execGate.ts reads a session row per request,
// which is fine across a handful of /exec routes and would be a Supabase round
// trip on every page load and every scanner beep here.

export const STAFF_COOKIE   = 'cmc_staff'
export const MACHINE_HEADER = 'x-cmc-token'
export const SESSION_DAYS   = 180   // a full season: the scanner is not re-prompted mid-shift

const ENC = new TextEncoder()

function hex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function sha256Hex(text: string): Promise<string> {
  return hex(await crypto.subtle.digest('SHA-256', ENC.encode(text)))
}

/** Fixed-length hex/secret comparison that doesn't leak position on mismatch. */
export function sameSecret(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

/**
 * The HMAC key. Returns null when unset — every caller treats that as "refuse",
 * never as "allow": a missing env var must not open the building.
 */
function signingKey(): string | null {
  return process.env.STAFF_SESSION_SECRET?.trim() || null
}

export function gateConfigured(): boolean {
  return signingKey() !== null
}

async function sign(key: string, payload: string): Promise<string> {
  const k = await crypto.subtle.importKey(
    'raw', ENC.encode(key), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  )
  return hex(await crypto.subtle.sign('HMAC', k, ENC.encode(payload)))
}

/** Cookie value: `<expiry ms>.<signature>`. Self-contained, so checking it is offline. */
export async function mintStaffToken(): Promise<string> {
  const key = signingKey()
  if (!key) throw new Error('STAFF_SESSION_SECRET is not configured')
  const exp = Date.now() + SESSION_DAYS * 86_400_000
  return `${exp}.${await sign(key, `cmc-staff|${exp}`)}`
}

export async function verifyStaffToken(token: string | undefined): Promise<boolean> {
  const key = signingKey()
  if (!key || !token) return false

  const dot = token.indexOf('.')
  if (dot < 1) return false
  const expRaw = token.slice(0, dot)
  const sig    = token.slice(dot + 1)

  const exp = Number(expRaw)
  // The expiry is inside the signed payload, so a client that edits it to buy
  // itself more time invalidates the signature it came with.
  if (!Number.isFinite(exp) || exp <= Date.now()) return false

  return sameSecret(sig, await sign(key, `cmc-staff|${exp}`))
}

/**
 * The door for things that aren't a browser: import_schedule.ps1, and any
 * scripted check against prod. One token, sent as a header, never in a URL
 * (query strings end up in logs). Unset means no machine may enter.
 */
export function machineTokenOk(req: NextRequest): boolean {
  const expected = process.env.CMC_API_TOKEN?.trim()
  if (!expected) return false
  const got = req.headers.get(MACHINE_HEADER)?.trim()
  return !!got && sameSecret(got, expected)
}

/** Cookie or machine token. Used by proxy.ts and re-checked inside sharp routes. */
export async function isStaff(req: NextRequest): Promise<boolean> {
  if (machineTokenOk(req)) return true
  return verifyStaffToken(req.cookies.get(STAFF_COOKIE)?.value)
}
