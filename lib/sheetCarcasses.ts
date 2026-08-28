// Which animals a cut sheet is actually about.
//
// Linking a sheet attaches it to a CUSTOMER SLOT on a check-in ("one of Cook's
// hogs is Gabby's"), not to an animal. One sheet can sit on several slots of
// the same check-in — Montana Veterans Meat Locker books five hogs against one
// cut spec, and each slot is a different end buyer with its own carcass — so
// the answer is a list, and it has to be worked out slot by slot.
//
// This lived inside the value-add report until 2026-08-27, when the cure-tag
// picker needed the same answer to offer a customer's animals. Extracted rather
// than copied: lib/nameKey.ts had already been written twice with a "keep the
// two in step" comment on both copies, and this is fiddlier than that was.

export interface ApptSlotRow {
  id: string
  harvest_date?: string | null
  customers: unknown
}

export interface AssignmentRow {
  harvest_log_id: unknown
  appointment_id: unknown
  appointment_customer_id: unknown
  linked_cutting_instruction_id: unknown
}

export interface CarcassRow {
  id: unknown
  appointment_id?: unknown
  hot_carcass_weight_lbs?: unknown
  half_1_weight_lbs?: unknown
  half_2_weight_lbs?: unknown
}

/** Whole-carcass hanging weight, the way it prints on the cut card: the hot
 *  weight when there is one, else the halves added back together. */
export function hangingWeight(l: CarcassRow): number | null {
  const hcw = l.hot_carcass_weight_lbs as number | null
  if (hcw != null) return Number(hcw)
  const h1 = l.half_1_weight_lbs as number | null
  const h2 = l.half_2_weight_lbs as number | null
  return h1 != null || h2 != null ? Number(h1 ?? 0) + Number(h2 ?? 0) : null
}

export interface SheetSlots {
  slotsByCi: Map<string, { apptId: string; slotId: string }[]>
  dateByCi: Map<string, string>
  /** Every check-in these sheets touch, for scoping the carcass reads. */
  appointmentIds: string[]
}

/**
 * Step one: which slots of which check-ins each sheet sits on.
 *
 * Separate from the index because the caller needs `appointmentIds` to scope
 * its harvest_log and carcass_assignments reads — neither table should be read
 * whole as they grow.
 */
export function sheetSlots(appts: ApptSlotRow[] | null | undefined): SheetSlots {
  const dateByCi = new Map<string, string>()
  const slotsByCi = new Map<string, { apptId: string; slotId: string }[]>()
  for (const a of appts ?? []) {
    for (const c of ((a.customers as Array<Record<string, unknown>>) ?? [])) {
      const id = String(c?.linked_cutting_instruction_id ?? '')
      if (!id) continue
      if (a.harvest_date) dateByCi.set(id, a.harvest_date)
      const list = slotsByCi.get(id) ?? []
      list.push({ apptId: String(a.id), slotId: String(c?.id ?? '') })
      slotsByCi.set(id, list)
    }
  }
  return {
    slotsByCi, dateByCi,
    appointmentIds: [...new Set([...slotsByCi.values()].flat().map(s => s.apptId))],
  }
}

export interface SheetCarcassIndex {
  /** harvest_log ids for one cut sheet, in slot order, each animal once. */
  carcassesFor(ciId: string): string[]
  /** Hanging weight by harvest_log id. */
  weightOf(logId: string): number | null
  /** Scheduled harvest date for a sheet, off the check-in it's linked to. */
  dateFor(ciId: string): string | undefined
}

/** Step two, once the carcasses and assignments for those check-ins are read. */
export function buildSheetCarcassIndex(
  slots: SheetSlots,
  asgs: AssignmentRow[] | null | undefined,
  logs: CarcassRow[] | null | undefined,
): SheetCarcassIndex {
  const { slotsByCi, dateByCi } = slots

  const wtByLog = new Map<string, number | null>()
  const logIdsOn = new Map<string, string[]>()   // appointment id → its carcasses
  for (const l of logs ?? []) {
    wtByLog.set(String(l.id), hangingWeight(l))
    if (l.appointment_id == null) continue
    const list = logIdsOn.get(String(l.appointment_id)) ?? []
    list.push(String(l.id))
    logIdsOn.set(String(l.appointment_id), list)
  }

  const rows = asgs ?? []

  // Resolves slot by slot, and a carcass claimed by one slot is not available
  // to the next.
  //
  // This used to take the first assignment matching the slot OR the sheet. The
  // sheet half is true of EVERY assignment on that sheet, so all of a sheet's
  // slots matched the same first row and the rest were deduped away: Kristin's
  // three-hog sheet reported one 180 lb hog instead of 553 lb across three,
  // which is the hanging weight that didn't line up (Charlie, 2026-08-27).
  function carcassesFor(ciId: string): string[] {
    const slots = slotsByCi.get(ciId) ?? []
    const mine = rows.filter(a => String(a.linked_cutting_instruction_id ?? '') === ciId)
    const claimed = new Set<string>()
    const out: string[] = []

    // Pass 1: the assignment made for THIS slot. Unambiguous, so it wins, and
    // it claims its carcass before any fallback can take it.
    const bySlot = new Map<string, string>()
    for (const { apptId, slotId } of slots) {
      if (!slotId) continue
      const asg = rows.find(a =>
        String(a.appointment_id) === apptId && String(a.appointment_customer_id) === slotId)
      if (!asg) continue
      bySlot.set(slotId, String(asg.harvest_log_id))
      claimed.add(String(asg.harvest_log_id))
    }

    // Pass 2: anything left over. An assignment tied to the sheet but to no
    // slot we recognise, else the check-in's only animal. More than one animal
    // and nothing pointing at it means nobody knows which carcass is theirs —
    // that stays blank rather than being guessed.
    for (const { apptId, slotId } of slots) {
      let logId = slotId ? bySlot.get(slotId) ?? '' : ''
      if (!logId) {
        const spare = mine.find(a =>
          String(a.appointment_id) === apptId && !claimed.has(String(a.harvest_log_id)))
        const onAppt = logIdsOn.get(apptId) ?? []
        logId = spare ? String(spare.harvest_log_id) : onAppt.length === 1 ? onAppt[0] : ''
        if (logId) claimed.add(logId)
      }
      if (logId && !out.includes(logId)) out.push(logId)
    }
    return out
  }

  return {
    carcassesFor,
    weightOf: (logId: string) => wtByLog.get(logId) ?? null,
    dateFor: (ciId: string) => dateByCi.get(ciId),
  }
}
