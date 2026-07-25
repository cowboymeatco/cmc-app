export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { planSweep, runSweep } from '@/lib/ringUpSweep'
import { supabase } from '@/lib/supabase'

// Register sweep, for the /billing UI.
//   GET  -> what the sweep would do right now + recent history (read-only)
//   POST -> run it now ("Clean up now" button)
//
// The scheduled run lives at /api/cron/ringup-sweep so Vercel's plain GET
// can't accidentally trigger a delete through this endpoint.

export async function GET() {
  try {
    const [decisions, history] = await Promise.all([
      planSweep(),
      supabase
        .from('clover_ringup_sweep_log')
        .select('created_at, doc_number, title, amount_cents, action, reason, status, error, triggered_by')
        .order('created_at', { ascending: false })
        .limit(25),
    ])
    return NextResponse.json({
      wouldRemove: decisions.filter(d => d.action === 'remove'),
      wouldKeep: decisions.filter(d => d.action === 'keep'),
      history: history.data ?? [],
      historyError: history.error?.message,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST() {
  try {
    const result = await runSweep('manual')
    return NextResponse.json({
      ok: true,
      removed: result.removed,
      kept: result.kept,
      errors: result.errors,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
