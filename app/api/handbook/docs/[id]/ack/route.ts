export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { acknowledge, isUuid, jsonError, requireHr } from '@/lib/hrDocsServer'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/handbook/docs/[id]/ack — { version }. "I've read this", for the
// signed-in employee and the version they had open. The time is stamped by
// the database, not the phone.
export async function POST(req: NextRequest, ctx: Ctx) {
  const auth = await requireHr(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const { version } = await req.json().catch(() => ({})) as { version?: unknown }
    if (!isUuid(id) || typeof version !== 'number' || !Number.isInteger(version) || version < 1) {
      return NextResponse.json({ error: 'bad_request', message: 'Open the document first.' }, { status: 400 })
    }
    const r = await acknowledge(auth.employee.id, id, version)
    if (!r.ok) return NextResponse.json({ error: 'refused', message: r.message }, { status: 409 })
    return NextResponse.json({ acknowledgedAt: r.acknowledgedAt })
  } catch (e) {
    return jsonError(e)
  }
}
