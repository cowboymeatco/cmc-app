export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { PHOTO_BUCKET, jsonError, requireKiosk } from '@/lib/timeclockServer'

// POST /api/timeclock/photo — the front-camera snapshot taken at a punch.
// multipart: shift_id, punch, file. Only for the signed-in employee's own
// shift. The bucket is private; managers see photos through signed URLs.
const MAX_BYTES = 500 * 1024

export async function POST(req: NextRequest) {
  const auth = await requireKiosk(req)
  if (!auth.ok) return auth.response
  try {
    const form = await req.formData()
    const file = form.get('file') as File | null
    const shiftId = String(form.get('shift_id') ?? '')
    const punch = String(form.get('punch') ?? '')
    if (!file || !file.type.startsWith('image/') || file.size > MAX_BYTES) return NextResponse.json({ error: 'Bad photo' }, { status: 400 })
    if (!/^(in|out|lunch-out|lunch-in|break-(out|in)-\d{1,2})$/.test(punch)) return NextResponse.json({ error: 'Bad punch' }, { status: 400 })
    const { data: shift } = await supabaseAdmin.from('tk_shifts').select('id').eq('id', shiftId).eq('employee_id', auth.employee.id).maybeSingle()
    if (!shift) return NextResponse.json({ error: 'Not your shift' }, { status: 403 })

    const path = `${auth.employee.id}/${shiftId}/${punch}-${Date.now()}.jpg`
    const { error: upErr } = await supabaseAdmin.storage.from(PHOTO_BUCKET).upload(path, file, { contentType: 'image/jpeg', upsert: false })
    if (upErr) return jsonError(upErr.message)
    const { error } = await supabaseAdmin.from('tk_punch_photos').insert({ shift_id: shiftId, punch, storage_path: path })
    if (error) return jsonError(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return jsonError(e)
  }
}
