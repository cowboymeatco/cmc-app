export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode, QBO_CONNECTIONS, QboConnection } from '@/lib/qbo'

// GET /api/qbo/oauth/callback — Intuit redirects here with ?code&state&realmId.
// Exchanges the code for tokens, stores them under the connection the start
// route recorded in the state cookie, and bounces back to that route's page.
interface OauthState { state: string; connection: QboConnection; back: string }

function readState(raw: string | undefined): OauthState | null {
  if (!raw) return null
  try {
    const parsed = JSON.parse(raw) as Partial<OauthState>
    if (typeof parsed.state !== 'string') return null
    const connection = QBO_CONNECTIONS.includes(parsed.connection as QboConnection) ? parsed.connection as QboConnection : 'accounting'
    const back = typeof parsed.back === 'string' && parsed.back.startsWith('/') && !parsed.back.startsWith('//') ? parsed.back : '/processing'
    return { state: parsed.state, connection, back }
  } catch {
    // The cookie used to hold the bare state string; treat that as the
    // accounting connection so an in-flight consent still lands.
    return { state: raw, connection: 'accounting', back: '/processing' }
  }
}

export async function GET(req: NextRequest) {
  const saved = readState(req.cookies.get('qbo_oauth_state')?.value)
  const back = (param: string) => {
    const res = NextResponse.redirect(`${req.nextUrl.origin}${saved?.back ?? '/processing'}?${param}`)
    res.cookies.delete('qbo_oauth_state')
    return res
  }

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const realmId = req.nextUrl.searchParams.get('realmId')

  if (!code || !realmId) return back('qbo=error&reason=missing-params')
  if (!state || !saved || state !== saved.state) return back('qbo=error&reason=state-mismatch')

  try {
    await exchangeCode(code, `${req.nextUrl.origin}/api/qbo/oauth/callback`, realmId, saved.connection)
    return back(`qbo=connected&connection=${saved.connection}`)
  } catch (e) {
    console.error('QBO OAuth callback failed:', e)
    return back('qbo=error&reason=token-exchange')
  }
}
