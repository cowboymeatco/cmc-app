import { supabase } from '@/lib/supabase'

// Detaching a cut card means clearing everything that points AT it: the
// appointment customer slot that owns the link, and the carcass-assignment
// snapshot that copies it. Clearing only one side is what stranded a portion
// with no way to re-link it (Jill, 2026-07-28) — the animal still read as
// "has instructions" while the card was gone.
//
// `remaining` is how many OTHER animals still hold this card, so the caller can
// decide whether the card is fully unlinked. A customer taking a whole plus a
// half is linked once per animal; dropping one of those two is not the same as
// putting the card back in the unlinked pile.
export type UnlinkResult = { error: string | null; remaining: number }

// appointmentId scopes the detach to one animal. Omit it to detach from every
// animal — which is what deleting a card has to do.
export async function unlinkInstruction(id: string, appointmentId?: string): Promise<UnlinkResult> {
  const { data: appts, error: findErr } = await supabase
    .from('harvest_appointments')
    .select('id, customers')
    .contains('customers', [{ linked_cutting_instruction_id: id }])
  if (findErr) return { error: findErr.message, remaining: -1 }

  const all     = appts ?? []
  const targets = appointmentId ? all.filter(a => a.id === appointmentId) : all

  for (const appt of targets) {
    // Blank, not null: a fresh customer slot carries '' and every "needs
    // instructions" check in the app is a falsy test, so '' is the shape that
    // already means unlinked.
    const customers = (appt.customers as Array<Record<string, unknown>> ?? []).map(c =>
      c?.linked_cutting_instruction_id === id ? { ...c, linked_cutting_instruction_id: '' } : c
    )
    const { error } = await supabase
      .from('harvest_appointments')
      .update({ customers })
      .eq('id', appt.id)
    if (error) return { error: error.message, remaining: -1 }
  }

  // Scoped the same way. An unscoped clear here would strip the card off the
  // customer's OTHER animal too, which is the bug this whole helper exists to
  // avoid on the appointment side.
  let clear = supabase
    .from('carcass_assignments')
    .update({ linked_cutting_instruction_id: null })
    .eq('linked_cutting_instruction_id', id)
  if (appointmentId) clear = clear.eq('appointment_id', appointmentId)
  const { error: caErr } = await clear
  if (caErr) return { error: caErr.message, remaining: -1 }

  return { error: null, remaining: all.length - targets.length }
}
