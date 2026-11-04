import { NextRequest, NextResponse } from 'next/server'
// Service role: share_orders is staff data under RLS with no anon policy
// (scripts/2026-11-04_share_orders.sql). The public /buy form posts here and
// this route is the only thing that writes the table. Server-side only.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  SHARE_STATUSES, isShareSpecies, isSharePortion, monthToISO,
  type ShareOrder, type ShareSource, type ShareStatus,
} from '@/lib/shares'
import { enrichOrders, ensureCustomer, loadPrices } from '@/lib/sharesServer'

// Whole / half / quarter orders on our own animals.
//
// GET  /api/shares               open orders (everything but picked up and
//                                cancelled), newest first, with the kill day,
//                                hanging weight, cut card and invoice read
//                                off the booking each one is scheduled on
// GET  /api/shares?all=1         ...plus picked up and cancelled, last 180 days
// GET  /api/shares?count=1       the dashboard tile: orders nobody has placed
//                                on a kill date yet
// POST /api/shares               take an order (the desk, or the public form)
// PATCH /api/shares              edit fields, or move it along:
//        { id, action: 'confirm' | 'ready' | 'picked_up' | 'cancel' | 'reopen', ...fields }

const SOURCES: ShareSource[] = ['web', 'phone', 'walk_in', 'email', 'text']
const OPEN: ShareStatus[] = ['requested', 'confirmed', 'scheduled', 'ready']
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s || null
}

