export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  buildGrindAllData, grindAllMissing, instructionSpecies, speciesKey,
  type GrindAllChoices,
} from '@/lib/grindAll'

export const dynamic = 'force-dynamic'

// POST /api/cutting-instructions/grind-all
//   { appointment_id, appointment_customer_id, customer_name, notes,
//     fatPct, packSize, keepFat, porkFlavor, porkFormat, lgStyle }
//
// Writes a "grind the whole animal" cut card for a slot that will never get one
// off the public form — a house animal, a grinder cow — and links it to the
// slot in the same call. Two steps, one button: the crew was stuck otherwise,
// because the only way to create a card at all was to go and fill in the
// customer-facing form (Charlie, 2026-08-19).
//
// Creating and linking together is the point. A card left unlinked is invisible
// to the cut schedule, which is the screen the request came from.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  const apptId = String(body?.appointment_id ?? '')
  const slotId = String(body?.appointment_customer_id ?? '')
  if (!apptId || !slotId) {
    return NextResponse.json({ error: 'appointment_id and appointment_customer_id required' }, { status: 400 })
  }

  const { data: appt, error: apptErr } = await supabase
    .from('harvest_appointments')
    .select('id, species, harvest_date, source, customers')
    .eq('id', apptId)
    .single()
  // .single() on no rows comes back as a coercion error, not an empty result,
  // so the raw message would reach the operator as Postgres noise.
  if (apptErr || !appt) {
    return NextResponse.json({ error: 'That booking no longer exists.' }, { status: 404 })
  }

  const customers = (appt.customers as Array<Record<string, unknown>> | null) ?? []
  const slotIdx = customers.findIndex(c => c?.id === slotId)
  if (slotIdx < 0) {
    return NextResponse.json({ error: 'that cut customer is not on this appointment' }, { status: 404 })
  }
  const slot = customers[slotIdx]

  // Don't paper over an existing sheet. The button is only offered on a slot
  // with none, so reaching this means the page was stale — say so rather than
  // stranding the card that is already there.
  if (slot.linked_cutting_instruction_id) {
    return NextResponse.json(
      { error: 'This customer already has a cut card. Reload the page.' },
      { status: 409 },
    )
  }

  if (!speciesKey(appt.species as string)) {
    return NextResponse.json({ error: `no grind options for species "${appt.species}"` }, { status: 400 })
  }

  const choices: GrindAllChoices = {
    species:      String(appt.species ?? ''),
    // Falls back to the producer, which is who a house animal actually belongs
    // to — the slot on these bookings is left unnamed. Never invented: the UI
    // shows this field filled in and lets the operator correct it.
    // || not ??: an unnamed slot carries '', not null, and '' is the case this
    // fallback exists for.
    customerName: String(body?.customer_name || slot.customer_name || appt.source || ''),
    portion:      String(slot.portion ?? 'Whole'),
    killDate:     (appt.harvest_date as string) ?? null,
    notes:        String(body?.notes ?? ''),
    fatPct:       body?.fatPct     ? String(body.fatPct)     : undefined,
    packSize:     body?.packSize   ? String(body.packSize)   : undefined,
    keepFat:      !!body?.keepFat,
    porkFlavor:   body?.porkFlavor ? String(body.porkFlavor) : undefined,
    porkFormat:   body?.porkFormat ? String(body.porkFormat) : undefined,
    lgStyle:      body?.lgStyle    ? String(body.lgStyle)    : undefined,
  }

  const missing = grindAllMissing(choices)
  if (missing) {
    return NextResponse.json({ error: `This card still needs ${missing}.` }, { status: 400 })
  }

  const { data: card, error: insErr } = await supabase
    .from('cutting_instructions')
    .insert([{
      customer_name: choices.customerName.trim(),
      species:       instructionSpecies(appt.species as string),
      status:        'linked',
      appointment_id: apptId,
      customer_id:   (slot.customer_id as string | null) ?? null,
      // Records the front door, the same way 'portal' does. Nobody submitted
      // this one — the office wrote it.
      submitted_by:  'office',
      data:          buildGrindAllData(choices),
    }])
    .select()
    .single()
  if (insErr || !card) {
    return NextResponse.json({ error: insErr?.message ?? 'could not create the card' }, { status: 500 })
  }

  const next = customers.map((c, i) =>
    i === slotIdx ? { ...c, linked_cutting_instruction_id: card.id } : c
  )
  const { error: linkErr } = await supabase
    .from('harvest_appointments')
    .update({ customers: next })
    .eq('id', apptId)

  // The card exists but points at nothing, which is worse than not having it —
  // it would sit in the unlinked pile looking like a customer submission. Drop
  // it and let the caller retry.
  if (linkErr) {
    await supabase.from('cutting_instructions').delete().eq('id', card.id)
    return NextResponse.json({ error: linkErr.message }, { status: 500 })
  }

  return NextResponse.json({ id: card.id, customer_name: card.customer_name })
}
