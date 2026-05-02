import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/processing — list all PLU items
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search') ?? ''

  let query = supabase
    .from('plu_items')
    .select('*')
    .order('plu_number', { ascending: true })

  if (search) {
    query = query.or(`plu_number.ilike.%${search}%,item_name.ilike.%${search}%`)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/processing/upload — upsert PLU records from parsed CSV
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { items } = body as { items: Record<string, unknown>[] }

  if (!items?.length) return NextResponse.json({ error: 'No items provided' }, { status: 400 })

  // Upsert on plu_number — update existing, insert new
  const rows = items.map(item => ({
    ...item,
    updated_at: new Date().toISOString(),
  }))

  const { data, error } = await supabase
    .from('plu_items')
    .upsert(rows, { onConflict: 'plu_number' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: data.length })
}
