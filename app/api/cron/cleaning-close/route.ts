export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { closeStaleShifts } from '@/lib/cleaningShiftServer'

// Scheduled 3 AM close of the cleaning shift — see vercel.json.
//
// A shift the crew forgot to close would otherwise sit open forever, which is
// exactly how every shift before 2026-09-05 ended up. The cutoff is 3:00 AM
// on the shop clock the morning after shift_date; the close is stamped at
// that cutoff, not at whenever this ran, and signed 'system'.
//
// Vercel cron is UTC-only, so vercel.json fires this at both 09:00 and 10:00
// UTC — 3 AM Mountain in summer lands on the first, 3 AM in winter on the
// second. The function only closes shifts already past their cutoff, so the
// early one is a no-op when it's too early. The morning view runs the same
// close on load as a belt-and-braces.
//
// Guarded by CRON_SECRET and fails CLOSED.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured — refusing to run' },
      { status: 503 },
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const closed = await closeStaleShifts()
    return NextResponse.json({ ok: true, closed })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
