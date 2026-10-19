export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// POST /api/appointments/split
//   { id, to_date: YYYY-MM-DD, head: number, slot_ids?: string[], animal_ids?: string[] }
//
// Move some of a booking's head to another kill day (Jill, 2026-10-14,
// /schedule: "Move one animal from an appointment to the next day's kill").
// Changing harvest_date moves the whole booking; this peels `head` off it into
// a new appointment on `to_date` and leaves the rest where it was.
//
// What rides along:
//   - the customer slots in slot_ids, keeping their ids, so the cut sheets
//     linked to them (trg_sync_cut_sheet_appointment repoints those), the
//     carcass assignments and the cut-schedule rows keyed by slot all follow;
//   - the checked-in animals in animal_ids. Each gets a fresh receiving row on
//     the new appointment and its old row is kept as 'removed' with "Moved to
//     <date>" in its notes, so the carcass number it was holding on the old
//     day stays spent — same rule as a whole-booking roll (Charlie,
//     2026-08-03: tags are printed, nobody slides up onto them);
//   - that many unharvested harvest_log rows (paired by ear tag first), with
//     their harvest_date and appointment moved and their kill order cleared so
//     the new day numbers them itself.
//
// Nothing here runs in one transaction (supabase-js on the edge), so the new
// appointment is written first and deleted again if shrinking the original
// fails; the follow-on repointing is best-effort and reported as warnings.

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/

type Slot = { id: string; [k: string]: unknown }
type Animal = {
  id: string; animal_index: number | null; status: string | null; notes: string | null
  ear_tag: string | null; received_at: string | null; live_weight_lbs: number | null
  received_by: string | null; health_cert_no: string | null; brand_insp_no: string | null
  sex: string | null; breed: string | null; over_30_months: boolean | null; horns: boolean | null
  photo_url: string | null
}
type Log = {
  id: string; ear_tag: string | null; created_at: string | null
  hot_carcass_weight_lbs: number | null; live_weight_lbs: number | null
  part_b_complete: boolean | null; knock_time: string | null; carcass_tag: string | null
}

