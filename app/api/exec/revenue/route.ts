export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { loadRevenueRecognition } from '@/lib/revenueLoad'
import { addDaysISO } from '@/lib/dates'

// GET /api/exec/revenue?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Service revenue recognized on the day the work happens rather than the day
// it's invoiced — see lib/revenueRecognition for why and how. Default window
// is the last 30 days plus the next 30, so the same picture carries what was
// earned and what's on the books.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    // Plant-local, not UTC — a Montana evening is still today.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const q = req.nextUrl.searchParams
    const start = DATE_RE.test(q.get('start') ?? '') ? q.get('start')! : addDaysISO(today, -30)
    const end = DATE_RE.test(q.get('end') ?? '') ? q.get('end')! : addDaysISO(today, 30)
    if (end < start) return NextResponse.json({ error: 'end is before start' }, { status: 400 })

    return NextResponse.json(await loadRevenueRecognition(start, end, today))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
