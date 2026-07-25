export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { runSync } from '@/lib/ringUpSync'
import { runSweep } from '@/lib/ringUpSweep'

// Scheduled register reconcile — see vercel.json. One job, both directions:
// sync first (create/update orders for open invoices), then sweep (remove
// orders whose invoice is now settled).
//
// Order matters. Sweeping first would delete a settled order and the sync
// would have nothing to say about it; syncing first means the sweep always
// sees the register in its just-updated state.
//
// Vercel Cron fires a plain GET, so this path stays separate from the UI's
// /api/clover/reconcile: nothing that merely reads should share a URL with
// something that creates and deletes.
//
// Guarded by CRON_SECRET and fails CLOSED — with no secret configured it
// refuses to run, so a missing env var can never leave this exposed.

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json(
      { error: 'CRON_SECRET is not configured — refusing to run' },
      { status: 503 }
    )
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  try {
    const sync = await runSync('cron')
    const sweep = await runSweep('cron')
    return NextResponse.json({
      ok: true,
      created: sync.created.length,
      updated: sync.updated.length,
      deferred: sync.deferred,
      removed: sweep.removed.length,
      syncErrors: sync.errors.length,
      sweepErrors: sweep.errors.length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
