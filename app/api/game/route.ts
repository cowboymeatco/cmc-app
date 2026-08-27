export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { gameCharges, chargeTotal } from '@/lib/gameBilling'
import { loadRates } from '@/lib/gameRates'
import { isoDate } from '@/lib/dates'
import { seasonFor, type GameIntake, type GameOutput } from '@/lib/types'

export const dynamic = 'force-dynamic'

const ACTIVE: string[] = ['receiving', 'processing', 'value_add', 'freezer']

// GET /api/game
//   ?status=cutting          one status
//   ?active=1                everything still in the building (the board default)
//   ?season=2026
//   ?tag=WG-26-0014          one animal by claim number, or null
//   ?q=smith                 hunter name / tag / licence search
//   ?count=1                 just the active count, for the dashboard tile
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const tag = searchParams.get('tag')
  if (tag) {
    const { data, error } = await supabase
      .from('game_intakes').select('*').ilike('tag_number', tag).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (searchParams.get('count') === '1') {
    const { count, error } = await supabase
      .from('game_intakes').select('id', { count: 'exact', head: true }).in('status', ACTIVE)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ count: count ?? 0 })
  }

  let q = supabase.from('game_intakes').select('*').order('received_at', { ascending: false })

  const status = searchParams.get('status')
  if (status) q = q.eq('status', status)
  else if (searchParams.get('active') === '1') q = q.in('status', ACTIVE)

  const season = searchParams.get('season')
  if (season) q = q.eq('season', season)

  const search = searchParams.get('q')?.trim()
  if (search) {
    const like = `%${search}%`
    q = q.or(`hunter_name.ilike.${like},tag_number.ilike.${like},license_tag_no.ilike.${like},hunter_phone.ilike.${like}`)
  }

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const intakes = (data ?? []) as GameIntake[]
  if (!intakes.length) return NextResponse.json([])

  // One query for every animal's weighed output rather than one per animal —
  // in November this list is a couple of hundred rows and the board reloads
  // every time somebody flips a status.
  const ids = intakes.map(i => i.id)
  const [{ data: outputs }, { data: additions }, rates] = await Promise.all([
    supabase.from('game_outputs').select('*').in('intake_id', ids),
    supabase.from('game_additions').select('*').in('intake_id', ids),
    loadRates(),
  ])

  const outByIntake = new Map<string, GameOutput[]>()
  for (const o of (outputs ?? []) as GameOutput[]) {
    const list = outByIntake.get(o.intake_id) ?? []
    list.push(o)
    outByIntake.set(o.intake_id, list)
  }
  const addByIntake = new Map<string, { kind: string; weight_lbs: number; rate: number }[]>()
  for (const a of (additions ?? []) as { intake_id: string; kind: string; weight_lbs: number; rate: number }[]) {
    const list = addByIntake.get(a.intake_id) ?? []
    list.push(a)
    addByIntake.set(a.intake_id, list)
  }

  const withTotals = intakes.map(intake => {
    const outs = outByIntake.get(intake.id) ?? []
    const adds = addByIntake.get(intake.id) ?? []
    return {
      ...intake,
      output_lbs:   Math.round(outs.reduce((s, o) => s + Number(o.weight_lbs ?? 0), 0) * 10) / 10,
      charge_total: chargeTotal(gameCharges(intake, outs, adds, rates)),
    }
  })

  return NextResponse.json(withTotals)
}

