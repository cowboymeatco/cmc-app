export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { resolveCarcasses, markCarcassesDelivered } from '@/lib/carcassDelivery'

export const dynamic = 'force-dynamic'

// A packed box's printed serial — CMC + YYMMDD + 4 alnum (Code 39 on the label).
// Distinct from the CMC-YYYYMMDD-NNN identifier receiving puts on inbound product.
const SERIAL_RE = /^CMC\d{6}[A-Z0-9]{4}$/i

interface BoxRow {
  id: string
  serial_number: string | null
  customer_name: string
  pack_date: string
  box_number: number
  is_closed: boolean
  total_weight_lbs: number | null
  total_cuts: number | null
  box_label: string | null
  picked_up_at: string | null
  picked_up_by: string | null
}

const BOX_COLS = 'id, serial_number, customer_name, pack_date, box_number, is_closed, total_weight_lbs, total_cuts, box_label, picked_up_at, picked_up_by'

// Every box packed for one customer on one day — the session the scan belongs to.
async function sessionBoxes(customer_name: string, pack_date: string) {
  const { data } = await supabase
    .from('boxes')
    .select(BOX_COLS)
    .eq('customer_name', customer_name)
    .eq('pack_date', pack_date)
    .order('box_number', { ascending: true })
  return (data ?? []) as BoxRow[]
}

// The order as Load Out draws it — every box, with what's already gone.
async function sessionPayload(customer_name: string, session_date: string) {
  const siblings = await sessionBoxes(customer_name, session_date)
  const { data: session } = await supabase
    .from('processing_sessions')
    .select('status')
    .eq('customer_name', customer_name)
    .eq('session_date', session_date)
    .maybeSingle()
  return {
    customer_name,
    session_date,
    status:    session?.status ?? 'scanning',
    box_count: siblings.length,
    boxes: siblings.map(s => ({
      id: s.id, serial_number: s.serial_number, box_number: s.box_number,
      is_closed: s.is_closed, total_weight_lbs: Number(s.total_weight_lbs) || 0,
      picked_up_at: s.picked_up_at,
    })),
  }
}

// GET /api/delivery/loadout?serial=CMC260724373E
// Resolves one scanned box label to its box and the session it belongs to, so
// the floor sees "Ben Herzog · box 2 of 3" the instant the gun beeps.
// GET /api/delivery/loadout?customer=<name>&date=YYYY-MM-DD
// The same order card without a scan — for boxes that haven't had their big
// label put on yet, which get checked onto the load by hand (Charlie, 2026-09-23).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const serial = (searchParams.get('serial') ?? '').trim().toUpperCase()

  // GET ?freezer=1 — every order with a box not yet picked up, for the
  // "no box label yet" search. Read from a grouped view: the boxes themselves
  // are well past PostgREST's 1,000-row cap.
  if (searchParams.get('freezer')) {
    const { data, error } = await supabase
      .from('v_freezer_orders')
      .select('customer_name, session_date, box_count, total_weight')
      .order('session_date', { ascending: false })
      .limit(2000)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json((data ?? []).map(r => ({ ...r, status: 'in_freezer', total_weight: Number(r.total_weight) || 0 })))
  }

  const byName = (searchParams.get('customer') ?? '').trim()
  const byDate = (searchParams.get('date') ?? '').trim()
  if (!serial && byName && byDate) {
    const session = await sessionPayload(byName, byDate)
    if (!session.box_count) return NextResponse.json({ error: 'no boxes for that order' }, { status: 404 })
    return NextResponse.json({ session })
  }

  if (!serial) return NextResponse.json({ error: 'serial required' }, { status: 400 })
  if (!SERIAL_RE.test(serial)) {
    return NextResponse.json({ error: 'not_a_box_label', serial }, { status: 422 })
  }

  const { data: box, error } = await supabase
    .from('boxes')
    .select(BOX_COLS)
    .ilike('serial_number', serial)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!box)  return NextResponse.json({ error: 'box_not_found', serial }, { status: 404 })

  const b = box as BoxRow
  return NextResponse.json({ box: b, session: await sessionPayload(b.customer_name, b.pack_date) })
}

