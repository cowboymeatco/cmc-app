export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
// smokehouse_supplies / smokehouse_blend_lines are under RLS with no policies —
// a house blend's make-up is as much a trade secret as the recipes.
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

const FIELDS = ['name', 'kind', 'supplier', 'pack_lb', 'lead_days', 'on_hand_lb', 'cost_per_lb', 'notes', 'active'] as const

// GET /api/smokehouse-supplies — every supply plus every blend's lines.
export async function GET() {
  const [s, l] = await Promise.all([
    supabaseAdmin.from('smokehouse_supplies').select('*').order('name'),
    supabaseAdmin.from('smokehouse_blend_lines').select('*'),
  ])
  const err = s.error ?? l.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })
  return NextResponse.json({ supplies: s.data ?? [], lines: l.data ?? [] })
}

// POST /api/smokehouse-supplies — create (no id) or update one supply. A new
// on-hand number stamps counted_at so the list can say how old the count is.
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
  if (body.on_hand_lb !== undefined) row.counted_at = new Date().toISOString()
  if (!body.id && !row.name) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const q = body.id
    ? supabaseAdmin.from('smokehouse_supplies').update(row).eq('id', body.id)
    : supabaseAdmin.from('smokehouse_supplies').insert(row)
  const { data, error } = await q.select().single()
  if (error) {
    const msg = /duplicate key/.test(error.message) ? 'A supply with that name already exists' : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json(data)
}

// PUT /api/smokehouse-supplies — replace a blend's ingredient lines.
// body: { blend_id, lines: [{ ingredient_id, pct }], updated_by }
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const who = typeof body.updated_by === 'string' ? body.updated_by.trim() : ''
  if (!who) return NextResponse.json({ error: 'Your name is required to save' }, { status: 400 })
  const blendId = typeof body.blend_id === 'string' ? body.blend_id : ''
  if (!blendId) return NextResponse.json({ error: 'blend_id required' }, { status: 400 })
  const raw: { ingredient_id?: unknown; pct?: unknown }[] = Array.isArray(body.lines) ? body.lines : []
  const lines = raw
    .map(l => ({ blend_id: blendId, ingredient_id: String(l.ingredient_id ?? ''), pct: Number(l.pct) }))
    .filter(l => l.ingredient_id && l.pct > 0)
  if (lines.some(l => l.ingredient_id === blendId)) {
    return NextResponse.json({ error: 'A blend cannot contain itself' }, { status: 400 })
  }

  const del = await supabaseAdmin.from('smokehouse_blend_lines').delete().eq('blend_id', blendId)
  if (del.error) return NextResponse.json({ error: del.error.message }, { status: 500 })
  if (lines.length) {
    const ins = await supabaseAdmin.from('smokehouse_blend_lines').insert(lines)
    if (ins.error) return NextResponse.json({ error: ins.error.message }, { status: 500 })
  }
  await supabaseAdmin.from('smokehouse_supplies')
    .update({ updated_by: who, updated_at: new Date().toISOString() }).eq('id', blendId)
  return NextResponse.json({ ok: true })
}

// DELETE /api/smokehouse-supplies?id= — refused while a blend still uses it.
// Recipes pointing at it fall back to blank (on delete set null) and show up
// on the order list's "can't count" list.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('smokehouse_supplies').delete().eq('id', id)
  if (error) {
    const msg = /foreign key/.test(error.message) ? 'A blend still uses this — take it out of the blend first' : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json({ ok: true })
}
