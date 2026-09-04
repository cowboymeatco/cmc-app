export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { qboStatus } from '@/lib/qbo'
import { LABOR_WEEKS, syncLaborWeeks } from '@/lib/laborSync'

// GET /api/exec/labor — weekly labor history, freshly topped up.
//
// Every call first pulls any pay week the last 13 weeks are missing from
// QuickBooks Payroll, joins that week's pounds packed, and writes the row
// (lib/laborSync.ts); then it returns the newest 13 rows. Two doors in:
//   • the exec session cookie, when the /exec page loads it;
//   • the Vercel cron secret, Thursday 6am Mountain (vercel.json), the
//     morning after Wednesday's pay run has posted.
// A sync failure is reported in the payload rather than failing the request,
// so the rows already on file still render.

function cronAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  return Boolean(secret) && req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!cronAuthorized(req)) {
    const gate = await requireExec(req)
    if (!gate.ok) return gate.response
  }

  const sync = await syncLaborWeeks()

  const [{ data, error }, payroll] = await Promise.all([
    supabaseAdmin
      .from('labor_reports')
      .select('*')
      .order('week_start', { ascending: false })
      .limit(LABOR_WEEKS),
    qboStatus('payroll'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    weeks: data ?? [],
    payroll: { connected: payroll.connected, refreshExpiresAt: payroll.refreshExpiresAt },
    sync,
  })
}
