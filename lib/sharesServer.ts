// Server side of lib/shares.ts: everything /api/shares/* reads off the records
// a share order hands off to. Service role only — never import from a page.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { OWN_PRODUCER } from '@/lib/ownership'
import { addDaysISO, isoDate } from '@/lib/dates'
import {
  PORTION_FRACTION, SHARE_PORTIONS, SHARE_SPECIES, shareLbs,
  type ShareOrder, type ShareOrderView, type SharePrice, type ShareSpecies, type SharePortion,
} from '@/lib/shares'

/** The producer name our own bookings go on the schedule under. */
export const OWN_SOURCE = 'Cowboy Meat Company'

/** How far back the typical hanging weight looks. Same window as /demand. */
const WEIGHT_DAYS = 180

interface HarvestRow {
  id: string; appointment_id: string | null; harvest_date: string; species: string | null
  producer: string | null; carcass_tag: string | null
  hot_carcass_weight_lbs: number | null; half_1_weight_lbs: number | null; half_2_weight_lbs: number | null
}
const HARVEST_COLS = 'id, appointment_id, harvest_date, species, producer, carcass_tag, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs'
export const carcassLbs = (h: HarvestRow): number =>
  h.hot_carcass_weight_lbs != null
    ? Number(h.hot_carcass_weight_lbs)
    : Number(h.half_1_weight_lbs ?? 0) + Number(h.half_2_weight_lbs ?? 0)

/** Appointment slot as stored in harvest_appointments.customers. */
export interface Slot {
  id: string
  customer_name: string
  customer_id?: string | null
  portion: string
  payment_responsibility?: 'producer' | 'customer'
  contact_preference: string
  contact_value: string
  linked_cutting_instruction_id: string
  reminder_last_sent_at: string | null
  reminder_count: number
  qbo_customer_id?: string | null
  qbo_display_name?: string | null
  /** Set on slots /api/shares/schedule wrote, so the order can find itself. */
  share_order_id?: string | null
}
export interface ApptRow {
  id: string; harvest_date: string; species: string; head_count: number; source: string | null
  status: string; customers: Slot[] | null; kill_only?: boolean | null
}
export const APPT_COLS = 'id, harvest_date, species, head_count, source, status, customers, kill_only'

/** Head claimed by NAMED slots. A blank slot is the placeholder a new booking
 *  starts with, not a buyer — /schedule counts it, this does not, because the
 *  share being placed is going to take that placeholder's spot. */
export function claimedHead(slots: Slot[] | null | undefined): number {
  return (slots ?? []).reduce((n, s) => n + (s.customer_name?.trim() ? (PORTION_FRACTION[s.portion as SharePortion] ?? 0) : 0), 0)
}
export const isOwnBooking = (a: { source: string | null }) => OWN_PRODUCER.test(a.source ?? '')

export async function loadPrices(): Promise<SharePrice[]> {
  const { data, error } = await supabaseAdmin
    .from('share_prices')
    .select('id, species, portion, price_per_lb, qbo_item_id, qbo_item_name, est_hanging_lbs')
    .order('species').order('portion')
  if (error) throw new Error(error.message)
  const rows = (data ?? []) as SharePrice[]
  // Every species × portion the shop sells, whether or not a row exists yet.
  const have = new Set(rows.map(r => `${r.species}|${r.portion}`))
  for (const s of SHARE_SPECIES) for (const p of SHARE_PORTIONS[s]) {
    if (!have.has(`${s}|${p}`)) rows.push({ id: '', species: s, portion: p, price_per_lb: null, qbo_item_id: null, qbo_item_name: null, est_hanging_lbs: null })
  }
  return rows.map(r => ({
    ...r,
    price_per_lb:    r.price_per_lb    != null ? Number(r.price_per_lb)    : null,
    est_hanging_lbs: r.est_hanging_lbs != null ? Number(r.est_hanging_lbs) : null,
  }))
}

/** Average whole-carcass hanging weight of our own animals, per species, off
 *  the last six months of kills. Null for a species we haven't killed. */
export async function typicalHangingLbs(): Promise<Partial<Record<ShareSpecies, { lbs: number; head: number }>>> {
  const { data, error } = await supabaseAdmin
    .from('harvest_log')
    .select(HARVEST_COLS)
    .gte('harvest_date', addDaysISO(isoDate(), -WEIGHT_DAYS))
    .range(0, 4999)
  if (error) throw new Error(error.message)
  const acc = new Map<string, { lbs: number; head: number }>()
  for (const h of (data ?? []) as HarvestRow[]) {
    if (!OWN_PRODUCER.test(h.producer ?? '')) continue
    const w = carcassLbs(h)
    if (!(w > 0)) continue
    const sp = (h.species ?? '').trim()
    const a = acc.get(sp) ?? { lbs: 0, head: 0 }
    a.lbs += w; a.head += 1
    acc.set(sp, a)
  }
  const out: Partial<Record<ShareSpecies, { lbs: number; head: number }>> = {}
  for (const s of SHARE_SPECIES) {
    const a = acc.get(s)
    if (a && a.head > 0) out[s] = { lbs: Math.round(a.lbs / a.head), head: a.head }
  }
  return out
}

/** Typical hanging weight to quote from: the kill floor's average when we
 *  have one, else the number typed on the price list. */
