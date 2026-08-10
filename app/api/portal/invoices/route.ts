export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { qboConfigured } from '@/lib/qbo'
import { getInvoicesForCustomer } from '@/lib/qboInvoices'

// Read-only invoice lookup for the producer/customer portal.
//
// WHY THE PORTAL DOESN'T TALK TO QUICKBOOKS ITSELF. The Intuit refresh token
// rotates on every refresh and lives in one row (qbo_tokens, service role
// only). A second app refreshing the same row would race this one and both
// would get logged out. cmc-app owns the tokens; the portal reads through this
// door and holds no Intuit credentials of its own.
//
// Guarded by PORTAL_API_SECRET and fails CLOSED — with no secret configured it
// refuses to answer, so a missing env var can never leave receivables exposed.
// GET only: nothing here creates, changes or settles anything.

export async function GET(req: NextRequest) {
  const secret = process.env.PORTAL_API_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'PORTAL_API_SECRET is not configured — refusing to answer' },
      { status: 503 }
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  if (!qboConfigured()) {
    return NextResponse.json({ error: 'QuickBooks is not connected' }, { status: 503 })
  }

  const id = new URL(req.url).searchParams.get('qbo_customer_id')
  if (!id) {
    return NextResponse.json({ error: 'qbo_customer_id required' }, { status: 400 })
  }

  try {
    const invoices = await getInvoicesForCustomer(id)
    return NextResponse.json({ invoices })
  } catch (e) {
    // The caller renders "couldn't reach QuickBooks" — it must never show a
    // blank list, which would read as "nothing owed".
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'QuickBooks lookup failed' },
      { status: 502 }
    )
  }
}
