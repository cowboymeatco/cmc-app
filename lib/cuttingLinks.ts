import { supabase } from '@/lib/supabase'

// Detaching a cut card means clearing everything that points AT it: the
// appointment customer slot that owns the link, and the carcass-assignment
// snapshot that copies it. Clearing only one side is what stranded a portion
// with no way to re-link it (Jill, 2026-07-28) — the animal still read as
// "has instructions" while the card was gone.
//
// `remaining` counts the SLOTS still holding this card, not appointments: one
// cut spec can sit on five hog slots of a single check-in, so "no appointments
// left" and "nothing points here any more" are different questions.
export type UnlinkResult = { error: string | null; remaining: number }

// appointmentId narrows the detach to one check-in; slotId narrows it further to
// one customer slot on that check-in. Omit both to detach from everything —
// which is what deleting a card has to do.
export async function unlinkInstruction(
  id: string,
  appointmentId?: string,
  slotId?: string,
): Promise<UnlinkResult> {
  // supabase-js stringifies a raw array/object value with String() before
  // sending it, which for a jsonb column produces the literal text
  // "{[object Object]}" instead of JSON — Postgres then rejects it with
  // "invalid input syntax for type json". Pre-serializing sidesteps that
  // (Charlie, 2026-08-18 — surfaced as a raw Postgres error in the UI).
  const { data: appts, error: findErr } = await supabase
    .from('harvest_appointments')
    .select('id, customers')
    .contains('customers', JSON.stringify([{ linked_cutting_instruction_id: id }]))
  if (findErr) return { error: findErr.message, remaining: -1 }

  const all = appts ?? []
  const linkedSlots = (a: { customers: unknown }) =>
    (a.customers as Array<Record<string, unknown>> ?? []).filter(c => c?.linked_cutting_instruction_id === id)
  const total = all.reduce((n, a) => n + linkedSlots(a).length, 0)

  const targets = appointmentId ? all.filter(a => a.id === appointmentId) : all
  let cleared = 0

  for (const appt of targets) {
    // Blank, not null: a fresh customer slot carries '' and every "needs
    // instructions" check in the app is a falsy test, so '' is the shape that
    // already means unlinked.
    const customers = (appt.customers as Array<Record<string, unknown>> ?? []).map(c => {
      const hit = c?.linked_cutting_instruction_id === id && (!slotId || c?.id === slotId)
      if (hit) cleared++
      return hit ? { ...c, linked_cutting_instruction_id: '' } : c
    })
    const { error } = await supabase
      .from('harvest_appointments')
      .update({ customers })
      .eq('id', appt.id)
    if (error) return { error: error.message, remaining: -1 }
  }

  // Scoped the same way, and by slot when we have one. An unscoped clear would
  // strip the card off the producer's OTHER animals too — the bug this helper
  // exists to avoid on the appointment side. The assignment ROW stays: the
  // carcass is still that slot's animal, it just no longer carries this card.
  let clear = supabase
    .from('carcass_assignments')
    .update({ linked_cutting_instruction_id: null })
    .eq('linked_cutting_instruction_id', id)
  if (slotId) clear = clear.eq('appointment_customer_id', slotId)
  else if (appointmentId) clear = clear.eq('appointment_id', appointmentId)
  const { error: caErr } = await clear
  if (caErr) return { error: caErr.message, remaining: -1 }

  return { error: null, remaining: Math.max(0, total - cleared) }
}
