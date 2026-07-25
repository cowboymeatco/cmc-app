export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { runSweep } from '@/lib/ringUpSweep'

// Scheduled register sweep — see vercel.json. Vercel Cron fires a plain GET,
// so this path is deliberately separate from /api/clover/reconcile: nothing
// that merely reads should share a URL with something that deletes.
//
// Guarded by CRON_SECRET, which Vercel sends as a bearer token. The check fails
// CLOSED: with no secret configured the endpoint refuses to run at all, so a
// missing env var can never leave a public delete endpoint exposed.

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
    const result = await runSweep('cron')
    return NextResponse.json({
      ok: true,
      removed: result.removed.length,
      kept: result.kept.length,
      errors: result.errors.length,
      detail: result.removed.map(d => d.title),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
