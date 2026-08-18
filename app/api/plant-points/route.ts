export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { POINT_KINDS, type PointKind } from '@/lib/plantPoints'

// GET    /api/plant-points?area=…   → fixed points, optionally for one room
// POST   /api/plant-points          → capture one
// PATCH  /api/plant-points          → edit / move / record a swab
// DELETE /api/plant-points?id=…     → deactivate

export async function GET(req: NextRequest) {
  const url    = new URL(req.url)
  const areaId = url.searchParams.get('area')
  const kind   = url.searchParams.get('kind')

  let q = supabase
    .from('plant_points')
    .select('*, cleaning_areas(id, name)')
    .eq('active', true)
    .order('kind')
  if (areaId) q = q.eq('area_id', areaId)
  if (kind)   q = q.eq('kind', kind)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const kind = body?.kind

  if (!kind || !POINT_KINDS.includes(kind as PointKind)) {
    return NextResponse.json(
      { error: `kind must be one of: ${POINT_KINDS.join(', ')}` }, { status: 400 })
  }
  if (!body.area_id) {
    // The room is the part that's reliably true without a floor plan, so it is
    // the one thing a point cannot be saved without.
    return NextResponse.json({ error: 'Which room is it in?' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('plant_points')
    .insert([{
      area_id:    body.area_id,
      kind,
      label:      body.label?.trim() || null,
      map_x:      body.map_x ?? null,
      map_y:      body.map_y ?? null,
      photo_url:  body.photo_url ?? null,
      notes:      body.notes?.trim() || null,
      attributes: body.attributes ?? {},
      swab_site:  !!body.swab_site,
      last_swabbed_on: body.last_swabbed_on || null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, action, ...updates } = body as Record<string, unknown> & { id?: string; action?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Recording a swab is its own action rather than a raw date edit, so the
  // common case is one call and can't be half-done.
  if (action === 'swabbed') {
    const on = (body as { on?: string }).on
    const { data, error } = await supabase
      .from('plant_points')
      .update({ last_swabbed_on: on || new Date().toISOString().slice(0, 10), updated_at: new Date().toISOString() })
      .eq('id', id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (updates.kind && !POINT_KINDS.includes(updates.kind as PointKind)) {
    return NextResponse.json({ error: 'unknown kind' }, { status: 400 })
  }

  updates.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('plant_points').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Deactivated rather than deleted: a drain that was swabbed under the Lm
// program is part of that record even after it's capped or rerouted.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('plant_points').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
