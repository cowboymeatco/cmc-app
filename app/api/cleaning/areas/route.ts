export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Areas — the rooms the crew walks, in the order they walk them.
// GET returns each area with its equipment nested, because every screen that
// wants one wants the other.

export async function GET(req: NextRequest) {
  const includeInactive = new URL(req.url).searchParams.get('all') === '1'

  let q = supabase
    .from('cleaning_areas')
    .select('*, cleaning_equipment(id, name, make_model, sort_order, active, notes)')
    .order('sort_order', { ascending: true })
  if (!includeInactive) q = q.eq('active', true)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Nested rows come back unordered; sort here so every caller doesn't have to.
  type Equip = { sort_order: number; name: string; active: boolean }
  const rows = (data ?? []).map(a => ({
    ...a,
    cleaning_equipment: ((a.cleaning_equipment ?? []) as Equip[])
      .filter(e => includeInactive || e.active)
      .sort((x, y) => x.sort_order - y.sort_order || x.name.localeCompare(y.name)),
  }))

  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_areas')
    .insert([{
      name:       body.name.trim(),
      sort_order: body.sort_order ?? 100,
      notes:      body.notes?.trim() || null,
    }])
    .select().single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'There is already an area with that name.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_areas').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Deactivate rather than delete: an area's name is snapshotted onto every shift
// item ever recorded under it, and history should stay readable.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_areas').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
