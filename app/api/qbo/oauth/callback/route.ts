export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { exchangeCode } from '@/lib/qbo'

// GET /api/qbo/oauth/callback — Intuit redirects here with ?code&state&realmId.
// Exchanges the code for tokens, stores them, and bounces back to /processing.
export async function GET(req: NextRequest) {
  const back = (param: string) => {
    const res = NextResponse.redirect(`${req.nextUrl.origin}/processing?${param}`)
    res.cookies.delete('qbo_oauth_state')
    return res
  }

  const code = req.nextUrl.searchParams.get('code')
  const state = req.nextUrl.searchParams.get('state')
  const realmId = req.nextUrl.searchParams.get('realmId')
  const expectedState = req.cookies.get('qbo_oauth_state')?.value

  if (!code || !realmId) return back('qbo=error&reason=missing-params')
  if (!state || !expectedState || state !== expectedState) return back('qbo=error&reason=state-mismatch')

  try {
    await exchangeCode(code, `${req.nextUrl.origin}/api/qbo/oauth/callback`, realmId)
    return back('qbo=connected')
  } catch (e) {
    console.error('QBO OAuth callback failed:', e)
    return back('qbo=error&reason=token-exchange')
  }
}
