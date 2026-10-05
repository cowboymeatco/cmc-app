import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { CUT_SHEET_BUCKET } from '@/lib/cutSheetFiles'

type Ctx = { params: Promise<{ id: string }> }

// GET /api/cut-sheet-files/[id] — a short-lived signed link to one migrated
// file. The bucket is private; this is the only way a browser reaches a scan.
// ?redirect=1 sends the browser straight there, so a plain <a> can open it.
export async function GET(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const { data: f, error } = await supabaseAdmin
    .from('cutting_instruction_files')
    .select('storage_path, filename, mime_type')
    .eq('id', id)
    .maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!f) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const { data, error: signErr } = await supabaseAdmin.storage
    .from(CUT_SHEET_BUCKET)
    .createSignedUrl(f.storage_path, 300)
  if (signErr || !data) return NextResponse.json({ error: signErr?.message ?? 'sign failed' }, { status: 500 })

  if (req.nextUrl.searchParams.get('redirect')) return NextResponse.redirect(data.signedUrl, 302)
  return NextResponse.json({ url: data.signedUrl, filename: f.filename, mime_type: f.mime_type })
}
