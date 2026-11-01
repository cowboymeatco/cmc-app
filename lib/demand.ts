// Demand: what the open orders want that the plant cannot already cover.
//
// Charlie, 2026-11-01: "make me a demand page in the app so I know what I need
// to procure." Scope agreed the same day: meat only, every open order, a plain
// staff page.
//
// Three figures per item, and the arithmetic between them is the whole page:
//
//   short    what open retail orders (the Retail Case restock order included)
//            still need — ordered less what the scanner has packed against them
//   on hand  the last CLOSED physical count of each room, added up
//   coming   our own animals hanging or booked, turned into pounds of this item
//            by the yield the scanner has measured on our own past sessions
//
//   to buy = short − on hand − coming, floored at zero
//
// Everything here is arithmetic on rows the route has already fetched, so it
// can be read and checked without a database. The route (app/api/demand) does
// the fetching; the page (app/demand) does the showing.
//
// Nothing is ordered. This is a list for a person to act on.

export type SaleUnit = 'LB' | 'EA'

/** An open order line, with what the scanner has packed against it. */
export interface OpenLine {
  order_id:      string
  customer_name: string
  due_date:      string
  status:        string
  plu_number:    string | null
  item_name:     string
  unit:          string
  qty_ordered:   number
  qty_filled:    number
  /** Pounds (LB) or packages (EA) scanned into a box linked to this order. */
  scanned_qty?:  number | null
}

/** The last closed count of one room. */
export interface RoomCount {
  location:   string
  count_date: string
  closed_at:  string | null
}

/** What one PLU makes per hanging pound of a species, off our own sessions. */
export interface YieldRate {
  lbPerHangLb:  number
  pkgPerHangLb: number
}

/** Own meat on its way to the freezer, by species. */
export interface SpeciesSupply {
  species:     string
  hangingHead: number
  hangingLbs:  number
  bookedHead:  number
  /** Booked head × the species' average hanging weight. An estimate, and said so. */
  bookedLbs:   number
  /** How many own sessions the yield rate rests on. 0 means no rate. */
  yieldSessions: number
  yieldHangLbs:  number
}

export interface DemandOrderRef {
  order_id:      string
  customer_name: string
  due_date:      string
  status:        string
  short:         number
  restock:       boolean
}

export interface DemandLine {
  /** PLU, or `name:<item>` for a free-text line nothing can be matched to. */
  key:        string
  plu_number: string | null
  item_name:  string
  species:    string | null
  unit:       SaleUnit
  ordered:    number
  filled:     number
  short:      number
  /** Null when no closed count exists at all; 0 when counts exist and none hold it. */
  onHand:     number | null
  /** Null when no own-session yield exists for this PLU. */
  coming:     number | null
  comingHanging: number
  comingBooked:  number
  toBuy:      number
  orders:     DemandOrderRef[]
}

/** The retail case's standing order (app/orders/page.tsx). Demand like any other, but named. */
export const RESTOCK_CUSTOMER = 'Retail Case'
export const isRestock = (name: string) => name.trim().toLowerCase() === RESTOCK_CUSTOMER.toLowerCase()

/** The scanner's weight wins over a hand-typed fill; a line nobody scanned keeps what was typed. */
export const filledQty = (l: OpenLine) => l.scanned_qty != null ? Number(l.scanned_qty) : Number(l.qty_filled) || 0

/** Full once it is within what the display rounds away (same rule as /orders). */
export const lineShort = (l: OpenLine) => {
  const s = Math.max(0, (Number(l.qty_ordered) || 0) - filledQty(l))
  return s < (saleUnit(l.unit) === 'LB' ? 0.05 : 0.5) ? 0 : s
}

/** Order lines carry LB or EA; anything else is treated as by the pound. */
export const saleUnit = (u: string | null | undefined): SaleUnit => (u ?? '').toUpperCase() === 'EA' ? 'EA' : 'LB'

export const r1 = (n: number) => Math.round(n * 10) / 10
export const r2 = (n: number) => Math.round(n * 100) / 100

/** to buy = short − on hand − coming, never below zero. Unknowns count as zero and are shown as unknown. */
export function netToBuy(short: number, onHand: number | null, coming: number | null): number {
  return Math.max(0, short - (onHand ?? 0) - (coming ?? 0))
}

/**
 * Pounds (and packages) of each PLU per hanging pound of each species.
 *
 * `scans` are the packages our own single-species sessions produced, each
 * tagged with the species of the carcasses on that bench; `hangLbs` is the
 * hanging weight those same sessions took in. A PLU with no scans in a species
 * has no rate for it, which is different from a rate of zero.
 */
