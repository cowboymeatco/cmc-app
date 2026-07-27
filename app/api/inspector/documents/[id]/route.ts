import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { HACCP_BUCKET } from '@/lib/haccpDocs'
import { requireInspector, logActivity } from '@/lib/inspectorGate'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/inspector/documents/[id] — signed link to one document, recorded
// against the visit so the plant knows which records were pulled.
export async function GET(req: NextRequest, ctx: Ctx) {
  const gate = await requireInspector(req)
  if (!gate.ok) return gate.response

  const { id } = await ctx.params
  const { data: doc, error } = await supabaseAdmin
    .from('haccp_documents')
    .select('storage_path, filename, title, active')
    .eq('id', id)
    .single()
  if (error || !doc || !doc.active) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data, error: signErr } = await supabaseAdmin.storage
    .from(HACCP_BUCKET)
    .createSignedUrl(doc.storage_path, 300)
  if (signErr || !data) return NextResponse.json({ error: signErr?.message ?? 'sign failed' }, { status: 500 })

  await logActivity(gate.visit.id, 'open_document', doc.title as string)
  return NextResponse.json({ url: data.signedUrl, filename: doc.filename })
}
