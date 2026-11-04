// Whole / half / quarter sales of our own animals — the shapes and arithmetic
// shared by the public /buy form, the staff /shares queue and /api/shares/*.
// See scripts/2026-11-04_share_orders.sql for what each field means.

export type ShareSpecies = 'Beef' | 'Hog' | 'Lamb'
export type SharePortion = 'Whole' | 'Half' | 'Quarter'
export type ShareStatus  = 'requested' | 'confirmed' | 'scheduled' | 'ready' | 'picked_up' | 'cancelled'
export type ShareSource  = 'web' | 'phone' | 'walk_in' | 'email' | 'text'

export const SHARE_SPECIES: ShareSpecies[] = ['Beef', 'Hog', 'Lamb']
/** Which sizes each species sells in. A quarter hog or lamb is not a thing. */
export const SHARE_PORTIONS: Record<ShareSpecies, SharePortion[]> = {
  Beef: ['Whole', 'Half', 'Quarter'],
  Hog:  ['Whole', 'Half'],
  Lamb: ['Whole', 'Half'],
}
export const PORTION_FRACTION: Record<SharePortion, number> = { Whole: 1, Half: 0.5, Quarter: 0.25 }

export const isShareSpecies = (v: unknown): v is ShareSpecies => typeof v === 'string' && (SHARE_SPECIES as string[]).includes(v)
export const isSharePortion = (s: ShareSpecies, v: unknown): v is SharePortion =>
  typeof v === 'string' && (SHARE_PORTIONS[s] as string[]).includes(v)

export const SHARE_STATUSES: ShareStatus[] = ['requested', 'confirmed', 'scheduled', 'ready', 'picked_up', 'cancelled']
export const STATUS_LABEL: Record<ShareStatus, string> = {
  requested: 'Requested',
  confirmed: 'Confirmed · needs a kill date',
  scheduled: 'On the schedule',
  ready:     'Ready for pickup',
  picked_up: 'Picked up',
  cancelled: 'Cancelled',
}
export const SOURCE_LABEL: Record<ShareSource, string> = {
  web: 'Website', phone: 'Phone', walk_in: 'Walk-in', email: 'Email', text: 'Text',
}

export interface SharePrice {
  id:              string
  species:         ShareSpecies
  portion:         SharePortion
  price_per_lb:    number | null
  qbo_item_id:     string | null
  qbo_item_name:   string | null
  est_hanging_lbs: number | null
}

export interface ShareOrder {
  id:                      string
  created_at:              string
  updated_at:              string
  status:                  ShareStatus
  source:                  ShareSource
  taken_by:                string | null
  customer_id:             string | null
  customer_name:           string
  phone:                   string | null
  email:                   string | null
  preferred_contact:       string
  species:                 ShareSpecies
  portion:                 SharePortion
  wanted_month:            string | null
  fulfillment:             'pickup' | 'delivery'
  delivery_address:        string | null
  notes:                   string
  office_notes:            string
  price_per_lb:            number | null
  qbo_item_id:             string | null
  qbo_item_name:           string | null
  appointment_id:          string | null
  appointment_customer_id: string | null
  billable_event_id:       string | null
  confirmed_at:            string | null
  scheduled_at:            string | null
  ready_at:                string | null
  picked_up_at:            string | null
  cancelled_at:            string | null
  cancel_reason:           string | null
}

/** What /api/shares adds to each order from the records it hands off to. */
export interface ShareOrderView extends ShareOrder {
  harvest_date:     string | null   // the booking's kill day
  carcass_tag:      string | null
  /** Whole-carcass hanging weight off the kill floor; null until weighed. */
  hanging_lbs:      number | null
  /** hanging_lbs × the portion fraction, what the invoice line bills. */
  share_lbs:        number | null
  cut_card_in:      boolean
  /** The billable_events row, once written: pending, pushed, skipped … */
  invoice_status:   string | null
  invoice_amount:   number | null
}

/** Pounds on the invoice: the carcass weight times the share, to the tenth. */
export function shareLbs(hangingLbs: number | null | undefined, portion: SharePortion): number | null {
  if (hangingLbs == null || !(hangingLbs > 0)) return null
  return Math.round(hangingLbs * PORTION_FRACTION[portion] * 10) / 10
}

/** The quote: typical share pounds × $/lb, or null when either is unknown. */
export function estimateDollars(estHangingLbs: number | null | undefined, portion: SharePortion, pricePerLb: number | null | undefined): number | null {
  const lbs = shareLbs(estHangingLbs, portion)
  if (lbs == null || pricePerLb == null || !(pricePerLb > 0)) return null
  return Math.round(lbs * pricePerLb)
}

export const money = (n: number | null | undefined, digits = 0) =>
  n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}`

/** First-of-month ISO for a wanted month, from the <input type="month"> value. */
export function monthToISO(v: unknown): string | null {
  if (typeof v !== 'string') return null
  const m = /^(\d{4})-(\d{2})$/.exec(v.trim())
  return m ? `${m[1]}-${m[2]}-01` : null
}
export function monthLabel(iso: string | null): string {
  if (!iso) return 'Soonest available'
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

/** The customer's phone with the digits normalised, for matching on. */
export const digitsOf = (s: string | null | undefined) => (s ?? '').replace(/\D+/g, '')
