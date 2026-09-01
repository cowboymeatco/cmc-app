export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/scale-push — recent push requests (for status display)
export async function GET() {
  const { data, error } = await supabase
    .from('scale_push_requests')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(5)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/scale-push — queue a push. The shop kiosk (watch mode) picks it up.
// kind 'store_name' + payload {ip, store_name} rewrites ONE scale's store-name
// record (the line its labels print as the store) to a customer's name.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const row: Record<string, unknown> = { requested_by: body.requested_by ?? 'app', status: 'pending' }
  if (body.kind === 'store_name') {
    const ip = String(body.payload?.ip ?? '')
    const store_name = String(body.payload?.store_name ?? '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 40)
    if (!/^192\.168\.1\.\d{1,3}$/.test(ip)) return NextResponse.json({ error: 'bad scale ip' }, { status: 400 })
    if (!store_name) return NextResponse.json({ error: 'empty store name' }, { status: 400 })
    row.kind = 'store_name'
    row.payload = { ip, store_name }
  }
  const { data, error } = await supabase
    .from('scale_push_requests')
    .insert(row)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, request: data })
}
