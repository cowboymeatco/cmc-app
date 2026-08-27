// The smokehouse book: everything the house is committed to, and what it costs
// in loads and hours.
//
// This started as a hog-and-cure forecast (2026-08-27) and Charlie asked for the
// whole enterprise. So it covers every booked animal of every species and every
// product that goes through the house — not just the seal-tagged pieces.
//
// The house sells its time two different ways and they cannot be added up:
//
//   RACK PRODUCTS are ordered as things. Hams, bellies, shoulder bacon: the cut
//   sheet says how many, the rack says how many fit, and the loads fall out.
//   Capacity here is COUNTED (24 hams, 72 combs), and lib/cureLoad.ts owns it.
//
//   WEIGHT PRODUCTS are ordered as pounds. Snack sticks, brots, summer sausage,
//   jerky, hot dogs: the sheet asks for 25 lb of country brots, and the only
//   thing that turns pounds into loads is cook_profile.lbs_per_batch — which is
//   null on every profile, because the controller logs never recorded a load
//   size. So this module reports their POUNDS honestly and reports NO loads for
//   them, rather than inventing a batch size to make the schedule look finished.
//   `unsized` names exactly which products are in that state and how much demand
//   is riding on each, because that list is the work standing between here and a
//   complete schedule.
//
// Demand comes from the cut sheet where one exists and from a per-species rate
// learned off past sheets where it doesn't. The two are never blended into one
// number: every result says how many head it read and how many it projected.
import { extractValueAdd } from '@/lib/valueAdd'
import { rackFor, loadsFor } from '@/lib/cureLoad'
import { DEFAULT_SETTINGS, type CookProfile, type CookSettings } from '@/lib/cookPredict'

/** Animal-equivalents below this and a learned per-head rate is not evidence. */
export const MIN_ANIMALS_FOR_RATE = 5

/** Harvest-schedule species → the species a cut sheet is filed under. */
export const SHEET_SPECIES: Record<string, string> = {
  Hog: 'Pork', Beef: 'Beef', Lamb: 'Lamb', Goat: 'Goat',
}

// Products the sheet counts as PIECES → the rack name lib/cureLoad.ts knows.
// Beef bacon is a belly and hangs on the bacon combs like any other.
const PIECE_PRODUCT: Record<string, string> = {
  'Cured & Smoked Ham':   'Ham',
  'Bacon':                'Bacon',
  'Beef Bacon':           'Bacon',
  'Shoulder Bacon':       'Shoulder Bacon',
  'Cured & Smoked Hocks': 'Hocks',
  'Smoked Chops':         'Bone-In Loin',
}

// Products the sheet orders in POUNDS → the cook profile that cooks them.
const WEIGHT_PRODUCT: Record<string, string> = {
  'Snack Sticks':   'SNACK STICKS',
  'Brots':          'SMOKED BRATS',
  'Summer Sausage': 'SUMMER SAUSAGE',
  'Jerky':          'BEEF JERKY',
  'Hot Dogs':       'MMPA HOT DOG',
}

// Pieces that go through the house but have no rack counted for them yet. They
// are listed so the book is complete and left out of the load math so it stays
// honest.
const LOOSE_PIECE: Record<string, string> = {
  'Pulled Pork':              'SMKD PORK BUTT',
  'Smoked & Sliced Brisket':  'SMKD BRISKET',
  'Smoked & Pulled Beef':     'SMKD PPD BEEF',
}

export interface SheetRow {
  id:             string
  species:        string | null
  data:           unknown
  appointment_id: string | null
}

export interface ApptRow {
  id:           string
  harvest_date: string | null
  species:      string | null
  head_count:   number | null
  status:       string | null
}

/** Pieces and pounds one sheet commits the house to. */
export interface SheetDemand {
  pieces: Record<string, number>   // keyed by rack product name
  lbs:    Record<string, number>   // keyed by extractValueAdd product name
  loose:  Record<string, number>   // pieces with no rack, by product name
}

const emptyDemand = (): SheetDemand => ({ pieces: {}, lbs: {}, loose: {} })

