export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  const formData     = await req.formData()
  const file         = formData.get('file') as File | null
  const apptId       = (formData.get('appointment_id') as string) ?? 'unknown'
  const animalIndex  = (formData.get('animal_index')   as string) ?? '1'

  if (!file) return NextResponse.json({ error: 'No file' }, { status: 400 })

  const bytes  = await file.arrayBuffer()
  const buffer = Buffer.from(bytes)
  const ext    = file.name.split('.').pop()?.toLowerCase() ?? 'jpg'
  const path   = `${apptId}/${animalIndex}_${Date.now()}.${ext}`

  const { error } = await supabase.storage
    .from('animal-photos')
    .upload(path, buffer, { contentType: file.type, upsert: true })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage
    .from('animal-photos')
    .getPublicUrl(path)

  return NextResponse.json({ url: publicUrl })
}
