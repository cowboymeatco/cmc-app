// Which cut card is this packing session working from?
//
// The scanner, the box label and the WIP tag all have to answer it the same
// way — a box that prints one customer's intent while the screen checks off
// another's is worse than either of them being wrong alone.

import { supabase } from '@/lib/supabase'
import { isSameParty, CICard } from '@/lib/wipIntent'

// Names as the floor writes them vs. as the cut card holds them: the box says
// "Travis Buck 204#", the card says "Travis Buck". Strip the hanging weight and
// punctuation so the two can be compared. Half-pound weights are real —
// "DAN JOHNSON 204.5" — so the number may carry a decimal.
export const normName = (n: string) =>
  (n || '')
    .replace(/\s*[·\-]?\s*\d{2,4}(\.\d+)?\s*(#|lbs?)?\s*$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

export interface CIMatch { cards: CICard[]; via: string; name: string }

// Find the customer's cut card. Tries the databased links first, but in
// practice most sessions have neither — carcass_assignments has a handful of
// rows and no cutting instruction carries an appointment_id — so the name match
// is what actually connects a box to its orders today. How it matched gets
// printed on the tag, because a name match deserves to be visible.
export async function resolveCuttingInstruction(customerName: string, packDate: string): Promise<CIMatch | null> {
  const pick = (row: { data?: unknown; customer_name?: string; customer_id?: string | null; species?: string | null } | null, via: string): CIMatch | null =>
    row?.data
      ? { cards: [{ data: row.data as Record<string, unknown>, customerId: row.customer_id ?? null, species: row.species ?? null }], via, name: row.customer_name ?? '' }
      : null

  // 1. Carcass scanned into this session → the assignment made at check-in.
  const inputs = await supabase
    .from('processing_inputs')
    .select('linked_harvest_id')
    .eq('customer_name', customerName)
    .eq('pack_date', packDate)
    .not('linked_harvest_id', 'is', null)
  const harvestIds = [...new Set((inputs.data ?? []).map(r => r.linked_harvest_id).filter(Boolean))]

  if (harvestIds.length) {
    const ca = await supabase
      .from('carcass_assignments')
      .select('linked_cutting_instruction_id')
      .in('harvest_log_id', harvestIds)
      .not('linked_cutting_instruction_id', 'is', null)
    const ciIds = [...new Set((ca.data ?? []).map(r => r.linked_cutting_instruction_id).filter(Boolean))]
    if (ciIds.length === 1) {
      const ci = await supabase.from('cutting_instructions').select('data, customer_name, species').eq('id', ciIds[0]).maybeSingle()
      const hit = pick(ci.data, 'carcass')
      if (hit) return hit
    }

    // 2. Appointment key, for once cut cards start carrying one.
    const hl = await supabase.from('harvest_log').select('appointment_id').in('id', harvestIds)
    const appts = [...new Set((hl.data ?? []).map(r => r.appointment_id).filter(Boolean))]
    if (appts.length) {
      const ci = await supabase
        .from('cutting_instructions')
        .select('data, customer_name, species')
        .in('appointment_id', appts)
        .order('last_modified', { ascending: false })
        .limit(1)
        .maybeSingle()
      const hit = pick(ci.data, 'appointment')
      if (hit) return hit
    }
  }

  // 3. Name. Two strangers sharing a name means we'd cook somebody else's
  // order, so that case still goes back to the crew. But one customer with two
  // animals is not that case: her orders are all hers, and refusing outright is
  // how a 50 lb tub of Daina Green's trim printed no intent while her 50 lb
  // german brat order sat on the whole-hog card (Charlie, 2026-08-01).
  const target = normName(customerName)
  if (!target) return null
  const all = await supabase.from('cutting_instructions').select('data, customer_name, customer_id, species')
  const matches = (all.data ?? []).filter(r => normName(r.customer_name ?? '') === target)
  if (!matches.length) return null

  const cards: CICard[] = matches
    .filter(r => r.data)
    .map(r => ({ data: r.data as Record<string, unknown>, customerId: r.customer_id ?? null, species: r.species ?? null }))
  if (!cards.length) return null
  if (cards.length > 1 && !isSameParty(cards)) return null

  return { cards, via: cards.length > 1 ? 'name-multi' : 'name', name: matches[0].customer_name ?? '' }
}

// Every smokehouse order this customer has open, across all her cards. Keys get
// namespaced per card when there's more than one, so a whole hog's brats#0 and a
// half's brats#0 can't be mistaken for the same order when pounds are tallied.
