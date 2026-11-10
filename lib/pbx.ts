// 3CX phone system ↔ app glue, shared by the two /api/pbx routes.
//
// The PBX (hosted 3CX through Range) runs the CRM template in
// scripts/3cx/cmc-app.xml. On every call it asks /api/pbx/lookup who a
// number belongs to, and when the call ends it posts the call to
// /api/pbx/report. Both routes are machine-to-machine: no browser, no
// session, just the shared key in PBX_API_KEY sent as a Bearer token.
import { NextRequest, NextResponse } from 'next/server'

/** Fails CLOSED: no key configured means nobody gets in. */
export function pbxUnauthorized(req: NextRequest): NextResponse | null {
  const key = process.env.PBX_API_KEY
  if (!key) return NextResponse.json({ error: 'PBX_API_KEY is not configured — refusing' }, { status: 503 })
  if (req.headers.get('authorization') !== `Bearer ${key}`) return new NextResponse('Unauthorized', { status: 401 })
  return null
}

/** "406-555-1234", "+1 (406) 555-1234", "14065551234" → "14065551234". */
export function phoneDigits(v: unknown): string {
  return typeof v === 'string' ? v.replace(/\D/g, '') : ''
}

/**
 * Same rule the customer-claim SQL uses (scripts/2026-08-09_rls_customers_
 * phase1_functions.sql): two numbers are the same if their last 10 digits
 * agree. A 7-digit local number on file still matches on its last 7, so an
 * old record typed without the area code is not a stranger.
 */
export function samePhone(a: string, b: string): boolean {
  if (a.length >= 10 && b.length >= 10) return a.slice(-10) === b.slice(-10)
  if (a.length >= 7 && b.length >= 7) return a.slice(-7) === b.slice(-7)
  return false
}

/** Placeholder contact id for a number nobody has on file — see lookup route. */
export const UNKNOWN_PREFIX = 'unknown:'

export const CALL_TYPES = ['inbound', 'outbound', 'missed', 'notanswered'] as const
export type CallType = (typeof CALL_TYPES)[number]
