export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/exec/labor — weekly labor-efficiency history. Rows are written by
// the scheduled labor-report task (payroll data isn't reachable through the
// app's own QBO connection — accounting scope only).

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  const { data, error } = await supabaseAdmin
    .from('labor_reports')
    .select('*')
    .order('week_start', { ascending: false })
    .limit(26)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ weeks: data ?? [] })
}