export function yieldRates(
  scans:   { species: string; plu_number: string; lbs: number; pkgs: number }[],
  hangLbs: Map<string, number>,
): Map<string, Map<string, YieldRate>> {
  const acc = new Map<string, Map<string, { lbs: number; pkgs: number }>>()
  for (const s of scans) {
    const bySp = acc.get(s.species) ?? new Map()
    const t = bySp.get(s.plu_number) ?? { lbs: 0, pkgs: 0 }
    t.lbs += s.lbs; t.pkgs += s.pkgs
    bySp.set(s.plu_number, t)
    acc.set(s.species, bySp)
  }
  const out = new Map<string, Map<string, YieldRate>>()
  for (const [sp, bySp] of acc) {
    const hang = hangLbs.get(sp) ?? 0
    if (hang <= 0) continue
    const rates = new Map<string, YieldRate>()
    for (const [plu, t] of bySp) rates.set(plu, { lbPerHangLb: t.lbs / hang, pkgPerHangLb: t.pkgs / hang })
    out.set(sp, rates)
  }
  return out
}

/**
 * Fold open order lines into one demand line per PLU, net of the freezer and
 * what is coming, sorted by what has to be bought.
 */
export function buildDemandLines(args: {
  lines:    OpenLine[]
  plu:      Map<string, { item_name: string; species: string | null; sell_by_weight: boolean | null }>
  onHand:   Map<string, { lbs: number; pkgs: number }> | null
  supply:   SpeciesSupply[]
  yields:   Map<string, Map<string, YieldRate>>
}): DemandLine[] {
  const { lines, plu, onHand, supply, yields } = args
  const byKey = new Map<string, DemandLine>()

  for (const l of lines) {
    const short = lineShort(l)
    if (short <= 0) continue
    const info = l.plu_number ? plu.get(l.plu_number) : undefined
    // The PLU's sell-by-weight flag is the truth; the line's unit is what was typed.
    const unit: SaleUnit = info ? (info.sell_by_weight === false ? 'EA' : 'LB') : saleUnit(l.unit)
    const key = l.plu_number ?? `name:${l.item_name.trim().toLowerCase()}`
    const d = byKey.get(key) ?? {
      key, plu_number: l.plu_number, item_name: info?.item_name || l.item_name,
      species: info?.species ?? null, unit,
      ordered: 0, filled: 0, short: 0, onHand: null, coming: null,
      comingHanging: 0, comingBooked: 0, toBuy: 0, orders: [],
    }
    d.ordered += Number(l.qty_ordered) || 0
    d.filled  += filledQty(l)
    d.short   += short
    d.orders.push({
      order_id: l.order_id, customer_name: l.customer_name, due_date: l.due_date,
      status: l.status, short: r2(short), restock: isRestock(l.customer_name),
    })
    byKey.set(key, d)
  }

  for (const d of byKey.values()) {
    if (d.plu_number) {
      if (onHand) {
        const h = onHand.get(d.plu_number)
        d.onHand = h ? (d.unit === 'LB' ? h.lbs : h.pkgs) : 0
      }
      // Coming: every species' supply × that species' rate for this PLU.
      let hanging = 0, booked = 0, rated = false
      for (const s of supply) {
        const rate = yields.get(s.species)?.get(d.plu_number)
        if (!rate) continue
        rated = true
        const per = d.unit === 'LB' ? rate.lbPerHangLb : rate.pkgPerHangLb
        hanging += s.hangingLbs * per
        booked  += s.bookedLbs  * per
      }
      if (rated) { d.comingHanging = hanging; d.comingBooked = booked; d.coming = hanging + booked }
    }
    d.toBuy = netToBuy(d.short, d.onHand, d.coming)
    d.orders.sort((a, b) => a.due_date.localeCompare(b.due_date))
    // Round for the wire after the arithmetic, never before.
    d.ordered = r2(d.ordered); d.filled = r2(d.filled); d.short = r2(d.short)
    if (d.onHand != null) d.onHand = r2(d.onHand)
    if (d.coming != null) d.coming = r2(d.coming)
    d.comingHanging = r2(d.comingHanging); d.comingBooked = r2(d.comingBooked)
    d.toBuy = r2(d.toBuy)
  }

  return [...byKey.values()].sort((a, b) =>
    b.toBuy - a.toBuy || b.short - a.short || a.item_name.localeCompare(b.item_name))
}

export interface DemandSummary {
  linesShort:   number
  linesToBuy:   number
  lbsToBuy:     number
  pkgsToBuy:    number
  openOrders:   number
  restockOrder: boolean
}

export function summarize(lines: DemandLine[]): DemandSummary {
  const orders = new Set<string>()
  let restock = false
  for (const d of lines) for (const o of d.orders) { orders.add(o.order_id); if (o.restock) restock = true }
  return {
    linesShort:   lines.length,
    linesToBuy:   lines.filter(d => d.toBuy > 0).length,
    lbsToBuy:     r1(lines.filter(d => d.unit === 'LB').reduce((s, d) => s + d.toBuy, 0)),
    pkgsToBuy:    Math.ceil(lines.filter(d => d.unit === 'EA').reduce((s, d) => s + d.toBuy, 0) - 1e-9),
    openOrders:   orders.size,
    restockOrder: restock,
  }
}
