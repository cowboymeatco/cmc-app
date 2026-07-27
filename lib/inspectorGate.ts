import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Server-side gate for the inspector portal. Two doors, both of which have to
// open: the request has to come from a network on the plant's allowlist, and
// the visitor has to have signed their name (which mints the visit cookie).
//
// The IP check is a location check, not a security proof — anyone who can reach
// the plant's network can reach the portal, and IPs are not identity. It is
// exactly the boundary asked for: nobody can pull up the HACCP plan from home.

export const VISIT_COOKIE = 'inspector_visit'
export const VISIT_HOURS  = 12

/**
 * The caller's address. On Vercel both of these headers are set by the platform
 * on the way in, so prefer x-real-ip (single-valued) and fall back to the first
 * hop of x-forwarded-for. Locally neither header exists, which is why an empty
 * string — not a loopback address — is the fallback: an unidentifiable caller
 * must never inherit the trust the dev machine gets.
 */
export function getClientIp(req: NextRequest): string {
  const real = req.headers.get('x-real-ip')?.trim()
  if (real) return normalize(real)
  const fwd = req.headers.get('x-forwarded-for')
  if (fwd) return normalize(fwd.split(',')[0].trim())
  return ''
}

// ::ffff:1.2.3.4 is an IPv4 address wearing an IPv6 coat — compare it as IPv4.
function normalize(ip: string): string {
  const m = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip)
  return m ? m[1] : ip
}

function ipv4ToInt(ip: string): number | null {
  const parts = ip.split('.')
  if (parts.length !== 4) return null
  let n = 0
  for (const p of parts) {
    const v = Number(p)
    if (!/^\d+$/.test(p) || v < 0 || v > 255) return null
    n = n * 256 + v
  }
  return n
}

/** Does `ip` fall inside `network`, written as a bare address or IPv4 CIDR? */
export function ipMatches(ip: string, network: string): boolean {
  const net = network.trim()
  if (!net) return false
  if (!net.includes('/')) return net === ip

  const [base, bitsRaw] = net.split('/')
  const bits = Number(bitsRaw)
  if (!Number.isInteger(bits) || bits < 0 || bits > 32) return false

  const a = ipv4ToInt(ip)
  const b = ipv4ToInt(base)
  if (a === null || b === null) return false
  if (bits === 0) return true

  const mask = (0xffffffff << (32 - bits)) >>> 0
  return ((a & mask) >>> 0) === ((b & mask) >>> 0)
}

/**
 * Is this something the matcher can actually act on? Guards the allowlist
 * against typos, which would otherwise fail silently at the door with an
 * inspector standing in front of it.
 */
export function isValidNetwork(network: string): boolean {
  const net = network.trim()
  if (!net) return false

  if (net.includes('/')) {
    const [base, bitsRaw] = net.split('/')
    const bits = Number(bitsRaw)
    return ipv4ToInt(base) !== null && /^\d+$/.test(bitsRaw) && bits >= 0 && bits <= 32
  }
  if (ipv4ToInt(net) !== null) return true
  // Bare IPv6 is matched literally, so only check it looks like an address.
  return /^[0-9a-f:]+$/i.test(net) && net.includes(':')
}

/**
 * The dev server is allowed so the portal can be worked on off a laptop, where
 * there is no proxy setting the address headers. Gated on NODE_ENV rather than
 * on the address alone: if a deployed request ever arrives without those
 * headers, it gets refused instead of inheriting the developer's trust.
 */
const LOOPBACK = ['127.0.0.1', '::1', '']

export async function isAllowedNetwork(ip: string): Promise<boolean> {
  if (process.env.NODE_ENV !== 'production' && LOOPBACK.includes(ip)) return true
  if (!ip) return false
  const { data } = await supabaseAdmin
    .from('inspector_allowed_networks')
    .select('network')
    .eq('active', true)
  return (data ?? []).some(r => ipMatches(ip, r.network as string))
}

export interface Visit { id: string; inspector: string; agency: string | null }

/**
 * Resolve the signed-in visit from the cookie, refreshing last_seen_at. Returns
 * null when the cookie is missing, unknown, or older than VISIT_HOURS — the
 * next inspector at the same terminal signs in under their own name.
 */
export async function getVisit(req: NextRequest): Promise<Visit | null> {
  const id = req.cookies.get(VISIT_COOKIE)?.value
  if (!id) return null

  const { data } = await supabaseAdmin
    .from('inspector_visits')
    .select('id, inspector, agency, started_at')
    .eq('id', id)
    .single()
  if (!data) return null

  const ageHours = (Date.now() - new Date(data.started_at as string).getTime()) / 3_600_000
  if (ageHours > VISIT_HOURS) return null

  await supabaseAdmin
    .from('inspector_visits')
    .update({ last_seen_at: new Date().toISOString() })
    .eq('id', id)

  return { id: data.id as string, inspector: data.inspector as string, agency: data.agency as string | null }
}

export type GateResult =
  | { ok: true;  visit: Visit; ip: string }
  | { ok: false; response: NextResponse }

/** Both doors, for any route that serves actual HACCP content. */
export async function requireInspector(req: NextRequest): Promise<GateResult> {
  const ip = getClientIp(req)

  if (!(await isAllowedNetwork(ip))) {
    return { ok: false, response: NextResponse.json(
      { error: 'off_network', ip, message: 'The inspector portal is only available from the plant network.' },
      { status: 403 },
    ) }
  }

  const visit = await getVisit(req)
  if (!visit) {
    return { ok: false, response: NextResponse.json(
      { error: 'not_signed_in', message: 'Sign in with your name to view HACCP records.' },
      { status: 401 },
    ) }
  }

  return { ok: true, visit, ip }
}

export async function logActivity(visitId: string, action: string, detail?: string) {
  await supabaseAdmin
    .from('inspector_activity')
    .insert([{ visit_id: visitId, action, detail: detail ?? null }])
}