// POST /api/delivery/loadout — the customer drove off with these boxes.
// Body: { released_by, customer?, notes?, serials: string[], carcass_codes?: string[], picked_up_at? }
//
// Stamps each box, logs one delivery_scans row so the run shows in the Delivery
// Log like any other, and closes out a session only once every box it holds has
// left. A partial pickup leaves the session open — the rest is still in the freezer.
//
// A load can also carry hanging carcasses (Charlie, 2026-09-11) — scanned by
// carcass tag, with no boxes and no session behind them. They ride in the same
// barcode manifest, carrying the status they were pulled out of so a later pull
// off the load can put them back on the rail.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const releasedBy: string = (body.released_by ?? body.driver ?? '').trim()
  // A semi run can drop orders at Baker Transfer & Storage rather than hand
  // them to the customer (Charlie, 2026-09-24): same stamps, but a finished
  // order parks at baker_storage instead of picked_up.
  const destination = body.destination === 'baker_storage' ? 'baker_storage' : 'customer'
  const notes: string      = body.notes ?? ''
  const pickedUpAt: string = body.picked_up_at ?? new Date().toISOString()

  const serials: string[] = [...new Set(
    (Array.isArray(body.serials) ? body.serials : [])
      .map((s: unknown) => String(s ?? '').trim().toUpperCase())
      .filter((s: string) => s.length > 0)
  )] as string[]

  const carcassCodes: string[] = [...new Set(
    (Array.isArray(body.carcass_codes) ? body.carcass_codes : [])
      .map((s: unknown) => String(s ?? '').trim().toUpperCase())
      .filter((s: string) => s.length > 0)
  )] as string[]

  if (!releasedBy) return NextResponse.json({ error: 'released_by required' }, { status: 400 })
  if (!serials.length && !carcassCodes.length) {
    return NextResponse.json({ error: 'nothing scanned' }, { status: 400 })
  }

  let boxes: BoxRow[] = []
  let unknown: string[] = []
  if (serials.length) {
    const { data: boxRows, error: bErr } = await supabase
      .from('boxes')
      .select(BOX_COLS)
      .in('serial_number', serials)
    if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

    boxes = (boxRows ?? []) as BoxRow[]
    const found = new Set(boxes.map(b => (b.serial_number ?? '').toUpperCase()))
    unknown = serials.filter(s => !found.has(s))
    if (!boxes.length && !carcassCodes.length) {
      return NextResponse.json({ error: 'none of those serials match a box', unknown }, { status: 404 })
    }
  }

  const carcasses = carcassCodes.length ? await resolveCarcasses(carcassCodes) : []
  const knownCarcasses = carcasses.filter(c => c.harvest_log_id)
  unknown = unknown.concat(carcasses.filter(c => !c.harvest_log_id).map(c => c.code))

  const customer: string = (body.customer ?? '').trim()
    || [...new Set([
      ...boxes.map(b => b.customer_name),
      ...knownCarcasses.map(c => c.owner ?? c.producer ?? '').filter(Boolean),
    ])].join(' / ')

  // 1. Log the run first — if a stamp below fails the pickup is still on record.
  const { data: delivery, error: dErr } = await supabase
    .from('delivery_scans')
    .insert([{
      delivered_at: pickedUpAt,
      driver:       releasedBy,
      customer,
      barcodes: [
        ...boxes.map(b => ({ barcode: b.serial_number ?? '', scannedAt: pickedUpAt })),
        // prev_status is what the rail said before the truck left with it, so
        // pulling the carcass back off this load restores it exactly.
        ...knownCarcasses.map(c => ({ barcode: c.code, scannedAt: pickedUpAt, prev_status: c.status })),
      ],
      notes,
      status:       'pending',
      destination,
      session_refs: [...new Map(
        boxes.map(b => [`${b.customer_name}|${b.pack_date}`, { customer_name: b.customer_name, session_date: b.pack_date }])
      ).values()],
    }])
    .select()
    .single()
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })

  // 2. Stamp the boxes that went out the door. Already-stamped boxes keep their
  //    original pickup — rescanning one is a no-op, not a rewrite of history.
  const toStamp = boxes.filter(b => !b.picked_up_at).map(b => b.id)
  if (toStamp.length) {
    await supabase
      .from('boxes')
      .update({ picked_up_at: pickedUpAt, picked_up_by: releasedBy, delivery_id: delivery.id })
      .in('id', toStamp)
  }

  // 3. A session is picked up only when nothing of it is left in the freezer.
  const sessionKeys = [...new Map(boxes.map(b => [`${b.customer_name}|${b.pack_date}`, b])).values()]
  const sessionsClosed: { customer_name: string; session_date: string }[] = []
  const sessionsPartial: { customer_name: string; session_date: string; remaining: number }[] = []

  for (const s of sessionKeys) {
    const all = await sessionBoxes(s.customer_name, s.pack_date)
    const remaining = all.filter(b => !b.picked_up_at && !toStamp.includes(b.id)).length
    if (remaining === 0) {
      await supabase
        .from('processing_sessions')
        .update({ status: destination === 'baker_storage' ? 'baker_storage' : 'picked_up', updated_at: new Date().toISOString() })
        .eq('customer_name', s.customer_name)
        .eq('session_date', s.pack_date)
      sessionsClosed.push({ customer_name: s.customer_name, session_date: s.pack_date })
    } else {
      sessionsPartial.push({ customer_name: s.customer_name, session_date: s.pack_date, remaining })
    }
  }

  // 4. Carcasses that went out are off the rail.
  const carcassesDelivered = await markCarcassesDelivered(
    knownCarcasses.map(c => c.harvest_log_id as string),
  )

  return NextResponse.json({
    delivery,
    boxes_picked_up: toStamp.length,
    already_gone:    boxes.length - toStamp.length,
    carcasses:       knownCarcasses,
    carcasses_delivered: carcassesDelivered,
    unknown,
    sessions_closed:  sessionsClosed,
    sessions_partial: sessionsPartial,
  })
}
