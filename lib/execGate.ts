import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Server-side gate for the executive suite (/exec). One door: a passphrase
// known to Charlie, checked against a SHA-256 hash in exec_config (service
// role only). A correct passphrase mints a session row and a cookie; every
// /api/exec/* data route calls requireExec before returning numbers.

export const EXEC_COOKIE = 'exec_session'
export const SESSION_DAYS = 30

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('')
}

export async function checkPassphrase(pass: string): Promise<boolean> {
  const { data } = await supabaseAdmin
    .from('exec_config')
    .select('value')
    .eq('key', 'access_pass_sha256')
    .maybeSingle()
  if (!data) return false
  return (await sha256Hex(pass)) === data.value
}

/** Mint a session and return the response with the cookie set. */
export async function startSession(res: NextResponse): Promise<NextResponse> {
  const expires = new Date(Date.now() + SESSION_DAYS * 86_400_000)
  const { data, error } = await supabaseAdmin
    .from('exec_sessions')
    .insert({ expires_at: expires.toISOString() })
    .select('token')
    .single()
  if (error || !data) throw new Error(`Failed to create exec session: ${error?.message}`)
  res.cookies.set(EXEC_COOKIE, data.token as string, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_DAYS * 86_400,
  })
  return res
}

export type ExecGateResult =
  | { ok: true }
  | { ok: false; response: NextResponse }

export async function requireExec(req: NextRequest): Promise<ExecGateResult> {
  const token = req.cookies.get(EXEC_COOKIE)?.value
  if (token) {
    const { data } = await supabaseAdmin
      .from('exec_sessions')
      .select('token, expires_at')
      .eq('token', token)
      .maybeSingle()
    if (data && new Date(data.expires_at as string) > new Date()) {
      await supabaseAdmin
        .from('exec_sessions')
        .update({ last_seen_at: new Date().toISOString() })
        .eq('token', token)
      return { ok: true }
    }
  }
  return { ok: false, response: NextResponse.json(
    { error: 'not_signed_in', message: 'Enter the executive passphrase to view this.' },
    { status: 401 },
  ) }
}
