// ──────────────────────────────────────────────────────────────────────────────
// Billing detector — every charge the plant has earned, priced from the price
// book. SERVER-ONLY. Called by POST /api/billing/detect.
//
// Writes PENDING rows into billable_events. Idempotent: the unique key
// (rule_key, source_table, source_id, customer_name) makes a re-run a no-op,
// and pending rows are re-priced in place so a price change or a late cut-card
// rate reaches them. Skipped, superseded and pushed rows are never touched.
//
// Charlie's rules (2026-11-11, docs/invoicing-spec.md):
//
// PER CARCASS (harvest_log)
//   kill_fee   beef $/lb hanging (kill-only booking → Beef Kill & Chill Only),
//              hog $/lb, lamb kill-only per head (superseded by the lamb flat
//              fee once cut). Goat kill is inside its flat fee.
//   cut_wrap   once cut: beef whole/half or quarters $/lb, hog $/lb, lamb and
//              goat flat per head.
//   cmc_animal our own animal sold to a customer: ONE all-in line at the
//              advertised price (whole / half / quarter beef $/lb hanging on
//              the share, whole / half hog and whole lamb per head). No kill
//              or cut & wrap lines. Value-add bills on top (per order, below).
//   Splits: customer-pays portions bill the customer, the rest the producer;
//   on our own animals every named portion is a buyer.
//
// PER BOOKING (harvest_appointments)
//   outdoor_kill, rush  flat fees, flagged on the booking, billed to the producer.
//
// PER ORDER (processing_sessions = one customer's pack, from Ready to Invoice on)
//   finished lb off the box scans: sausage, links, patties, curing (cured lb),
//              smoked / pulled items (smoking fee), Philly slicing ($10 once).
//   raw lb in off the cut sheet's smokehouse block: sticks, summers, brats,
//              hot dogs, jerky (cheese or not).
//   Baker storage: $20 transfer when the order went to Baker, then $28 per
//              customer per calendar month while anything of theirs is there.
//
// Priced: cut-card rate > customer deal > price book (lib/priceBook.ts).
// ──────────────────────────────────────────────────────────────────────────────

import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isExcludedProducer, isCmcAnimalNotBilled, PORTION_FRACTION } from '@/lib/billingRules'
import { PriceBook, round2 } from '@/lib/priceBook'
import { smokeLines, type SmokeLine } from '@/lib/pipelineValue'
import { selectIn } from '@/lib/selectIn'
import { isoDate } from '@/lib/dates'
import { nameKey } from '@/lib/nameKey'
import type { AppointmentCustomer } from '@/lib/types'

export interface EventRow {
  service_date: string; rule_key: string; source_table: string; source_id: string
  customer_name: string; qbo_customer_id: string; qbo_item_id: string; price_key: string
  description: string; qty: number; unit: string; rate: number; amount: number; status: 'pending'
}

export interface DetectResult {
  events: EventRow[]
  unbillable: string[]
  supersededLambIds: string[]
  excluded: number
  scanned: { carcasses: number; bookings: number; orders: number }
}

interface HarvestRow {
  id: string; appointment_id: string | null; harvest_date: string; species: string
  carcass_tag: string | null; hot_carcass_weight_lbs: number | null; status: string; producer: string | null
}
interface ApptRow {
  id: string; harvest_date: string; species: string; customers: AppointmentCustomer[] | null
  kill_only: boolean; outdoor_kill: boolean; rush: boolean; producer_qbo_customer_id: string | null
  head_count: number | null
}
interface SessionRow {
  id: string; customer_name: string; session_date: string; status: string | null
  linked_appointment_id: string | null; linked_cutting_instruction_id: string | null
  baker_storage_at: string | null; updated_at: string | null
}

interface Payer { name: string; qboCustomerId: string }

const ORDER_DONE = ['ready_to_invoice', 'complete', 'baker_storage', 'picked_up']

