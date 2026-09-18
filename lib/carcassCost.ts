import { qboFetch } from '@/lib/qbo'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { OWN_PRODUCER } from '@/lib/ownership'

// What our own meat actually COST, per pound, for the balance sheet.
//
// WHY NOT A BLENDED RATE OFF COGS-Meats. That was the original plan and it was
// wrong twice over (checked against live bill lines, 2026-09-15):
//
//   1. COGS-Meats is not livestock. Every line in it is a food distributor —
//      purchased resale product. Cattle never touch it.
//   2. Livestock is capitalised as inventory ITEMS on item-based bill lines, and
//      those lines already carry a quantity and a unit price. The exact cost of
//      the exact animal is sitting in QuickBooks, so this does not estimate it.
//
// THREE BILLING BASES, AND TWO DESTINATIONS. The item name says both, and
// getting either wrong moves the cost by a third or more:
//
//   liveLb    — bought on the hoof, priced per LIVE pound. Killed on
//               our floor, so it becomes a harvest_log row. Live pounds must be
//               dressed before they compare with anything hanging.
//   hangingLb — priced per HANGING pound. This splits by vendor intent:
//               "Hanging Beef Carcass" arrives already hanging and was killed
//               somewhere else, so it never reaches harvest_log; "CMC BEEF" is
//               our own animal, killed on our floor, and merely BILLED on the
//               hanging weight it made. Checked 2026-09-18: one such bill's
//               pounds match, to the pound, the hanging weight of our own beef
//               killed the same day — the same animals.
//   head      — priced per HEAD, not per pound ("CMC HOG"). These
//               carry no pounds at all, so they can never contribute to a $/lb
//               rate; they cost one whole carcass each.
//
// The ownKill flag, not the basis, decides what may pay for a harvest_log row.
// Treating CMC BEEF as delivered-hanging left every 2026 kill reaching back to
// 2025 live-cattle lots and understated beef by about 35%.

export type Basis = 'liveLb' | 'hangingLb' | 'head'
export type Species = 'Beef' | 'Hog' | 'Lamb' | 'Goat'

/**
 * Livestock purchase items, as they are named in QuickBooks.
 *
 * Deliberately an allow-list rather than a keyword sweep. The bills are full of
 * purchased FINISHED product under names like
 * "RETAIL SALES:RETAIL CUTS:BEEF PRIME RIB ROAST" and
 * "SERVICE INCOME:CUSTOM KILL & PROCESSING:Beef Chuck Roll - Bulk".
 * Those are boxes bought to resell, not animals, and a /beef/i style match would
 * pull every one of them in and roughly double the carcass cost.
 */
const LIVESTOCK_ITEMS: { re: RegExp; basis: Basis; ownKill: boolean; species: Species }[] = [
  // Delivered already hanging — killed elsewhere, never in harvest_log.
  { re: /^hanging beef carcass$/i,              basis: 'hangingLb', ownKill: false, species: 'Beef' },
  { re: /^hanging hog carcass$/i,               basis: 'hangingLb', ownKill: false, species: 'Hog'  },
  { re: /^hanging whole lamb\/sheep carcass$/i, basis: 'hangingLb', ownKill: false, species: 'Lamb' },
  // Bought live, killed on our floor.
  { re: /^live cattle$/i,                       basis: 'liveLb',    ownKill: true,  species: 'Beef' },
  { re: /^live lambs?$/i,                       basis: 'liveLb',    ownKill: true,  species: 'Lamb' },
  { re: /^live hogs?$/i,                        basis: 'liveLb',    ownKill: true,  species: 'Hog'  },
  // Our own animal, killed on our floor, billed after the fact.
  { re: /^cmc beef$/i,                          basis: 'hangingLb', ownKill: true,  species: 'Beef' },
  { re: /^cmc hog$/i,                           basis: 'head',      ownKill: true,  species: 'Hog'  },
  { re: /^cmc lamb$/i,                          basis: 'head',      ownKill: true,  species: 'Lamb' },
]

// QuickBooks marks an item inactive by renaming it "Name (deleted)" or
// "Name (deleted-2)", so the live and retired versions of the same item read as
// different names. Most livestock history is under retired names.
function normalizeItemName(name: string): string {
  return name.replace(/\s*\(deleted(?:-\d+)?\)\s*$/i, '').trim()
}

