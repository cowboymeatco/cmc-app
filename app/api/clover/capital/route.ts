export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { currentAdvance, saveAdvance, capitalStatus } from '@/lib/cloverCapital'
import { isoDate } from '@/lib/dates'

// The Clover Capital advance, for the /billing UI — see lib/cloverCapital.
//   GET  -> the open advance as entered, and where it stands as of today
//           (from the card days already on record; reads nothing from Clover)
//   POST -> save what the Clover dashboard (Finances → Clover Capital) shows:
//           { advanceNumber, advanceDollars, fundedDate, lastPaymentDate,
//             paidDollars, balanceDollars, closedDate?, holdbackRate?, by? }

export async function GET() {
  try {
    const advance = await currentAdvance()
    const status = advance ? await capitalStatus(isoDate(), 0) : null
    return NextResponse.json({ advance, status })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

const cents = (v: unknown): number => {
  const n = typeof v === 'number' ? v : parseFloat(String(v ?? '').replace(/[$,\s]/g, ''))
  return Number.isFinite(n) ? Math.round(n * 100) : NaN
}

export async function POST(req: NextRequest) {
  try {
    const b = await req.json() as Record<string, unknown>
    const advance = await saveAdvance({
      advance_number: String(b.advanceNumber ?? ''),
      advance_cents: cents(b.advanceDollars),
      funded_date: b.fundedDate ? String(b.fundedDate) : null,
      holdback_rate: b.holdbackRate == null || b.holdbackRate === '' ? undefined : Number(b.holdbackRate),
      last_payment_date: String(b.lastPaymentDate ?? ''),
      paid_cents: cents(b.paidDollars),
      balance_cents: cents(b.balanceDollars),
      closed_date: b.closedDate ? String(b.closedDate) : null,
      updated_by: `${String(b.by ?? '').trim() || 'Billing page'}, from the Clover dashboard ${isoDate()}`,
    })
    const status = await capitalStatus(isoDate(), 0)
    return NextResponse.json({ ok: true, advance, status })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 400 })
  }
}
