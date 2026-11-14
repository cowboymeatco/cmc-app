export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { jsonError, listVisibleDocs, requireHr } from '@/lib/hrDocsServer'

// GET /api/handbook/docs — what the signed-in employee may read: documents for
// everyone, plus the ones assigned to them. Published copies only.
export async function GET(req: NextRequest) {
  const auth = await requireHr(req)
  if (!auth.ok) return auth.response
  try {
    return NextResponse.json(
      { employee: { id: auth.employee.id, name: auth.employee.name }, docs: await listVisibleDocs(auth.employee.id) },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (e) {
    return jsonError(e)
  }
}
