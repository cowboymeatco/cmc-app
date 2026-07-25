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

  // ?phase=sweep runs removal only. vercel.json schedules the two phases as
  // separate cron entries so neither request has to carry both workloads —
  // doing both in one call timed out against a populated register.
  const phase = new URL(req.url).searchParams.get('phase')

  try {
    if (phase === 'sweep') {
      const sweep = await runSweep('cron')
      return NextResponse.json({ ok: true, phase, removed: sweep.removed.length, errors: sweep.errors.length })
    }
    const sync = await runSync('cron')
    return NextResponse.json({
      ok: true,
      phase: 'sync',
      created: sync.created.length,
      updated: sync.updated.length,
      deferred: sync.deferred,
      errors: sync.errors.length,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