// ── Box-scan products → price key (finished lb). Smokehouse products (sticks,
// summers, brats, hot dogs, jerky, Polish) are NOT here: they bill on raw lb
// in off the cut sheet, and counting their packages too would double-bill.
export const SCAN_RULES: { key: string; test: RegExp; species?: string }[] = [
  { key: 'pork_sausage_links', test: /^PORK SAUSAGE LINKS?$/ },
  { key: 'sausage_patties',    test: /SAUSAGE PATT/ },
  { key: 'pork_sausage',       test: /^PORK (ITALIAN |JUMPSTART |BREAKFAST )?SAUSAGE$/ },
  { key: 'beef_sausage',       test: /^BEEF (BREAKFAST )?SAUSAGE$/ },
  { key: 'lamb_bulk_sausage',  test: /^LAMB (BULK )?SAUSAGE$/ },
  { key: 'lamb_curry_patties', test: /CURRY PATT/ },
  { key: 'beef_patty_fee',     test: /GROUND BEEF PATT/ },
  { key: 'italian_ground_beef',test: /ITALIAN GROUND BEEF/ },
  { key: 'hog_curing',         test: /^PORK .*(BACON|CURED)/ },
  { key: 'beef_bacon_curing',  test: /^BEEF BACON/ },
  { key: 'beef_curing',        test: /CORNED BEEF/ },
  { key: 'smoking_fee',        test: /PULLED|BRISKET SMOKED|CHOPS SMOKED/ },
]
const PHILLY = /PHILLY/

// Cut-sheet smokehouse line → price key.
export function smokeKey(l: SmokeLine, species: string): string {
  const ch = l.cheese ? '_cheese' : ''
  switch (l.item) {
    case 'sticks':  return `sticks${ch}`
    case 'summer':  return `summer${ch}`
    case 'hotDogs': return `hot_dogs${ch}`
    case 'jerky':   return species === 'Hog' ? 'pork_jerky' : 'beef_jerky'
    case 'brats':   return `${species === 'Hog' ? 'pork' : species === 'Lamb' ? 'lamb' : 'beef'}_brats${ch}`
  }
}

const fracWord = (f: number) => (f === 1 ? 'whole' : f === 0.5 ? 'half' : f === 0.25 ? 'quarter' : `${f} share`)
export const monthsBetween = (fromISO: string, toISO: string) => {
  const out: string[] = []
  let [y, m] = fromISO.slice(0, 7).split('-').map(Number)
  const [ty, tm] = toISO.slice(0, 7).split('-').map(Number)
  while (y < ty || (y === ty && m <= tm)) { out.push(`${y}-${String(m).padStart(2, '0')}`); m++; if (m > 12) { m = 1; y++ } }
  return out
}

