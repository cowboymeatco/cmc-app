export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { jsonError, listManageDocs, setAssignments, validAudience } from '@/lib/hrDocsServer'

// GET  /api/handbook/manage/docs — every document with its draft, publish
//      state, who it's assigned to and who has acknowledged it; plus the crew.
// POST /api/handbook/manage/docs — { title, audience, body?, assignedTo? }
//      start a new document. It's a draft: nobody sees it until it's published.
export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    return NextResponse.json(await listManageDocs(), { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return jsonError(e)
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const body = await req.json().catch(() => ({})) as { title?: unknown; audience?: unknown; body?: unknown; assignedTo?: unknown }
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 })
    if (!validAudience(body.audience)) return NextResponse.json({ error: 'Pick who the document is for.' }, { status: 400 })
    const { data, error } = await supabaseAdmin.from('hr_documents')
      .insert({ title, audience: body.audience, body: typeof body.body === 'string' ? body.body : '' })
      .select('id').single()
    if (error || !data) return jsonError(error?.message ?? 'Could not create the document')
    if (body.audience === 'assigned' && Array.isArray(body.assignedTo)) await setAssignments(data.id as string, body.assignedTo as string[])
    return NextResponse.json({ id: data.id })
  } catch (e) {
    return jsonError(e)
  }
}
