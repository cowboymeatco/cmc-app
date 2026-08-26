export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { summariseCooks, CookRow } from '@/lib/smokehouseUptime'

// GET /api/exec/smokehouse?weeks=12 — how much of the time the smokehouse is
// actually cooking. The arithmetic lives in lib/smokehouseUptime so it can be
// checked against the raw cook table; this route only fetches and gates.

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  const weeks = Math.min(Math.max(Number(new URL(req.url).searchParams.get('weeks')) || 12, 4), 52)

  // One extra week of slack so the oldest bucket is whole before we trim to it.
  const since = new Date(Date.now() - (weeks + 1) * 7 * 86_400_000).toISOString()

  const { data, error } = await supabaseAdmin
    .from('smokehouse_cook')
    .select('started_at, ended_at')
    .gte('started_at', since)
    .order('started_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    weeks,
    ...summariseCooks((data ?? []) as CookRow[], weeks, new Date()),
  })
}
