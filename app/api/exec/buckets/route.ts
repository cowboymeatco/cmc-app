export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// PUT /api/exec/buckets — move a cost account between the fixed (overheads)
// and variable buckets, or reset it to its P&L-section default with null.
export async function PUT(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  const { account, bucket } = await req.json().catch(() => ({}))
  if (typeof account !== 'string' || !account.trim()) {
    return NextResponse.json({ error: 'account required' }, { status: 400 })
  }
  if (bucket !== 'fixed' && bucket !== 'variable' && bucket !== null) {
    return NextResponse.json({ error: 'bucket must be fixed, variable, or null' }, { status: 400 })
  }

  const name = account.trim()
  const { error } = bucket === null
    ? await supabaseAdmin.from('exec_cost_buckets').delete().eq('account', name)
    : await supabaseAdmin.from('exec_cost_buckets').upsert({ account: name, bucket, updated_at: new Date().toISOString() })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
