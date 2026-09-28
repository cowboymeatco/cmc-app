// Plant-wide kanban ordering: types and the lean arithmetic behind the board.
//
// A kanban loop, as the cards in this app model it:
//   • The CARD is the order. When a bin empties (two-bin) or stock drops to the
//     reorder line (reorder-point card), someone pulls the card — scans its QR
//     or taps it on the board — and that pull is the signal.
//   • Whoever orders works the ORDER SHEET: pulled cards grouped by vendor, so
//     each vendor gets one call/email/PO, with their cutoff, minimum and
//     free-freight line in front of them.
//   • Received closes the loop and records the ACTUAL lead time, which is what
//     the sizing math below should be trusting.
//
// Sizing (units are the item's `unit`, not the order unit):
//   demand during lead time  = daily usage × lead days
//   safety stock             = daily usage × safety days
//   reorder point            = demand during lead time + safety stock
//   two-bin: each bin must hold at least the reorder point — the second bin is
//   what you live on while the order is in transit.
//   kanban qty (order units) = ceil(reorder point ÷ units per order unit),
//   rounded up to the vendor minimum.
//
// Nothing here orders anything. Every step is a person's tap.
import { addDaysISO, dayOfWeekISO, daysBetweenISO, isoDate } from '@/lib/dates'

export const CATEGORIES = [
  'Packaging & Film',
  'Labels & Printing',
  'Cleaning & Sanitation',
  'PPE & Safety',
  'Knives & Small Tools',
  'Smokehouse & Casings',
  'Maintenance & Parts',
  'Office & Retail',
  'Other',
] as const

/** Card colour per category — lean shops colour-code so a glance says whose it is. */
export const CATEGORY_COLOR: Record<string, string> = {
  'Packaging & Film':      '#60A5FA',
  'Labels & Printing':     '#A78BFA',
  'Cleaning & Sanitation': '#38BDF8',
  'PPE & Safety':          '#F59E0B',
  'Knives & Small Tools':  '#EF4444',
  'Smokehouse & Casings':  '#F97316',
  'Maintenance & Parts':   '#9CA3AF',
  'Office & Retail':       '#E879A0',
  'Other':                 '#A6785A',
}

export const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const

export const ORDER_METHODS = ['phone', 'email', 'web', 'text', 'rep', 'other'] as const
export const ORDER_METHOD_LABEL: Record<string, string> = {
  phone: '📞 Call', email: '✉️ Email', web: '🌐 Online', text: '💬 Text', rep: '🤝 Rep visit', other: 'Other',
}

export const CARD_TYPE_LABEL: Record<string, string> = {
  two_bin:       'Two-bin',
  reorder_point: 'Reorder point',
  single:        'Single card',
}

export interface Vendor {
  id: string
  name: string
  contact_name: string | null
  phone: string | null
  email: string | null
  website: string | null
  account_number: string | null
  order_method: string
  order_days: string[]
  order_cutoff: string | null
  delivery_days: string[]
  lead_days: number | null
  min_order: number | null
  free_freight_at: number | null
  payment_terms: string | null
  notes: string | null
  active: boolean
  updated_at: string
  updated_by: string | null
}

export interface Item {
  id: string
  card_no: number
  name: string
  description: string | null
  category: string
  location: string | null
  backstock_location: string | null
  card_type: 'two_bin' | 'reorder_point' | 'single'
  cards_in_loop: number
  unit: string | null
  order_unit: string | null
  units_per_order_unit: number | null
  order_qty: number | null
  min_order_qty: number | null
  bin_qty: number | null
  reorder_point: number | null
  price: number | null
  price_updated_at: string | null
  vendor_id: string | null
  vendor_sku: string | null
  alt_vendor_id: string | null
  alt_vendor_sku: string | null
  manufacturer: string | null
  mfg_part_no: string | null
  lead_days: number | null
  daily_usage: number | null
  safety_days: number
  owner: string | null
  order_instructions: string | null
  sds_url: string | null
  notes: string | null
  learned_lead_days: number | null
  last_ordered_at: string | null
  last_received_at: string | null
  active: boolean
  updated_at: string
  updated_by: string | null
}