export function sheetDemand(species: string | null, data: unknown): SheetDemand {
  const out = emptyDemand()
  for (const item of extractValueAdd(species, data)) {
    const qty = item.qty ?? 1
    const rack = PIECE_PRODUCT[item.product]
    if (rack) { out.pieces[rack] = (out.pieces[rack] ?? 0) + qty; continue }
    if (WEIGHT_PRODUCT[item.product]) {
      // No pounds on the line means the customer ticked the product without
      // saying how much. Counting it as zero would hide the order, so it rides
      // as a piece instead and shows up in the book as an unsized line.
      if (item.lbs != null) out.lbs[item.product] = (out.lbs[item.product] ?? 0) + item.lbs
      else out.loose[item.product] = (out.loose[item.product] ?? 0) + qty
      continue
    }
    if (LOOSE_PIECE[item.product]) {
      out.loose[item.product] = (out.loose[item.product] ?? 0) + qty
    }
    // Everything else on a cut sheet — seasoned roasts, philly, corned beef —
    // never sees the smokehouse and is deliberately not counted here.
  }
  return out
}

/**
 * How much of one animal a sheet speaks for.
 *
 * A whole-animal card covers the animal however many people split the box — the
 * A|B and A|B|C|D shares are one card for one animal, which is why
 * extractValueAdd already doubles the paired primals on them.
 */
export function animalFraction(data: unknown): number {
  const portion = String((data as Record<string, unknown> | null)?.portion ?? '')
  if (portion.startsWith('whole')) return 1
  if (portion === 'half')          return 0.5
  if (portion === 'quarter')       return 0.25
  // Nothing recorded is a whole animal — the wizard's own default. Calling it a
  // fraction would under-forecast.
  return 1
}

export interface SpeciesRate {
  species: string
  perHead: SheetDemand   // pieces and pounds per whole animal
  animals: number
  sheets:  number
  usable:  boolean
}

/** What each species has historically put in the house, per head. */
export function learnRates(sheets: SheetRow[]): Record<string, SpeciesRate> {
  const bySpecies = new Map<string, { animals: number; sheets: number; total: SheetDemand }>()

  for (const s of sheets) {
    const sp = (s.species ?? '').trim()
    if (!sp) continue
    let acc = bySpecies.get(sp)
    if (!acc) { acc = { animals: 0, sheets: 0, total: emptyDemand() }; bySpecies.set(sp, acc) }
    acc.animals += animalFraction(s.data)
    acc.sheets++
    const d = sheetDemand(s.species, s.data)
    for (const [k, v] of Object.entries(d.pieces)) acc.total.pieces[k] = (acc.total.pieces[k] ?? 0) + v
    for (const [k, v] of Object.entries(d.lbs))    acc.total.lbs[k]    = (acc.total.lbs[k]    ?? 0) + v
    for (const [k, v] of Object.entries(d.loose))  acc.total.loose[k]  = (acc.total.loose[k]  ?? 0) + v
  }

  const out: Record<string, SpeciesRate> = {}
  for (const [species, acc] of bySpecies) {
    const perHead = emptyDemand()
    if (acc.animals > 0) {
      for (const [k, v] of Object.entries(acc.total.pieces)) perHead.pieces[k] = v / acc.animals
      for (const [k, v] of Object.entries(acc.total.lbs))    perHead.lbs[k]    = v / acc.animals
      for (const [k, v] of Object.entries(acc.total.loose))  perHead.loose[k]  = v / acc.animals
    }
    out[species] = {
      species, perHead,
      animals: Math.round(acc.animals * 10) / 10,
      sheets:  acc.sheets,
      usable:  acc.animals >= MIN_ANIMALS_FOR_RATE,
    }
  }
  return out
}

// ── What a day's demand costs the house ──────────────────────────────────────

export interface RackLine {
  group:  string
  label:  string
  products: { product: string; pieces: number; slots: number }[]
  pieces: number
  slots:  number
  displayName:    string | null
  unitsPerBatch:  number | null
  unitLabel:      string | null
  loads:          number | null
  spaceLeft:      number | null
  perLoadMinutes: number | null
  cookMinutes:    number | null
}

export interface WeightLine {
  product:        string
  profileKey:     string
  displayName:    string | null
  lbs:            number
  lbsPerBatch:    number | null
  loads:          number | null
  perLoadMinutes: number | null
  cookMinutes:    number | null
}

export interface LooseLine {
  product: string
  pieces:  number
  displayName: string | null
}

