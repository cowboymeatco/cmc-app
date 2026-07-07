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
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const { data, error } = await supabase
    .from('scale_push_requests')
    .insert({ requested_by: body.requested_by ?? 'app', status: 'pending' })
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, request: data })
}
