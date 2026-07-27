import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { HACCP_BUCKET } from '@/lib/haccpDocs'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/haccp/documents/[id] — short-lived signed link to the stored file
export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params

  const { data: doc, error } = await supabaseAdmin
    .from('haccp_documents')
    .select('storage_path, filename, active')
    .eq('id', id)
    .single()
  if (error || !doc || !doc.active) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data, error: signErr } = await supabaseAdmin.storage
    .from(HACCP_BUCKET)
    .createSignedUrl(doc.storage_path, 300)
  if (signErr || !data) return NextResponse.json({ error: signErr?.message ?? 'sign failed' }, { status: 500 })

  return NextResponse.json({ url: data.signedUrl, filename: doc.filename })
}

// PATCH /api/haccp/documents/[id] — edit the metadata, not the file itself
export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const body = await req.json()

  const patch: Record<string, unknown> = {}
  for (const k of ['title', 'category', 'version_date', 'notes'] as const) {
    if (k in body) patch[k] = body[k] || null
  }
  if (Object.keys(patch).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('haccp_documents')
    .update(patch)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/haccp/documents/[id] — retire a document. The row and the file
// both stay put: a superseded HACCP revision is still a record we may have to
// produce, so retiring only hides it from the current list.
export async function DELETE(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const { error } = await supabaseAdmin
    .from('haccp_documents')
    .update({ active: false })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
