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
    status: string; notes: string; created_at: string
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

  // 3. Merge
  const result: Array<{
    id: string | null; customer_name: string; session_date: string
    status: string; notes: string
    box_count: number; closed_count: number; total_weight: number; total_cuts: number
  }> = []
  const seen = new Set<string>()

  for (const s of sessions) {
    const key   = `${s.customer_name}|${s.session_date}`
    const stats = boxGroups.get(key) ?? { box_count: 0, closed_count: 0, total_weight: 0, total_cuts: 0 }
    result.push({ id: s.id, customer_name: s.customer_name, session_date: s.session_date, status: s.status, notes: s.notes, ...stats })
    seen.add(key)
  }
  // Box groups with no session record yet â†’ derive status
  for (const [key, stats] of boxGroups) {
    if (!seen.has(key)) {
      const { customer_name, session_date, ...rest } = stats
      result.push({ id: null, customer_name, session_date, status: 'scanning', notes: '', ...rest })
    }
  }

  result.sort((a, b) => b.session_date.localeCompare(a.session_date))
  return NextResponse.json(result)
}

// POST â€” upsert session record (by customer_name + session_date)
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { customer_name, session_date, status = 'scanning', notes = '' } = body

  const { data, error } = await supabase
    .from('processing_sessions')
    .upsert(
      [{ customer_name, session_date, status, notes, updated_at: new Date().toISOString() }],
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
