export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { readCloverDay } from '@/lib/cloverSales'
import { planRingUpPayments, runRingUpPayments, ringUpPostingFrom, isLive, PostingRefused } from '@/lib/ringUpPayments'
import { requireExec } from '@/lib/execGate'
import { isoDate } from '@/lib/dates'

// Register payments of invoice tickets → QuickBooks Receive Payment, for /billing.
//   GET  ?date=YYYY-MM-DD -> what the app would record for that day (default
//                           today). Read-only: nothing is written anywhere.
//   POST {date}           -> Record now. In test mode (RINGUP_PAYMENTS_POSTING_FROM
//                           unset, or a day before it) this is the same plan
//                           and writes nothing; live, it records. Exec only.
//
// The scheduled run lives at /api/cron/ringup-payments.

const DATE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date') ?? isoDate()
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  try {
    const summary = await readCloverDay(date)
    const decisions = await planRingUpPayments(summary)
    return NextResponse.json({ date, live: isLive(date), postingFrom: ringUpPostingFrom(), decisions })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const { date = isoDate() } = await req.json().catch(() => ({}))
    if (typeof date !== 'string' || !DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    const result = await runRingUpPayments(date, 'manual')
    return NextResponse.json({ ...result, postingFrom: ringUpPostingFrom() })
  } catch (e) {
    const status = e instanceof PostingRefused ? 409 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status })
  }
}
