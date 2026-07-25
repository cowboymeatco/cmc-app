export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { planSweep, runSweep } from '@/lib/ringUpSweep'
import { planSync, runSync } from '@/lib/ringUpSync'
import { supabase } from '@/lib/supabase'

// Register reconcile, for the /billing UI.
//   GET  -> what a run would do right now + recent history (read-only)
//   POST -> run it now ("Sync register" button): sync, then sweep
//
// The scheduled run lives at /api/cron/register-sync so Vercel's plain GET
// can't trigger writes through this read path.

export async function GET() {
  try {
    const [sweepDecisions, syncDecisions, history] = await Promise.all([
      planSweep(),
      planSync(),
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

export async function POST() {
  try {
    const sync = await runSync('manual')
    const sweep = await runSweep('manual')
    return NextResponse.json({
      ok: true,
      created: sync.created,
      updated: sync.updated,
      deferred: sync.deferred,
      removed: sweep.removed,
      errors: [...sync.errors, ...sweep.errors],
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