/** A product the house is committed to that nothing can turn into loads yet. */
export interface UnsizedLine {
  product:     string
  profileKey:  string | null
  displayName: string | null
  /** What's riding on it — pounds for a weight product, pieces for a rack one. */
  lbs:         number | null
  pieces:      number | null
}

const perLoadMinutes = (p: CookProfile) => p.p50_minutes + p.setup_minutes + p.teardown_minutes

export function racksFromCounts(counts: Record<string, number>, profiles: CookProfile[]): RackLine[] {
  const byProfile = new Map(profiles.map(p => [p.profile_key, p]))
  const racks = new Map<string, RackLine>()

  for (const [product, pieces] of Object.entries(counts)) {
    if (!(pieces > 0)) continue
    const spec = rackFor(product)
    let rack = racks.get(spec.group)
    if (!rack) {
      const profile = spec.profileKey ? byProfile.get(spec.profileKey) ?? null : null
      rack = {
        group: spec.group, label: spec.label, products: [], pieces: 0, slots: 0,
        displayName:    profile?.display_name ?? null,
        unitsPerBatch:  profile?.units_per_batch ?? null,
        unitLabel:      profile?.unit_label ?? null,
        loads: null, spaceLeft: null,
        perLoadMinutes: profile ? perLoadMinutes(profile) : null,
        cookMinutes:    null,
      }
      racks.set(spec.group, rack)
    }
    const slots = Math.ceil(pieces / spec.perSlot)
    rack.products.push({ product, pieces, slots })
    rack.pieces += pieces
    rack.slots  += slots
  }

  for (const rack of racks.values()) {
    rack.products.sort((a, b) => b.pieces - a.pieces)
    const cap = loadsFor(rack.slots, rack.unitsPerBatch)
    rack.loads     = cap.loads
    rack.spaceLeft = cap.spaceLeft
    rack.cookMinutes = rack.loads != null && rack.perLoadMinutes != null
      ? rack.loads * rack.perLoadMinutes : null
  }
  return [...racks.values()].sort((a, b) => b.pieces - a.pieces)
}

export function weightsFromLbs(lbs: Record<string, number>, profiles: CookProfile[]): WeightLine[] {
  const byProfile = new Map(profiles.map(p => [p.profile_key, p]))
  const out: WeightLine[] = []

  for (const [product, pounds] of Object.entries(lbs)) {
    if (!(pounds > 0)) continue
    const key     = WEIGHT_PRODUCT[product]
    const profile = key ? byProfile.get(key) ?? null : null
    const per     = profile?.lbs_per_batch ?? null
    const loads   = per && per > 0 ? Math.ceil(pounds / per) : null
    const mins    = profile ? perLoadMinutes(profile) : null
    out.push({
      product, profileKey: key ?? '',
      displayName: profile?.display_name ?? null,
      lbs: Math.round(pounds),
      lbsPerBatch: per != null ? Number(per) : null,
      loads,
      perLoadMinutes: mins,
      cookMinutes: loads != null && mins != null ? loads * mins : null,
    })
  }
  return out.sort((a, b) => b.lbs - a.lbs)
}

/**
 * How long the house is tied up.
 *
 * One lane (lib/cookPredict.ts), so nothing overlaps: every load's own cook end
 * to end, plus a changeover between each pair. Changeovers count ACROSS
 * products — the lane doesn't care whether the next load is hams or brots.
 */
export function houseMinutesFor(
  racks:    RackLine[],
  weights:  WeightLine[],
  settings: CookSettings = DEFAULT_SETTINGS,
): number | null {
  const timed = [...racks, ...weights].filter(x => x.cookMinutes != null && x.loads != null)
  if (!timed.length) return null
  const cook  = timed.reduce((n, x) => n + (x.cookMinutes ?? 0), 0)
  const loads = timed.reduce((n, x) => n + (x.loads ?? 0), 0)
  return cook + Math.max(0, loads - 1) * settings.changeover_minutes
}

export interface DayBook {
  date:     string | null
  bookings: number
  /** Head by harvest species, so a mixed day reads honestly. */
  head:     Record<string, number>
  headTotal:     number
  headOnSheet:   number
  headProjected: number

  racks:   RackLine[]
  weights: WeightLine[]
  loose:   LooseLine[]

  /** Loads the house can actually count for this day. */
  loads:        number | null
  houseMinutes: number | null
  /** Demand this day carries that nothing can size yet. */
  unsized:      UnsizedLine[]
}