export type SignalStatus = 'pulled' | 'ordered' | 'received' | 'cancelled'

export interface Signal {
  id: string
  item_id: string
  card_seq: number | null
  status: SignalStatus
  urgency: 'normal' | 'out'
  qty: number | null
  source: 'scan' | 'board'
  pulled_by: string
  pulled_at: string
  vendor_id: string | null
  unit_price: number | null
  ordered_by: string | null
  ordered_at: string | null
  po_number: string | null
  expected_on: string | null
  received_by: string | null
  received_at: string | null
  received_qty: number | null
  note: string | null
}

/** Fields the item editor may write. Anything else in a POST body is ignored. */
export const ITEM_FIELDS = [
  'name', 'description', 'category', 'location', 'backstock_location', 'card_type',
  'cards_in_loop', 'unit', 'order_unit', 'units_per_order_unit', 'order_qty',
  'min_order_qty', 'bin_qty', 'reorder_point', 'price', 'vendor_id', 'vendor_sku',
  'alt_vendor_id', 'alt_vendor_sku', 'manufacturer', 'mfg_part_no', 'lead_days',
  'daily_usage', 'safety_days', 'owner', 'order_instructions', 'sds_url', 'notes', 'active',
] as const

export const VENDOR_FIELDS = [
  'name', 'contact_name', 'phone', 'email', 'website', 'account_number', 'order_method',
  'order_days', 'order_cutoff', 'delivery_days', 'lead_days', 'min_order',
  'free_freight_at', 'payment_terms', 'notes', 'active',
] as const

// ── Formatting ──────────────────────────────────────────────────────────

export function cardLabel(n: number): string {
  return `K-${String(n).padStart(3, '0')}`
}

export function money(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
}

export function qtyText(n: number | null | undefined, unit: string | null | undefined): string {
  if (n == null) return '—'
  const v = Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '')
  return unit ? `${v} ${unit}` : v
}

// ── Lead time and sizing ────────────────────────────────────────────────

/**
 * The lead time to plan with, and where it came from. The item's own number
 * wins over the vendor's default; a learned number (actual receipts) is shown
 * beside it but never silently swapped in — it's somebody's call to adopt it.
 */
export function leadDays(item: Item, vendor: Vendor | undefined): { days: number | null; from: 'item' | 'vendor' | null } {
  if (item.lead_days != null) return { days: item.lead_days, from: 'item' }
  if (vendor?.lead_days != null) return { days: vendor.lead_days, from: 'vendor' }
  return { days: null, from: null }
}

export interface Sizing {
  lead: number | null
  demandDuringLead: number | null     // units
  safetyStock: number | null          // units
  reorderPoint: number | null         // units
  suggestedOrderQty: number | null    // order units per card
  coverDays: number | null            // days one card's order lasts
  flag: 'undersized' | 'oversized' | 'ok' | 'unknown'
  note: string
}

export function sizing(item: Item, vendor: Vendor | undefined): Sizing {
  const lead = leadDays(item, vendor).days
  const use = item.daily_usage
  const per = item.units_per_order_unit && item.units_per_order_unit > 0 ? item.units_per_order_unit : 1

  if (use == null || use <= 0 || lead == null) {
    return {
      lead, demandDuringLead: null, safetyStock: null, reorderPoint: null,
      suggestedOrderQty: null, coverDays: null, flag: 'unknown',
      note: use == null || use <= 0 ? 'Add daily usage to size this card' : 'Add a lead time to size this card',
    }
  }

  const demandDuringLead = use * lead
  const safetyStock = use * (item.safety_days ?? 0)
  const reorderPoint = demandDuringLead + safetyStock
  let suggested = Math.ceil(reorderPoint / per)
  if (item.min_order_qty && suggested < item.min_order_qty) suggested = item.min_order_qty
  suggested = Math.max(1, suggested)

  const orderUnits = item.order_qty
  const coverDays = orderUnits ? (orderUnits * per) / use : null

  let flag: Sizing['flag'] = 'ok'
  let note = 'Sized right'
  if (orderUnits == null) {
    flag = 'unknown'
    note = `Set the order qty — suggested ${suggested}`
  } else if (orderUnits * per < reorderPoint) {
    // One card's order won't carry the loop through the next lead time: the
    // shelf goes empty before the truck shows up.
    flag = 'undersized'
    note = `Runs out before the order lands — raise to ${suggested}`
  } else if (orderUnits * per > reorderPoint * 3 && orderUnits > (item.min_order_qty ?? 0)) {
    // Over-ordering ties up cash and shelf, the waste lean calls inventory.
    flag = 'oversized'
    note = `More than 3× what the lead time needs — ${suggested} would do`
  }
  return { lead, demandDuringLead, safetyStock, reorderPoint, suggestedOrderQty: suggested, coverDays, flag, note }
}

