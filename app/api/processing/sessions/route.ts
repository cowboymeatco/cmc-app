export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET â€” merged list of sessions (processing_sessions records + derived from boxes)
export async function GET() {
  // 1. Fetch session records
  const { data: sessionRows } = await supabase
    .from('processing_sessions')
    .select('*')
    .order('session_date', { ascending: false })

  const sessions = (sessionRows ?? []) as Array<{
    id: string; customer_name: string; session_date: string
    status: string; notes: string; created_at: string; box_type: string | null
  }>
  const sessionMap = new Map(sessions.map(s => [`${s.customer_name}|${s.session_date}`, s]))

  // 2. Fetch box stats (recent 500 to cover all sessions)
  const { data: boxRows } = await supabase
    .from('boxes')
    .select('customer_name, pack_date, is_closed, total_weight_lbs, total_cuts')
    .order('created_at', { ascending: false })
    .limit(500)

  const boxGroups = new Map<string, {
    customer_name: string; session_date: string
    box_count: number; closed_count: number; total_weight: number; total_cuts: number
  }>()
  for (const b of (boxRows ?? [])) {
    const key = `${b.customer_name}|${b.pack_date}`
    if (!boxGroups.has(key)) {
      boxGroups.set(key, { customer_name: b.customer_name, session_date: b.pack_date, box_count: 0, closed_count: 0, total_weight: 0, total_cuts: 0 })
    }
    const g = boxGroups.get(key)!
    g.box_count++
    if (b.is_closed) {
      g.closed_count++
      g.total_weight += Number(b.total_weight_lbs) || 0
      g.total_cuts   += Number(b.total_cuts) || 0
    }
  }

  // 3. Carcass inputs per session — so the freezer list shows which animals
  // are in each customer's boxes (e.g. "Beef — Tag 06 (Holdbrook)")
  const { data: carcassRows } = await supabase
    .from('processing_inputs')
    .select('customer_name, session_date, description')
    .eq('input_type', 'carcass')
    .order('created_at', { ascending: false })
    .limit(500)

  const animalGroups = new Map<string, string[]>()
  for (const r of (carcassRows ?? []) as { customer_name: string | null; session_date: string; description: string }[]) {
    if (!r.customer_name || !r.description) continue
    const key = `${r.customer_name}|${r.session_date}`
    if (!animalGroups.has(key)) animalGroups.set(key, [])
    // Both halves of one animal scan in as the same description bar the side —
    // collapse "Beef — Tag 06 L Half" / "R Half" into one animal entry.
    const desc = r.description.replace(/ [LR] Half/, '')
    const list = animalGroups.get(key)!
    if (!list.includes(desc)) list.push(desc)
  }

  // 4. Merge
  const result: Array<{
    id: string | null; customer_name: string; session_date: string
    status: string; notes: string; box_type: string | null
    box_count: number; closed_count: number; total_weight: number; total_cuts: number
    animals: string[]
  }> = []
  const seen = new Set<string>()

  for (const s of sessions) {
    const key   = `${s.customer_name}|${s.session_date}`
    const stats = boxGroups.get(key) ?? { box_count: 0, closed_count: 0, total_weight: 0, total_cuts: 0 }
    result.push({ id: s.id, customer_name: s.customer_name, session_date: s.session_date, status: s.status, notes: s.notes, box_type: s.box_type ?? null, ...stats, animals: animalGroups.get(key) ?? [] })
    seen.add(key)
  }
  // Box groups with no session record yet â†’ derive status
  for (const [key, stats] of boxGroups) {
    if (!seen.has(key)) {
      const { customer_name, session_date, ...rest } = stats
      result.push({ id: null, customer_name, session_date, status: 'scanning', notes: '', box_type: null, ...rest, animals: animalGroups.get(key) ?? [] })
    }
  }

  result.sort((a, b) => b.session_date.localeCompare(a.session_date))
  return NextResponse.json(result)
}

// POST â€” upsert session record (by customer_name + session_date)
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { session_date, status = 'scanning', notes = '' } = body
  // Trim: a stray trailing space would upsert a phantom twin session
  const customer_name = typeof body.customer_name === 'string' ? body.customer_name.trim() : body.customer_name

  // Only carry box_type into the upsert when it's actually supplied. Reopening a
  // session upserts to refresh status and must NOT null out a type set earlier.
  const row: Record<string, unknown> = { customer_name, session_date, status, notes, updated_at: new Date().toISOString() }
  if (body.box_type != null) row.box_type = body.box_type

  const { data, error } = await supabase
    .from('processing_sessions')
    .upsert(
      [row],
      { onConflict: 'customer_name,session_date' }
    )
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH â€” update status / notes (by id OR customer_name+session_date)
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, customer_name, session_date, ...updates } = body

  let query = supabase
    .from('processing_sessions')
    .update({ ...updates, updated_at: new Date().toISOString() })

  if (id) {
    query = query.eq('id', id)
  } else if (customer_name && session_date) {
    query = query.eq('customer_name', customer_name).eq('session_date', session_date)
  } else {
    return NextResponse.json({ error: 'id or customer_name+session_date required' }, { status: 400 })
  }

  const { data, error } = await query.select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE — remove a session record (by id OR customer_name+session_date).
// Only deletes the processing_sessions row; boxes are untouched.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id            = searchParams.get('id')
  const customer_name = searchParams.get('customer_name')
  const session_date  = searchParams.get('session_date')

  let query = supabase.from('processing_sessions').delete()
  if (id) {
    query = query.eq('id', id)
  } else if (customer_name && session_date) {
    query = query.eq('customer_name', customer_name).eq('session_date', session_date)
  } else {
    return NextResponse.json({ error: 'id or customer_name+session_date required' }, { status: 400 })
  }

  const { error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