export interface Book {
  days:  DayBook[]
  rates: Record<string, SpeciesRate>

  head:          Record<string, number>
  headTotal:     number
  headOnSheet:   number
  headProjected: number

  racks:   RackLine[]
  weights: WeightLine[]
  loose:   LooseLine[]

  loads:        number | null
  houseMinutes: number | null
  /** Every product the book can't size, pooled across the window. */
  unsized:      UnsizedLine[]
  changeoverMinutes: number
  firstDate: string | null
  lastDate:  string | null
}

const addInto = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v
}

function unsizedFrom(
  racks: RackLine[], weights: WeightLine[], loose: LooseLine[],
): UnsizedLine[] {
  const out: UnsizedLine[] = []
  for (const r of racks) {
    if (r.loads == null) {
      out.push({
        product: r.label, profileKey: null, displayName: r.displayName,
        lbs: null, pieces: r.pieces,
      })
    }
  }
  for (const w of weights) {
    if (w.loads == null) {
      out.push({
        product: w.product, profileKey: w.profileKey || null,
        displayName: w.displayName, lbs: w.lbs, pieces: null,
      })
    }
  }
  for (const l of loose) {
    out.push({ product: l.product, profileKey: null, displayName: l.displayName, lbs: null, pieces: l.pieces })
  }
  return out
}

/**
 * Build the book from the harvest schedule.
 *
 * Loads are counted KILL DAY BY KILL DAY. Everything killed the same day is one
 * run and shares the racks; two dates a month apart don't, so their part-full
 * loads can't be added together. Counting per BOOKING instead read 34 loads for
 * 52 hogs — eight one-hog bookings each paying for a whole ham load and a whole
 * bacon load.
 */