/**
 * Match on the LEAF of the item name, not the whole string.
 *
 * QuickBooks reports an item by its full category path, so the same carcass
 * arrives as "RETAIL SALES:CARCASS:Hanging Beef Carcass (deleted)" on one bill
 * and "CARCASS:CMC BEEF" on another. Anchoring the pattern at the start of the
 * full path matched 12 of roughly 90 real purchase lots and silently dropped
 * the rest — every line the category prefix happened to differ on.
 *
 * Taking the leaf is safe against the purchased-finished-goods lines this must
 * keep out: their leaves read "BEEF PRIME RIB ROAST" and "Beef Chuck Roll -
 * Bulk", which match nothing here.
 */
function classify(rawName: string): { basis: Basis; ownKill: boolean; species: Species } | null {
  const leaf = normalizeItemName(rawName).split(':').pop()?.trim() ?? ''
  for (const c of LIVESTOCK_ITEMS) if (c.re.test(leaf)) return c
  return null
}

// A per-pound rate outside this band is a keying error, not a price.
const MIN_PLAUSIBLE_RATE = 0.25
const MAX_PLAUSIBLE_RATE = 12.00
// A per-head price outside this band is likewise not an animal.
const MIN_PLAUSIBLE_HEAD = 50
const MAX_PLAUSIBLE_HEAD = 6000
// More head than this on one line means the quantity is not a head count.
const MAX_HEAD_PER_LINE = 100

/** Dressing percentages if the kill floor has too few paired weights to measure. */
const FALLBACK_DRESSING: Record<Species, number> = { Beef: 0.62, Hog: 0.72, Lamb: 0.50, Goat: 0.48 }
const MIN_DRESSING_SAMPLES = 5

/**
 * How long an animal may sit between being paid for and being killed.
 *
 * WITHOUT THIS, FIFO DRAINS A PHANTOM BACKLOG. Purchases go back to 2024 but
 * harvest_log only starts 2026-04-16, so every animal bought before that was
 * killed and sold without leaving a record here. The queue cannot see that,
 * treats a year-old load of live cattle as still on hand, and pays for 2026
 * kills with it — the August 2026 kill came out billed entirely to early-2025
 * purchases, a third or more under the price of the 2026 purchases that sat
 * unused beside them.
 *
 * Six months is deliberately generous against what Charlie says actually
 * happens (2026-09-15: "We do not hold them that long"). The point is not to
 * model the feeding programme, it is to stop a dead animal paying for a live
 * one. Anything the cap leaves unmatched is reported as a gap rather than
 * quietly filled, which is what makes the missing bills visible.
 */
const MAX_HOLD_DAYS = 180

export interface LivestockLot {
  /**
   * Stable identity for one purchase line: bill id plus its index on that bill.
   *
   * The bill id alone is not enough and neither is date+vendor+price — one
   * vendor billed two separate loads of live cattle on the same day at the same
   * price, on two different bills. Anything coarser silently merges them, and a
   * merged lot cannot be audited back to the paper it came from.
   */
  lotId: string
  qboBillId: string
  date: string
  vendor: string
  item: string
  species: Species
  basis: Basis
  /** True when this animal was killed on our floor, so a harvest_log row exists. */
  ownKill: boolean
  /** Quantity as billed — live lb, hanging lb, or head, per `basis`. */
  billedQty: number
  /** Unit price on that same basis. */
  billedUnit: number
  amount: number
  /** Billed quantity on a hanging basis. Null for head-priced lots. */
  hangingLbs: number | null
  /** amount / hangingLbs. Null for head-priced lots, which have no pounds. */
  ratePerHangingLb: number | null
  /** Cost of one whole animal. Only set for head-priced lots. */
  costPerHead: number | null
  /** Non-null when the line failed a sanity check; excluded from all rates. */
  suspect: string | null
}

export interface DressingRate {
  species: Species
  pct: number
  samples: number
  measured: boolean
}

export interface SpeciesCost {
  species: Species
  basis: Basis
  ownKill: boolean
  lots: number
  /** Null for head-priced groups. */
  hangingLbs: number | null
  head: number | null
  amount: number
  /** Weighted over every good lot in the group. Null for head-priced groups. */
  blendedRatePerHangingLb: number | null
  /** Weighted over the most recent quarter by weight — replacement cost today. */
  recentRatePerHangingLb: number | null
  blendedCostPerHead: number | null
  latestPurchase: { date: string; unit: number } | null
}

