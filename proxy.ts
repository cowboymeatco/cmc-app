import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { isStaff, gateConfigured } from '@/lib/staffSession'

// The gate, applied to the whole office app. Before this file existed, every
// page and all 85 API routes answered anyone on the internet — including full
// CRUD over all 332 customers, the portal user list, and the HACCP library.
//
// It lives here rather than in each route on purpose: a per-route check is a
// list you have to remember to add to, and the routes that were missing one
// were exactly the ones nobody thought about. Default closed, name the
// exceptions. (In Next 16 this file is `proxy.ts`, not `middleware.ts` — the
// convention was renamed; see node_modules/next/dist/docs/01-app/
// 03-api-reference/03-file-conventions/proxy.md.)
//
// PATHS THAT STAY OPEN, and why each one is safe:
//   /sign-in, /api/staff/session  the door itself
//   /inspector, and the inspector routes listed below
//                                 the inspector portal has its own two doors
//                                 (plant IP + name sign-in, lib/inspectorGate)
//                                 and its visitors are not staff — they must
//                                 never need the crew's passphrase.
//   /api/portal/invoices          the portal's machine door. Carries its own
//                                 PORTAL_API_SECRET and already fails closed.
//   /api/cron/*                   Vercel cron. Carries its own CRON_SECRET.
// Everything else under /api/inspector — network (which edits the plant
// allowlist) and visits (the visitor log) — is staff administration and is
// deliberately NOT on this list.
const OPEN_PATHS = [
  '/sign-in',
  '/api/staff/session',
  '/inspector',
  '/api/inspector/session',
  '/api/inspector/documents',
  '/api/inspector/records',
  '/api/portal/invoices',
  '/api/cron',
]

// Prefix match on path segments, so /inspector covers /inspector/documents but
// a route that merely starts with the same letters can't inherit the exemption.
function isOpen(pathname: string): boolean {
  return OPEN_PATHS.some(p => pathname === p || pathname.startsWith(`${p}/`))
}

export async function proxy(req: NextRequest) {
  const { pathname, search } = req.nextUrl

  if (isOpen(pathname)) return NextResponse.next()

  // No signing key means no session can be verified. Refuse rather than fall
  // through: a missing env var is the one failure that must not open the door.
  if (!gateConfigured()) {
    return NextResponse.json(
      { error: 'gate_unconfigured', message: 'STAFF_SESSION_SECRET is not set — refusing to serve.' },
      { status: 503 },
    )
  }

  if (await isStaff(req)) return NextResponse.next()

  // A person gets the passphrase form and lands back where they were going; a
  // script gets a status code it can act on instead of a login page as "200".
  if (pathname.startsWith('/api/')) {
    return NextResponse.json(
      { error: 'not_signed_in', message: 'Staff passphrase required. Machines send the x-cmc-token header.' },
      { status: 401 },
    )
  }

  const url = req.nextUrl.clone()
  url.pathname = '/sign-in'
  url.search   = `?next=${encodeURIComponent(pathname + search)}`
  return NextResponse.redirect(url)
}

export const config = {
  // Everything except build output and plain assets. The images in public/ are
  // a logo and the USDA legend — they carry nothing worth gating, and leaving
  // them open keeps the inspector portal's shell from breaking on them.
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|webp|ico|woff|woff2|ttf)$).*)',
  ],
}
