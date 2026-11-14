export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isUuid, jsonError } from '@/lib/hrDocsServer'

type Ctx = { params: Promise<{ id: string }> }

// POST /api/handbook/manage/docs/[id]/publish — freeze the saved draft as the
// next version and make it what employees read. Everyone who should read it
// is asked to acknowledge the new version; older acknowledgments stay on
// record against the version they were given for.
export async function POST(req: NextRequest, ctx: Ctx) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const { id } = await ctx.params
    if (!isUuid(id)) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    const { data: doc } = await supabaseAdmin.from('hr_documents').select('body, archived').eq('id', id).maybeSingle()
    if (!doc || doc.archived) return NextResponse.json({ error: 'Document not found.' }, { status: 404 })
    if (!String(doc.body).trim()) return NextResponse.json({ error: 'There is nothing to publish yet — the document is empty.' }, { status: 400 })
    const { data, error } = await supabaseAdmin.rpc('hr_publish_document', { p_document_id: id })
    if (error) return jsonError(error.message)
    return NextResponse.json({ version: data as number })
  } catch (e) {
    return jsonError(e)
  }
}
