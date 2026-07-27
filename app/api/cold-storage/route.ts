export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/cold-storage?start=YYYY-MM-DD&end=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const start = searchParams.get('start')
  const end   = searchParams.get('end')

  let query = supabase
    .from('cold_storage_log')
    .select('*')
    .order('recorded_date', { ascending: false })
    .order('created_at',    { ascending: false })

  if (start) query = query.gte('recorded_date', start)
  if (end)   query = query.lte('recorded_date', end)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/cold-storage
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase
    .from('cold_storage_log')
    .insert([{
      recorded_date:        body.recorded_date,
      recorded_time:           body.recorded_time           ?? null,
      showcase_freezer_f:      body.showcase_freezer_f      ?? null,
      showcase_cooler_f:       body.showcase_cooler_f       ?? null,
      retail_freezer_f:        body.retail_freezer_f        ?? null,
      custom_freezer_middle_f: body.custom_freezer_middle_f ?? null,
      custom_freezer_east_f:   body.custom_freezer_east_f   ?? null,
      new_carcass_cooler_f:    body.new_carcass_cooler_f    ?? null,
      old_carcass_cooler_f:    body.old_carcass_cooler_f    ?? null,
      initials:                body.initials                ?? '',
      notes:                   body.notes                   ?? '',
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/cold-storage?id=UUID
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('cold_storage_log').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
