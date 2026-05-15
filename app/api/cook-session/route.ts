export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/cook-session?status=active  OR  /api/cook-session?limit=20
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const limit  = parseInt(searchParams.get('limit') ?? '20', 10)

  let q = supabase
    .from('cook_session')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(limit)

  if (status) q = q.eq('status', status)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/cook-session  — start a new session
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase
    .from('cook_session')
    .insert([{
      session_name:  body.session_name,
      device_serial: body.device_serial ?? null,
      target_temp_f: body.target_temp_f ?? null,
      product:       body.product       ?? null,
      notes:         body.notes         ?? null,
      status:        'active',
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/cook-session?id=UUID  — end session or update notes
export async function PATCH(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const body = await req.json()
  const updates: Record<string, unknown> = {}
  if (body.status       !== undefined) updates.status       = body.status
  if (body.ended_at     !== undefined) updates.ended_at     = body.ended_at
  if (body.notes        !== undefined) updates.notes        = body.notes
  if (body.target_temp_f !== undefined) updates.target_temp_f = body.target_temp_f

  const { data, error } = await supabase
    .from('cook_session')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
