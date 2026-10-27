// What a customer phone call can be about, in one place.
//
// The /calls entry form, its top-questions tally and the call_log table's
// check constraint (scripts/2026-10-27_call_log.sql) all have to agree on the
// list. Add a category here AND in the constraint, or the insert fails.
//
// The list is deliberately short and fixed: the whole value of the log is a
// clean count per category, and a free-text category can't be counted.

export type CallCategory =
  | 'status' | 'scheduling' | 'pricing' | 'pickup'
  | 'cut_sheet' | 'billing' | 'order' | 'other'

export interface CallCategorySpec {
  key: CallCategory
  /** Chip on the entry form and label in the tally. */
  label: string
  color: string
  /** One-line hint on the form for the desk, when a call could go two ways. */
  hint: string
}

// In the order the chips sit: the ones the phone rings for most, first.
export const CALL_CATEGORIES: CallCategorySpec[] = [
  { key: 'status',     label: 'Job status / ready date',     color: '#E8883A', hint: '"Is my beef ready?" — where an animal or order is right now' },
  { key: 'scheduling', label: 'Scheduling a harvest date',   color: '#A78BFA', hint: 'Booking, moving or cancelling a kill date' },
  { key: 'pricing',    label: 'Pricing',                     color: '#4CAF50', hint: 'Processing fees, per-pound rates, deposits' },
  { key: 'pickup',     label: 'Pickup hours & location',     color: '#60A5FA', hint: 'When and where to come get it, how long we hold it' },
  { key: 'cut_sheet',  label: 'Cut sheet question',          color: '#F59E0B', hint: 'How to fill it out, what a cut is, changing one already in' },
  { key: 'billing',    label: 'Billing or payment',          color: '#06B6D4', hint: 'Invoice amount, how to pay, what was charged' },
  { key: 'order',      label: 'Wholesale or retail order',   color: '#E879A0', hint: 'Buying product: retail counter, wholesale, online' },
  { key: 'other',      label: 'Other',                       color: '#A6785A', hint: 'Anything else — say what in the question box' },
]

const BY_KEY = new Map(CALL_CATEGORIES.map(c => [c.key, c]))

/** Spec for a stored category; unknown/legacy values render as Other. */
export function callCategorySpec(key: string): CallCategorySpec {
  return BY_KEY.get(key as CallCategory) ?? BY_KEY.get('other')!
}

export function isCallCategory(v: unknown): v is CallCategory {
  return typeof v === 'string' && BY_KEY.has(v as CallCategory)
}
