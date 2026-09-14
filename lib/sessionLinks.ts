// One ID from the kill floor to the invoice.
//
// Charlie (2026-09-13): "I assume we are coming back to a naming issue ... we
// are so close to really shoring this up." A packing session has always been
// the name somebody typed plus a date, and every box, carcass scan and cure
// tag hangs off that text. Over the last 60 days 59 of 289 sessions reached no
// animal at all, and 263 session names covered 204 customers.
//
// So a session now carries the animal: the appointment it's working and the
// cut card it's packing to. They're set when the session is started off a
// carcass tag, a cut card or the cooler list — or the first time a carcass tag
// is scanned into an older one — and everything made inside the session reads
// them back instead of re-deriving the animal from the name. The name stays,
// but only as the label the floor wants on the box.

import { supabase } from '@/lib/supabase'
import { parseCarcassTag } from '@/lib/carcassTag'
import { julianYYDDD } from '@/lib/label'

export interface SessionLinks {
  linked_appointment_id: string | null
  linked_cutting_instruction_id: string | null
}

export interface AnimalCard { id: string; customer_name: string; species: string | null; created_at: string | null }

export interface ResolvedAnimal {
  found: boolean
  kind: 'carcass' | 'card'
  /** The code as scanned, when it's a carcass tag — added to the session as its input. */
  carcass_code: string | null
  harvest_log_id: string | null
  appointment_id: string | null
  species: string | null
  producer: string | null
  tag: string | null
  side: 'L' | 'R' | null
  weight_lbs: number | null
  status: string | null
  /** Cut cards behind this animal. One = it's settled; several = the crew picks whose half. */
  cards: AnimalCard[]
  label: string
}

const CI_SCAN = /^CI-?([0-9A-F]{8})$/i
const num = (v: unknown) => (v == null || v === '' ? null : Number(v))

export async function getSessionLinks(customerName: string, sessionDate: string): Promise<SessionLinks> {
  const { data } = await supabase
    .from('processing_sessions')
    .select('linked_appointment_id, linked_cutting_instruction_id')
    .eq('customer_name', customerName.trim())
    .eq('session_date', sessionDate)
    .maybeSingle()
  return {
    linked_appointment_id: (data?.linked_appointment_id as string) ?? null,
    linked_cutting_instruction_id: (data?.linked_cutting_instruction_id as string) ?? null,
  }
}

/**
 * Fill in whichever links the session doesn't have yet. Never overwrites one
 * that's set — the first animal a session was opened or scanned against stays
 * its animal; a mixed session (CMC retail off several carcasses) keeps the
 * first and the carcass scans carry the rest.
 */
export async function fillSessionLinks(customerName: string, sessionDate: string, links: Partial<SessionLinks>): Promise<void> {
  const name = customerName.trim()
  if (links.linked_appointment_id) {
    await supabase.from('processing_sessions')
      .update({ linked_appointment_id: links.linked_appointment_id })
      .eq('customer_name', name).eq('session_date', sessionDate).is('linked_appointment_id', null)
  }
  if (links.linked_cutting_instruction_id) {
    await supabase.from('processing_sessions')
      .update({ linked_cutting_instruction_id: links.linked_cutting_instruction_id })
      .eq('customer_name', name).eq('session_date', sessionDate).is('linked_cutting_instruction_id', null)
  }
}

/** Every cut card behind an animal or an appointment: assignments, the card's own appointment_id, the appointment's customer rows. */
export async function cardsForAnimal(appointmentId: string | null, harvestLogId: string | null): Promise<AnimalCard[]> {
  const ids = new Set<string>()
  const [asg, byAppt, appt] = await Promise.all([
    harvestLogId
      ? supabase.from('carcass_assignments').select('linked_cutting_instruction_id').eq('harvest_log_id', harvestLogId)
      : Promise.resolve({ data: [] as { linked_cutting_instruction_id: string | null }[] }),
    appointmentId
      ? supabase.from('cutting_instructions').select('id').eq('appointment_id', appointmentId).neq('status', 'archived')
      : Promise.resolve({ data: [] as { id: string }[] }),
    appointmentId
      ? supabase.from('harvest_appointments').select('customers').eq('id', appointmentId).maybeSingle()
      : Promise.resolve({ data: null }),
  ])
  for (const a of asg.data ?? []) if (a.linked_cutting_instruction_id) ids.add(String(a.linked_cutting_instruction_id))
  for (const c of byAppt.data ?? []) ids.add(String(c.id))
  const customers = ((appt.data as { customers?: { linked_cutting_instruction_id?: string }[] } | null)?.customers ?? [])
  for (const c of customers) if (c.linked_cutting_instruction_id) ids.add(String(c.linked_cutting_instruction_id).trim())
  ids.delete('')
  if (!ids.size) return []
  const { data } = await supabase.from('cutting_instructions').select('id, customer_name, species, created_at').in('id', [...ids]).order('created_at')
  return (data ?? []).map(c => ({ id: String(c.id), customer_name: String(c.customer_name ?? '').trim(), species: (c.species as string) ?? null, created_at: (c.created_at as string) ?? null }))
}

