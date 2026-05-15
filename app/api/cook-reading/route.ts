export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/cook-reading?session_id=UUID&limit=200
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const session_id = searchParams.get('session_id')
  const limit      = parseInt(searchParams.get('limit') ?? '200', 10)

  let q = supabase
    .from('cook_reading')
    .select('*')
    .order('read_at', { ascending: true })
    .limit(limit)

  if (session_id) q = q.eq('session_id', session_id)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