export async function detectCharges(opts: { since: string; ordersSince: string }): Promise<DetectResult> {
  const book = await PriceBook.load()
  const today = isoDate()

  const [harvestQ, linksQ, custLinksQ, sessionsQ] = await Promise.all([
    supabaseAdmin.from('harvest_log')
      .select('id, appointment_id, harvest_date, species, carcass_tag, hot_carcass_weight_lbs, status, producer')
      .gte('harvest_date', opts.since).not('producer', 'is', null).neq('producer', ''),
    supabaseAdmin.from('producer_qbo_links').select('producer_name, qbo_customer_id'),
    supabaseAdmin.from('customer_qbo_links').select('customer_name, qbo_customer_id'),
    supabaseAdmin.from('processing_sessions')
      .select('id, customer_name, session_date, status, linked_appointment_id, linked_cutting_instruction_id, baker_storage_at, updated_at')
      .eq('cmc', false).in('status', ORDER_DONE).gte('session_date', opts.ordersSince),
  ])
  for (const q of [harvestQ, linksQ, custLinksQ, sessionsQ]) if (q.error) throw new Error(q.error.message)
  const harvests = (harvestQ.data ?? []) as HarvestRow[]
  const sessions = (sessionsQ.data ?? []) as SessionRow[]
  const producerLink = new Map((linksQ.data ?? []).map(l => [nameKey(l.producer_name), l.qbo_customer_id as string]))
  const customerLink = new Map((custLinksQ.data ?? []).map(l => [nameKey(l.customer_name), l.qbo_customer_id as string]))

  // Appointments behind both the carcasses and the orders.
  const apptIds = [...new Set([
    ...harvests.map(h => h.appointment_id), ...sessions.map(s => s.linked_appointment_id),
  ].filter(Boolean))] as string[]
  const appts = await selectIn<ApptRow>(apptIds, b => supabaseAdmin.from('harvest_appointments')
    .select('id, harvest_date, species, customers, kill_only, outdoor_kill, rush, producer_qbo_customer_id, head_count').in('id', b))
  const apptById = new Map(appts.map(a => [a.id, a]))
  // Producer name per appointment, off its carcasses (the booking has no name column).
  const producerOfAppt = new Map<string, string>()
  for (const h of harvests) if (h.appointment_id && h.producer) producerOfAppt.set(h.appointment_id, h.producer)

  // Cut cards: negotiated rates (carcass) and smokehouse lines (orders).
  const cardIds = [...new Set([
    ...appts.flatMap(a => (a.customers ?? []).map(c => c.linked_cutting_instruction_id)),
    ...sessions.map(s => s.linked_cutting_instruction_id),
  ].filter(Boolean))] as string[]
  const cards = await selectIn<{ id: string; data: unknown; kill_price_per_lb: number | string | null; processing_price_per_lb: number | string | null }>(
    cardIds, b => supabaseAdmin.from('cutting_instructions').select('id, data, kill_price_per_lb, processing_price_per_lb').in('id', b))
  const toNum = (v: number | string | null) => (v == null || v === '' ? null : Number(v))
  const cardById = new Map(cards.map(c => [c.id, c]))

  // Cut date per carcass: first pack scan.
  const packs = await selectIn<{ linked_harvest_id: string; pack_date: string }>(harvests.map(h => h.id),
    b => supabaseAdmin.from('processing_inputs').select('linked_harvest_id, pack_date').in('linked_harvest_id', b).not('pack_date', 'is', null))
  const cutDate = new Map<string, string>()
  for (const p of packs) { const prev = cutDate.get(p.linked_harvest_id); if (!prev || p.pack_date < prev) cutDate.set(p.linked_harvest_id, p.pack_date) }

  // Which buyers are on WHICH carcass. A booking can cover many head (12 beef on
  // one appointment), and its customers list is every buyer across all of them.
  // Billing that whole list against each carcass charged every buyer once per
  // animal on the booking — 12× on the Aug 14 CMC beef (found 2026-11-13).
  // carcass_assignments (the assign modal / cut schedule) ties a buyer's slot to
  // one carcass. A one-carcass booking needs no assignment.
  const assigns = await selectIn<{ harvest_log_id: string; appointment_customer_id: string | null; customer_name: string | null; portion: string | null; linked_cutting_instruction_id: string | null }>(
    harvests.map(h => h.id), b => supabaseAdmin.from('carcass_assignments')
      .select('harvest_log_id, appointment_customer_id, customer_name, portion, linked_cutting_instruction_id').in('harvest_log_id', b))
  const assignsByCarcass = new Map<string, typeof assigns>()
  for (const a of assigns) assignsByCarcass.set(a.harvest_log_id, [...(assignsByCarcass.get(a.harvest_log_id) ?? []), a])
  const carcassesPerAppt = new Map<string, number>()
  for (const h of harvests) if (h.appointment_id) carcassesPerAppt.set(h.appointment_id, (carcassesPerAppt.get(h.appointment_id) ?? 0) + 1)
  /** The booking slots that belong to this carcass, or null when a multi-head booking has no assignment for it. */
  const slotsForCarcass = (h: HarvestRow, appt?: ApptRow): AppointmentCustomer[] | null => {
    const all = (appt?.customers ?? []) as AppointmentCustomer[]
    const rows = assignsByCarcass.get(h.id)
    if (rows?.length) {
      return rows.map(r => {
        const slot = all.find(s => s.id === r.appointment_customer_id)
        return slot
          ? { ...slot, portion: r.portion || slot.portion, linked_cutting_instruction_id: r.linked_cutting_instruction_id || slot.linked_cutting_instruction_id }
          : ({ id: r.appointment_customer_id ?? '', customer_name: r.customer_name ?? '', portion: r.portion ?? '', linked_cutting_instruction_id: r.linked_cutting_instruction_id ?? '' } as AppointmentCustomer)
      })
    }
    const head = Math.max(carcassesPerAppt.get(h.appointment_id ?? '') ?? 0, Number(appt?.head_count) || 0)
    if (!h.appointment_id || head <= 1) return all
    return null
  }

  const events: EventRow[] = []
  const unbillable: string[] = []

  const producerPayer = (name: string, appt?: ApptRow): Payer =>
    ({ name, qboCustomerId: appt?.producer_qbo_customer_id || producerLink.get(nameKey(name)) || '' })
  const customerPayer = (name: string, slots: AppointmentCustomer[] = []): Payer =>
    ({ name, qboCustomerId: slots.map(s => s.qbo_customer_id).find(Boolean) || customerLink.get(nameKey(name)) || producerLink.get(nameKey(name)) || '' })

  /** Price one charge and queue it, or record why it couldn't be. */
  const add = (o: {
    key: string; rule: string; sourceTable: string; sourceId: string; payer: Payer
    qty: number; unit: 'lb' | 'ea'; date: string; what: string; cardRate?: number | null; tag: string
  }) => {
    if (!(o.qty > 0)) return
    const r = book.resolve(o.key, o.payer.qboCustomerId, o.cardRate)
    if ('problem' in r) { unbillable.push(`${o.tag}: ${r.problem}`); return }
    const p = r.price
    const note = p.source === 'card' ? ' (negotiated rate)' : p.source === 'customer' ? ' (customer rate)' : ''
    events.push({
      service_date: o.date, rule_key: o.rule, source_table: o.sourceTable, source_id: o.sourceId,
      customer_name: o.payer.name, qbo_customer_id: o.payer.qboCustomerId, qbo_item_id: p.qboItemId, price_key: p.key,
      description: `${p.label} — ${o.what}${note}`, qty: round2(o.qty), unit: o.unit, rate: p.rate,
      amount: round2(round2(o.qty) * p.rate), status: 'pending',
    })
  }

  // ── Per carcass ──────────────────────────────────────────────────────────
  let excluded = 0
  const supersededLambIds: string[] = []
  for (const h of harvests) {
    const appt = h.appointment_id ? apptById.get(h.appointment_id) : undefined
    const tag = `${h.carcass_tag || h.id.slice(0, 8)} (${h.species})`
    const assigned = slotsForCarcass(h, appt)
    const slots = assigned ?? []
    const hcw = Number(h.hot_carcass_weight_lbs) || 0
    const src = { sourceTable: 'harvest_log', sourceId: h.id, tag }

    if (isExcludedProducer(h.producer!)) {
      // Our own animal: only the named buyers pay, at the advertised all-in price.
      if (!assigned) { unbillable.push(`${tag}: our animal on a ${appt?.head_count ?? 'multi'}-head booking with no buyer assigned to this carcass — assign it on the cut schedule`); continue }
      const buyers = new Map<string, { frac: number; slots: AppointmentCustomer[] }>()
      for (const s of slots) {
        const f = PORTION_FRACTION[s.portion] ?? 0
        if (!s.customer_name?.trim() || f <= 0) continue
        if (isCmcAnimalNotBilled(s.customer_name)) continue
        const b = buyers.get(s.customer_name.trim()) ?? { frac: 0, slots: [] }
        buyers.set(s.customer_name.trim(), { frac: b.frac + f, slots: [...b.slots, s] })
      }
      if (!buyers.size) { excluded++; continue }
      for (const [name, b] of buyers) {
        const payer = customerPayer(name, b.slots)
        const f = Math.min(b.frac, 1)
        if (h.species === 'Beef') {
          const key = f === 1 ? 'cmc_beef_whole' : f === 0.5 ? 'cmc_beef_half' : f === 0.25 ? 'cmc_beef_quarter' : null
          if (!key) { unbillable.push(`${tag}: ${name} holds a ${f} share — no advertised price for that size`); continue }
          if (!hcw) { unbillable.push(`${tag}: ${name}'s ${fracWord(f)} beef needs a hanging weight`); continue }
          add({ ...src, key, rule: 'cmc_animal', payer, qty: hcw * f, unit: 'lb', date: h.harvest_date, what: `carcass ${h.carcass_tag ?? ''}, ${round2(hcw * f)} lbs hanging (${fracWord(f)})` })
        } else if (h.species === 'Hog') {
          const key = f === 1 ? 'cmc_hog_whole' : f === 0.5 ? 'cmc_hog_half' : null
          if (!key) { unbillable.push(`${tag}: ${name} holds a ${f} share of a hog — no advertised price`); continue }
          add({ ...src, key, rule: 'cmc_animal', payer, qty: 1, unit: 'ea', date: h.harvest_date, what: `carcass ${h.carcass_tag ?? ''} (${fracWord(f)})` })
        } else if (h.species === 'Lamb' && f === 1) {
          add({ ...src, key: 'cmc_lamb_whole', rule: 'cmc_animal', payer, qty: 1, unit: 'ea', date: h.harvest_date, what: `carcass ${h.carcass_tag ?? ''}` })
        } else {
          unbillable.push(`${tag}: no advertised price for a ${fracWord(f)} ${h.species.toLowerCase()}`)
        }
      }
      continue
    }

    // Customer animal: split into payer shares.
    const producer = h.producer!
    if (!assigned && ((appt?.customers ?? []) as AppointmentCustomer[]).some(s => s.payment_responsibility === 'customer')) {
      unbillable.push(`${tag}: ${producer}'s ${appt?.head_count ?? 'multi'}-head booking has customer-paid shares but no buyer assigned to this carcass — assign it on the cut schedule`)
      continue
    }
    const byName = new Map<string, { frac: number; allQuarters: boolean; slots: AppointmentCustomer[] }>()
    const producerSlots: AppointmentCustomer[] = []
    let customerPaid = 0
    for (const s of slots) {
      const f = PORTION_FRACTION[s.portion] ?? 0
      if ((s.payment_responsibility ?? 'producer') !== 'customer' || !s.customer_name?.trim() || f <= 0) { producerSlots.push(s); continue }
      customerPaid += f
      const prev = byName.get(s.customer_name.trim())
      byName.set(s.customer_name.trim(), { frac: (prev?.frac ?? 0) + f, allQuarters: (prev?.allQuarters ?? true) && s.portion === 'Quarter', slots: [...(prev?.slots ?? []), s] })
    }
    const shares = [...byName.entries()].map(([name, s]) => ({ payer: customerPayer(name, s.slots), frac: Math.min(s.frac, 1), allQuarters: s.allQuarters, slots: s.slots }))
    const remainder = Math.max(0, 1 - customerPaid)
    if (remainder > 0.001) shares.push({ payer: producerPayer(producer, appt), frac: remainder, allQuarters: remainder === 0.25, slots: producerSlots })

    for (const sh of shares) {
      // Negotiated rates: every cut card on the share has to agree.
      const ids = sh.slots.map(s => s.linked_cutting_instruction_id).filter(Boolean)
      const seen = (field: 'kill_price_per_lb' | 'processing_price_per_lb') =>
        new Set(ids.map(id => { const v = toNum(cardById.get(id)?.[field] ?? null); return v != null && v > 0 ? v.toFixed(4) : 'standard' }))
      const ks = seen('kill_price_per_lb'), ps = seen('processing_price_per_lb')
      if (ks.size > 1 || ps.size > 1) {
        unbillable.push(`${tag}: cut cards on ${sh.payer.name}'s share disagree on rates — make them match on the cut card`)
        continue
      }
      const pick = (s: Set<string>) => { const v = [...s][0]; return !v || v === 'standard' ? null : Number(v) }
      const killRate = pick(ks), procRate = pick(ps)
      const share = sh.frac < 1 ? ` (${fracWord(sh.frac)} share)` : ''

      // Kill fee
      if (h.species === 'Beef' || h.species === 'Hog') {
        if (!hcw) unbillable.push(`${tag}: kill fee needs a carcass weight`)
        else add({ ...src, key: h.species === 'Hog' ? 'hog_kill' : appt?.kill_only ? 'beef_kill_only' : 'beef_kill', rule: 'kill_fee', payer: sh.payer,
          qty: hcw * sh.frac, unit: 'lb', date: h.harvest_date, what: `carcass ${h.carcass_tag ?? ''}, ${round2(hcw * sh.frac)} lbs${share}`, cardRate: killRate })
      } else if (h.species === 'Lamb') {
        add({ ...src, key: 'lamb_kill_only', rule: 'kill_fee', payer: sh.payer, qty: sh.frac, unit: 'ea', date: h.harvest_date, what: `carcass ${h.carcass_tag ?? ''}${share}` })
      }

      // Cut & wrap, once cut (never on a kill-only booking)
      if (h.status !== 'cut' || appt?.kill_only) continue
      if (h.species === 'Lamb') supersededLambIds.push(h.id)
      const date = cutDate.get(h.id) || today
      if (h.species === 'Beef' || h.species === 'Hog') {
        if (!hcw) { unbillable.push(`${tag}: cut & wrap needs a carcass weight`); continue }
        const key = h.species === 'Hog' ? 'hog_proc' : sh.allQuarters ? 'beef_proc_quarter' : 'beef_proc_whole_half'
        add({ ...src, key, rule: 'cut_wrap', payer: sh.payer, qty: hcw * sh.frac, unit: 'lb', date, what: `carcass ${h.carcass_tag ?? ''}, ${round2(hcw * sh.frac)} lbs`, cardRate: procRate })
      } else if (h.species === 'Lamb' || h.species === 'Goat') {
        add({ ...src, key: h.species === 'Lamb' ? 'lamb_proc' : 'goat_proc', rule: 'cut_wrap', payer: sh.payer, qty: sh.frac, unit: 'ea', date, what: `carcass ${h.carcass_tag ?? ''}${share}` })
      }
    }
  }
  // A fully processed lamb pays the flat fee, not the kill-only fee.
  const superseded = new Set(supersededLambIds)
  const carcassEvents = events.filter(e => !(e.rule_key === 'kill_fee' && superseded.has(e.source_id)))
  events.length = 0
  events.push(...carcassEvents)

  // ── Per booking: outdoor kill, rush ──────────────────────────────────────
  let bookings = 0
  for (const a of appts) {
    if (!a.outdoor_kill && !a.rush) continue
    const producer = producerOfAppt.get(a.id)
    if (!producer || isExcludedProducer(producer)) continue
    bookings++
    const payer = producerPayer(producer, a)
    const tag = `booking ${a.harvest_date} ${producer}`
    if (a.outdoor_kill) add({ key: 'outdoor_kill', rule: 'outdoor_kill', sourceTable: 'harvest_appointments', sourceId: a.id, payer, qty: 1, unit: 'ea', date: a.harvest_date, what: `${a.species} booked ${a.harvest_date}`, tag })
    if (a.rush)         add({ key: 'rush',         rule: 'rush',         sourceTable: 'harvest_appointments', sourceId: a.id, payer, qty: 1, unit: 'ea', date: a.harvest_date, what: `${a.species} booked ${a.harvest_date}`, tag })
  }

  // ── Per order ────────────────────────────────────────────────────────────
  // Box scans for every order, joined the way the scanner does: customer + pack date.
  const scanTotals = new Map<string, Map<string, number>>()   // session id → item → lbs
  if (sessions.length) {
    const boxes = await selectIn<{ id: string; customer_name: string; pack_date: string }>(
      [...new Set(sessions.map(s => s.customer_name))],
      b => supabaseAdmin.from('boxes').select('id, customer_name, pack_date').in('customer_name', b).gte('pack_date', opts.ordersSince), 60)
    const sessionOf = new Map(sessions.map(s => [`${s.customer_name}|${s.session_date}`, s.id]))
    const boxSession = new Map<string, string>()
    for (const b of boxes) { const sid = sessionOf.get(`${b.customer_name}|${b.pack_date}`); if (sid) boxSession.set(b.id, sid) }
    const scans = await selectIn<{ box_id: string; item_name: string | null; weight_lbs: number | string | null }>(
      [...boxSession.keys()], b => supabaseAdmin.from('box_scans').select('box_id, item_name, weight_lbs').in('box_id', b))
    for (const s of scans) {
      const sid = boxSession.get(s.box_id)!
      const item = (s.item_name ?? '').toUpperCase().trim()
      const m = scanTotals.get(sid) ?? new Map<string, number>()
      m.set(item, (m.get(item) ?? 0) + (Number(s.weight_lbs) || 0))
      scanTotals.set(sid, m)
    }
  }

  const bakerMonths = new Map<string, { payer: Payer; month: string }>()
  for (const s of sessions) {
    const appt = s.linked_appointment_id ? apptById.get(s.linked_appointment_id) : undefined
    const slots = (appt?.customers ?? []) as AppointmentCustomer[]
    const producer = appt ? producerOfAppt.get(appt.id) : undefined
    // The order's slot: by its cut card, else by name.
    const slot = slots.find(c => s.linked_cutting_instruction_id && c.linked_cutting_instruction_id === s.linked_cutting_instruction_id)
      ?? slots.find(c => nameKey(c.customer_name) === nameKey(s.customer_name))
    const customerPays = !!slot && ((slot.payment_responsibility ?? 'producer') === 'customer' || (!!producer && isExcludedProducer(producer)))
    const payer = customerPays ? customerPayer(slot!.customer_name, [slot!])
      : producer && !isExcludedProducer(producer) ? producerPayer(producer, appt)
      : customerPayer(s.customer_name)
    const species = appt?.species ?? 'Beef'
    const date = s.session_date
    const tag = `order ${s.customer_name} ${s.session_date}`
    const src = { sourceTable: 'processing_sessions', sourceId: s.id, payer, date, tag }

    // Finished lb off the box scans, one line per price key.
    const totals = scanTotals.get(s.id) ?? new Map<string, number>()
    const byKey = new Map<string, { lbs: number; items: Set<string> }>()
    let philly = false
    for (const [item, lbs] of totals) {
      if (PHILLY.test(item)) philly = true
      const rule = SCAN_RULES.find(r => r.test.test(item))
      if (!rule) continue
      const k = byKey.get(rule.key) ?? { lbs: 0, items: new Set<string>() }
      k.lbs += lbs; k.items.add(item)
      byKey.set(rule.key, k)
    }
    for (const [key, k] of byKey) {
      add({ ...src, key, rule: key, qty: k.lbs, unit: 'lb', what: `${round2(k.lbs)} lbs (${[...k.items].join(', ').toLowerCase()})` })
    }
    if (philly) add({ ...src, key: 'philly_slicing', rule: 'philly_slicing', qty: 1, unit: 'ea', what: 'Philly meat sliced' })

    // Raw lb in off the cut sheet's smokehouse block.
    const cardId = s.linked_cutting_instruction_id || slot?.linked_cutting_instruction_id
    const card = cardId ? cardById.get(cardId) : undefined
    if (card) {
      const smoke = new Map<string, number>()
      for (const l of smokeLines(card.data)) { const k = smokeKey(l, species); smoke.set(k, (smoke.get(k) ?? 0) + l.lbs) }
      for (const [key, lbs] of smoke) add({ ...src, key, rule: key, qty: lbs, unit: 'lb', what: `${round2(lbs)} lbs raw ordered on the cut sheet` })
    }

    // Baker storage.
    if (s.baker_storage_at) {
      const went = isoDate(new Date(s.baker_storage_at))
      if (went >= opts.ordersSince) add({ ...src, key: 'baker_transfer', rule: 'baker_transfer', qty: 1, unit: 'ea', date: went, what: `moved to Baker ${went}` })
      const until = s.status === 'baker_storage' ? today : isoDate(new Date(s.updated_at ?? s.baker_storage_at))
      for (const month of monthsBetween(went < opts.ordersSince ? opts.ordersSince : went, until)) {
        bakerMonths.set(`${nameKey(payer.name)}|${month}`, { payer, month })
      }
    }
  }
  for (const { payer, month } of bakerMonths.values()) {
    add({ key: 'baker_storage', rule: 'baker_storage', sourceTable: 'baker_month', sourceId: month, payer, qty: 1, unit: 'ea',
      date: `${month}-01`, what: `storage at Baker, ${month}`, tag: `Baker storage ${payer.name} ${month}` })
  }

  return {
    events, unbillable: [...new Set(unbillable)], supersededLambIds, excluded,
    scanned: { carcasses: harvests.length, bookings, orders: sessions.length },
  }
}