export async function GET(req: NextRequest) {
  try {
    const p = req.nextUrl.searchParams
    if (p.get('count')) {
      const { count, error } = await supabaseAdmin
        .from('share_orders').select('id', { count: 'exact', head: true })
        .in('status', ['requested', 'confirmed'])
      if (error) throw new Error(error.message)
      return NextResponse.json({ count: count ?? 0 })
    }
    let q = supabaseAdmin.from('share_orders').select('*').order('created_at', { ascending: false }).limit(1000)
    if (p.get('all')) {
      q = q.or(`status.in.(${OPEN.join(',')}),updated_at.gte.${new Date(Date.now() - 180 * 86_400_000).toISOString()}`)
    } else {
      q = q.in('status', OPEN)
    }
    const { data, error } = await q
    if (error) throw new Error(error.message)
    return NextResponse.json(await enrichOrders((data ?? []) as ShareOrder[]))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// Fields a person may set on an order, validated the same way whether they
// arrive from the desk or the website.
function readFields(body: Record<string, unknown>, species?: string) {
  const out: Record<string, unknown> = {}
  const err: string[] = []
  if ('customer_name' in body) {
    const n = clean(body.customer_name, 200)
    if (!n) err.push('a name is required'); else out.customer_name = n
  }
  if ('phone' in body)            out.phone = clean(body.phone, 40)
  if ('email' in body)            out.email = clean(body.email, 200)
  if ('preferred_contact' in body) {
    const pc = clean(body.preferred_contact, 40)
    out.preferred_contact = pc === 'Text Message' || pc === 'Email' ? pc : 'Phone Call'
  }
  if ('species' in body) {
    if (!isShareSpecies(body.species)) err.push('species must be Beef, Hog or Lamb'); else out.species = body.species
  }
  const sp = (out.species as string | undefined) ?? species
  if ('portion' in body) {
    if (!sp || !isShareSpecies(sp) || !isSharePortion(sp, body.portion)) err.push(`that size is not sold on a ${sp ?? 'share'}`)
    else out.portion = body.portion
  }
  if ('wanted_month' in body)     out.wanted_month = monthToISO(body.wanted_month)
  if ('fulfillment' in body)      out.fulfillment = body.fulfillment === 'delivery' ? 'delivery' : 'pickup'
  if ('delivery_address' in body) out.delivery_address = clean(body.delivery_address, 500)
  if ('notes' in body)            out.notes = clean(body.notes, 4000) ?? ''
  if ('office_notes' in body)     out.office_notes = clean(body.office_notes, 4000) ?? ''
  if ('taken_by' in body)         out.taken_by = clean(body.taken_by, 80)
  if ('price_per_lb' in body) {
    const n = Number(body.price_per_lb)
    if (body.price_per_lb === null || body.price_per_lb === '') out.price_per_lb = null
    else if (!Number.isFinite(n) || n < 0) err.push('price must be a number'); else out.price_per_lb = Math.round(n * 100) / 100
  }
  return { out, err }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('bad JSON')
  const { out, err } = readFields(body)
  if (!out.customer_name) err.push('a name is required')
  if (!out.species)       err.push('pick a species')
  if (!out.portion)       err.push('pick a size')
  if (!out.phone && !out.email) err.push('a phone number or email is required so we can confirm')
  if (err.length) return bad(err.join('; '))

  const source: ShareSource = SOURCES.includes(body.source as ShareSource) ? body.source as ShareSource : 'phone'
  // A buyer wanting two halves is two slots on the schedule, so two rows.
  const qty = Math.max(1, Math.min(8, Math.floor(Number(body.qty)) || 1))
  const customer_id = source === 'web' ? null : await ensureCustomer({
    customer_name: out.customer_name as string, phone: (out.phone as string) ?? null,
    email: (out.email as string) ?? null, preferred_contact: (out.preferred_contact as string) ?? 'Phone Call',
  })

  const rows = Array.from({ length: qty }, () => ({
    ...out,
    source,
    status: 'requested',
    customer_id,
    preferred_contact: out.preferred_contact ?? (out.phone ? 'Phone Call' : 'Email'),
  }))
  const { data, error } = await supabaseAdmin.from('share_orders').insert(rows).select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(await enrichOrders((data ?? []) as ShareOrder[]))
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('bad JSON')
  const id = clean(body.id, 64)
  if (!id) return bad('id required')

  const { data: cur, error: curErr } = await supabaseAdmin.from('share_orders').select('*').eq('id', id).single()
  if (curErr || !cur) return bad('order not found', 404)
  const order = cur as ShareOrder

  const { out, err } = readFields(body, order.species)
  if (err.length) return bad(err.join('; '))
  // A scheduled share's size is the slot on the booking; change it there.
  if (out.portion && out.portion !== order.portion && order.appointment_id) {
    return bad('this share is on the schedule — change the portion on the booking, or take it off the schedule first', 409)
  }

  const action = typeof body.action === 'string' ? body.action : null
  const now = new Date().toISOString()
  if (action === 'confirm') {
    if (!['requested', 'confirmed'].includes(order.status)) return bad(`can't confirm an order that is ${order.status}`, 409)
    // Snapshot the posted price so a later change never reprices this quote.
    if (order.price_per_lb == null && out.price_per_lb == null) {
      const price = (await loadPrices()).find(p => p.species === (out.species ?? order.species) && p.portion === (out.portion ?? order.portion))
      if (price?.price_per_lb == null) return bad(`no price set for a ${order.portion.toLowerCase()} ${order.species.toLowerCase()} — set it under Prices first`, 409)
      out.price_per_lb = price.price_per_lb
      out.qbo_item_id = price.qbo_item_id
      out.qbo_item_name = price.qbo_item_name
    }
    if (!order.customer_id) out.customer_id = await ensureCustomer({ ...order, ...out } as ShareOrder)
    out.status = 'confirmed'
    out.confirmed_at = order.confirmed_at ?? now
  } else if (action === 'ready') {
    if (order.status !== 'scheduled') return bad('a share is ready once it is on the schedule and cut', 409)
    out.status = 'ready'; out.ready_at = now
  } else if (action === 'picked_up') {
    if (!['scheduled', 'ready'].includes(order.status)) return bad(`can't pick up an order that is ${order.status}`, 409)
    out.status = 'picked_up'; out.picked_up_at = now; out.ready_at = order.ready_at ?? now
  } else if (action === 'cancel') {
    if (order.status === 'picked_up') return bad('already picked up', 409)
    if (order.appointment_id) return bad('take it off the schedule first, so the booking slot is freed', 409)
    out.status = 'cancelled'; out.cancelled_at = now; out.cancel_reason = clean(body.cancel_reason, 500)
  } else if (action === 'reopen') {
    if (!['cancelled', 'picked_up', 'ready'].includes(order.status)) return bad(`nothing to reopen on a ${order.status} order`, 409)
    out.status = order.appointment_id ? 'scheduled' : order.confirmed_at ? 'confirmed' : 'requested'
    out.cancelled_at = null; out.cancel_reason = null; out.picked_up_at = null; out.ready_at = null
  } else if (action) {
    return bad(`unknown action ${action}`)
  } else if ('status' in body) {
    if (!SHARE_STATUSES.includes(body.status as ShareStatus)) return bad('bad status')
    return bad('use an action (confirm, ready, picked_up, cancel, reopen) to move an order along')
  }

  if (Object.keys(out).length === 0) return NextResponse.json((await enrichOrders([order]))[0])
  const { data, error } = await supabaseAdmin.from('share_orders').update(out).eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((await enrichOrders([data as ShareOrder]))[0])
}
