export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { jsonError } from '@/lib/timeclockServer'

// PATCH /api/timekeeping/requests — { id, status }: approve or deny time off.
export async function PATCH(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const { id, status } = await req.json()
    if (!id || !['approved', 'denied', 'pending'].includes(status)) return NextResponse.json({ error: 'id and status required' }, { status: 400 })
    const { error } = await supabaseAdmin.from('tk_time_off_requests')
      .update({ status, decided_at: status === 'pending' ? null : new Date().toISOString() }).eq('id', id)
    if (error) return jsonError(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
