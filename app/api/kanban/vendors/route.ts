import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { VENDOR_FIELDS, DAYS, ORDER_METHODS } from '@/lib/kanban'

export const dynamic = 'force-dynamic'

const NUMBERS = new Set(['lead_days', 'min_order', 'free_freight_at'])
const DAY_LISTS = new Set(['order_days', 'delivery_days'])

// POST /api/kanban/vendors — create (no id) or update one vendor.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const who = typeof body.updated_by === 'string' ? body.updated_by.trim() : ''
  if (!who) return NextResponse.json({ error: 'Your name is required to save' }, { status: 400 })

  const row: Record<string, unknown> = { updated_by: who, updated_at: new Date().toISOString() }
  for (const f of VENDOR_FIELDS) {
    if (body[f] === undefined) continue
    const v = body[f]
    if (NUMBERS.has(f)) {
      const n = v === '' || v == null ? null : Number(v)
      if (n != null && (!Number.isFinite(n) || n < 0)) {
        return NextResponse.json({ error: `${f.replace(/_/g, ' ')} must be a number` }, { status: 400 })
      }
      row[f] = n
    } else if (DAY_LISTS.has(f)) {
      row[f] = Array.isArray(v) ? v.filter((d: unknown) => (DAYS as readonly unknown[]).includes(d)) : []
    } else if (f === 'order_method') {
      if (!(ORDER_METHODS as readonly unknown[]).includes(v)) {
        return NextResponse.json({ error: 'Unknown order method' }, { status: 400 })
      }
      row[f] = v
    } else if (f === 'active') {
      row[f] = v === true
    } else {
      row[f] = typeof v === 'string' ? (v.trim() || null) : v
    }
  }
  if (!body.id && !row.name) return NextResponse.json({ error: 'Vendor name required' }, { status: 400 })
  if (body.id && body.name !== undefined && !row.name) {
    return NextResponse.json({ error: 'Vendor name cannot be blank' }, { status: 400 })
  }

  const q = body.id
    ? supabaseAdmin.from('kanban_vendors').update(row).eq('id', body.id)
    : supabaseAdmin.from('kanban_vendors').insert(row)
  const { data, error } = await q.select().single()
  if (error) {
    const msg = /duplicate key/.test(error.message) ? 'A vendor with that name already exists' : error.message
    return NextResponse.json({ error: msg }, { status: 400 })
  }
  return NextResponse.json(data)
}

// DELETE /api/kanban/vendors?id= — retires, never deletes: old signals keep
// pointing at who we bought from.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await supabaseAdmin
    .from('kanban_vendors').update({ active: false, updated_at: new Date().toISOString() })
    .eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
