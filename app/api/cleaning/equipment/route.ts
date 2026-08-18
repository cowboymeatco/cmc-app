export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Equipment, and the procedure attached to it.
//
// GET ?id=…   → one machine with its steps, for the procedure screen
// GET ?area=… → the machines in an area
// GET         → everything, flat, for pickers
//
// Backed by `assets`, not the old cleaning_equipment table. A machine is one
// record carrying its teardown procedure, its service history and its cost, so
// a machine captured on the plant walk has to be the same row the night crew
// opens a procedure on. Writes go through /api/assets; this route stays as the
// cleaning module's read view, filtered to what is actually cleanable.

export async function GET(req: NextRequest) {
  const url    = new URL(req.url)
  const id     = url.searchParams.get('id')
  const areaId = url.searchParams.get('area')

  if (id) {
    const { data: equip, error } = await supabase
      .from('assets')
      .select('*, cleaning_areas(id, name)')
      .eq('id', id).single()
    if (error) return NextResponse.json({ error: error.message }, { status: 404 })

    const { data: steps } = await supabase
      .from('cleaning_steps').select('*')
      .eq('asset_id', id)
      .order('step_no', { ascending: true })

    // Open suggestions ride along so the admin screen can show that the crew
    // has flagged this procedure without a second request.
    const { data: suggestions } = await supabase
      .from('cleaning_step_suggestions').select('*')
      .eq('asset_id', id).eq('status', 'open')
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
    .from('assets')
    .select('*, cleaning_areas(id, name, sort_order)')
    .eq('active', true)
    .eq('cleanable', true)
    .order('name', { ascending: true })
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

  // Adding a machine here creates an ASSET. There is no separate cleaning
  // equipment list any more, so a machine added by Jill in the cleaning admin
  // and one captured on the plant walk are the same record — which is the
  // whole point of one row per physical thing.
  const { data, error } = await supabase
    .from('assets')
    .insert([{
      area_id:   body.area_id,
      name:      body.name.trim(),
      // The cleaning form asks for one "make & model" string; assets keep the
      // two apart, so it lands in make and can be split later.
      make:      body.make_model?.trim() || null,
      category:  'equipment',
      cleanable: true,
      notes:     body.notes?.trim() || null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('assets').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Retired, not deleted — the service history and the cleaning steps written
// against a machine stay meaningful after it leaves the floor.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('assets').update({ active: false, status: 'retired' }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