/** A scanned carcass tag or cut card → the animal, its appointment and its cut card(s). */
export async function resolveAnimal(raw: string): Promise<ResolvedAnimal> {
  const code = String(raw ?? '').trim().toUpperCase()
  const empty = (kind: ResolvedAnimal['kind'], label: string): ResolvedAnimal => ({
    found: false, kind, carcass_code: null, harvest_log_id: null, appointment_id: null, species: null, producer: null,
    tag: null, side: null, weight_lbs: null, status: null, cards: [], label,
  })

  const ci = code.match(CI_SCAN)
  if (ci) {
    const hex = ci[1].toLowerCase()
    const { data: rows } = await supabase
      .from('cutting_instructions').select('id, appointment_id, customer_name, species, created_at').ilike('id', `${hex}%`).limit(2)
    if (!rows || rows.length !== 1) return empty('card', rows?.length ? 'That card code matches more than one sheet' : 'No cut card with that code')
    const card = rows[0]
    let appointmentId = (card.appointment_id as string) ?? null
    if (!appointmentId) {
      const { data: appts } = await supabase.from('harvest_appointments').select('id')
        .contains('customers', [{ linked_cutting_instruction_id: String(card.id) }]).limit(2)
      if (appts?.length === 1) appointmentId = String(appts[0].id)
    }
    return {
      found: true, kind: 'card', carcass_code: null, harvest_log_id: null, appointment_id: appointmentId,
      species: (card.species as string) ?? null, producer: null, tag: null, side: null, weight_lbs: null, status: null,
      cards: [{ id: String(card.id), customer_name: String(card.customer_name ?? '').trim(), species: (card.species as string) ?? null, created_at: (card.created_at as string) ?? null }],
      label: `📋 Cut card · ${String(card.customer_name ?? '').trim()}${card.species ? ` · ${card.species}` : ''}`,
    }
  }

  const tag = parseCarcassTag(code)
  if (!tag) return empty('carcass', 'Not a carcass tag or cut card')
  const cols = 'id, species, carcass_tag, harvest_date, producer, appointment_id, status, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs'
  const { data: h } = tag.legacyId
    ? await supabase.from('harvest_log').select(cols).eq('id', tag.legacyId).maybeSingle()
    : await supabase.from('harvest_log').select(cols).eq('harvest_date', tag.harvestDate!).eq('carcass_tag', tag.tag!).maybeSingle()
  if (!h) return { ...empty('carcass', `No kill record for ${code}`), carcass_code: code, tag: tag.tag, side: tag.side }

  const hcw = num(h.hot_carcass_weight_lbs) ?? (((num(h.half_1_weight_lbs) ?? 0) + (num(h.half_2_weight_lbs) ?? 0)) || null)
  const weight = hcw != null && tag.side ? Math.round(hcw / 2 * 10) / 10 : hcw
  const appointmentId = (h.appointment_id as string) ?? null
  const cards = await cardsForAnimal(appointmentId, String(h.id))
  return {
    found: true, kind: 'carcass', carcass_code: code, harvest_log_id: String(h.id), appointment_id: appointmentId,
    species: (h.species as string) ?? null, producer: (h.producer as string) ?? null,
    tag: (h.carcass_tag as string) ?? tag.tag, side: tag.side, weight_lbs: weight, status: (h.status as string) ?? null,
    cards,
    label: `${h.species ?? 'Carcass'} · Tag ${h.carcass_tag}${tag.side ? ` · ${tag.side} half` : ''}${weight ? ` · ${Math.round(weight)} lb` : ''}${h.producer ? ` · ${h.producer}` : ''}`,
  }
}

export interface CoolerAnimal {
  harvest_log_id: string
  code: string
  tag: string
  species: string | null
  producer: string | null
  harvest_date: string
  weight_lbs: number | null
  appointment_id: string | null
  scheduled_today: boolean
  /** One pick per customer on the animal — a split beef shows each half's card. */
  picks: { customer_name: string; cutting_instruction_id: string | null }[]
}

