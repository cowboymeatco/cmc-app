import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { HACCP_BUCKET } from '@/lib/haccpDocs'

// The written HACCP plan, prerequisite programs, SSOPs and blank forms.
// The table has RLS on and the bucket is private, so every read and write goes
// through the service-role client here — the browser never touches either
// directly. That boundary is what lets a read-only inspector view be added later
// without exposing the whole bucket.

const MAX_BYTES = 25 * 1024 * 1024

// GET /api/haccp/documents — every active document, newest upload first
export async function GET() {
  const { data, error } = await supabaseAdmin
    .from('haccp_documents')
    .select('*')
    .eq('active', true)
    .order('category', { ascending: true })
    .order('title',    { ascending: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/haccp/documents — multipart upload of one file plus its metadata
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file')
  if (!(file instanceof File)) return NextResponse.json({ error: 'file required' }, { status: 400 })
  if (file.size === 0)         return NextResponse.json({ error: 'file is empty' }, { status: 400 })
  if (file.size > MAX_BYTES)   return NextResponse.json({ error: 'file is larger than 25 MB' }, { status: 400 })

  const str = (k: string) => (form.get(k) as string | null)?.trim() || ''
  const title    = str('title') || file.name
  const category = str('category') || 'Supporting Document'

  // Keep the original name readable in the path but strip anything that would
  // upset the storage key, and prefix a timestamp so re-uploads never collide.
  const safeName = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-120)
  const storagePath = `${category.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}/${Date.now()}-${safeName}`

  const bytes = new Uint8Array(await file.arrayBuffer())
  const { error: upErr } = await supabaseAdmin.storage
    .from(HACCP_BUCKET)
    .upload(storagePath, bytes, { contentType: file.type || 'application/octet-stream', upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data, error } = await supabaseAdmin
    .from('haccp_documents')
    .insert([{
      title,
      category,
      filename:     file.name,
      storage_path: storagePath,
      mime_type:    file.type || null,
      size_bytes:   file.size,
      version_date: str('version_date') || null,
      notes:        str('notes') || null,
      uploaded_by:  str('uploaded_by') || null,
    }])
    .select()
    .single()

  // Don't leave an orphan file in the bucket if the row fails to write.
  if (error) {
    await supabaseAdmin.storage.from(HACCP_BUCKET).remove([storagePath])
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}