export interface CostedCarcass {
  harvestId: string
  harvestDate: string
  species: Species
  carcassTag: string
  producer: string
  hangingLbs: number
  cost: number | null
  ratePerHangingLb: number | null
  /** `lot` = matched to real purchases; `fallback` = species rate; `none` = no basis. */
  source: 'lot' | 'fallback' | 'none'
  /** Which purchase lots paid for this carcass, when source is `lot`. */
  matched: { lotId: string; qboBillId: string; date: string; vendor: string; basis: Basis; lbs: number; head: number; cost: number }[]
}

export interface CarcassCostBasis {
  asOf: string
  since: string
  dressing: DressingRate[]
  lots: LivestockLot[]
  suspects: LivestockLot[]
  species: SpeciesCost[]
  /** Own-killed carcasses, costed FIFO from own-kill purchase lots. */
  ownCarcasses: CostedCarcass[]
  coverage: {
    ownCarcasses: number
    ownHangingLbs: number
    costedFromLots: number
    costedFromLotsLbs: number
    uncostedLbs: number
    /** Delivered-hanging purchases never enter harvest_log; counted separately. */
    deliveredHangingLbs: number
  }
  notes: string[]
}

interface BillLine {
  Amount?: number
  Description?: string
  ItemBasedExpenseLineDetail?: {
    ItemRef?: { name?: string; value?: string }
    Qty?: number
    UnitPrice?: number
  }
}
interface Bill {
  Id?: string
  TxnDate?: string
  VendorRef?: { name?: string }
  Line?: BillLine[]
}
interface BillQuery { QueryResponse?: { Bill?: Bill[] } }

/**
 * Every livestock purchase line since `since`.
 *
 * QuickBooks caps a query at 1000 rows and simply stops rather than saying so,
 * which is the same trap `getCachedQboItems` exists to avoid on the item cache.
 */
export async function fetchLivestockLots(since: string, dressing: Map<Species, number>): Promise<LivestockLot[]> {
  const bills: Bill[] = []
  const PAGE = 500
  for (let start = 1; ; start += PAGE) {
    const q = `select * from Bill where TxnDate >= '${since}' startposition ${start} maxresults ${PAGE}`
    const res = await qboFetch<BillQuery>(`query?query=${encodeURIComponent(q)}`)
    const page = res.QueryResponse?.Bill ?? []
    bills.push(...page)
    if (page.length < PAGE) break
  }

  const lots: LivestockLot[] = []
  for (const b of bills) {
    for (const [lineIndex, line] of (b.Line ?? []).entries()) {
      const d = line.ItemBasedExpenseLineDetail
      if (!d?.ItemRef?.name) continue
      const kind = classify(d.ItemRef.name)
      if (!kind) continue

      const billedQty = Number(d.Qty ?? 0)
      const amount = Number(line.Amount ?? 0)
      if (!billedQty || !amount) continue
      const billedUnit = Number(d.UnitPrice ?? 0) || amount / billedQty

      const pct = dressing.get(kind.species) ?? FALLBACK_DRESSING[kind.species]
      const hangingLbs = kind.basis === 'head' ? null
        : kind.basis === 'liveLb' ? billedQty * pct
        : billedQty
      const ratePerHangingLb = hangingLbs && hangingLbs > 0 ? amount / hangingLbs : null
      const costPerHead = kind.basis === 'head' ? amount / billedQty : null

      // The declared basis is checked against the numbers rather than trusted.
      // If somebody starts billing CMC HOG by the pound, or types a head count
      // into a pounds field, the arithmetic says so and the line is held out.
      let suspect: string | null = null
      if (kind.basis === 'head') {
        if (billedQty > MAX_HEAD_PER_LINE) {
          suspect = `${billedQty} head on one line — quantity looks like pounds, not head`
        } else if (costPerHead! < MIN_PLAUSIBLE_HEAD || costPerHead! > MAX_PLAUSIBLE_HEAD) {
          suspect = `$${costPerHead!.toFixed(0)}/head is outside $${MIN_PLAUSIBLE_HEAD}-$${MAX_PLAUSIBLE_HEAD} — check the bill`
        }
      } else if (!ratePerHangingLb || !Number.isFinite(ratePerHangingLb)) {
        suspect = 'no usable rate'
      } else if (ratePerHangingLb < MIN_PLAUSIBLE_RATE) {
        suspect = `$${ratePerHangingLb.toFixed(2)}/hanging lb is below $${MIN_PLAUSIBLE_RATE.toFixed(2)} — check the bill`
      } else if (ratePerHangingLb > MAX_PLAUSIBLE_RATE) {
        suspect = `$${ratePerHangingLb.toFixed(2)}/hanging lb is above $${MAX_PLAUSIBLE_RATE.toFixed(2)} — pounds field probably holds a head count`
      }

      lots.push({
        lotId: `${b.Id ?? '?'}#${lineIndex}`,
        qboBillId: b.Id ?? '',
        date: b.TxnDate ?? '',
        vendor: b.VendorRef?.name ?? '',
        item: normalizeItemName(d.ItemRef.name),
        species: kind.species,
        basis: kind.basis,
        ownKill: kind.ownKill,
        billedQty,
        billedUnit,
        amount,
        hangingLbs,
        ratePerHangingLb,
        costPerHead,
        suspect,
      })
    }
  }
  lots.sort((a, b) => a.date.localeCompare(b.date))
  return lots
}

