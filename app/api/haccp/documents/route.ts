import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { HACCP_BUCKET, HACCP_MAX_BYTES, compareDocs } from '@/lib/haccpDocs'

// The written HACCP plan, prerequisite programs, SSOPs and blank forms.
// The table has RLS on and the bucket is private, so every read and write goes
// through the service-role client here — the browser never touches either
// directly. That boundary is what lets a read-only inspector view be added later
// without exposing the whole bucket.
//
// Uploads are two steps, because the file itself must NOT pass through this
// route: Vercel drops request bodies over ~4.5 MB before the handler runs, and
// the plan's supporting papers run to 27 MB. So the browser asks for a signed
// upload URL ('sign'), PUTs the bytes straight into the bucket with it, then
// comes back to write the row ('register'). The signed URL is single-path and
// expires in two hours, so the anon key still can't write anywhere else.

// GET /api/haccp/documents — every active document, in library order
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('haccp_documents')
    .select('*')
    .eq('active', true)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data.sort(compareDocs))
}

// POST /api/haccp/documents  { intent: 'sign' | 'register', ... }
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return NextResponse.json({ error: 'JSON body required' }, { status: 400 })
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')

  if (body.intent === 'sign') {
    const filename = str('filename')
    const size     = Number(body.size)
    if (!filename)              return NextResponse.json({ error: 'filename required' }, { status: 400 })
    if (!(size > 0))            return NextResponse.json({ error: 'file is empty' }, { status: 400 })
    if (size > HACCP_MAX_BYTES) return NextResponse.json({ error: `file is larger than ${HACCP_MAX_BYTES / 1024 / 1024} MB` }, { status: 400 })

    const category = str('category') || 'Supporting Document'
    // Keep the original name readable in the path but strip anything that would
    // upset the storage key, and prefix a timestamp so re-uploads never collide.
    const safeName = filename.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120)
    const path = `${category.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}/${Date.now()}-${safeName}`

    const { data, error } = await supabaseAdmin.storage.from(HACCP_BUCKET).createSignedUploadUrl(path)
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'could not sign upload' }, { status: 500 })
    return NextResponse.json({ path: data.path, token: data.token })
  }

  if (body.intent === 'register') {
    const path = str('path')
    if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })

    // Trust the bucket, not the browser, for what actually landed.
    const dir  = path.slice(0, path.lastIndexOf('/'))
    const base = path.slice(path.lastIndexOf('/') + 1)
    const { data: objs, error: listErr } = await supabaseAdmin.storage.from(HACCP_BUCKET).list(dir, { search: base, limit: 1 })
    if (listErr) return NextResponse.json({ error: listErr.message }, { status: 500 })
    const obj = objs?.find(o => o.name === base)
    if (!obj)    return NextResponse.json({ error: 'upload did not land in the bucket' }, { status: 400 })
    const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string }

    const filename = str('filename') || base
    const { data, error } = await supabaseAdmin
      .from('haccp_documents')
      .insert([{
        title:        str('title') || filename,
        category:     str('category') || 'Supporting Document',
        filename,
        storage_path: path,
        mime_type:    meta.mimetype || str('mime') || null,
        size_bytes:   meta.size ?? (Number(body.size) || null),
        version_date: str('version_date') || null,
        notes:        str('notes') || null,
        uploaded_by:  str('uploaded_by') || null,
      }])
      .select()
      .single()

    // Don't leave an orphan file in the bucket if the row fails to write.
    if (error) {
      await supabaseAdmin.storage.from(HACCP_BUCKET).remove([path])
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: "intent must be 'sign' or 'register'" }, { status: 400 })
}
