export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'
import { seasonFor } from '@/lib/types'

export const dynamic = 'force-dynamic'

// Orders hunters submitted online, before the meat arrived.
//
// Read with the SERVICE ROLE on purpose. game_orders holds hunters' names,
// phone numbers and licence tag numbers, so the public form may insert but the
// anon key cannot read a single row back. Staff reach it through this route.

// GET /api/game/orders?status=pending  ·  ?count=1  ·  ?q=smith
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  if (searchParams.get('count') === '1') {
    const { count, error } = await supabaseAdmin
      .from('game_orders').select('id', { count: 'exact', head: true }).eq('status', 'pending')
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ count: count ?? 0 })
  }

  let q = supabaseAdmin.from('game_orders').select('*').order('created_at', { ascending: false })
  const status = searchParams.get('status') ?? 'pending'
  if (status !== 'all') q = q.eq('status', status)

  const search = searchParams.get('q')?.trim()
  if (search) {
    const like = `%${search}%`
    q = q.or(`hunter_name.ilike.${like},hunter_phone.ilike.${like},license_tag_no.ilike.${like}`)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

// POST /api/game/orders — turn one online order into a real intake.
// { order_id, weight_in_lbs?, received_by?, storage_location?, condition?, cleaning_hours? }
//
// The counter supplies what only the counter can know: the weight off our
// scale, where it went, and how filthy it was. Everything else rides across
// from what the hunter already typed, so nobody re-keys an order at a window
// with a truck idling outside.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    order_id, weight_in_lbs, roast_lbs, trim_lbs,
    received_by, storage_location, condition, cleaning_hours,
  } = body as {
    order_id?: string; weight_in_lbs?: number | null
    roast_lbs?: number | null; trim_lbs?: number | null
    received_by?: string; storage_location?: string
    condition?: string; cleaning_hours?: number | null
  }
  if (!order_id) return NextResponse.json({ error: 'order_id required' }, { status: 400 })

  const { data: order, error: readErr } = await supabaseAdmin
    .from('game_orders').select('*').eq('id', order_id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!order)  return NextResponse.json({ error: 'order not found' }, { status: 404 })
  // Importing twice would hand the same hunter two claim numbers for one cooler.
  if (order.status === 'imported' && order.linked_intake_id) {
    return NextResponse.json(
      { error: 'This order has already been taken in.', linked_intake_id: order.linked_intake_id },
      { status: 409 },
    )
  }

  const season = seasonFor(isoDate())
  const { data: tagNumber, error: tagError } = await supabase.rpc('next_game_tag', { p_season: season })
  if (tagError) return NextResponse.json({ error: tagError.message }, { status: 500 })

  const hours = cleaning_hours == null ? null : Number(cleaning_hours)

  const { data: intake, error } = await supabaseAdmin
    .from('game_intakes')
    .insert([{
      tag_number:       tagNumber,
      season,
      hunter_name:      order.hunter_name,
      hunter_phone:     order.hunter_phone,
      hunter_email:     order.hunter_email,
      species:          order.species || 'Other',
      license_tag_no:   order.license_tag_no,
      hunting_district: order.hunting_district,
      harvest_date:     order.harvest_date,
      base_material:    order.base_material,
      finished_product: order.finished_product,
      condition:        condition || 'Boned Out',
      received_by:      String(received_by ?? ''),
      // The two pools are weighed apart: steaks and jerky can only come off the
      // roasts, so a single total would let a jerky order look filled against a
      // cooler that is all trim. Total falls back to the sum when not given.
      roast_lbs:        roast_lbs ?? null,
      trim_lbs:         trim_lbs ?? null,
      weight_in_lbs:    weight_in_lbs ?? (
        (Number(roast_lbs) || 0) + (Number(trim_lbs) || 0) || null),
      cleaning_hours:   hours,
      cleaning_fee:     Number(hours ?? 0) > 0,
      storage_location: String(storage_location ?? ''),
      cut_sheet:        order.cut_sheet ?? {},
      notes:            order.notes,
    }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabaseAdmin.from('game_orders')
    .update({ status: 'imported', linked_intake_id: intake.id, imported_at: new Date().toISOString() })
    .eq('id', order_id)

  await supabaseAdmin.from('game_events').insert([{
    intake_id: intake.id, event: 'status',
    detail: `Received from online order — ${intake.condition}${intake.weight_in_lbs ? `, ${intake.weight_in_lbs} lbs` : ''}`,
    actor: String(received_by ?? ''),
  }])

  return NextResponse.json(intake)
}

// PATCH /api/game/orders — archive one that never turned up.
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, status } = body as { id?: string; status?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (status !== 'pending' && status !== 'archived') {
    return NextResponse.json({ error: 'status must be pending or archived' }, { status: 400 })
  }
  const { data, error } = await supabaseAdmin
    .from('game_orders').update({ status }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
