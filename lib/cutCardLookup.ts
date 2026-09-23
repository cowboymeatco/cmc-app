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

type CIRow = { data?: unknown; customer_name?: string; customer_id?: string | null; species?: string | null; scale_label?: string | null }

// Which of these cards belongs to the session on the bench.
//
// A carcass and an appointment are both wider than one order — a split hog
// carries two cards, a five-hog drop-off carries five — so neither can name a
// card on its own. One card means no question to answer. More than one, and
// only the session's own name may choose; failing that the caller has to look
// elsewhere, because picking any of them is picking a stranger's order.
function theOneFor(rows: CIRow[], customerName: string): CIRow | null {
  const cards = rows.filter(r => r?.data)
  if (cards.length <= 1) return cards[0] ?? null
  const target = normName(customerName)
  const named  = target ? cards.filter(r => normName(r.customer_name ?? '') === target) : []
  return named.length === 1 ? named[0] : null
}

// Find the customer's cut card. Tries the databased links first, but in
// practice most sessions have neither — carcass_assignments has a handful of
// rows and no cutting instruction carries an appointment_id — so the name match
// is what actually connects a box to its orders today. How it matched gets
// printed on the tag, because a name match deserves to be visible.
export async function resolveCuttingInstruction(customerName: string, packDate: string): Promise<CIMatch | null> {
  const pick = (row: CIRow | null, via: string): CIMatch | null =>
    row?.data
      ? { cards: [{ data: row.data as Record<string, unknown>, customerId: row.customer_id ?? null, species: row.species ?? null, scaleLabel: row.scale_label ?? null }], via, name: row.customer_name ?? '' }
      : null

  // 0. The session was started off (or scanned against) its animal and knows
  //    its card outright (lib/sessionLinks.ts, 2026-09-13). Nothing below —
  //    least of all a name — gets a vote.
  const sess = await supabase
    .from('processing_sessions')
    .select('linked_cutting_instruction_id')
    .eq('customer_name', customerName.trim())
    .eq('session_date', packDate)
    .maybeSingle()
  const sessionCi = sess.data?.linked_cutting_instruction_id as string | null | undefined
  if (sessionCi) {
    const ci = await supabase.from('cutting_instructions').select('data, customer_name, customer_id, species, scale_label').eq('id', sessionCi).maybeSingle()
    const hit = pick(ci.data, 'session')
    if (hit) return hit
  }

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
    if (ciIds.length) {
      const ci = await supabase.from('cutting_instructions').select('data, customer_name, species, scale_label').in('id', ciIds)
      // One carcass can carry two orders — a hog split down the middle between
      // two customers, both cards assigned to tag 09. The carcass says whose
      // animal it is, not whose half is on THIS bench, so the session's own
      // name picks between them (Jill, 2026-09-21).
      const hit = pick(theOneFor(ci.data ?? [], customerName), 'carcass')
      if (hit) return hit
    }

    // 2. Appointment key. A drop-off is a whole appointment — five hogs, five
    // cards — so the appointment alone does NOT name a card. This used to take
    // the most recently edited one, which handed the Art Adame bench Rolph
    // Pankratz's card and told it to pack ground pork against a pork sausage
    // order (Jill, 2026-09-21). Only a name match gets to speak for a shared
    // appointment; with none, the honest answer is to fall through to the name
    // search below rather than print somebody else's intent.
    const hl = await supabase.from('harvest_log').select('appointment_id').in('id', harvestIds)
    const appts = [...new Set((hl.data ?? []).map(r => r.appointment_id).filter(Boolean))]
    if (appts.length) {
      const ci = await supabase
        .from('cutting_instructions')
        .select('data, customer_name, species, scale_label')
        .in('appointment_id', appts)
      const hit = pick(theOneFor(ci.data ?? [], customerName), 'appointment')
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
  const all = await supabase.from('cutting_instructions').select('data, customer_name, customer_id, species, scale_label')
  const matches = (all.data ?? []).filter(r => normName(r.customer_name ?? '') === target)
  if (!matches.length) return null

  const cards: CICard[] = matches
    .filter(r => r.data)
    .map(r => ({ data: r.data as Record<string, unknown>, customerId: r.customer_id ?? null, species: r.species ?? null, scaleLabel: r.scale_label ?? null }))
  if (!cards.length) return null
  if (cards.length > 1 && !isSameParty(cards)) return null

  return { cards, via: cards.length > 1 ? 'name-multi' : 'name', name: matches[0].customer_name ?? '' }
}

// Every smokehouse order this customer has open, across all her cards. Keys get
// namespaced per card when there's more than one, so a whole hog's brats#0 and a
// half's brats#0 can't be mistaken for the same order when pounds are tallied.
