import { NextRequest, NextResponse } from 'next/server'
// kanban_* are under RLS with no policies — vendor account numbers and what we
// pay are not for the public anon key.
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// GET /api/kanban — everything the board needs in one trip: items, vendors,
// every open card, and the last `days` (default 90) of closed ones for the
// Received column and the health numbers.
//   ?all=1  include retired items and vendors (the editors want them)
export async function GET(req: NextRequest) {
  const url = new URL(req.url)

  // ?count=1 — the dashboard tile: how many cards are pulled and waiting on an order.
  if (url.searchParams.get('count') === '1') {
    const { count, error } = await supabaseAdmin.from('kanban_signals')
      .select('id', { count: 'exact', head: true }).eq('status', 'pulled')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ count: count ?? 0 })
  }

  const all = url.searchParams.get('all') === '1'
  const days = Math.min(365, Math.max(7, Number(url.searchParams.get('days')) || 90))
  const since = new Date(Date.now() - days * 86400000).toISOString()

  let items = supabaseAdmin.from('kanban_items').select('*').order('card_no')
  let vendors = supabaseAdmin.from('kanban_vendors').select('*').order('name')
  if (!all) { items = items.eq('active', true); vendors = vendors.eq('active', true) }

  const [i, v, open, closed] = await Promise.all([
    items,
    vendors,
    supabaseAdmin.from('kanban_signals').select('*')
      .in('status', ['pulled', 'ordered']).order('pulled_at', { ascending: true }),
    supabaseAdmin.from('kanban_signals').select('*')
      .in('status', ['received', 'cancelled']).gte('pulled_at', since)
      .order('pulled_at', { ascending: false }).limit(2000),
  ])
  const err = i.error ?? v.error ?? open.error ?? closed.error
  if (err) return NextResponse.json({ error: err.message }, { status: 500 })

  return NextResponse.json({
    items:   i.data ?? [],
    vendors: v.data ?? [],
    signals: [...(open.data ?? []), ...(closed.data ?? [])],
    days,
  })
}