/** $ for one card's order. */
export function cardValue(item: Item): number | null {
  if (item.price == null || item.order_qty == null) return null
  return item.price * item.order_qty
}

// ── Vendor calendar ─────────────────────────────────────────────────────

/** The next day (today counts) this vendor takes orders, on the shop clock. */
export function nextOrderDay(vendor: Vendor | undefined, fromISO: string = isoDate()): string {
  if (!vendor || vendor.order_days.length === 0) return fromISO
  for (let i = 0; i < 7; i++) {
    const d = addDaysISO(fromISO, i)
    if (vendor.order_days.includes(DAYS[dayOfWeekISO(d)])) return d
  }
  return fromISO
}

/** When an order placed on `orderedISO` should land. */
export function expectedOn(orderedISO: string, lead: number | null): string | null {
  return lead == null ? null : addDaysISO(orderedISO, lead)
}

/** Days late (positive) or early/on time (≤0). Null if there's no ETA. */
export function daysLate(sig: Signal, todayISO: string = isoDate()): number | null {
  if (!sig.expected_on) return null
  return daysBetweenISO(sig.expected_on, todayISO)
}

// ── Health ──────────────────────────────────────────────────────────────

export interface ItemHealth {
  cycles: number             // cards received in the window
  stockouts: number          // pulls flagged OUT in the window
  avgLead: number | null     // actual ordered → received, days
  avgPullToReceive: number | null
  onTimePct: number | null
  spend: number
}

/** Rolls signals for one item (already filtered to the window) into numbers. */
export function itemHealth(sigs: Signal[]): ItemHealth {
  const received = sigs.filter(s => s.status === 'received' && s.received_at)
  const leads: number[] = []
  const pulls: number[] = []
  let onTime = 0, withEta = 0, spend = 0
  for (const s of received) {
    const rec = isoDate(new Date(s.received_at!))
    if (s.ordered_at) leads.push(daysBetweenISO(isoDate(new Date(s.ordered_at)), rec))
    pulls.push(daysBetweenISO(isoDate(new Date(s.pulled_at)), rec))
    if (s.expected_on) { withEta++; if (rec <= s.expected_on) onTime++ }
    const q = s.received_qty ?? s.qty
    if (q != null && s.unit_price != null) spend += q * s.unit_price
  }
  const avg = (a: number[]) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null
  return {
    cycles: received.length,
    stockouts: sigs.filter(s => s.urgency === 'out' && s.status !== 'cancelled').length,
    avgLead: avg(leads),
    avgPullToReceive: avg(pulls),
    onTimePct: withEta ? Math.round((onTime / withEta) * 100) : null,
    spend,
  }
}

/** Order text for one vendor: what the person pastes into an email or reads down the phone. */
export function orderText(
  vendor: Vendor | undefined,
  lines: { item: Item; qty: number | null }[],
  from = 'Cowboy Meat Co. · 1109 Front St, Forsyth MT · (406) 346-7660',
): string {
  const head = [
    `Order for ${vendor?.name ?? 'vendor'}`,
    vendor?.account_number ? `Account #: ${vendor.account_number}` : null,
    '',
  ].filter(l => l !== null) as string[]
  const body = lines.map(({ item, qty }) => {
    const sku = item.vendor_sku ? ` [${item.vendor_sku}]` : ''
    const unit = item.order_unit ?? item.unit ?? ''
    return `• ${qty ?? '?'} ${unit} — ${item.name}${sku}`.replace(/\s+—/, ' —')
  })
  return [...head, ...body, '', `Ship to: ${from}`, 'Thank you!'].join('\n')
}
