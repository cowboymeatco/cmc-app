export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/cutting-instructions
//   ?ids_only=1 â€” return just [{ id }] rows. The cut schedule only needs an
//   existence check per id, and the full rows carry the whole form payload,
//   so this keeps the phone-facing response small as the table grows.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const idsOnly = searchParams.get('ids_only')

  const { data, error } = await supabase
    .from('cutting_instructions')
    .select(idsOnly ? 'id' : '*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/cutting-instructions â€” create new instruction internally
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase
    .from('cutting_instructions')
    .insert([{ status: 'pending', data: body }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/cutting-instructions â€” update status
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { ids, status } = body as { ids: string[]; status: string }

  const { error } = await supabase
    .from('cutting_instructions')
    .update({ status })
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