export function quoteLbs(species: ShareSpecies, prices: SharePrice[], typical: Partial<Record<ShareSpecies, { lbs: number }>>): number | null {
  const t = typical[species]?.lbs
  if (t && t > 0) return t
  const p = prices.find(r => r.species === species && r.est_hanging_lbs != null)
  return p?.est_hanging_lbs ?? null
}

/** Hanging weight, kill day, cut card and invoice for each order, read off
 *  the booking slot it points at. Never stored on the order: the kill floor
 *  record is the record. */
export async function enrichOrders(orders: ShareOrder[]): Promise<ShareOrderView[]> {
  const apptIds = [...new Set(orders.map(o => o.appointment_id).filter((x): x is string => !!x))]
  const orderIds = orders.map(o => o.id)

  const [appts, assigns, logs, events] = await Promise.all([
    apptIds.length
      ? supabaseAdmin.from('harvest_appointments').select(APPT_COLS).in('id', apptIds)
      : Promise.resolve({ data: [] as ApptRow[], error: null }),
    apptIds.length
      ? supabaseAdmin.from('carcass_assignments').select('harvest_log_id, appointment_id, appointment_customer_id').in('appointment_id', apptIds)
      : Promise.resolve({ data: [] as { harvest_log_id: string; appointment_id: string; appointment_customer_id: string }[], error: null }),
    apptIds.length
      ? supabaseAdmin.from('harvest_log').select(HARVEST_COLS).in('appointment_id', apptIds)
      : Promise.resolve({ data: [] as HarvestRow[], error: null }),
    orderIds.length
      ? supabaseAdmin.from('billable_events').select('id, source_id, status, amount').eq('source_table', 'share_orders').in('source_id', orderIds)
      : Promise.resolve({ data: [] as { id: string; source_id: string; status: string; amount: number }[], error: null }),
  ])
  if (appts.error) throw new Error(appts.error.message)
  if (logs.error) throw new Error(logs.error.message)
  // carcass_assignments may not exist on an older database; the booking's
  // only carcass is the fallback either way.

  const apptById  = new Map(((appts.data ?? []) as ApptRow[]).map(a => [a.id, a]))
  const logById   = new Map(((logs.data ?? []) as HarvestRow[]).map(l => [l.id, l]))
  const logsByAppt = new Map<string, HarvestRow[]>()
  for (const l of (logs.data ?? []) as HarvestRow[]) {
    if (!l.appointment_id) continue
    logsByAppt.set(l.appointment_id, [...(logsByAppt.get(l.appointment_id) ?? []), l])
  }
  const logBySlot = new Map<string, string>()
  for (const a of (assigns.data ?? []) as { harvest_log_id: string; appointment_id: string; appointment_customer_id: string }[]) {
    logBySlot.set(`${a.appointment_id}|${a.appointment_customer_id}`, a.harvest_log_id)
  }
  // Newest event per order wins; a superseded one is history.
  const eventByOrder = new Map<string, { id: string; status: string; amount: number }>()
  for (const e of (events.data ?? []) as { id: string; source_id: string; status: string; amount: number }[]) {
    const prev = eventByOrder.get(e.source_id)
    if (!prev || prev.status === 'superseded') eventByOrder.set(e.source_id, e)
  }

  return orders.map(o => {
    const appt = o.appointment_id ? apptById.get(o.appointment_id) : undefined
    const slot = appt?.customers?.find(s => s.id === o.appointment_customer_id)
    let log: HarvestRow | undefined
    if (appt) {
      const assigned = logBySlot.get(`${appt.id}|${o.appointment_customer_id}`)
      if (assigned) log = logById.get(assigned)
      // One animal on the booking means every slot is a share of it.
      if (!log) {
        const own = logsByAppt.get(appt.id) ?? []
        if (own.length === 1) log = own[0]
      }
    }
    const hanging = log ? carcassLbs(log) : 0
    const ev = eventByOrder.get(o.id)
    return {
      ...o,
      price_per_lb:   o.price_per_lb != null ? Number(o.price_per_lb) : null,
      harvest_date:   appt?.harvest_date ?? null,
      carcass_tag:    log?.carcass_tag ?? null,
      hanging_lbs:    hanging > 0 ? Math.round(hanging * 10) / 10 : null,
      share_lbs:      hanging > 0 ? shareLbs(hanging, o.portion) : null,
      cut_card_in:    !!slot?.linked_cutting_instruction_id,
      invoice_status: ev?.status ?? null,
      invoice_amount: ev ? Number(ev.amount) : null,
    }
  })
}

/** The customers-table record for a buyer: matched on name (exact,
 *  case-insensitive — the same rule the schedule uses), else created. */
export async function ensureCustomer(o: Pick<ShareOrder, 'customer_name' | 'phone' | 'email' | 'preferred_contact'>): Promise<string | null> {
  const name = o.customer_name.trim()
  if (!name) return null
  try {
    const { data: found } = await supabaseAdmin.from('customers').select('id').ilike('name', name).limit(1)
    if (found?.[0]?.id) return found[0].id as string
    const { data: created } = await supabaseAdmin
      .from('customers')
      .insert([{
        name,
        ranch_name: '',
        phone: o.phone ?? '',
        email: o.email ?? '',
        preferred_contact: o.preferred_contact || 'Phone Call',
        notes: 'Auto-created from a whole/half/quarter order',
        role: 'customer',
      }])
      .select('id')
      .single()
    return (created?.id as string | undefined) ?? null
  } catch {
    return null
  }
}
