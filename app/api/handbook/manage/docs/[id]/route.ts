export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isUuid, jsonError, setAssignments, validAudience } from '@/lib/hrDocsServer'

type Ctx = { params: Promise<{ id: string }> }

// PATCH /api/handbook/manage/docs/[id] — { title?, body?, audience?, archived?, assignedTo? }
// Saves the DRAFT. What employees read doesn't change until it's published.
// Who it's assigned to and archiving take effect right away.
// Nothing is ever deleted: acknowledgments are records. Archive instead.
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const { id } = await ctx.params
    if (!isUuid(id)) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    const body = await req.json().catch(() => ({})) as { title?: unknown; body?: unknown; audience?: unknown; archived?: unknown; assignedTo?: unknown }

    const patch: Record<string, unknown> = {}
    if (typeof body.title === 'string') {
      if (!body.title.trim()) return NextResponse.json({ error: 'A title is required.' }, { status: 400 })
      patch.title = body.title.trim()
    }
    if (typeof body.body === 'string') patch.body = body.body
    if (body.audience !== undefined) {
      if (!validAudience(body.audience)) return NextResponse.json({ error: 'Pick who the document is for.' }, { status: 400 })
      patch.audience = body.audience
    }
    if (typeof body.archived === 'boolean') patch.archived = body.archived

    if (Object.keys(patch).length) {
      patch.updated_at = new Date().toISOString()
      const { data, error } = await supabaseAdmin.from('hr_documents').update(patch).eq('id', id).select('id').maybeSingle()
      if (error) return jsonError(error.message)
      if (!data) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    }
    if (Array.isArray(body.assignedTo)) await setAssignments(id, body.assignedTo as string[])
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
