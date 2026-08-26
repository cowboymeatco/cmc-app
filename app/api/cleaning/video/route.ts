export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { CLEANING_PHOTO_BUCKET, CLEANING_VIDEO_MAX_BYTES, CLEANING_VIDEO_TYPES } from '@/lib/cleaning'

// POST /api/cleaning/video — hand back a one-shot upload URL for a clip.
//
// Photos post their bytes through /api/cleaning/photo. A video can't: this runs
// on the edge, where the request body is capped in the low megabytes, and a
// ten-second phone clip clears that on its own. So the browser never sends the
// file here — it asks for a signed URL, PUTs the file straight at storage, and
// tells us the public URL to save on the step.
//
// The signature is what makes that safe: it names one path, is good once, and
// expires. The caller picks nothing.

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { filename?: string; size?: number; type?: string }

  const type = (body.type ?? '').split(';')[0].trim().toLowerCase()
  if (type && !CLEANING_VIDEO_TYPES.includes(type)) {
    return NextResponse.json(
      { error: "That file isn't a video the scale-house browsers can play — record it with the phone camera." },
      { status: 400 },
    )
  }
  // Checked here so the crew hears "too long" before the upload, not after it.
  if (body.size && body.size > CLEANING_VIDEO_MAX_BYTES) {
    return NextResponse.json(
      { error: `That clip is ${Math.round(body.size / 1048576)} MB — keep it under ${Math.round(CLEANING_VIDEO_MAX_BYTES / 1048576)} MB. A step is a few seconds, not the whole teardown.` },
      { status: 400 },
    )
  }

  const ext = (body.filename ?? '').split('.').pop()?.toLowerCase().replace(/[^a-z0-9]/g, '')
    || (type === 'video/quicktime' ? 'mov' : 'mp4')
  const path = `reference/video/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`

  const { data, error } = await supabase.storage
    .from(CLEANING_PHOTO_BUCKET)
    .createSignedUploadUrl(path)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const { data: { publicUrl } } = supabase.storage
    .from(CLEANING_PHOTO_BUCKET).getPublicUrl(path)

  return NextResponse.json({ upload_url: data.signedUrl, path, url: publicUrl })
}

// DELETE /api/cleaning/video?path=… — drop a clip that was uploaded and then
// abandoned, so a step the author backed out of doesn't leave 40 MB behind.
export async function DELETE(req: NextRequest) {
  const path = new URL(req.url).searchParams.get('path')
  if (!path) return NextResponse.json({ error: 'path required' }, { status: 400 })
  if (!path.startsWith('reference/video/')) {
    return NextResponse.json({ error: 'not a clip path' }, { status: 400 })
  }
  const { error } = await supabase.storage.from(CLEANING_PHOTO_BUCKET).remove([path])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
