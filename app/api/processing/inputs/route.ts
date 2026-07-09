export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'

export const dynamic = 'force-dynamic'

// GET /api/processing/inputs?customer_name=X&pack_date=YYYY-MM-DD
// Returns all inputs for a given scanner session
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const customer_name = searchParams.get('customer_name')
  const pack_date     = searchParams.get('pack_date')
  const session_date  = searchParams.get('session_date')

  let query = supabase
    .from('processing_inputs')
    .select('*')
    .order('created_at', { ascending: true })

  if (customer_name) query = query.eq('customer_name', customer_name)
  if (pack_date)     query = query.eq('pack_date', pack_date)
  if (session_date)  query = query.eq('session_date', session_date)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/processing/inputs
// If box_identifier is provided, auto-fill description/weight from box_receiving_log
export async function POST(req: NextRequest) {
  const body = await req.json()

  let description = body.description ?? ''
  let weight_lbs  = body.weight_lbs  ?? null
  let linked_box_id: string | null = body.linked_box_id ?? null
  let identifier: string | null = body.box_identifier ?? null
  let input_type: string = body.input_type ?? 'raw'
  let linked_harvest_id: string | null = null

  // Keyboard-wedge scanners type wherever the cursor is, so barcodes often
  // arrive in the Description field. If the description IS an identifier
  // (CMC box, CT legacy, or a carcass tag), treat it as a scan.
  const descTrim = typeof description === 'string' ? description.trim() : ''
  if (!identifier && /^(CMC-\d{8}-\d{3}|CT-.+|\d{5,6}-\w+(-[LRlr])?)$/.test(descTrim)) {
    identifier  = descTrim.toUpperCase()
    description = ''
  }

  // If a CMC box identifier was scanned, look up the receiving record
  if (identifier && /^CMC-/.test(identifier) && !description) {
    const { data: box } = await supabase
      .from('box_receiving_log')
      .select('id, product, vendor, weight_lbs')
      .eq('box_identifier', identifier)
      .single()

    if (box) {
      description   = box.vendor ? `${box.product} (${box.vendor})` : box.product
      weight_lbs    = box.weight_lbs
      linked_box_id = box.id
    }
  }

  // Legacy format: CT-{harvest_log_id}
  if (identifier && /^CT-/.test(identifier) && !description) {
    const harvestId = identifier.replace(/^CT-/, '').replace(/-[LR]$/, '')
    const { data: harvest } = await supabase
      .from('harvest_log')
      .select('id, species, carcass_tag, hot_carcass_weight_lbs, producer, appointment_id')
      .eq('id', harvestId)
      .single()

    if (harvest) {
      description = `${harvest.species} Carcass — Tag ${harvest.carcass_tag || 'N/A'}${harvest.producer ? ` (${harvest.producer})` : ''}`
      weight_lbs  = harvest.hot_carcass_weight_lbs
      input_type  = 'carcass'
      linked_harvest_id = harvest.id
    }
  }

  // Carcass half tags: YYMMDD-TAG-SIDE (calendar, e.g. 260514-001-R) or
  // YYDDD-TAG[-SIDE] (Julian, from pre-printed tag sheets, e.g. 26169-06-L).
  // No side suffix = whole carcass (full HCW); with side = half (HCW / 2).
  let harvestDate: string | null = null
  let tag: string | null = null
  let side: string | null = null
  const calMatch = !description && identifier
    ? identifier.match(/^(\d{2})(\d{2})(\d{2})-(\w+)-([LR])$/)
    : null
  const julMatch = !description && identifier && !calMatch
    ? identifier.match(/^(\d{2})(\d{3})-(\w+?)(?:-([LR]))?$/)
    : null
  if (calMatch) {
    harvestDate = `20${calMatch[1]}-${calMatch[2]}-${calMatch[3]}`
    tag  = calMatch[4]
    side = calMatch[5]
  } else if (julMatch) {
    const d = new Date(Date.UTC(2000 + Number(julMatch[1]), 0, Number(julMatch[2])))
    harvestDate = d.toISOString().slice(0, 10)
    tag  = julMatch[3]
    side = julMatch[4] ?? null
  }
  if (harvestDate && tag) {
    const { data: harvest } = await supabase
      .from('harvest_log')
      .select('id, species, carcass_tag, hot_carcass_weight_lbs, producer, appointment_id')
      .eq('harvest_date', harvestDate)
      .eq('carcass_tag', tag)
      .maybeSingle()

    if (harvest) {
      const hcw   = harvest.hot_carcass_weight_lbs != null ? Number(harvest.hot_carcass_weight_lbs) : null
      weight_lbs  = side ? (hcw != null ? hcw / 2 : null) : hcw
      description = `${harvest.species} — Tag ${harvest.carcass_tag}${side ? ` ${side} Half` : ''}${harvest.producer ? ` (${harvest.producer})` : ''}`
      input_type  = 'carcass'
      linked_harvest_id = harvest.id
      if (harvest.appointment_id && !body.linked_appointment_id) {
        body.linked_appointment_id = harvest.appointment_id
      }
    }
  }

  const { data, error } = await supabase
    .from('processing_inputs')
    .insert([{
      session_date:          body.session_date          ?? isoDate(),
      customer_name:         body.customer_name         ?? null,
      pack_date:             body.pack_date             ?? null,
      description,
      weight_lbs,
      input_type,
      source_type:           body.source_type           ?? 'general',
      linked_order_id:       body.linked_order_id       ?? null,
      linked_appointment_id: body.linked_appointment_id ?? null,
      linked_box_id,
      linked_harvest_id,
      box_identifier:        identifier,
      notes:                 body.notes                 ?? null,
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Pull the carcass off the cooler rail once every side is accounted for:
  // a whole-carcass tag pulls immediately; halves pull when both L and R
  // have been scanned (the other half may still be hanging until then).
  let cooler_pulled = false
  if (linked_harvest_id) {
    const { data: siblings } = await supabase
      .from('processing_inputs')
      .select('box_identifier')
      .eq('linked_harvest_id', linked_harvest_id)
    if (allSidesScanned(siblings ?? [])) {
      const { data: pulled } = await supabase
        .from('harvest_log')
        .update({ status: 'cut' })
        .eq('id', linked_harvest_id)
        .eq('status', 'chilling')
        .select('id')
      cooler_pulled = (pulled?.length ?? 0) > 0
    }
  }

  return NextResponse.json({ ...data, cooler_pulled })
}

// True when the scanned inputs cover the whole carcass: any tag without an
// -L/-R suffix counts as both sides.
function allSidesScanned(rows: { box_identifier: string | null }[]): boolean {
  const seen = new Set<string>()
  for (const r of rows) {
    if (!r.box_identifier) continue
    const m = r.box_identifier.match(/-([LR])$/i)
    if (m) seen.add(m[1].toUpperCase())
    else { seen.add('L'); seen.add('R') }
  }
  return seen.has('L') && seen.has('R')
}

// DELETE /api/processing/inputs?id=...
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: row } = await supabase
    .from('processing_inputs')
    .select('id, linked_harvest_id')
    .eq('id', id)
    .maybeSingle()

  const { error } = await supabase
    .from('processing_inputs')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // If this scan is what pulled a carcass off the cooler rail, undoing the
  // scan hangs it back up (only touches status 'cut', never 'complete').
  if (row?.linked_harvest_id) {
    const { data: siblings } = await supabase
      .from('processing_inputs')
      .select('box_identifier')
      .eq('linked_harvest_id', row.linked_harvest_id)
    if (!allSidesScanned(siblings ?? [])) {
      await supabase
        .from('harvest_log')
        .update({ status: 'chilling' })
        .eq('id', row.linked_harvest_id)
        .eq('status', 'cut')
    }
  }

  return NextResponse.json({ ok: true })
}
