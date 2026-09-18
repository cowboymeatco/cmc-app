export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { decodeHobartLabel, BOX_SERIAL_RE } from '@/lib/hobartBarcode'
import { isOwnSession, OWN_SESSION } from '@/lib/ownership'
import { matchingBoxedLine, type CountLine } from '@/lib/inventoryCount'

// Scanned packages inside one count.
//
// GET                                          → every line, newest first (voids included)
// POST  { barcode }                             → one loose package
// POST  { box_serial }                          → PREVIEW a sealed box; writes nothing
// POST  { box_serial, confirm_sealed: true }    → count every package in that box
// PATCH { line_id | box_id, reason, by }        → void one line, or a whole box
//
// Nothing here writes to box_scans. A box_scan means "this package was
// produced"; a counted package was produced weeks ago, and putting counts there
// would double every pound the plant makes. Reading box_scans is fine — that is
// how a box label knows what went into the box.

interface Ctx { params: Promise<{ id: string }> }

export async function GET(_req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const { data, error } = await supabase
    .from('inventory_count_lines')
    .select('*')
    .eq('count_id', id)
    .order('created_at', { ascending: false })
    .limit(5000)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const body = await req.json() as Record<string, string | number | boolean | undefined>

  // A closed count is a finished record. Scanning into one would change a
  // number Jill may already have booked, so it is refused rather than reopened
  // silently.
  const { data: count, error: cErr } = await supabase
    .from('inventory_counts')
    .select('id, status')
    .eq('id', id)
    .maybeSingle()
  if (cErr) return NextResponse.json({ error: cErr.message }, { status: 500 })
  if (!count) return NextResponse.json({ error: 'No such count.' }, { status: 404 })
  if (count.status !== 'open') {
    return NextResponse.json({ error: 'That count is closed. Reopen it to keep scanning.' }, { status: 409 })
  }

  const counted_by = String(body.counted_by ?? '').trim()
  if (body.box_serial) {
    return countBox(id, String(body.box_serial).trim().toUpperCase(), body.confirm_sealed === true, counted_by)
  }
  return countPackage(id, body, counted_by)
}

async function countPackage(countId: string, body: Record<string, unknown>, counted_by: string) {
  const raw = String(body.barcode ?? '').trim()
  let plu_number = String(body.plu_number ?? '').trim()
  let weight_lbs: number | null = body.weight_lbs == null ? null : Number(body.weight_lbs)

  if (raw) {
    const decoded = decodeHobartLabel(raw)
    if (!decoded) return NextResponse.json({ error: `Not a scale label: ${raw}` }, { status: 400 })
    plu_number = decoded.plu
    weight_lbs = decoded.weightLbs
  }
  if (!plu_number) return NextResponse.json({ error: 'plu_number or barcode is required' }, { status: 400 })

  // Name is snapshotted so retiring the PLU later never rewrites this count.
  // A PLU the app has never heard of still counts — the meat is on the shelf
  // either way — it just carries no name, and the page says so.
  const { data: item } = await supabase
    .from('plu_items')
    .select('item_name')
    .eq('plu_number', plu_number)
    .maybeSingle()

  const quantity = Math.max(1, Math.round(Number(body.quantity ?? 1)) || 1)

  const { data, error } = await supabase
    .from('inventory_count_lines')
    .insert({
      count_id: countId,
      plu_number,
      item_name: item?.item_name ?? '',
      weight_lbs,
      quantity,
      barcode: raw,
      counted_by,
    })
    .select('*')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Probably pulled out of a box that was already counted by its label.
  const { data: boxed } = await supabase
    .from('inventory_count_lines')
    .select('*')
    .eq('count_id', countId)
    .eq('plu_number', plu_number)
    .is('voided_at', null)
    .not('box_id', 'is', null)
  const twin = matchingBoxedLine((boxed ?? []) as CountLine[], data as CountLine)

  return NextResponse.json({
    ...data,
    known_plu: Boolean(item),
    possible_duplicate: twin ? { box_serial: twin.box_serial } : null,
  })
}

