export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeUrl, qboConfigured, QBO_CONNECTIONS, QboConnection } from '@/lib/qbo'

// GET /api/qbo/oauth/start — kick off the Intuit OAuth flow.
// The redirect URI derives from the request origin, so localhost dev and
// app.cowboymeats.com both work as long as both URIs are registered in the
// Intuit developer app's Keys & Credentials.
//
// ?connection=payroll asks for the payroll (Workforce API) scopes and stores
// the result as the separate payroll connection; the default is the original
// accounting connection. ?back=/exec is where the callback lands afterwards
// (same-site paths only). Both ride along in the state cookie so the callback
// cannot be talked into a different connection than the one consented to.
export async function GET(req: NextRequest) {
  if (!qboConfigured()) {
    return NextResponse.json(
      { error: 'QuickBooks not configured — set QBO_CLIENT_ID, QBO_CLIENT_SECRET and SUPABASE_SERVICE_ROLE_KEY' },
      { status: 500 },
    )
  }
  const requested = req.nextUrl.searchParams.get('connection') ?? 'accounting'
  if (!QBO_CONNECTIONS.includes(requested as QboConnection)) {
    return NextResponse.json({ error: `Unknown connection "${requested}"` }, { status: 400 })
  }
  const connection = requested as QboConnection
  const backParam = req.nextUrl.searchParams.get('back') ?? '/processing'
  const back = backParam.startsWith('/') && !backParam.startsWith('//') ? backParam : '/processing'

  const redirectUri = `${req.nextUrl.origin}/api/qbo/oauth/callback`
  const state = crypto.randomUUID()
  const res = NextResponse.redirect(authorizeUrl(redirectUri, state, connection))
  res.cookies.set('qbo_oauth_state', JSON.stringify({ state, connection, back }), {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/qbo/oauth',
  })
  return res
}
