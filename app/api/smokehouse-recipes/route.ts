export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
// Service role: smokehouse_recipes holds the formulations and is under RLS with
// no policies — the anon key can't read it at all. See
// scripts/2026-09-26_smokehouse_recipes.sql.
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const FIELDS = [
  'product', 'label',
  'seasoning_id', 'seasoning_lb_per_100',
  'cure_id', 'cure_oz_per_100', 'other_adds',
  'casing_type', 'casing_size', 'steps', 'notes', 'label_statement',
] as const

interface LineIn { item: string; supply_id: string | null; lb_per_100: number | null; qty_note: string | null }

// A recipe's ingredient lines as sent by the editor. Returns an error string
// rather than saving half a formulation.
function parseLines(v: unknown): LineIn[] | string {
  if (!Array.isArray(v)) return 'lines must be a list'
  const out: LineIn[] = []
  for (const raw of v as Record<string, unknown>[]) {
    const item = typeof raw?.item === 'string' ? raw.item.trim() : ''
    if (!item) return 'Every ingredient line needs a name'
    const lb = raw.lb_per_100 == null || raw.lb_per_100 === '' ? null : Number(raw.lb_per_100)
    if (lb !== null && !(isFinite(lb) && lb >= 0)) return `${item}: amount must be a number`
    const note = typeof raw.qty_note === 'string' ? raw.qty_note.trim() || null : null
    const supply = typeof raw.supply_id === 'string' && raw.supply_id ? raw.supply_id : null
    out.push({ item, supply_id: supply, lb_per_100: lb, qty_note: note })
  }
  return out
}

// GET /api/smokehouse-recipes — every active wizard flavour (filled in or not),
// the free house-product rows, their ingredient lines, the cook profiles'
// pounds per load, and the supplies a recipe's lines are picked from.
export async function GET() {
  const [flav, rec, prof, sup, lin] = await Promise.all([
    supabaseAdmin.from('wizard_flavors').select('id, product, val, label, plu_number, sort_order').eq('active', true).order('sort_order'),
    supabaseAdmin.from('smokehouse_recipes').select('*'),
    supabaseAdmin.from('cook_profile').select('id, profile_key, display_name, lbs_per_batch, units_per_batch, unit_label').eq('active', true),
    supabaseAdmin.from('smokehouse_supplies').select('id, name, kind, supplier').eq('active', true).order('name'),
    supabaseAdmin.from('smokehouse_recipe_lines').select('id, recipe_id, sort_order, item, supply_id, lb_per_100, qty_note').order('sort_order'),
  ])
  const err = flav.error ?? rec.error ?? prof.error ?? sup.error ?? lin.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })
  const linesOf = new Map<string, unknown[]>()
  for (const l of lin.data ?? []) linesOf.set(l.recipe_id, [...(linesOf.get(l.recipe_id) ?? []), l])
  const recipes = (rec.data ?? []).map(r => ({ ...r, lines: linesOf.get(r.id) ?? [] }))
  return NextResponse.json({ flavors: flav.data ?? [], recipes, profiles: prof.data ?? [], supplies: sup.data ?? [] })
}

// POST /api/smokehouse-recipes — save one recipe. `id` updates; otherwise a
// new row (for a wizard flavour, keyed on wizard_flavor_id so a double-save
// can't make two). updated_by is required — who wrote it down is the point.
// `lines`, when sent, replaces the recipe's ingredient lines in full.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const who = typeof body.updated_by === 'string' ? body.updated_by.trim() : ''
  if (!who) return NextResponse.json({ error: 'Your name is required to save' }, { status: 400 })
  const lines = body.lines === undefined ? undefined : parseLines(body.lines)
  if (typeof lines === 'string') return NextResponse.json({ error: lines }, { status: 400 })

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

  // New lines go in before the old ones come out, so a failed write never
  // leaves a recipe with no ingredients.
  let saved = lines
  if (lines) {
    const { data: old, error: oe } = await supabaseAdmin.from('smokehouse_recipe_lines').select('id').eq('recipe_id', data.id)
    if (oe) return NextResponse.json({ error: oe.message }, { status: 500 })
    if (lines.length) {
      const ins = await supabaseAdmin.from('smokehouse_recipe_lines')
        .insert(lines.map((l, i) => ({ ...l, recipe_id: data.id, sort_order: i })))
        .select('id, recipe_id, sort_order, item, supply_id, lb_per_100, qty_note')
      if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
      saved = ins.data
    }
    const oldIds = (old ?? []).map(o => o.id)
    if (oldIds.length) {
      const del = await supabaseAdmin.from('smokehouse_recipe_lines').delete().in('id', oldIds)
      if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 })
    }
  } else {
    const cur = await supabaseAdmin.from('smokehouse_recipe_lines')
      .select('id, recipe_id, sort_order, item, supply_id, lb_per_100, qty_note').eq('recipe_id', data.id).order('sort_order')
    saved = cur.data ?? []
  }
  return NextResponse.json({ ...data, lines: saved })
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
