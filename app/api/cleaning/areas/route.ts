export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Areas — the rooms the crew walks, in the order they walk them.
// GET returns each area with its machines nested, because every screen that
// wants one wants the other.
//
// The machines come from `assets`, not the old cleaning_equipment table: a
// machine is one record carrying its cleaning procedure, its service history
// AND its cost, so the plant walk and the cleaning module have to be looking
// at the same row. Filtered to cleanable, since a truck and a leasehold
// improvement are assets but are not on anyone's nightly list.
//
// Still returned under the key `cleaning_equipment` so existing callers keep
// working — the shape is what they depend on, not the table behind it.

export async function GET(req: NextRequest) {
  const includeInactive = new URL(req.url).searchParams.get('all') === '1'

  let q = supabase
    .from('cleaning_areas')
    .select('*, assets(id, name, make, model, status, active, cleanable, notes)')
    .order('sort_order', { ascending: true })
  if (!includeInactive) q = q.eq('active', true)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  type AssetRow = {
    id: string; name: string; make: string | null; model: string | null
    status: string; active: boolean; cleanable: boolean; notes: string | null
  }
  const rows = (data ?? []).map(a => {
    const machines = ((a.assets ?? []) as AssetRow[])
      // Filtered here rather than in the query: an inner join on cleanable
      // would drop every room that has no machines yet, and an empty room
      // still has to appear on the list.
      .filter(e => e.cleanable)
      .filter(e => includeInactive || e.active)
      .sort((x, y) => x.name.localeCompare(y.name))
      .map(e => ({
        id: e.id,
        name: e.name,
        // Collapsed to the single field the cleaning screens display.
        make_model: [e.make, e.model].filter(Boolean).join(' ') || null,
        status: e.status,
        active: e.active,
        notes: e.notes,
      }))
    // Drop the raw nested key; callers get the shaped `cleaning_equipment`.
    const area = { ...(a as Record<string, unknown>) }
    delete area.assets
    return { ...area, cleaning_equipment: machines }
  })

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
