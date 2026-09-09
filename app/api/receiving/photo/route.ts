export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const formData     = await req.formData()
  const file         = formData.get('file') as File | null
  const apptId       = (formData.get('appointment_id') as string) ?? 'unknown'
  const animalIndex  = (formData.get('animal_index')   as string) ?? '1'

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })
  // The page shrinks what it can to ~1 MB; an original comes through only when
  // the browser couldn't decode it. Cap it so a 40 MB RAW doesn't sit in the bucket.
  if (file.size > 20 * 1024 * 1024) {
    return NextResponse.json({ error: 'That photo is too big — 20 MB max.' }, { status: 400 })
  }
  if (file.type && !file.type.startsWith('image/')) {
    return NextResponse.json({ error: 'Photos only.' }, { status: 400 })
  }

  const ext  = (file.name.split('.').pop()?.toLowerCase() ?? 'jpg').replace(/[^a-z0-9]/g, '') || 'jpg'
  const path = `${apptId}/${animalIndex}_${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('animal-photos')
    .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage
    .from('animal-photos')
    .getPublicUrl(path)

  return NextResponse.json({ url: publicUrl })
}
