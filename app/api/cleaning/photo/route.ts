export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { CLEANING_PHOTO_BUCKET } from '@/lib/cleaning'

// POST /api/cleaning/photo — upload one photo
//
// Serves both kinds of photo the tool keeps, distinguished by `kind`:
//
//   documentation — proof that tonight's work happened. Rows in
//                   cleaning_photos, tied to a shift and usually an item.
//   reference     — permanent, part of a procedure ("this is how the auger
//                   seats"). Returns a URL for the caller to store on the
//                   step, issue, or suggestion it belongs to.
//
// They share an upload path and nothing else: different lifetimes, different
// owners, different tables.

const MAX_BYTES = 15 * 1024 * 1024

export async function POST(req: NextRequest) {
  const form = await req.formData()
  const file = form.get('file') as File | null
  const kind = ((form.get('kind') as string) || 'documentation').trim()

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: 'That photo is too big — 15 MB max.' }, { status: 400 })
  }
  if (file.type && !file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Photos only.' }, { status: 400 })
  }

  const shiftId  = (form.get('shift_id')      as string) || null
  const itemId   = (form.get('shift_item_id') as string) || null
  const caption  = (form.get('caption')       as string) || null
  const takenBy  = (form.get('taken_by')      as string) || null

  const ext  = file.name.split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg'
  // Foldered by kind and owner so a night's photos can be found (or pruned)
  // without a database round trip.
  const folder = kind === 'reference' ? 'reference' : `shifts/${shiftId ?? 'unassigned'}`
  const path   = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { error: upErr } = await supabase.storage
    .from(CLEANING_PHOTO_BUCKET)
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false })
  if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage
    .from(CLEANING_PHOTO_BUCKET).getPublicUrl(path)

  // A reference photo has no row of its own — it lives on whatever record the
  // caller is editing, so hand the URL back and let them save it.
  if (kind === 'reference' || !shiftId) {
    return NextResponse.json({ url: publicUrl, storage_path: path })
  }

  const { data, error } = await supabase
    .from('cleaning_photos')
    .insert([{
      shift_id:      shiftId,
      shift_item_id: itemId,
      url:           publicUrl,
      storage_path:  path,
      caption:       caption?.trim() || null,
      taken_by:      takenBy?.trim() || null,
    }])
    .select().single()
  // The file is already stored; failing the whole request would strand it and
  // tell the crew their photo vanished when it didn't. Report the row failure
  // and still hand back the URL.
  if (error) {
    return NextResponse.json({ url: publicUrl, storage_path: path, warning: error.message })
  }

  return NextResponse.json(data)
}

// DELETE /api/cleaning/photo?id=… — remove a documentation photo
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: photo } = await supabase
    .from('cleaning_photos').select('storage_path').eq('id', id).single()

  const { error } = await supabase.from('cleaning_photos').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (photo?.storage_path) {
    await supabase.storage.from(CLEANING_PHOTO_BUCKET).remove([photo.storage_path as string])
  }
  return NextResponse.json({ ok: true })
}
