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
  const name = body.name?.trim()
  if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const fields = {
    unit:       body.unit?.trim()   || null,
    vendor:     body.vendor?.trim() || null,
    sku:        body.sku?.trim()    || null,
    par_level:  body.par_level ?? null,
    sort_order: body.sort_order ?? 100,
    notes:      body.notes?.trim()  || null,
  }

  const { data, error } = await supabase
    .from('cleaning_supplies')
    .insert([{ name, ...fields }])
    .select().single()

  if (error) {
    if (error.code !== '23505') {
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    // The name is taken — but taking it off the list only sets active=false, so
    // the row blocking this insert may be one nobody can see. Retiring a supply
    // and then adding it back is an ordinary thing to do, and it used to dead-end
    // on "already in the list" against an item that wasn't on the list (Charlie,
    // 2026-08-23). A retired name is brought back with whatever was just typed.
    const { data: existing } = await supabase
      .from('cleaning_supplies').select('*').eq('name', name).maybeSingle()
    if (!existing) return NextResponse.json({ error: error.message }, { status: 500 })
    if (existing.active) {
      return NextResponse.json({ error: 'That supply is already in the list.' }, { status: 409 })
    }

    // Blank boxes shouldn't wipe what the retired row already knew — and the
    // default sort_order isn't something the form asked for, so it doesn't
    // get to reset a position someone set on purpose.
    const revived = Object.fromEntries(
      Object.entries(fields).filter(([k, v]) =>
        v !== null && v !== undefined && (k !== 'sort_order' || body.sort_order != null)),
    )
    const { data: back, error: reviveErr } = await supabase
      .from('cleaning_supplies')
      .update({ ...revived, active: true })
      .eq('id', existing.id)
      .select().single()
    if (reviveErr) return NextResponse.json({ error: reviveErr.message }, { status: 500 })
    return NextResponse.json({ ...back, revived: true })
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
