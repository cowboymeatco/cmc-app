export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// The supply catalog the request list picks from. Par levels and on-hand counts
// exist as columns but no screen writes them yet — counting stock is a habit
// worth having before it becomes a feature.

export async function GET(req: NextRequest) {
  const all = new URL(req.url).searchParams.get('all') === '1'

  let q = supabase.from('cleaning_supplies').select('*').order('sort_order', { ascending: true })
  if (!all) q = q.eq('active', true)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const rows = (data ?? []).sort(
    (a, b) => (a.sort_order as number) - (b.sort_order as number) ||
              String(a.name).localeCompare(String(b.name)),
  )
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_supplies')
    .insert([{
      name:       body.name.trim(),
      unit:       body.unit?.trim()   || null,
      vendor:     body.vendor?.trim() || null,
      sku:        body.sku?.trim()    || null,
      par_level:  body.par_level ?? null,
      sort_order: body.sort_order ?? 100,
      notes:      body.notes?.trim()  || null,
    }])
    .select().single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That supply is already in the list.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_supplies').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_supplies').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
