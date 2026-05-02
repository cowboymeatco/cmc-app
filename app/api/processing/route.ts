import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/processing?search=
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search  = searchParams.get('search') ?? ''
  const species = searchParams.get('species') ?? ''
  const active  = searchParams.get('active')  // 'true' | 'false' | null

  let query = supabase
    .from('plu_items')
    .select('*')
    .order('plu_number', { ascending: true })

  if (search)  query = query.or(`plu_number.ilike.%${search}%,item_name.ilike.%${search}%`)
  if (species) query = query.eq('species', species)
  if (active !== null) query = query.eq('active', active === 'true')

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/processing — bulk upsert from file upload
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { items } = body as { items: Record<string, unknown>[] }
  if (!items?.length) return NextResponse.json({ error: 'No items provided' }, { status: 400 })

  const rows = items.map(item => ({ ...item, updated_at: new Date().toISOString() }))

  const { data, error } = await supabase
    .from('plu_items')
    .upsert(rows, { onConflict: 'plu_number' })
    .select()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, count: data.length })
}

// PATCH /api/processing — update single item by id
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  const { data, error } = await supabase
    .from('plu_items')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/processing?id=
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase.from('plu_items').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