// POST /api/game — tag an animal in at the drop-off window.
//
// The claim number is allocated by the database, not here: two people at the
// window on a Saturday in November would otherwise read the same last number
// off the board and hand out WG-26-0087 twice.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    hunter_name, hunter_phone, hunter_email, customer_id,
    species, sex, license_tag_no, hunting_district, harvest_date,
    condition, received_by, weight_in_lbs, roast_lbs, trim_lbs,
    cape_requested, antlers_returned, hide_returned, cleaning_hours,
    storage_location, cut_sheet, notes,
    base_material, finished_product,
  } = body as Record<string, unknown>

  if (!hunter_name || !String(hunter_name).trim()) {
    return NextResponse.json({ error: 'hunter_name required' }, { status: 400 })
  }
  if (!species) return NextResponse.json({ error: 'species required' }, { status: 400 })

  const season = seasonFor(isoDate())
  const { data: tagNumber, error: tagError } = await supabase.rpc('next_game_tag', { p_season: season })
  if (tagError) return NextResponse.json({ error: tagError.message }, { status: 500 })

  const { data, error } = await supabase
    .from('game_intakes')
    .insert([{
      tag_number:       tagNumber,
      season,
      hunter_name:      String(hunter_name).trim(),
      hunter_phone:     String(hunter_phone ?? ''),
      hunter_email:     String(hunter_email ?? ''),
      customer_id:      customer_id || null,
      species,
      sex:              String(sex ?? ''),
      license_tag_no:   String(license_tag_no ?? ''),
      hunting_district: String(hunting_district ?? ''),
      harvest_date:     harvest_date || null,
      condition:        condition || 'Quartered',
      received_by:      String(received_by ?? ''),
      weight_in_lbs:    weight_in_lbs ?? null,
      roast_lbs:        roast_lbs ?? null,
      trim_lbs:         trim_lbs ?? null,
      cape_requested:   !!cape_requested,
      antlers_returned: !!antlers_returned,
      hide_returned:    !!hide_returned,
      // Hours against the $60/hr cleaning fee, per the slip. Kept in step with
      // the legacy boolean so anything still reading it stays truthful.
      cleaning_hours:   cleaning_hours == null || cleaning_hours === '' ? null : Number(cleaning_hours),
      cleaning_fee:     Number(cleaning_hours ?? 0) > 0,
      base_material:    String(base_material ?? ''),
      finished_product: String(finished_product ?? ''),
      storage_location: String(storage_location ?? ''),
      cut_sheet:        cut_sheet ?? {},
      notes:            String(notes ?? ''),
    }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('game_events').insert([{
    intake_id: data.id, event: 'status',
    detail: `Received — ${data.condition}${data.weight_in_lbs ? `, ${data.weight_in_lbs} lbs` : ''}`,
    actor: String(received_by ?? ''),
  }])

  return NextResponse.json(data)
}

// Status flips that stamp a time. Everything else is a plain field edit.
// Reaching the freezer IS the animal being ready — there is no separate ready
// state, because "in the freezer" and "done" are the same fact.
const STATUS_STAMP: Record<string, string> = {
  freezer:   'ready_at',
  picked_up: 'picked_up_at',
}

// PATCH /api/game — status flips and field edits. Every status change writes a
// game_events row, because a single status column forgets the moment it moves
// and a hunter will ask when their animal went in the smokehouse.
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, actor, ...fields } = body as Record<string, unknown> & { id?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: before } = await supabase
    .from('game_intakes').select('status').eq('id', id).maybeSingle()

  const ALLOWED = new Set([
    'hunter_name', 'hunter_phone', 'hunter_email', 'customer_id', 'qbo_customer_id',
    'species', 'sex', 'license_tag_no', 'hunting_district', 'harvest_date',
    'condition', 'received_by', 'weight_in_lbs', 'roast_lbs', 'trim_lbs',
    'cape_requested', 'antlers_returned', 'hide_returned', 'cleaning_hours',
    'base_material', 'finished_product', 'boxes_out',
    'storage_location', 'status', 'cut_sheet', 'notes', 'picked_up_by', 'notified_at',
  ])
  const updates: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(fields)) if (ALLOWED.has(k)) updates[k] = v

  // The boolean is legacy; keep it agreeing with the hours so nothing reading
  // the old column ever contradicts the ticket.
  if ('cleaning_hours' in updates) {
    updates.cleaning_hours = updates.cleaning_hours == null || updates.cleaning_hours === ''
      ? null : Number(updates.cleaning_hours)
    updates.cleaning_fee = Number(updates.cleaning_hours ?? 0) > 0
  }

  if (typeof updates.status === 'string') {
    const stamp = STATUS_STAMP[updates.status]
    if (stamp) updates[stamp] = new Date().toISOString()
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('game_intakes').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (typeof updates.status === 'string' && before && before.status !== updates.status) {
    await supabase.from('game_events').insert([{
      intake_id: id, event: 'status',
      detail: `${before.status} → ${updates.status}`,
      actor: String(actor ?? ''),
    }])
  }
  if (updates.notified_at) {
    await supabase.from('game_events').insert([{
      intake_id: id, event: 'notified', detail: 'Hunter told it was ready', actor: String(actor ?? ''),
    }])
  }

  return NextResponse.json(data)
}

// DELETE /api/game?id=... — a mis-keyed intake. Real animals that never get
// collected flip to 'abandoned' instead, so the season count stays honest.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('game_intakes').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
