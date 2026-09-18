export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { buildCarcassCostBasis } from '@/lib/carcassCost'

// GET /api/exec/carcass-cost?since=2024-01-01 — what our own meat cost per
// hanging pound, traced to the bills that paid for it.
//
// Step 1 of the inventory true-up (Jill, 2026-09-15): before anything can be
// counted and valued for the balance sheet, the $/lb has to be a number
// somebody can defend. This route is the working shown — every purchase lot,
// the dressing percentages measured off our own floor, which carcasses trace
// to which purchases, and plainly what does not trace at all.
//
// Deliberately read-only and deliberately not summarised down to one figure.
// The gaps are the point at this stage.

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  const since = req.nextUrl.searchParams.get('since') ?? '2024-01-01'
  if (!/^\d{4}-\d{2}-\d{2}$/.test(since)) {
    return NextResponse.json({ error: 'bad_since', message: 'since must be YYYY-MM-DD' }, { status: 400 })
  }

  try {
    const basis = await buildCarcassCostBasis(since)
    return NextResponse.json(basis)
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e)
    return NextResponse.json({ error: 'carcass_cost_failed', message }, { status: 500 })
  }
}
