export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/exec/war — the WAR report numbers (today vs Monday-to-date),
// straight from the exec_war_metrics() SQL function so the page and the
// SMS can never drift apart.

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  const { data, error } = await supabaseAdmin.rpc('exec_war_metrics')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
