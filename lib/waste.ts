// Waste hauling — shared types and the arithmetic behind "pounds in, pounds
// out". Nothing derived is stored: every figure on the page comes through
// here so the route, the page and any later report agree.
//
// Pounds in is hanging weight (hot carcass), not live weight. Live weight is
// only on the harvest log when the producer brought a number, and most months
// it isn't there at all, so a ratio against it would mostly be a ratio
// against nothing. Hanging weight is on every animal. Where live weight does
// exist it is shown alongside, because offal and hide are the gap between the
// two and that gap is what most of a Colstrip load is.

export const WASTE_KINDS = ['mixed', 'offal', 'bone', 'fat', 'hide', 'paunch', 'other'] as const
export type WasteKind = typeof WASTE_KINDS[number]

export const KIND_LABEL: Record<WasteKind, string> = {
  mixed:  'Mixed',
  offal:  'Offal',
  bone:   'Bone',
  fat:    'Fat trim',
  hide:   'Hides',
  paunch: 'Paunch',
  other:  'Other',
}

export const WEIGH_METHODS = ['shop_scale', 'landfill_scale', 'estimate'] as const
export type WeighMethod = typeof WEIGH_METHODS[number]

export const METHOD_LABEL: Record<WeighMethod, string> = {
  shop_scale:     'Shop scale',
  landfill_scale: 'Landfill scale',
  estimate:       'Estimate',
}

export const METHOD_HINT: Record<WeighMethod, string> = {
  shop_scale:     'Each barrel or tote across the floor scale before it goes on the truck. Tap in every weight; the total is the gross.',
  landfill_scale: 'Truck across the landfill scale loaded, then empty. Gross in, tare out, off the ticket.',
  estimate:       'No scale this trip. Count the containers and call it; it still beats a blank.',
}

/** Where a load usually goes. Free text on the row; these are the taps. */
export const DESTINATIONS = ['Colstrip landfill', 'Forsyth transfer station', 'Rendering'] as const
export const DEFAULT_DESTINATION: string = DESTINATIONS[0]

export interface WasteHaul {
  id: string
  created_at: string
  hauled_on: string
  destination: string
  kind: WasteKind
  gross_lbs: number | null
  tare_lbs: number | null
  net_lbs: number
  weigh_method: WeighMethod
  container_count: number | null
  container_weights: number[] | null
  ticket_no: string | null
  fee_dollars: number | null
  odometer_out: number | null
  odometer_in: number | null
  hauled_by: string | null
  notes: string | null
}

/** What came in over the same stretch of days, off the harvest log. */
export interface PoundsIn {
  from: string
  to: string
  head: number
  hanging_lbs: number
  /** Sum of live weight where it was recorded; null when nobody recorded any. */
  live_lbs: number | null
  /** How many of `head` had a live weight. */
  live_head: number
  by_species: { species: string; head: number; hanging_lbs: number }[]
}

/** One processing day off waste_cutting_days(): what was scanned in against
 *  what crossed the scale as packages. */
export interface CuttingDay {
  day: string
  head: number
  sides: number
  carcass_lbs: number
  packages: number
  packed_lbs: number
}

export interface WastePayload {
  hauls: WasteHaul[]
  pounds_in: PoundsIn
  cutting: CuttingDay[]
}

export interface CuttingSummary {
  days: number
  head: number
  carcass_lbs: number
  packed_lbs: number
  /** carcass − packed. Negative when the window caught packing from earlier sides. */
  waste_lbs: number
  /** waste ÷ carcass, %. Null without carcass pounds. */
  pct: number | null
}

/** Window totals for the cutting floor. Per-day numbers wobble because a side
 *  scanned in late one day is boxed the next; the sum over the window is the
 *  number to quote. */
export function summarizeCutting(days: CuttingDay[]): CuttingSummary {
  const carcass = days.reduce((s, d) => s + Number(d.carcass_lbs), 0)
  const packed  = days.reduce((s, d) => s + Number(d.packed_lbs), 0)
  const head    = days.reduce((s, d) => s + Number(d.head), 0)
  return {
    days: days.length,
    head,
    carcass_lbs: carcass,
    packed_lbs: packed,
    waste_lbs: carcass - packed,
    pct: carcass > 0 ? ((carcass - packed) / carcass) * 100 : null,
  }
}

/** Net off whichever numbers the form has. Null when there isn't enough to say. */
export function netOf(gross: number | null, tare: number | null, net: number | null): number | null {
  if (net != null) return net
  if (gross != null) return Math.max(0, gross - (tare ?? 0))
  return null
}

export function sumWeights(ws: (number | null)[]): number {
  return ws.reduce<number>((s, w) => s + (w ?? 0), 0)
}

export interface WasteSummary {
  hauls: number
  net_lbs: number
  fee_dollars: number
  miles: number | null
  /** Hauled ÷ hanging pounds in, as a percentage. Null without pounds in. */
  pct_of_hanging: number | null
  /** Hauled ÷ live pounds in, where live weight was recorded. */
  pct_of_live: number | null
  lbs_per_head: number | null
  by_destination: { destination: string; hauls: number; net_lbs: number }[]
}

export function summarize(hauls: WasteHaul[], poundsIn: PoundsIn | null): WasteSummary {
  const net  = hauls.reduce((s, h) => s + Number(h.net_lbs), 0)
  const fees = hauls.reduce((s, h) => s + Number(h.fee_dollars ?? 0), 0)
  const legs = hauls.filter(h => h.odometer_out != null && h.odometer_in != null)
  const miles = legs.length
    ? legs.reduce((s, h) => s + (Number(h.odometer_in) - Number(h.odometer_out)), 0)
    : null

  const dest = new Map<string, { hauls: number; net_lbs: number }>()
  for (const h of hauls) {
    const d = dest.get(h.destination) ?? { hauls: 0, net_lbs: 0 }
    d.hauls += 1
    d.net_lbs += Number(h.net_lbs)
    dest.set(h.destination, d)
  }

  const hanging = poundsIn?.hanging_lbs ?? 0
  const live    = poundsIn?.live_lbs ?? null
  const head    = poundsIn?.head ?? 0

  return {
    hauls: hauls.length,
    net_lbs: net,
    fee_dollars: fees,
    miles,
    pct_of_hanging: hanging > 0 ? (net / hanging) * 100 : null,
    pct_of_live:    live != null && live > 0 && poundsIn && poundsIn.live_head === poundsIn.head
      ? (net / live) * 100 : null,
    lbs_per_head:   head > 0 ? net / head : null,
    by_destination: [...dest.entries()]
      .map(([destination, v]) => ({ destination, ...v }))
      .sort((a, b) => b.net_lbs - a.net_lbs),
  }
}

export const lbsFmt = (n: number | null | undefined, digits = 0): string =>
  n == null ? '—' : `${n.toLocaleString('en-US', { maximumFractionDigits: digits })} lb`

export const pctFmt = (n: number | null | undefined): string =>
  n == null ? '—' : `${n.toFixed(n >= 10 ? 0 : 1)}%`

export const dollars = (n: number | null | undefined): string =>
  n == null ? '—' : n.toLocaleString('en-US', { style: 'currency', currency: 'USD' })
