export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { authorizeUrl, qboConfigured } from '@/lib/qbo'

// GET /api/qbo/oauth/start — kick off the Intuit OAuth flow.
// The redirect URI derives from the request origin, so localhost dev and
// app.cowboymeats.com both work as long as both URIs are registered in the
// Intuit developer app's Keys & Credentials.
export async function GET(req: NextRequest) {
  if (!qboConfigured()) {
    return NextResponse.json(
      { error: 'QuickBooks not configured — set QBO_CLIENT_ID, QBO_CLIENT_SECRET and SUPABASE_SERVICE_ROLE_KEY' },
      { status: 500 },
    )
  }
  const redirectUri = `${req.nextUrl.origin}/api/qbo/oauth/callback`
  const state = crypto.randomUUID()
  const res = NextResponse.redirect(authorizeUrl(redirectUri, state))
  res.cookies.set('qbo_oauth_state', state, {
    httpOnly: true,
    secure: req.nextUrl.protocol === 'https:',
    sameSite: 'lax',
    maxAge: 600,
    path: '/api/qbo/oauth',
  })
  return res
}