/** What's hanging, for starting a session by tapping instead of typing. Today's cut schedule first. */
export async function coolerAnimals(today: string): Promise<CoolerAnimal[]> {
  const since = new Date(Date.parse(today + 'T12:00:00') - 75 * 86400000).toISOString().slice(0, 10)
  const [{ data: hanging }, { data: sched }] = await Promise.all([
    supabase.from('harvest_log')
      .select('id, species, carcass_tag, harvest_date, producer, appointment_id, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
      .in('status', ['chilling', 'complete']).gte('harvest_date', since).order('harvest_date', { ascending: true }),
    supabase.from('cut_schedule_items').select('appointment_id').eq('schedule_date', today).eq('kind', 'carcass'),
  ])
  const rows = hanging ?? []
  if (!rows.length) return []
  const todayIds = new Set((sched ?? []).map(s => String(s.appointment_id)))
  const apptIds = [...new Set(rows.map(r => r.appointment_id).filter(Boolean))] as string[]
  const { data: appts } = apptIds.length
    ? await supabase.from('harvest_appointments').select('id, source, customers').in('id', apptIds)
    : { data: [] }
  const byAppt = new Map((appts ?? []).map(a => [String(a.id), a]))

  const out: CoolerAnimal[] = rows.map(r => {
    const appt = r.appointment_id ? byAppt.get(String(r.appointment_id)) : undefined
    const customers = ((appt?.customers ?? []) as { customer_name?: string; linked_cutting_instruction_id?: string }[])
      .map(c => ({ customer_name: (c.customer_name ?? '').trim(), cutting_instruction_id: (c.linked_cutting_instruction_id ?? '').trim() || null }))
      .filter(c => c.customer_name || c.cutting_instruction_id)
    const fallback = String(appt?.source ?? r.producer ?? '').trim()
    const hcw = num(r.hot_carcass_weight_lbs) ?? (((num(r.half_1_weight_lbs) ?? 0) + (num(r.half_2_weight_lbs) ?? 0)) || null)
    return {
      harvest_log_id: String(r.id),
      code: `${julianYYDDD(r.harvest_date as string)}-${r.carcass_tag}`,
      tag: String(r.carcass_tag ?? ''),
      species: (r.species as string) ?? null,
      producer: (r.producer as string) ?? null,
      harvest_date: r.harvest_date as string,
      weight_lbs: hcw,
      appointment_id: (r.appointment_id as string) ?? null,
      scheduled_today: todayIds.has(String(r.id)),
      picks: customers.length ? customers : [{ customer_name: fallback, cutting_instruction_id: null }],
    }
  })
  // Card names for picks that only carry a card id.
  const needNames = [...new Set(out.flatMap(a => a.picks.filter(p => !p.customer_name && p.cutting_instruction_id).map(p => p.cutting_instruction_id!)))]
  if (needNames.length) {
    const { data: cards } = await supabase.from('cutting_instructions').select('id, customer_name').in('id', needNames)
    const names = new Map((cards ?? []).map(c => [String(c.id), String(c.customer_name ?? '').trim()]))
    for (const a of out) for (const p of a.picks) if (!p.customer_name && p.cutting_instruction_id) p.customer_name = names.get(p.cutting_instruction_id) ?? ''
  }
  return out.sort((a, b) => Number(b.scheduled_today) - Number(a.scheduled_today) || a.harvest_date.localeCompare(b.harvest_date))
}

export interface BookingAnimal {
  harvest_log_id: string
  code: string
  tag: string
  species: string | null
  producer: string | null
  harvest_date: string
  weight_lbs: number | null
  status: string | null
}

/**
 * The carcasses on a cut card's booking — the short list for a tag that won't
 * scan once the card is in hand (Charlie, 2026-09-13). Also says how each card
 * on the booking is portioned, so a half's pick doesn't pull the whole carcass.
 */
export async function animalsOnBooking(appointmentId: string): Promise<{ animals: BookingAnimal[]; portions: Record<string, string> }> {
  const [{ data: rows }, { data: appt }] = await Promise.all([
    supabase.from('harvest_log')
      .select('id, species, carcass_tag, harvest_date, producer, status, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
      .eq('appointment_id', appointmentId).order('carcass_tag'),
    supabase.from('harvest_appointments').select('customers').eq('id', appointmentId).maybeSingle(),
  ])
  const portions: Record<string, string> = {}
  for (const c of ((appt?.customers ?? []) as { linked_cutting_instruction_id?: string; portion?: string }[])) {
    const id = (c.linked_cutting_instruction_id ?? '').trim()
    if (id) portions[id] = c.portion ?? 'Whole'
  }
  const animals = (rows ?? []).map(r => ({
    harvest_log_id: String(r.id),
    code: `${julianYYDDD(r.harvest_date as string)}-${r.carcass_tag}`,
    tag: String(r.carcass_tag ?? ''),
    species: (r.species as string) ?? null,
    producer: (r.producer as string) ?? null,
    harvest_date: r.harvest_date as string,
    weight_lbs: num(r.hot_carcass_weight_lbs) ?? (((num(r.half_1_weight_lbs) ?? 0) + (num(r.half_2_weight_lbs) ?? 0)) || null),
    status: (r.status as string) ?? null,
  }))
  return { animals, portions }
}
