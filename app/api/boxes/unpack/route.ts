export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

// Produced-box serial off a printed box label: CMC + YYMMDD + 4 random chars.
// Distinct from the inbound receiving identifier CMC-YYYYMMDD-NNN (dashes).
const SERIAL_RE = /^CMC\d{6}[A-Z0-9]{4}$/i

// Unpacking a box for repack.
//
// Scanning a produced box's own serial is the moment the plant says "this box
// is being taken apart". That has to be the moment it stops counting as output,
// because its meat is about to be re-scanned into new boxes — and if the old box
// kept its weight, every downstream total would hold the same meat twice.
//
// So the box is consumed: its weight becomes an INPUT on the session, and the
// box and its scan lines go away. Nothing is duplicated — the weight simply
// moves from the output side of the ledger to the input side, where it belongs
// now that it is raw material again. Repacking it into new boxes then reads as
// ~100% yield, which is exactly the reconciliation the operator wants: pack out
// less than you unpacked and the yield says so.
//
// GET  ?serial=…  peek at a box without consuming it (used to open a session on
//                 the right customer before the first box is unpacked)
// POST { serial, session:{customer_name, session_date} }  consume it

async function findBox(serial: string) {
  const { data, error } = await supabase
    .from('boxes')
    .select('id, customer_name, pack_date, box_number, is_closed, total_weight_lbs, total_cuts, serial_number, picked_up_at, delivery_id, box_label')
    .ilike('serial_number', serial)
    .limit(2)
  if (error) return { error: error.message as string }
  if (!data || data.length === 0) return { error: 'No box carries that serial.' }
  // serial_number has no unique index, so a collision is possible rather than
  // impossible — say so instead of silently unpacking an arbitrary one.
  if (data.length > 1) return { error: 'More than one box carries that serial — unpack it from the box tab instead.' }
  return { box: data[0] }
}

export async function GET(req: NextRequest) {
  const serial = (req.nextUrl.searchParams.get('serial') ?? '').trim()
  if (!SERIAL_RE.test(serial)) {
    return NextResponse.json({ error: 'not a produced-box serial' }, { status: 400 })
  }
  const found = await findBox(serial)
  if (found.error) return NextResponse.json({ error: found.error }, { status: 404 })
  return NextResponse.json(found.box)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { serial, session } = body as {
    serial?: string
    session?: { customer_name?: string; session_date?: string }
  }
  const code = (serial ?? '').trim()
  if (!SERIAL_RE.test(code)) {
    return NextResponse.json({ error: 'not a produced-box serial' }, { status: 400 })
  }
  if (!session?.customer_name || !session?.session_date) {
    return NextResponse.json({ error: 'session {customer_name, session_date} required' }, { status: 400 })
  }

  const found = await findBox(code)
  if (found.error) return NextResponse.json({ error: found.error }, { status: 404 })
  const box = found.box!

  // A box that has left the building is not ours to take apart any more.
  if (box.picked_up_at) {
    return NextResponse.json({ error: `Box ${box.box_number} was already picked up — it can't be unpacked.` }, { status: 409 })
  }
  if (box.delivery_id) {
    return NextResponse.json({ error: `Box ${box.box_number} is loaded on a delivery — pull it off the load first.` }, { status: 409 })
  }

  // Weigh it from its own scan lines, not the cached header: the header is a
  // snapshot taken at close time and the lines are the truth.
  const { data: lines, error: lErr } = await supabase
    .from('box_scans')
    .select('id, weight_lbs, item_name')
    .eq('box_id', box.id)
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })

  const weight = Math.round((lines ?? []).reduce((s, l) => s + (Number(l.weight_lbs) || 0), 0) * 100) / 100
  const cuts   = (lines ?? []).length
  if (cuts === 0) {
    return NextResponse.json({ error: `Box ${box.box_number} is empty — nothing to unpack.` }, { status: 400 })
  }

  const fromOther = box.customer_name !== session.customer_name || box.pack_date !== session.session_date
  const label = `Repack — Box ${box.box_number}${fromOther ? ` (${box.customer_name} ${box.pack_date})` : ''}`

  // The input row is the audit trail: it keeps the old serial and weight after
  // the box row itself is gone.
  const { data: input, error: iErr } = await supabase
    .from('processing_inputs')
    .insert([{
      customer_name:  session.customer_name,
      session_date:   session.session_date,
      pack_date:      session.session_date,
      description:    label,
      weight_lbs:     weight,
      input_type:     'raw',
      source_type:    'repacked_box',
      box_identifier: box.serial_number,
      notes:          `Unpacked ${cuts} cut${cuts !== 1 ? 's' : ''} for repack on ${isoDate()}`,
    }])
    .select()
    .single()
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })

  // Now retire the old box. Its weight lives on as the input above, so deleting
  // it is what keeps the meat counted exactly once.
  const { error: dsErr } = await supabase.from('box_scans').delete().eq('box_id', box.id)
  if (dsErr) return NextResponse.json({ error: dsErr.message }, { status: 500 })
  const { error: dbErr } = await supabase.from('boxes').delete().eq('id', box.id)
  if (dbErr) return NextResponse.json({ error: dbErr.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    input,
    consumed: {
      box_id:        box.id,
      box_number:    box.box_number,
      customer_name: box.customer_name,
      pack_date:     box.pack_date,
      serial_number: box.serial_number,
      weight_lbs:    weight,
      cuts,
      from_other_session: fromOther,
    },
  })
}
