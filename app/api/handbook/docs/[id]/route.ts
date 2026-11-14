export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getVisibleDoc, isUuid, jsonError, requireHr } from '@/lib/hrDocsServer'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/handbook/docs/[id] — one document as published. A document this
// person may not see answers exactly like one that doesn't exist.
export async function GET(req: NextRequest, ctx: Ctx) {
  const auth = await requireHr(req)
  if (!auth.ok) return auth.response
  try {
    const { id } = await ctx.params
    const doc = isUuid(id) ? await getVisibleDoc(auth.employee.id, id) : null
    if (!doc) return NextResponse.json({ error: 'not_found', message: 'Document not found.' }, { status: 404 })
    return NextResponse.json({ doc }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return jsonError(e)
  }
}
