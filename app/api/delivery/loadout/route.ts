export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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

// GET /api/delivery/loadout?serial=CMC260724373E
// Resolves one scanned box label to its box and the session it belongs to, so
// the floor sees "Ben Herzog · box 2 of 3" the instant the gun beeps.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const serial = (searchParams.get('serial') ?? '').trim().toUpperCase()

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

  const b       = box as BoxRow
  const siblings = await sessionBoxes(b.customer_name, b.pack_date)
  const { data: session } = await supabase
    .from('processing_sessions')
    .select('status')
    .eq('customer_name', b.customer_name)
    .eq('session_date', b.pack_date)
    .maybeSingle()

  return NextResponse.json({
    box: b,
    session: {
      customer_name: b.customer_name,
      session_date:  b.pack_date,
      status:        session?.status ?? 'scanning',
      box_count:     siblings.length,
      boxes: siblings.map(s => ({
        id: s.id, serial_number: s.serial_number, box_number: s.box_number,
        is_closed: s.is_closed, total_weight_lbs: Number(s.total_weight_lbs) || 0,
        picked_up_at: s.picked_up_at,
      })),
    },
  })
}

// POST /api/delivery/loadout — the customer drove off with these boxes.
// Body: { released_by, customer?, notes?, serials: string[], picked_up_at? }
//
// Stamps each box, logs one delivery_scans row so the run shows in the Delivery
// Log like any other, and closes out a session only once every box it holds has
// left. A partial pickup leaves the session open — the rest is still in the freezer.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const releasedBy: string = (body.released_by ?? body.driver ?? '').trim()
  const notes: string      = body.notes ?? ''
  const pickedUpAt: string = body.picked_up_at ?? new Date().toISOString()

  const serials: string[] = [...new Set(
    (Array.isArray(body.serials) ? body.serials : [])
      .map((s: unknown) => String(s ?? '').trim().toUpperCase())
      .filter((s: string) => s.length > 0)
  )] as string[]

  if (!releasedBy) return NextResponse.json({ error: 'released_by required' }, { status: 400 })
  if (!serials.length) return NextResponse.json({ error: 'no boxes scanned' }, { status: 400 })

  const { data: boxRows, error: bErr } = await supabase
    .from('boxes')
    .select(BOX_COLS)
    .in('serial_number', serials)
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

  const boxes = (boxRows ?? []) as BoxRow[]
  const found = new Set(boxes.map(b => (b.serial_number ?? '').toUpperCase()))
  const unknown = serials.filter(s => !found.has(s))
  if (!boxes.length) {
    return NextResponse.json({ error: 'none of those serials match a box', unknown }, { status: 404 })
  }

  const customer: string = (body.customer ?? '').trim()
    || [...new Set(boxes.map(b => b.customer_name))].join(' / ')

  // 1. Log the run first — if a stamp below fails the pickup is still on record.
  const { data: delivery, error: dErr } = await supabase
    .from('delivery_scans')
    .insert([{
      delivered_at: pickedUpAt,
      driver:       releasedBy,
      customer,
      barcodes:     boxes.map(b => ({ barcode: b.serial_number ?? '', scannedAt: pickedUpAt })),
      notes,
      status:       'pending',
      destination:  'customer',
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
        .update({ status: 'picked_up', updated_at: new Date().toISOString() })
        .eq('customer_name', s.customer_name)
        .eq('session_date', s.pack_date)
      sessionsClosed.push({ customer_name: s.customer_name, session_date: s.pack_date })
    } else {
      sessionsPartial.push({ customer_name: s.customer_name, session_date: s.pack_date, remaining })
    }
  }

  return NextResponse.json({
    delivery,
    boxes_picked_up: toStamp.length,
    already_gone:    boxes.length - toStamp.length,
    unknown,
    sessions_closed:  sessionsClosed,
    sessions_partial: sessionsPartial,
  })
}
