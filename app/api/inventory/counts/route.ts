export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Physical inventory counts.
//
// GET   ?status=open|all   → counts, newest first
// POST  { count_date, location, opened_by }  → open one
// PATCH { id, action: 'close' | 'reopen', by, notes }
//
// One open count per location is enforced by a partial unique index rather than
// a check here, so two people starting the freezer at once loses cleanly at the
// database instead of quietly double-counting the stock.

export async function GET(req: NextRequest) {
  const status = req.nextUrl.searchParams.get('status') ?? 'all'
  let q = supabase.from('inventory_counts').select('*').order('count_date', { ascending: false })
  if (status !== 'all') q = q.eq('status', status)
  const { data, error } = await q.limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json() as Record<string, string | undefined>
  const count_date = (body.count_date ?? '').trim()
  const location = (body.location ?? '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(count_date)) {
    return NextResponse.json({ error: 'count_date must be YYYY-MM-DD' }, { status: 400 })
  }
  if (!location) return NextResponse.json({ error: 'location is required' }, { status: 400 })

  const { data, error } = await supabase
    .from('inventory_counts')
    .insert({ count_date, location, opened_by: (body.opened_by ?? '').trim(), notes: (body.notes ?? '').trim() })
    .select('*')
    .single()

  if (error) {
    // 23505 = the one-open-per-location index. Say which, rather than "failed".
    if (error.code === '23505') {
      return NextResponse.json(
        { error: `${location} already has a count open. Finish that one first.` },
        { status: 409 },
      )
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json() as Record<string, string | undefined>
  const { id, action } = body
  if (!id) return NextResponse.json({ error: 'id is required' }, { status: 400 })

  if (action === 'close') {
    const { data, error } = await supabase
      .from('inventory_counts')
      .update({ status: 'closed', closed_at: new Date().toISOString(), closed_by: (body.by ?? '').trim() })
      .eq('id', id)
      .eq('status', 'open')
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (!data) return NextResponse.json({ error: 'That count is not open.' }, { status: 409 })
    return NextResponse.json(data)
  }

  if (action === 'reopen') {
    const { data, error } = await supabase
      .from('inventory_counts')
      .update({ status: 'open', closed_at: null, closed_by: null })
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) {
      if (error.code === '23505') {
        return NextResponse.json({ error: 'That location already has another count open.' }, { status: 409 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }
    return NextResponse.json(data)
  }

  if (action === 'notes') {
    const { data, error } = await supabase
      .from('inventory_counts')
      .update({ notes: (body.notes ?? '').trim() })
      .eq('id', id)
      .select('*')
      .maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: `unknown action ${action}` }, { status: 400 })
}
