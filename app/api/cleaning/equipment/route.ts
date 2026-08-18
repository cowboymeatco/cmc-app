export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Equipment, and the procedure attached to it.
//
// GET ?id=…   → one machine with its steps, for the procedure screen
// GET ?area=… → the machines in an area
// GET         → everything, flat, for pickers

export async function GET(req: NextRequest) {
  const url    = new URL(req.url)
  const id     = url.searchParams.get('id')
  const areaId = url.searchParams.get('area')

  if (id) {
    const { data: equip, error } = await supabase
      .from('cleaning_equipment')
      .select('*, cleaning_areas(id, name)')
      .eq('id', id).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 404 })

    const { data: steps } = await supabase
      .from('cleaning_steps').select('*')
      .eq('equipment_id', id)
      .order('step_no', { ascending: true })

    // Open suggestions ride along so the admin screen can show that the crew
    // has flagged this procedure without a second request.
    const { data: suggestions } = await supabase
      .from('cleaning_step_suggestions').select('*')
      .eq('equipment_id', id).eq('status', 'open')
      .order('created_at', { ascending: false })

    return NextResponse.json({
      ...equip,
      steps:       steps ?? [],
      suggestions: suggestions ?? [],
      // The honest state for a machine nobody has written up yet. The browse
      // screen shows it as a gap rather than as an empty procedure.
      documented:  (steps ?? []).length > 0,
    })
  }

  let q = supabase
    .from('cleaning_equipment')
    .select('*, cleaning_areas(id, name, sort_order)')
    .eq('active', true)
    .order('sort_order', { ascending: true })
  if (areaId) q = q.eq('area_id', areaId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.area_id || !body.name?.trim()) {
    return NextResponse.json({ error: 'area_id and name required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('cleaning_equipment')
    .insert([{
      area_id:    body.area_id,
      name:       body.name.trim(),
      make_model: body.make_model?.trim() || null,
      sort_order: body.sort_order ?? 100,
      notes:      body.notes?.trim() || null,
    }])
    .select().single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That area already has a machine with that name.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_equipment').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Deactivated, not deleted — see the note in the areas route.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_equipment').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
