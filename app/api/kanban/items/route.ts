import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { ITEM_FIELDS, CATEGORIES } from '@/lib/kanban'

export const dynamic = 'force-dynamic'

const NUMBERS = new Set([
  'cards_in_loop', 'units_per_order_unit', 'order_qty', 'min_order_qty', 'bin_qty',
  'reorder_point', 'price', 'lead_days', 'daily_usage', 'safety_days',
])
const INTEGERS = new Set(['cards_in_loop', 'lead_days'])

// GET /api/kanban/items?id= — one card for the scan page: the item, its
// vendor's name, and any of its cards already out. Retired cards come back
// too (active=false) so the page can say so instead of 404ing a shelf sticker.
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data: item, error } = await supabaseAdmin.from('kanban_items').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!item) return NextResponse.json({ item: null, vendor: null, open: [] })
  const [v, o] = await Promise.all([
    item.vendor_id
      ? supabaseAdmin.from('kanban_vendors').select('name').eq('id', item.vendor_id).maybeSingle()
      : Promise.resolve({ data: null }),
    supabaseAdmin.from('kanban_signals').select('*').eq('item_id', id).in('status', ['pulled', 'ordered']),
  ])
  return NextResponse.json({ item, vendor: v.data ?? null, open: o.data ?? [] })
}

// POST /api/kanban/items — create (no id) or update one kanban card.
// A changed price stamps price_updated_at so the card can say how stale it is.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const who = typeof body.updated_by === 'string' ? body.updated_by.trim() : ''
  if (!who) return NextResponse.json({ error: 'Your name is required to save' }, { status: 400 })

  const now = new Date().toISOString()
  const row: Record<string, unknown> = { updated_by: who, updated_at: now }
  for (const f of ITEM_FIELDS) {
    if (body[f] === undefined) continue
    const v = body[f]
    if (NUMBERS.has(f)) {
      let n = v === '' || v == null ? null : Number(v)
      if (n != null && (!Number.isFinite(n) || n < 0)) {
        return NextResponse.json({ error: `${f.replace(/_/g, ' ')} must be a positive number` }, { status: 400 })
      }
      if (n != null && INTEGERS.has(f)) n = Math.round(n)
      // Two columns are NOT NULL with a default; blank puts the default back.
      if (n == null && f === 'cards_in_loop') n = 2
      if (n == null && f === 'safety_days') n = 0
      row[f] = n
    } else if (f === 'active') {
      row[f] = v === true
    } else if (f === 'category') {
      row[f] = (CATEGORIES as readonly unknown[]).includes(v) ? v : 'Other'
    } else if (f === 'vendor_id' || f === 'alt_vendor_id') {
      row[f] = typeof v === 'string' && v ? v : null
    } else {
      row[f] = typeof v === 'string' ? (v.trim() || null) : v
    }
  }
  if (!body.id && !row.name) return NextResponse.json({ error: 'Name the item' }, { status: 400 })
  if (body.id && body.name !== undefined && !row.name) {
    return NextResponse.json({ error: 'Name cannot be blank' }, { status: 400 })
  }
  if (row.cards_in_loop != null && ((row.cards_in_loop as number) < 1 || (row.cards_in_loop as number) > 20)) {
    return NextResponse.json({ error: 'Cards in the loop must be 1 to 20' }, { status: 400 })
  }

  if (body.price !== undefined) {
    if (body.id) {
      const { data: prev } = await supabaseAdmin.from('kanban_items').select('price').eq('id', body.id).maybeSingle()
      if (prev && Number(prev.price ?? NaN) !== Number(row.price ?? NaN)) row.price_updated_at = now
    } else if (row.price != null) {
      row.price_updated_at = now
    }
  }

  const q = body.id
    ? supabaseAdmin.from('kanban_items').update(row).eq('id', body.id)
    : supabaseAdmin.from('kanban_items').insert(row)
  const { data, error } = await q.select().single()
  if (error) {
    const msg = /duplicate key/.test(error.message) ? 'There is already a card with that name' : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json(data)
}

// DELETE /api/kanban/items?id= — retires the card. Printed cards on the shelf
// outlive this; their scan page says the card is retired.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('kanban_items').update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
