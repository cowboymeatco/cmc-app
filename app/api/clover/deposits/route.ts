export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { readCloverDay } from '@/lib/cloverSales'
import { proposeDeposit, postDeposit, depositRecord } from '@/lib/qboDeposits'
import { postingFrom, PostRefused } from '@/lib/qboDailySales'
import { requireExec } from '@/lib/execGate'

// The bank side of a day's Clover card sales, for /billing.
//   GET ?date=&deposit=&holdback=&bankDate= -> the proposed QuickBooks Deposit
//        (card payments out of Undeposited Funds, less loan holdback and fees).
//        deposit/holdback are cents; deposit is what the bank shows. Dry run.
//   POST {date, depositCents, holdbackCents, bankDate, fingerprint, approvedBy}
//        -> a person approves; posts it once. Exec passphrase + posting switch.

const DATE = /^\d{4}-\d{2}-\d{2}$/

function cents(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isInteger(n) ? n : null
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams
  const date = p.get('date') ?? ''
  if (!DATE.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  const bankDate = p.get('bankDate')
  try {
    const summary = await readCloverDay(date)
    const [proposal, record] = await Promise.all([
      proposeDeposit(summary, {
        depositCents: cents(p.get('deposit')),
        holdbackCents: cents(p.get('holdback')),
        bankDate: bankDate && DATE.test(bankDate) ? bankDate : null,
      }),
      depositRecord(date).catch(() => null),
    ])
    return NextResponse.json({ proposal, record, fingerprint: summary.fingerprint, postingFrom: postingFrom() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const gate = await requireExec(req)
    if (!gate.ok) return gate.response
    const b = await req.json().catch(() => ({}))
    const depositCents = cents(b.depositCents)
    const holdbackCents = cents(b.holdbackCents)
    if (typeof b.date !== 'string' || !DATE.test(b.date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    if (typeof b.bankDate !== 'string' || !DATE.test(b.bankDate)) return NextResponse.json({ error: 'bankDate must be YYYY-MM-DD' }, { status: 400 })
    if (depositCents == null || holdbackCents == null) return NextResponse.json({ error: 'depositCents and holdbackCents are required (whole cents)' }, { status: 400 })
    if (typeof b.fingerprint !== 'string' || !b.fingerprint) return NextResponse.json({ error: 'fingerprint required — approve from the page' }, { status: 400 })
    if (typeof b.approvedBy !== 'string' || !b.approvedBy.trim()) return NextResponse.json({ error: 'Say who is approving' }, { status: 400 })
    if (!postingFrom()) return NextResponse.json({ error: 'Posting to QuickBooks is switched off — deposits are still entered by hand.' }, { status: 409 })

    // Recomputed server-side from Clover and QuickBooks as they are now.
    const summary = await readCloverDay(b.date)
    const proposal = await proposeDeposit(summary, { depositCents, holdbackCents, bankDate: b.bankDate })
    const record = await postDeposit({ summary, proposal, approvedFingerprint: b.fingerprint, approvedBy: b.approvedBy.trim() })
    return NextResponse.json({ ok: true, record })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: e instanceof PostRefused ? 409 : 500 })
  }
}
