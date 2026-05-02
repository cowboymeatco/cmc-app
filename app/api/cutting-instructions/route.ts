import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/cutting-instructions
export async function GET() {
  const { data, error } = await supabase
    .from('cutting_instructions')
    .select('*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/cutting-instructions — update status
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
