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

  // If a CMC box identifier was scanned, look up the receiving record
  if (body.box_identifier && /^CMC-/.test(body.box_identifier) && !description) {
    const { data: box } = await supabase
      .from('box_receiving_log')
      .select('id, product, vendor, weight_lbs')
      .eq('box_identifier', body.box_identifier)
      .single()

    if (box) {
      description   = box.vendor ? `${box.product} (${box.vendor})` : box.product
      weight_lbs    = box.weight_lbs
      linked_box_id = box.id
    }
  }

  // Legacy format: CT-{harvest_log_id}
  if (body.box_identifier && /^CT-/.test(body.box_identifier) && !description) {
    const harvestId = body.box_identifier.replace(/^CT-/, '').replace(/-[LR]$/, '')
    const { data: harvest } = await supabase
      .from('harvest_log')
      .select('id, species, carcass_tag, hot_carcass_weight_lbs, producer, appointment_id')
      .eq('id', harvestId)
      .single()

    if (harvest) {
      description = `${harvest.species} Carcass — Tag ${harvest.carcass_tag || 'N/A'}${harvest.producer ? ` (${harvest.producer})` : ''}`
      weight_lbs  = harvest.hot_carcass_weight_lbs
    }
  }

  // New format: YYMMDD-TAG-SIDE  (e.g. 260514-001-R)
  const shortTagMatch = !description && body.box_identifier
    ? (body.box_identifier as string).match(/^(\d{2})(\d{2})(\d{2})-(\w+)-([LR])$/)
    : null
  if (shortTagMatch) {
    const [, yy, mm, dd, tag, side] = shortTagMatch
    const harvestDate = `20${yy}-${mm}-${dd}`
    const { data: harvest } = await supabase
      .from('harvest_log')
      .select('id, species, carcass_tag, hot_carcass_weight_lbs, producer, appointment_id')
      .eq('harvest_date', harvestDate)
      .eq('carcass_tag', tag)
      .maybeSingle()

    if (harvest) {
      const halfWt = harvest.hot_carcass_weight_lbs != null ? harvest.hot_carcass_weight_lbs / 2 : null
      description = `${harvest.species} — Tag ${harvest.carcass_tag} ${side} Half${harvest.producer ? ` (${harvest.producer})` : ''}`
      weight_lbs  = halfWt
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
      input_type:            body.input_type            ?? 'raw',
      source_type:           body.source_type           ?? 'general',
      linked_order_id:       body.linked_order_id       ?? null,
      linked_appointment_id: body.linked_appointment_id ?? null,
      linked_box_id,
      box_identifier:        body.box_identifier        ?? null,
      notes:                 body.notes                 ?? null,
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/processing/inputs?id=...
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('processing_inputs')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
