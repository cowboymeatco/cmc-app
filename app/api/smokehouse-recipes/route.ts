export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
// Service role: smokehouse_recipes holds the formulations and is under RLS with
// no policies — the anon key can't read it at all. See
// scripts/2026-09-26_smokehouse_recipes.sql.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

const FIELDS = [
  'product', 'label',
  'seasoning_name', 'seasoning_supplier', 'seasoning_lb_per_100',
  'cure_name', 'cure_oz_per_100', 'other_adds',
  'casing_type', 'casing_size', 'steps', 'notes',
] as const

// GET /api/smokehouse-recipes — every active wizard flavour (filled in or not),
// the free house-product rows, and the cook profiles' pounds per load, so the
// book shows what's still blank.
export async function GET() {
  const [flav, rec, prof] = await Promise.all([
    supabase.from('wizard_flavors').select('id, product, val, label, plu_number, sort_order').eq('active', true).order('sort_order'),
    supabaseAdmin.from('smokehouse_recipes').select('*'),
    supabase.from('cook_profile').select('id, profile_key, display_name, lbs_per_batch, units_per_batch, unit_label').eq('active', true),
  ])
  const err = flav.error ?? rec.error ?? prof.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })
  return NextResponse.json({ flavors: flav.data ?? [], recipes: rec.data ?? [], profiles: prof.data ?? [] })
}

// POST /api/smokehouse-recipes — save one recipe. `id` updates; otherwise a
// new row (for a wizard flavour, keyed on wizard_flavor_id so a double-save
// can't make two). updated_by is required — who wrote it down is the point.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const who = typeof body.updated_by === 'string' ? body.updated_by.trim() : ''
  if (!who) return NextResponse.json({ error: 'Your name is required to save' }, { status: 400 })

  const row: Record<string, unknown> = { updated_by: who, updated_at: new Date().toISOString() }
  for (const f of FIELDS) {
    if (body[f] === undefined) continue
    const v = body[f]
    row[f] = typeof v === 'string' ? (v.trim() || null) : v
  }

  let q
  if (body.id) {
    q = supabaseAdmin.from('smokehouse_recipes').update(row).eq('id', body.id)
  } else {
    if (!row.product || !row.label) return NextResponse.json({ error: 'product and label required' }, { status: 400 })
    if (body.wizard_flavor_id) row.wizard_flavor_id = body.wizard_flavor_id
    q = body.wizard_flavor_id
      ? supabaseAdmin.from('smokehouse_recipes').upsert(row, { onConflict: 'wizard_flavor_id' })
      : supabaseAdmin.from('smokehouse_recipes').insert(row)
  }
  const { data, error } = await q.select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/smokehouse-recipes?id= — house-product rows only. A wizard
// flavour's recipe is edited, never deleted, so a mis-tap can't erase it.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: existing } = await supabaseAdmin.from('smokehouse_recipes').select('wizard_flavor_id').eq('id', id).maybeSingle()
  if (existing?.wizard_flavor_id) return NextResponse.json({ error: 'Wizard flavour recipes can be edited, not deleted' }, { status: 400 })
  const { error } = await supabaseAdmin.from('smokehouse_recipes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