async function countBox(countId: string, serial: string, confirmed: boolean, counted_by: string) {
  if (!BOX_SERIAL_RE.test(serial)) {
    return NextResponse.json({ error: `Not a box label: ${serial}` }, { status: 400 })
  }

  const { data: box, error: bErr } = await supabase
    .from('boxes')
    .select('id, serial_number, customer_name, pack_date, is_closed, picked_up_at')
    .ilike('serial_number', serial)
    .maybeSingle()
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })
  if (!box) {
    return NextResponse.json({ code: 'unknown_box', error: `No box with label ${serial}. Scan its packages instead.` }, { status: 404 })
  }

  if (box.picked_up_at) {
    return NextResponse.json({
      code: 'picked_up',
      error: `Box ${serial} was marked picked up ${String(box.picked_up_at).slice(0, 10)}. If it is really here, scan its packages.`,
    }, { status: 409 })
  }
  if (!box.is_closed) {
    // Still open on the scanner means somebody may be packing into it — what it
    // holds is not settled yet.
    return NextResponse.json({
      code: 'box_open',
      error: `Box ${serial} is still open on the scanner. Scan its packages instead.`,
    }, { status: 409 })
  }

  // Ours or a producer's: the same rule /exec values by. A box is matched to
  // the session it was packed in; a box whose session cannot be found falls
  // back to its own name, and failing both it is not counted — ownership is
  // never guessed.
  const { data: sessions } = await supabase
    .from('processing_sessions')
    .select('customer_name, cmc')
    .eq('customer_name', box.customer_name)
    .eq('session_date', box.pack_date)
  const own = (sessions ?? []).length > 0
    ? (sessions ?? []).some(isOwnSession)
    : OWN_SESSION.test(box.customer_name ?? '')
  if (!own) {
    return NextResponse.json({
      code: 'not_ours',
      error: `Box ${serial} belongs to ${box.customer_name || 'a producer'} — their meat, not our inventory. Not counted.`,
    }, { status: 409 })
  }

  const { data: already } = await supabase
    .from('inventory_count_lines')
    .select('id')
    .eq('count_id', countId)
    .eq('box_id', box.id)
    .is('voided_at', null)
    .limit(1)
  if ((already ?? []).length > 0) {
    return NextResponse.json({ code: 'already_counted', error: `Box ${serial} is already in this count.` }, { status: 409 })
  }

  const { data: contents, error: sErr } = await supabase
    .from('box_scans')
    .select('plu_number, item_name, weight_lbs, quantity, barcode')
    .eq('box_id', box.id)
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  if (!contents || contents.length === 0) {
    return NextResponse.json({ code: 'empty', error: `Box ${serial} has no packages on record. Scan its packages instead.` }, { status: 409 })
  }

  const packages = contents.reduce((s, c) => s + (Number(c.quantity) || 1), 0)
  const lbs = contents.reduce((s, c) => s + (c.weight_lbs != null ? Number(c.weight_lbs) * (Number(c.quantity) || 1) : 0), 0)
  const summary = {
    serial: box.serial_number,
    customer_name: box.customer_name,
    pack_date: box.pack_date,
    packages,
    lbs,
    plus: new Set(contents.map(c => c.plu_number)).size,
  }

  // The record says what went IN. Whether it is all still there — nobody pulled
  // a few steaks to restock the case — only the person holding the box knows,
  // so nothing is written until they say so.
  if (!confirmed) return NextResponse.json({ needs_confirm: true, box: summary })

  // One insert, so every package from this box shares one timestamp and the
  // labor clock reads the box as a single scan.
  const rows = contents.map(c => ({
    count_id: countId,
    plu_number: String(c.plu_number),
    item_name: c.item_name ?? '',
    weight_lbs: c.weight_lbs == null ? null : Number(c.weight_lbs),
    quantity: Math.max(1, Number(c.quantity) || 1),
    barcode: c.barcode ?? '',
    counted_by,
    box_id: box.id,
    box_serial: box.serial_number,
  }))
  const { data, error } = await supabase.from('inventory_count_lines').insert(rows).select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ box: summary, lines: data })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { id } = await ctx.params
  const body = await req.json() as Record<string, string | undefined>
  const { line_id, box_id } = body
  if (!line_id && !box_id) return NextResponse.json({ error: 'line_id or box_id is required' }, { status: 400 })

  // Void, never delete: the count has to stay reconstructable at any instant,
  // and a row that vanishes takes its timestamp with it.
  let q = supabase
    .from('inventory_count_lines')
    .update({
      voided_at: new Date().toISOString(),
      voided_by: (body.by ?? '').trim(),
      void_reason: (body.reason ?? '').trim(),
    })
    .eq('count_id', id)
    .is('voided_at', null)
  q = box_id ? q.eq('box_id', box_id) : q.eq('id', line_id!)
  const { data, error } = await q.select('*')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data || data.length === 0) return NextResponse.json({ error: 'Already voided.' }, { status: 409 })
  return NextResponse.json(data)
}
