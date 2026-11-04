import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate } from '@/lib/dates'
import { PORTION_FRACTION, type ShareOrder } from '@/lib/shares'
import {
  APPT_COLS, OWN_SOURCE, claimedHead, enrichOrders, ensureCustomer, isOwnBooking, loadPrices,
  type ApptRow, type Slot,
} from '@/lib/sharesServer'

// Put a share on a kill date — as a customer slot on one of our own bookings,
// which is the one thing downstream already understands: the cut schedule
// lists the buyer, the carcass gets assigned to them, their cut card links to
// the slot, and the box labels carry their name.
//
// GET  /api/shares/schedule?species=Beef
//        Our upcoming bookings of that species with head still unclaimed.
// POST /api/shares/schedule
//        { id, appointment_id }            onto an existing CMC booking
//        { id, harvest_date: YYYY-MM-DD }  book a new head of ours that day
//        { id, action: 'remove' }          take it back off (slot deleted)
//        force: true                       place it even if the booking is
//                                          then over its head count
//
// The order is confirmed on the way if it still says "requested", so the
// price it was quoted is pinned before anybody cuts anything.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/
const BOOKABLE = new Set(['Tentative', 'Booked', 'Confirmed', 'InstructionsReceived', 'AnimalIn'])
const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

export async function GET(req: NextRequest) {
  try {
    const species = req.nextUrl.searchParams.get('species') ?? 'Beef'
    const { data, error } = await supabaseAdmin
      .from('harvest_appointments')
      .select(APPT_COLS)
      .eq('species', species)
      .gte('harvest_date', isoDate())
      .order('harvest_date', { ascending: true })
      .limit(300)
    if (error) throw new Error(error.message)
    const own = ((data ?? []) as ApptRow[])
      .filter(a => isOwnBooking(a) && BOOKABLE.has(a.status) && !a.kill_only)
      .map(a => {
        const claimed = claimedHead(a.customers)
        return {
          id: a.id, harvest_date: a.harvest_date, species: a.species, status: a.status,
          head_count: Number(a.head_count) || 0, claimed,
          open: Math.max(0, (Number(a.head_count) || 0) - claimed),
          buyers: (a.customers ?? []).filter(s => s.customer_name?.trim()).map(s => `${s.customer_name} (${s.portion})`),
        }
      })
    return NextResponse.json({ bookings: own, source: OWN_SOURCE })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

function slotFor(o: ShareOrder, qboId: string | null): Slot {
  const contact = o.phone?.trim() || o.email?.trim() || ''
  return {
    id: crypto.randomUUID(),
    customer_name: o.customer_name,
    customer_id: o.customer_id,
    portion: o.portion,
    payment_responsibility: 'customer',
    contact_preference: o.preferred_contact || (contact.includes('@') ? 'Email' : 'Phone Call'),
    contact_value: contact,
    linked_cutting_instruction_id: '',
    reminder_last_sent_at: null,
    reminder_count: 0,
    qbo_customer_id: qboId,
    share_order_id: o.id,
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('bad JSON')
  const id = typeof body.id === 'string' ? body.id : ''
  if (!id) return bad('id required')

  const { data: cur, error: curErr } = await supabaseAdmin.from('share_orders').select('*').eq('id', id).single()
  if (curErr || !cur) return bad('order not found', 404)
  const order = cur as ShareOrder
  const now = new Date().toISOString()

  // ── Take it off the schedule ─────────────────────────────────────────────
  if (body.action === 'remove') {
    if (!order.appointment_id) return bad('not on the schedule')
    if (order.billable_event_id) {
      const { data: ev } = await supabaseAdmin.from('billable_events').select('status').eq('id', order.billable_event_id).single()
      if (ev && ev.status !== 'pending' && ev.status !== 'skipped') return bad('this share has been invoiced — settle that in QuickBooks before moving it', 409)
    }
    const { data: appt } = await supabaseAdmin.from('harvest_appointments').select(APPT_COLS).eq('id', order.appointment_id).single()
    if (appt) {
      const a = appt as ApptRow
      const slots = (a.customers ?? []).filter(s => s.id !== order.appointment_customer_id)
      const { error } = await supabaseAdmin.from('harvest_appointments').update({ customers: slots }).eq('id', a.id)
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    }
    const { data, error } = await supabaseAdmin.from('share_orders')
      .update({ appointment_id: null, appointment_customer_id: null, scheduled_at: null, status: order.confirmed_at ? 'confirmed' : 'requested' })
      .eq('id', id).select('*').single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json((await enrichOrders([data as ShareOrder]))[0])
  }

  // ── Put it on ────────────────────────────────────────────────────────────
  if (!['requested', 'confirmed'].includes(order.status)) return bad(`this order is ${order.status.replace('_', ' ')}`, 409)
  if (order.appointment_id) return bad('already on the schedule', 409)

  // Confirm on the way: pin the price and make sure the buyer is a customer record.
  const patch: Record<string, unknown> = {}
  if (order.price_per_lb == null) {
    const price = (await loadPrices()).find(p => p.species === order.species && p.portion === order.portion)
    if (price?.price_per_lb == null) return bad(`no price set for a ${order.portion.toLowerCase()} ${order.species.toLowerCase()} — set it under Prices first`, 409)
    patch.price_per_lb = price.price_per_lb
    patch.qbo_item_id = price.qbo_item_id
    patch.qbo_item_name = price.qbo_item_name
  }
  if (!order.customer_id) {
    order.customer_id = await ensureCustomer(order)
    patch.customer_id = order.customer_id
  }
  // Their QuickBooks customer, if a booking ever linked one.
  let qboId: string | null = null
  if (order.customer_id) {
    const { data: c } = await supabaseAdmin.from('customers').select('qbo_customer_id').eq('id', order.customer_id).single()
    qboId = (c?.qbo_customer_id as string | null) || null
  }
  const slot = slotFor(order, qboId)
  const fraction = PORTION_FRACTION[order.portion]

  let apptId: string
  if (typeof body.appointment_id === 'string' && body.appointment_id) {
    const { data: appt, error } = await supabaseAdmin.from('harvest_appointments').select(APPT_COLS).eq('id', body.appointment_id).single()
    if (error || !appt) return bad('booking not found', 404)
    const a = appt as ApptRow
    if (a.species !== order.species) return bad(`that booking is ${a.species}, this order is ${order.species}`, 409)
    if (!isOwnBooking(a)) return bad('that booking is not one of our own animals', 409)
    const open = (Number(a.head_count) || 0) - claimedHead(a.customers)
    if (fraction > open + 1e-9 && !body.force) {
      return NextResponse.json({ error: `that booking only has ${open} head open and this share needs ${fraction}`, over: true }, { status: 409 })
    }
    // A new booking starts with one blank slot; the share takes that spot
    // rather than leaving an empty line beside it.
    const slots = [...(a.customers ?? [])]
    const blank = slots.findIndex(s => !s.customer_name?.trim() && !s.linked_cutting_instruction_id)
    if (blank >= 0) slots[blank] = slot; else slots.push(slot)
    const { error: upErr } = await supabaseAdmin.from('harvest_appointments').update({ customers: slots }).eq('id', a.id)
    if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
    apptId = a.id
  } else if (typeof body.harvest_date === 'string' && ISO_DAY.test(body.harvest_date)) {
    if (body.harvest_date < isoDate()) return bad('that kill date has gone by')
    const { data: own } = await supabaseAdmin.from('customers').select('id').ilike('name', OWN_SOURCE).limit(1)
    const { data: created, error } = await supabaseAdmin
      .from('harvest_appointments')
      .insert([{
        harvest_date: body.harvest_date,
        receive_date: null,
        species: order.species,
        head_count: 1,
        source: OWN_SOURCE,
        producer_contact: '',
        notes: 'Booked from /shares — our own animal, sold by the share.',
        status: 'Booked',
        linked_carcass_id: '',
        customers: [slot],
        producer_id: own?.[0]?.id ?? null,
        kill_only: false,
      }])
      .select('id').single()
    if (error || !created) return NextResponse.json({ error: error?.message ?? 'could not book' }, { status: 500 })
    apptId = created.id as string
  } else {
    return bad('appointment_id or harvest_date required')
  }

  const { data, error } = await supabaseAdmin.from('share_orders')
    .update({
      ...patch,
      status: 'scheduled',
      confirmed_at: order.confirmed_at ?? now,
      scheduled_at: now,
      appointment_id: apptId,
      appointment_customer_id: slot.id,
    })
    .eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((await enrichOrders([data as ShareOrder]))[0])
}
