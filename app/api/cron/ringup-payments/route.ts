export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { runRingUpPayments } from '@/lib/ringUpPayments'
import { addDaysISO, isoDate } from '@/lib/dates'

// Scheduled: record invoice tickets paid at the register in QuickBooks
// (lib/ringUpPayments). Every 30 minutes through shop hours for today, and
// once early morning for yesterday (?day=yesterday) to catch anything paid
// after the last daytime run. See vercel.json.
//
// In test mode (RINGUP_PAYMENTS_POSTING_FROM unset) it only plans, and writes
// the plan to the function log so a test run can be compared to the register.
//
// Guarded by CRON_SECRET and fails CLOSED, like /api/cron/register-sync.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured — refusing to run' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const day = new URL(req.url).searchParams.get('day')
  const date = day === 'yesterday' ? addDaysISO(isoDate(), -1) : isoDate()

  try {
    const r = await runRingUpPayments(date, 'cron')
    const count = (a: string) => r.decisions.filter(d => d.action === a).length
    // One line per decision, so the function log is the test-mode record.
    for (const d of r.decisions) {
      console.log(`[ringup-payments] ${date} ${r.live ? '' : 'TEST '}${d.action} INV ${d.docNumber} ${d.tender} $${(d.amountCents / 100).toFixed(2)}: ${d.reason}`)
    }
    return NextResponse.json({
      ok: true, date, live: r.live,
      record: count('record'), skip: count('skip'), flag: count('flag'),
      recorded: r.recorded.length, errors: r.errors.length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