const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const id        = String(body.id ?? '').trim()
  const toDate    = String(body.to_date ?? '').trim()
  const head      = Math.floor(Number(body.head))
  const slotIds   = Array.isArray(body.slot_ids)   ? (body.slot_ids as unknown[]).map(String)   : []
  const animalIds = Array.isArray(body.animal_ids) ? (body.animal_ids as unknown[]).map(String) : []

  if (!id) return bad('id required')
  if (!ISO_DAY.test(toDate)) return bad('to_date must be YYYY-MM-DD')
  if (!Number.isFinite(head) || head < 1) return bad('head must be at least 1')

  const { data: appt, error: aErr } = await supabaseAdmin
    .from('harvest_appointments')
    .select('*')
    .eq('id', id)
    .single()
  if (aErr || !appt) return bad('appointment not found', 404)

  const total = Number(appt.head_count) || 1
  if (toDate === appt.harvest_date) return bad('That is the day it is already on.')
  if (head >= total) return bad(`This booking is ${total} head. To move all of it, change its harvest date instead.`)

  const customers: Slot[] = Array.isArray(appt.customers) ? appt.customers : []
  const moving  = customers.filter(c => slotIds.includes(String(c.id)))
  const staying = customers.filter(c => !slotIds.includes(String(c.id)))
  if (moving.length !== slotIds.length) return bad('A ticked customer is no longer on this appointment. Reload and try again.')

  const { data: animalRows } = await supabaseAdmin
    .from('animal_receiving_log')
    .select('*')
    .eq('appointment_id', id)
    .order('animal_index', { ascending: true })
  const live = ((animalRows ?? []) as Animal[]).filter(a => a.status !== 'removed' && a.status !== 'no_show')
  const movingAnimals = live.filter(a => animalIds.includes(a.id))
  if (movingAnimals.length !== animalIds.length) return bad('A ticked animal is no longer checked in on this appointment. Reload and try again.')
  if (movingAnimals.length > head) return bad(`${movingAnimals.length} animals ticked but only ${head} head moving.`)
  if (live.length - movingAnimals.length > total - head) {
    return bad(`${live.length} animals are checked in on this booking; with ${total - head} head staying, ${live.length - (total - head)} of them have to go with the move. Tick which.`)
  }

  // A moved animal that is already in the pens is AnimalIn on its new day. A
  // slot moved before anything arrived goes back to Booked rather than
  // inheriting "animal in" from a day it was never checked in on.
  const status = movingAnimals.length > 0
    ? 'AnimalIn'
    : (appt.status === 'AnimalIn' || appt.status === 'Processing' ? 'Booked' : appt.status)

  // 1. The new booking. receive_date null → the trigger fills the day before.
  const { data: created, error: cErr } = await supabaseAdmin
    .from('harvest_appointments')
    .insert([{
      harvest_date:              toDate,
      receive_date:              null,
      species:                   appt.species,
      head_count:                head,
      source:                    appt.source ?? '',
      producer_contact:          appt.producer_contact ?? null,
      notes:                     appt.notes ?? '',
      status,
      linked_carcass_id:         '',
      customers:                 moving,
      producer_id:               appt.producer_id ?? null,
      processing_status:         appt.processing_status ?? 'scheduled',
      animal_description:        appt.animal_description ?? '',
      estimated_live_weight_lbs: appt.estimated_live_weight_lbs ?? null,
      self_scheduled:            false,
      producer_qbo_customer_id:  appt.producer_qbo_customer_id ?? null,
      producer_qbo_name:         appt.producer_qbo_name ?? null,
      kill_only:                 !!appt.kill_only,
    }])
    .select()
    .single()
  if (cErr || !created) return bad(cErr?.message ?? 'could not create the new appointment', 500)
  const newId = String(created.id)

  // 2. Shrink the original. If this fails, take the new booking back out so
  //    nothing is on two days at once.
  const { data: shrunk, error: sErr } = await supabaseAdmin
    .from('harvest_appointments')
    .update({ head_count: total - head, customers: staying })
    .eq('id', id)
    .select()
    .single()
  if (sErr) {
    await supabaseAdmin.from('harvest_appointments').delete().eq('id', newId)
    return bad(sErr.message, 500)
  }

  const warnings: string[] = []
  const warn = (what: string, e: { message: string } | null) => { if (e) warnings.push(`${what}: ${e.message}`) }

  // 3. Rows keyed by the moved slots follow them.
  if (slotIds.length) {
    const { error: e1 } = await supabaseAdmin.from('carcass_assignments')
      .update({ appointment_id: newId }).eq('appointment_id', id).in('appointment_customer_id', slotIds)
    warn('carcass assignments', e1)
    const { error: e2 } = await supabaseAdmin.from('cut_schedule_items')
      .update({ appointment_id: newId }).eq('appointment_id', id).in('appointment_customer_id', slotIds)
    warn('cut schedule', e2)
    const { error: e3 } = await supabaseAdmin.from('cut_schedule_items')
      .update({ future_appointment_id: newId }).eq('future_appointment_id', id).in('appointment_customer_id', slotIds)
    warn('cut schedule (upcoming)', e3)
  }

  // 4. Checked-in animals: a fresh row on the new day, the old row held as
  //    'removed' so its number stays spent.
  let nextIndex = 1
  for (const a of movingAnimals) {
    const { data: copy, error: iErr } = await supabaseAdmin.from('animal_receiving_log').insert([{
      appointment_id:  newId,
      animal_index:    nextIndex++,
      status:          'received',
      received_at:     a.received_at,
      live_weight_lbs: a.live_weight_lbs,
      received_by:     a.received_by ?? '',
      health_cert_no:  a.health_cert_no ?? '',
      brand_insp_no:   a.brand_insp_no ?? '',
      notes:           a.notes ?? '',
      ear_tag:         a.ear_tag ?? '',
      sex:             a.sex ?? '',
      breed:           a.breed ?? '',
      over_30_months:  a.over_30_months ?? false,
      horns:           a.horns ?? false,
      photo_url:       a.photo_url ?? '',
    }]).select('id').single()
    if (iErr || !copy) { warn(`animal ${a.ear_tag || a.animal_index}`, iErr ?? { message: 'copy failed' }); continue }

    const { error: rErr } = await supabaseAdmin.from('animal_receiving_log')
      .update({ status: 'removed', notes: `Moved to ${toDate}${a.notes ? ` — ${a.notes}` : ''}` })
      .eq('id', a.id)
    warn(`animal ${a.ear_tag || a.animal_index} (old row)`, rErr)

    const { error: pErr } = await supabaseAdmin.from('animal_photos')
      .update({ appointment_id: newId, receiving_log_id: copy.id })
      .eq('receiving_log_id', a.id)
    warn('animal photos', pErr)
  }

  // 5. Unharvested harvest_log rows: pair by ear tag with the animals that
  //    moved, then spares, up to the head moving. Rows with weights, a knock
  //    time, a finished Part B or a tag are a kill record of their day and stay.
  const { data: logRows } = await supabaseAdmin
    .from('harvest_log')
    .select('id, ear_tag, created_at, hot_carcass_weight_lbs, live_weight_lbs, part_b_complete, knock_time, carcass_tag')
    .eq('appointment_id', id)
    .order('created_at', { ascending: true })
  const spare = ((logRows ?? []) as Log[]).filter(l =>
    l.hot_carcass_weight_lbs == null && l.live_weight_lbs == null && !l.part_b_complete && !l.knock_time && !l.carcass_tag)
  const picked: Log[] = []
  for (const a of movingAnimals) {
    const tag = a.ear_tag || ''
    const i = tag ? spare.findIndex(l => (l.ear_tag || '') === tag && !picked.includes(l)) : -1
    if (i >= 0) picked.push(spare[i])
  }
  for (const l of spare) { if (picked.length >= head) break; if (!picked.includes(l)) picked.push(l) }
  if (picked.length) {
    const { error: lErr } = await supabaseAdmin.from('harvest_log')
      .update({ appointment_id: newId, harvest_date: toDate, harvest_order: null })
      .in('id', picked.map(l => l.id))
    warn('harvest log', lErr)
  }

  return NextResponse.json({ ok: true, moved: created, original: shrunk, animals_moved: movingAnimals.length, warnings })
}