/**
 * Dressing percentage measured on our own kill floor rather than assumed.
 *
 * Only a minority of harvest_log rows carry a live weight — it is not needed to
 * process an animal, so it often goes unrecorded — but the ones that do are a
 * real local measurement and beat a textbook constant. Ownership is irrelevant
 * here: how much of a steer hangs up is a fact about the steer, so a producer's
 * animal measures our dressing just as well as ours does.
 */
export async function measureDressing(): Promise<DressingRate[]> {
  const { data, error } = await supabaseAdmin
    .from('harvest_log')
    .select('species, live_weight_lbs, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
    .gt('live_weight_lbs', 0)
    .limit(10000)
  if (error) throw new Error(error.message)

  const acc = new Map<Species, { live: number; hang: number; n: number }>()
  for (const r of data ?? []) {
    const sp = r.species as Species
    if (!(sp in FALLBACK_DRESSING)) continue
    const live = Number(r.live_weight_lbs ?? 0)
    const hang = Number(r.hot_carcass_weight_lbs ?? 0)
      || (Number(r.half_1_weight_lbs ?? 0) + Number(r.half_2_weight_lbs ?? 0))
    if (live <= 0 || hang <= 0) continue
    const ratio = hang / live
    // A ratio outside this range is a transcription error, not an animal.
    if (ratio < 0.30 || ratio > 0.90) continue
    const a = acc.get(sp) ?? { live: 0, hang: 0, n: 0 }
    a.live += live; a.hang += hang; a.n += 1
    acc.set(sp, a)
  }

  return (Object.keys(FALLBACK_DRESSING) as Species[]).map(sp => {
    const a = acc.get(sp)
    const enough = a && a.n >= MIN_DRESSING_SAMPLES && a.live > 0
    return {
      species: sp,
      pct: enough ? a!.hang / a!.live : FALLBACK_DRESSING[sp],
      samples: a?.n ?? 0,
      measured: Boolean(enough),
    }
  })
}


interface HarvestRow {
  id: string
  harvest_date: string
  species: string
  carcass_tag: string | null
  producer: string | null
  hot_carcass_weight_lbs: number | null
  half_1_weight_lbs: number | null
  half_2_weight_lbs: number | null
}

export async function fetchOwnCarcasses(since: string): Promise<HarvestRow[]> {
  const out: HarvestRow[] = []
  const PAGE = 1000
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('harvest_log')
      .select('id, harvest_date, species, carcass_tag, producer, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
      .gte('harvest_date', since)
      .order('harvest_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    out.push(...((data ?? []) as HarvestRow[]))
    if (!data || data.length < PAGE) break
  }
  return out.filter(r => OWN_PRODUCER.test(r.producer ?? ''))
}

function hangingOf(r: HarvestRow): number {
  return Number(r.hot_carcass_weight_lbs ?? 0)
    || (Number(r.half_1_weight_lbs ?? 0) + Number(r.half_2_weight_lbs ?? 0))
}

interface Slot { lot: LivestockLot; remainingLbs: number; remainingHead: number }

/** ISO date shifted by whole days, without dragging in a date library. */
function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/**
 * Cost each own-killed carcass by consuming own-kill purchase lots oldest-first.
 *
 * FIFO is the point, not a convenience: the animals killed in April were paid
 * for before the ones killed in August, and in a market that has risen by about
 * a third in two years, averaging them together would quietly move money
 * between periods.
 *
 * Pound-priced and head-priced lots share one date-ordered queue, because a
 * hog bought by the head and a steer billed on its hanging weight are both
 * simply the next animal paid for. A head lot settles exactly one carcass
 * whatever it weighs — that is what buying by the head means.
 *
 * A carcass that exhausts the queue is NOT silently given the average. It is
 * marked `fallback` (species rate, flagged) or `none`, because the gap between
 * animals we killed and livestock we can prove we bought is itself the finding
 * — quietly averaging over it would hide exactly what the count needs to know.
 */
export interface FallbackRate {
  /** $/hanging lb, or null when the species is bought by the head. */
  ratePerHangingLb: number | null
  /** $/head, or null when the species is bought by weight. */
  costPerHead: number | null
  basis: Basis
  from: string
}

export function costOwnCarcasses(
  carcasses: HarvestRow[],
  lots: LivestockLot[],
  speciesRate: Map<Species, FallbackRate>,
): CostedCarcass[] {
  const queues = new Map<Species, Slot[]>()
  for (const l of lots) {
    if (!l.ownKill || l.suspect) continue
    const q = queues.get(l.species) ?? []
    q.push({
      lot: l,
      remainingLbs: l.basis === 'head' ? 0 : (l.hangingLbs ?? 0),
      remainingHead: l.basis === 'head' ? l.billedQty : 0,
    })
    queues.set(l.species, q)
  }
  for (const q of queues.values()) q.sort((a, b) => a.lot.date.localeCompare(b.lot.date))

  const ordered = [...carcasses].sort((a, b) => a.harvest_date.localeCompare(b.harvest_date))
  return ordered.map(r => {
    const species = r.species as Species
    const lbs = hangingOf(r)
    const base = {
      harvestId: r.id,
      harvestDate: r.harvest_date,
      species,
      carcassTag: r.carcass_tag ?? '',
      producer: r.producer ?? '',
      hangingLbs: lbs,
    }
    if (!lbs) return { ...base, cost: null, ratePerHangingLb: null, source: 'none' as const, matched: [] }

    const q = queues.get(species) ?? []
    let need = lbs
    let cost = 0
    let settledByHead = false
    const matched: CostedCarcass['matched'] = []
    const oldestUsable = addDays(r.harvest_date, -MAX_HOLD_DAYS)
    for (const slot of q) {
      if (need <= 0 || settledByHead) break
      // Only a purchase made before the kill can have paid for it.
      if (slot.lot.date > r.harvest_date) break
      // ...and not one so old the animal was already killed and sold. See
      // MAX_HOLD_DAYS: without this the queue never reaches the real purchases.
      if (slot.lot.date < oldestUsable) continue
      if (slot.lot.basis === 'head') {
        if (slot.remainingHead <= 0) continue
        slot.remainingHead -= 1
        cost += slot.lot.costPerHead ?? 0
        matched.push({ lotId: slot.lot.lotId, qboBillId: slot.lot.qboBillId, date: slot.lot.date, vendor: slot.lot.vendor, basis: 'head', lbs, head: 1, cost: slot.lot.costPerHead ?? 0 })
        need = 0
        settledByHead = true
        break
      }
      if (slot.remainingLbs <= 0) continue
      const take = Math.min(slot.remainingLbs, need)
      slot.remainingLbs -= take
      need -= take
      const slice = take * (slot.lot.ratePerHangingLb ?? 0)
      cost += slice
      matched.push({ lotId: slot.lot.lotId, qboBillId: slot.lot.qboBillId, date: slot.lot.date, vendor: slot.lot.vendor, basis: slot.lot.basis, lbs: take, head: 0, cost: slice })
    }

    if (need <= 0.0001) {
      return { ...base, cost, ratePerHangingLb: cost / lbs, source: 'lot' as const, matched }
    }
    // Partial matches are not half-reported: the whole carcass falls back, so
    // one number describes it and the flag is honest about which number it is.
    const fb = speciesRate.get(species)
    if (fb?.ratePerHangingLb) {
      return { ...base, cost: lbs * fb.ratePerHangingLb, ratePerHangingLb: fb.ratePerHangingLb, source: 'fallback' as const, matched: [] }
    }
    if (fb?.costPerHead) {
      // A species bought by the head has no $/lb to fall back on. Valuing it at
      // nothing would understate the freezer by a whole animal, so it takes the
      // per-head price and the implied rate is derived, not assumed.
      return { ...base, cost: fb.costPerHead, ratePerHangingLb: fb.costPerHead / lbs, source: 'fallback' as const, matched: [] }
    }
    return { ...base, cost: null, ratePerHangingLb: null, source: 'none' as const, matched: [] }
  })
}

function summarize(lots: LivestockLot[]): SpeciesCost[] {
  const key = (l: LivestockLot) => `${l.species}|${l.basis}|${l.ownKill ? 'own' : 'delivered'}`
  const groups = new Map<string, LivestockLot[]>()
  for (const l of lots) {
    if (l.suspect) continue
    const g = groups.get(key(l)) ?? []
    g.push(l)
    groups.set(key(l), g)
  }
  const out: SpeciesCost[] = []
  for (const [k, g] of groups) {
    const [species, basis, own] = k.split('|') as [Species, Basis, string]
    g.sort((a, b) => a.date.localeCompare(b.date))
    const amt = g.reduce((s, l) => s + l.amount, 0)
    const last = g[g.length - 1]

    if (basis === 'head') {
      const head = g.reduce((s, l) => s + l.billedQty, 0)
      out.push({
        species, basis, ownKill: own === 'own', lots: g.length,
        hangingLbs: null, head, amount: amt,
        blendedRatePerHangingLb: null, recentRatePerHangingLb: null,
        blendedCostPerHead: head > 0 ? amt / head : null,
        latestPurchase: last ? { date: last.date, unit: last.billedUnit } : null,
      })
      continue
    }

    const lbs = g.reduce((s, l) => s + (l.hangingLbs ?? 0), 0)
    // "Recent" is the last quarter of purchases BY WEIGHT, not by date. A date
    // window lands on however many buys happened to fall in it — three in one
    // month, none the next — and a thin window is noisier than a wide one, not
    // fresher. Weight makes the sample the same size every time.
    const target = lbs * 0.25
    let acc = 0, recentLbs = 0, recentAmt = 0
    for (let i = g.length - 1; i >= 0 && acc < target; i--) {
      recentLbs += g[i].hangingLbs ?? 0
      recentAmt += g[i].amount
      acc += g[i].hangingLbs ?? 0
    }
    out.push({
      species, basis, ownKill: own === 'own', lots: g.length,
      hangingLbs: lbs, head: null, amount: amt,
      blendedRatePerHangingLb: lbs > 0 ? amt / lbs : null,
      recentRatePerHangingLb: recentLbs > 0 ? recentAmt / recentLbs : null,
      blendedCostPerHead: null,
      latestPurchase: last ? { date: last.date, unit: last.billedUnit } : null,
    })
  }
  out.sort((a, b) => b.amount - a.amount)
  return out
}

/** The whole cost basis, with the working shown. */
export async function buildCarcassCostBasis(since: string): Promise<CarcassCostBasis> {
  const dressingRates = await measureDressing()
  const dressing = new Map<Species, number>(dressingRates.map(d => [d.species, d.pct]))

  const [allLots, carcasses] = await Promise.all([
    fetchLivestockLots(since, dressing),
    fetchOwnCarcasses(since),
  ])
  const good = allLots.filter(l => !l.suspect)
  const suspects = allLots.filter(l => l.suspect)
  const species = summarize(allLots)

  // The fallback is what that animal would cost to REPLACE, so it comes from
  // the most recently bought own-kill group for the species, whatever basis
  // that group used. Own-kill only — what a delivered carcass cost says nothing
  // about what our own animal cost. Beef switched from live pounds to hanging
  // pounds in April 2026 and lamb to per-head in July 2026, so picking by
  // recency rather than by a preferred basis is what keeps the fallback current.
  const speciesRate = new Map<Species, FallbackRate>()
  for (const s of species) {
    if (!s.ownKill) continue
    const when = s.latestPurchase?.date ?? ''
    const existing = speciesRate.get(s.species)
    if (existing && existing.from >= when) continue
    const rate = s.recentRatePerHangingLb ?? s.blendedRatePerHangingLb
    if (s.basis === 'head' ? !s.blendedCostPerHead : !rate) continue
    speciesRate.set(s.species, {
      ratePerHangingLb: s.basis === 'head' ? null : rate,
      costPerHead: s.basis === 'head' ? s.blendedCostPerHead : null,
      basis: s.basis,
      from: when,
    })
  }

  const ownCarcasses = costOwnCarcasses(carcasses, good, speciesRate)
  const ownLbs = ownCarcasses.reduce((s, c) => s + c.hangingLbs, 0)
  const fromLots = ownCarcasses.filter(c => c.source === 'lot')
  const deliveredHangingLbs = good
    .filter(l => !l.ownKill && l.hangingLbs)
    .reduce((s, l) => s + (l.hangingLbs ?? 0), 0)

  const notes: string[] = []
  const uncosted = ownLbs - fromLots.reduce((s, c) => s + c.hangingLbs, 0)
  if (uncosted > 0.5 && ownLbs > 0) {
    notes.push(
      `${Math.round(uncosted).toLocaleString()} of ${Math.round(ownLbs).toLocaleString()} own hanging lb ` +
      `(${Math.round((uncosted / ownLbs) * 100)}%) could not be traced to a livestock purchase in this window.`,
    )
    // Named by species, because "19% untraced" is not actionable and "every hog
    // we killed has nothing behind it" is — it points at either a missing bill
    // or an item the allow-list does not know about.
    const gap = new Map<Species, { head: number; lbs: number; last: string }>()
    for (const c of ownCarcasses) {
      if (c.source === 'lot') continue
      const g = gap.get(c.species) ?? { head: 0, lbs: 0, last: '' }
      g.head += 1; g.lbs += c.hangingLbs
      if (c.harvestDate > g.last) g.last = c.harvestDate
      gap.set(c.species, g)
    }
    for (const [sp, g] of [...gap].sort((a, b) => b[1].lbs - a[1].lbs)) {
      const own = species.filter(s => s.species === sp && s.ownKill)
      const lastBuy = own.map(s => s.latestPurchase?.date ?? '').sort().pop() || ''
      notes.push(
        `  ${sp}: ${g.head} head / ${Math.round(g.lbs).toLocaleString()} lb uncosted, latest kill ${g.last}` +
        (lastBuy
          ? ` — the purchase queue runs dry after ${lastBuy}.`
          : ` — there is NO own-kill ${sp.toLowerCase()} purchase on any bill in this window.`),
      )
    }
  }
  const zeroWeight = ownCarcasses.filter(c => c.hangingLbs === 0).length
  if (zeroWeight) {
    notes.push(`${zeroWeight} own carcass(es) carry no hanging weight at all and cannot be costed or counted.`)
  }
  if (deliveredHangingLbs > 0) {
    notes.push(
      `${Math.round(deliveredHangingLbs).toLocaleString()} hanging lb was delivered already-hanging. Those carcasses ` +
      `were killed elsewhere, so they never appear in harvest_log and are costed directly off the bill.`,
    )
  }
  for (const d of dressingRates) {
    if (!d.measured) notes.push(`${d.species} dressing is the ${Math.round(d.pct * 100)}% fallback — only ${d.samples} paired weights on the floor.`)
  }
  if (suspects.length) {
    notes.push(`${suspects.length} purchase line(s) failed the sanity check and are excluded from every rate. See suspects.`)
  }

  return {
    asOf: new Date().toISOString(),
    since,
    dressing: dressingRates,
    lots: good,
    suspects,
    species,
    ownCarcasses,
    coverage: {
      ownCarcasses: ownCarcasses.length,
      ownHangingLbs: ownLbs,
      costedFromLots: fromLots.length,
      costedFromLotsLbs: fromLots.reduce((s, c) => s + c.hangingLbs, 0),
      uncostedLbs: Math.max(0, uncosted),
      deliveredHangingLbs,
    },
    notes,
  }
}
