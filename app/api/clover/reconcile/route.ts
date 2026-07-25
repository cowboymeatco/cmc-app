export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { planSweep, runSweep } from '@/lib/ringUpSweep'
import { planSync, runSync, loadContext } from '@/lib/ringUpSync'
import { supabase } from '@/lib/supabase'

// Register reconcile, for the /billing UI.
//   GET               -> what a run would do right now + recent history
//   POST {phase:sync}  -> create/correct orders for open invoices
//   POST {phase:sweep} -> remove orders whose invoice is settled
//
// The two phases are SEPARATE requests on purpose. Running both in one call
// timed out (504) against a populated register: the writes had completed but
// the response never came back, which reads like total failure when it wasn't.
// The UI fires them in sequence so each gets its own function budget.
//
// The scheduled run lives at /api/cron/register-sync so Vercel's plain GET
// can't trigger writes through this read path.

export async function GET() {
  try {
    const ctx = await loadContext()
    const [sweepDecisions, syncDecisions, history] = await Promise.all([
      planSweep({ orders: ctx.orders, openDocNumbers: ctx.openDocNumbers }),
      planSync(ctx),
      supabase
        .from('clover_ringup_sweep_log')
        .select('created_at, doc_number, title, amount_cents, action, reason, status, error, triggered_by')
        .order('created_at', { ascending: false })
        .limit(25),
    ])
    return NextResponse.json({
      wouldRemove: sweepDecisions.filter(d => d.action === 'remove'),
      wouldKeep: sweepDecisions.filter(d => d.action === 'keep'),
      wouldCreate: syncDecisions.filter(d => d.action === 'create'),
      wouldUpdate: syncDecisions.filter(d => d.action === 'update'),
      // Only the skips that need a human — "amount current" is the steady
      // state and would drown the interesting ones.
      needsPerson: syncDecisions.filter(d => d.action === 'skip' && d.reason.includes('needs a person')),
      history: history.data ?? [],
      historyError: history.error?.message,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const { phase } = await req.json().catch(() => ({ phase: 'sync' }))

    if (phase === 'sweep') {
      const sweep = await runSweep('manual')
      return NextResponse.json({ phase, removed: sweep.removed, errors: sweep.errors })
    }

    const sync = await runSync('manual')
    return NextResponse.json({
      phase: 'sync',
      created: sync.created,
      updated: sync.updated,
      deferred: sync.deferred,
      errors: sync.errors,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
