export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Attach or clear a PLU's generic product photo (product-photos bucket, public).
// The image is resized client-side before it arrives; here we just store it and
// write the URL onto plu_items.photo_url so the portal shop can show it via
// products.plu_item_id. Mirrors the receiving/photo upload pattern.
export async function POST(req: NextRequest) {
  const form = await req.formData()
  const id = (form.get('id') as string) ?? ''
  if (!id) return NextResponse.json({ error: 'PLU id required' }, { status: 400 })

  // Remove: clear the column. The stored object is left in place (like
  // animal-photos — the bucket has no delete policy); nothing points at it.
  if (form.get('remove') === 'true') {
    const { error } = await supabase
      .from('plu_items')
      .update({ photo_url: null, updated_at: new Date().toISOString() })
      .eq('id', id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ url: null })
  }

  const file = form.get('file') as File | null
  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const ext  = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path = `${id}/${Date.now()}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('product-photos')
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage
    .from('product-photos')
    .getPublicUrl(path)

  const { error: dbErr } = await supabase
    .from('plu_items')
    .update({ photo_url: publicUrl, updated_at: new Date().toISOString() })
    .eq('id', id)
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  return NextResponse.json({ url: publicUrl })
}