export function buildBook(
  appts:    ApptRow[],
  sheets:   SheetRow[],
  profiles: CookProfile[],
  rates?:   Record<string, SpeciesRate>,
  settings: CookSettings = DEFAULT_SETTINGS,
): Book {
  const learned = rates ?? learnRates(sheets)

  const byAppt = new Map<string, SheetRow[]>()
  for (const s of sheets) {
    if (!s.appointment_id) continue
    const list = byAppt.get(s.appointment_id) ?? []
    list.push(s)
    byAppt.set(s.appointment_id, list)
  }

  interface Acc {
    date: string | null; bookings: number
    head: Record<string, number>; onSheet: number
    demand: SheetDemand
    projected: { species: string; head: number }[]
  }
  const byDay = new Map<string, Acc>()

  for (const a of appts) {
    const head = a.head_count ?? 0
    if (head <= 0) continue
    const species = (a.species ?? 'Unknown').trim()
    const key = a.harvest_date ?? 'unscheduled'
    let day = byDay.get(key)
    if (!day) {
      day = { date: a.harvest_date, bookings: 0, head: {}, onSheet: 0, demand: emptyDemand(), projected: [] }
      byDay.set(key, day)
    }

    let headOnSheet = 0
    for (const s of byAppt.get(a.id) ?? []) {
      headOnSheet += animalFraction(s.data)
      const d = sheetDemand(s.species, s.data)
      addInto(day.demand.pieces, d.pieces)
      addInto(day.demand.lbs,    d.lbs)
      addInto(day.demand.loose,  d.loose)
    }
    // A sheet can only speak for as much animal as was booked — a mis-linked
    // card must not make the run look bigger than the head count.
    headOnSheet = Math.min(headOnSheet, head)

    day.bookings++
    day.head[species] = (day.head[species] ?? 0) + head
    day.onSheet += headOnSheet
    const short = head - headOnSheet
    if (short > 0) day.projected.push({ species, head: short })
  }

  const out: DayBook[] = []
  for (const day of byDay.values()) {
    const demand: SheetDemand = {
      pieces: { ...day.demand.pieces },
      lbs:    { ...day.demand.lbs },
      loose:  { ...day.demand.loose },
    }

    // Heads with no sheet ride their own species' rate.
    let headProjected = 0
    for (const p of day.projected) {
      headProjected += p.head
      const rate = learned[SHEET_SPECIES[p.species] ?? p.species]
      if (!rate?.usable) continue
      for (const [k, v] of Object.entries(rate.perHead.pieces)) demand.pieces[k] = (demand.pieces[k] ?? 0) + v * p.head
      for (const [k, v] of Object.entries(rate.perHead.lbs))    demand.lbs[k]    = (demand.lbs[k]    ?? 0) + v * p.head
      for (const [k, v] of Object.entries(rate.perHead.loose))  demand.loose[k]  = (demand.loose[k]  ?? 0) + v * p.head
    }
    for (const k of Object.keys(demand.pieces)) {
      demand.pieces[k] = Math.round(demand.pieces[k])
      if (!demand.pieces[k]) delete demand.pieces[k]
    }
    for (const k of Object.keys(demand.loose)) {
      demand.loose[k] = Math.round(demand.loose[k])
      if (!demand.loose[k]) delete demand.loose[k]
    }

    const byProfile = new Map(profiles.map(p => [p.profile_key, p]))
    const racks   = racksFromCounts(demand.pieces, profiles)
    const weights = weightsFromLbs(demand.lbs, profiles)
    const loose   = Object.entries(demand.loose)
      .filter(([, n]) => n > 0)
      .map(([product, pieces]) => ({
        product, pieces,
        displayName: byProfile.get(LOOSE_PIECE[product] ?? WEIGHT_PRODUCT[product] ?? '')?.display_name ?? null,
      }))
      .sort((a, b) => b.pieces - a.pieces)

    const headTotal = Object.values(day.head).reduce((n, v) => n + v, 0)
    const sized = [...racks, ...weights].filter(x => x.loads != null)

    out.push({
      date: day.date, bookings: day.bookings, head: day.head,
      headTotal,
      headOnSheet:   Math.round(day.onSheet * 10) / 10,
      headProjected: Math.round(headProjected * 10) / 10,
      racks, weights, loose,
      loads: sized.length ? sized.reduce((n, x) => n + (x.loads ?? 0), 0) : null,
      houseMinutes: houseMinutesFor(racks, weights, settings),
      unsized: unsizedFrom(racks, weights, loose),
    })
  }

  out.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))

  // Window totals. Pieces and pounds pool freely; LOADS and HOURS do not — they
  // are summed off the days, because a day's changeovers only exist inside that
  // day's own run.
  const pieces: Record<string, number> = {}
  const lbs:    Record<string, number> = {}
  const loose:  Record<string, number> = {}
  const head:   Record<string, number> = {}
  for (const d of out) {
    for (const r of d.racks)   for (const p of r.products) pieces[p.product] = (pieces[p.product] ?? 0) + p.pieces
    for (const w of d.weights) lbs[w.product]   = (lbs[w.product]   ?? 0) + w.lbs
    for (const l of d.loose)   loose[l.product] = (loose[l.product] ?? 0) + l.pieces
    addInto(head, d.head)
  }

  const byProfile = new Map(profiles.map(p => [p.profile_key, p]))
  const allRacks   = racksFromCounts(pieces, profiles)
  const allWeights = weightsFromLbs(lbs, profiles)
  const allLoose   = Object.entries(loose).map(([product, pieces]) => ({
    product, pieces,
    displayName: byProfile.get(LOOSE_PIECE[product] ?? WEIGHT_PRODUCT[product] ?? '')?.display_name ?? null,
  })).sort((a, b) => b.pieces - a.pieces)

  const dates = out.map(d => d.date).filter(Boolean) as string[]

  return {
    days: out, rates: learned,
    head,
    headTotal:     out.reduce((n, d) => n + d.headTotal, 0),
    headOnSheet:   Math.round(out.reduce((n, d) => n + d.headOnSheet, 0) * 10) / 10,
    headProjected: Math.round(out.reduce((n, d) => n + d.headProjected, 0) * 10) / 10,
    racks: allRacks, weights: allWeights, loose: allLoose,
    loads: out.some(d => d.loads != null)
      ? out.reduce((n, d) => n + (d.loads ?? 0), 0) : null,
    houseMinutes: out.some(d => d.houseMinutes != null)
      ? out.reduce((n, d) => n + (d.houseMinutes ?? 0), 0) : null,
    unsized: unsizedFrom(allRacks, allWeights, allLoose),
    changeoverMinutes: settings.changeover_minutes,
    firstDate: dates.length ? dates[0] : null,
    lastDate:  dates.length ? dates[dates.length - 1] : null,
  }
}
