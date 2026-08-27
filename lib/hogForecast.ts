// How many smokehouse loads a booked run of hogs is going to take.
//
// This is what the load sizes were counted FOR (Charlie, 2026-08-27): "when we
// get a run of hogs we can predict how many smokehouse loads it is going to
// take." The cure board answers it for meat already hanging; this answers it
// for hogs that are still on the schedule.
//
// Two sources, in that order of trust:
//   1. THE CUT SHEET, where one exists. extractValueAdd already reads exactly
//      what the customer ordered — two hams off a whole hog, one off a half —
//      so a booked head with a sheet on file is not a projection at all.
//   2. A RATE LEARNED FROM PAST HOGS, for heads with no sheet yet. Booked
//      animals routinely have no sheet until close to the kill, and a forecast
//      that ignored them would read low precisely when the run is biggest.
//
// The two are never blended into one undifferentiated number: every result says
// how many head it actually read and how many it projected.
import { extractValueAdd } from '@/lib/valueAdd'
import { rackFor, loadsFor } from '@/lib/cureLoad'
import type { CookProfile } from '@/lib/cookPredict'

/** Hog-equivalents below this and a learned per-hog rate is not worth quoting. */
export const MIN_HOGS_FOR_RATE = 10

// What extractValueAdd calls a product → what the cure tags call it, so the
// forecast and the cooler board name the same rack. Anything not listed here
// never reaches the smokehouse as a cured piece and is left out.
const CURE_PRODUCT: Record<string, string> = {
  'Cured & Smoked Ham':   'Ham',
  'Bacon':                'Bacon',
  'Shoulder Bacon':       'Shoulder Bacon',
  'Cured & Smoked Hocks': 'Hocks',
  'Smoked Chops':         'Bone-In Loin',
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
  customers:    unknown
}

/**
 * How much of one hog a sheet speaks for.
 *
 * A whole-hog card covers the animal however many people split the box — the
 * A|B and A|B|C|D shares are one card for one hog, which is why extractValueAdd
 * already doubles the paired primals on them.
 */
export function hogFraction(data: unknown): number {
  const portion = String((data as Record<string, unknown> | null)?.portion ?? '')
  if (portion.startsWith('whole')) return 1
  if (portion === 'half')          return 0.5
  if (portion === 'quarter')       return 0.25
  // No portion recorded. A pork card with nothing said is a whole hog — that's
  // the wizard's own default — and calling it a fraction would under-forecast.
  return 1
}

/** Cure-bound pieces one sheet orders, keyed by cure-tag product name. */
export function sheetCurePieces(species: string | null, data: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  for (const item of extractValueAdd(species, data)) {
    const name = CURE_PRODUCT[item.product]
    if (!name) continue
    out[name] = (out[name] ?? 0) + (item.qty ?? 1)
  }
  return out
}

export interface HogRate {
  /** Pieces per whole hog, by cure-tag product name. */
  perHog:  Record<string, number>
  /** Hog-equivalents the rate was fitted on. */
  hogs:    number
  sheets:  number
  usable:  boolean
  reason:  string
}

/**
 * What a hog has historically put in the smokehouse, per head.
 *
 * Averaged over hog-equivalents rather than sheets: nineteen half-hog cards are
 * nine and a half hogs, and counting them as nineteen would halve the rate.
 */
export function learnHogRate(sheets: SheetRow[]): HogRate {
  const pork = sheets.filter(s => /pork|hog/i.test(s.species ?? ''))
  let hogs = 0
  const totals: Record<string, number> = {}

  for (const s of pork) {
    hogs += hogFraction(s.data)
    for (const [name, qty] of Object.entries(sheetCurePieces(s.species, s.data))) {
      totals[name] = (totals[name] ?? 0) + qty
    }
  }

  const perHog: Record<string, number> = {}
  if (hogs > 0) {
    for (const [name, qty] of Object.entries(totals)) perHog[name] = qty / hogs
  }

  const usable = hogs >= MIN_HOGS_FOR_RATE
  return {
    perHog, hogs: Math.round(hogs * 10) / 10, sheets: pork.length, usable,
    reason: usable
      ? `Averaged over ${Math.round(hogs)} hogs' worth of cut sheets.`
      : `Only ${Math.round(hogs * 10) / 10} hogs' worth of sheets on file — too few to project from.`,
  }
}

export interface ForecastRack {
  group:         string
  label:         string
  products:      { product: string; pieces: number; slots: number }[]
  pieces:        number
  slots:         number
  displayName:   string | null
  unitsPerBatch: number | null
  unitLabel:     string | null
  loads:         number | null
  spaceLeft:     number | null
}

export interface DayForecast {
  /** Kill date. Everything killed the same day cures and smokes together. */
  date:         string | null
  bookings:     number
  head:         number
  /** Head covered by a cut sheet already on file. */
  headOnSheet:  number
  /** Head with no sheet yet, carried by the learned rate. */
  headProjected: number
  pieces:       Record<string, number>
  racks:        ForecastRack[]
  loads:        number | null
}

export interface RunForecast {
  rate:  HogRate
  days:  DayForecast[]
  head:          number
  headOnSheet:   number
  headProjected: number
  pieces:        Record<string, number>
  racks:         ForecastRack[]
  /** Loads counted kill day by kill day — what the house actually has to run. */
  loads:         number | null
  /** Loads if every hog in the window cured at once. A floor, not a plan. */
  loadsIfCombined: number | null
  firstDate:   string | null
  lastDate:    string | null
}

/** Turn a bag of piece counts into rack loads, on the cure board's own rules. */
export function racksFromCounts(
  counts:   Record<string, number>,
  profiles: CookProfile[],
): ForecastRack[] {
  const byProfile = new Map(profiles.map(p => [p.profile_key, p]))
  const racks = new Map<string, ForecastRack>()

  for (const [product, pieces] of Object.entries(counts)) {
    if (!(pieces > 0)) continue
    const spec = rackFor(product)
    let rack = racks.get(spec.group)
    if (!rack) {
      const profile = spec.profileKey ? byProfile.get(spec.profileKey) ?? null : null
      rack = {
        group: spec.group, label: spec.label, products: [], pieces: 0, slots: 0,
        displayName:   profile?.display_name ?? null,
        unitsPerBatch: profile?.units_per_batch ?? null,
        unitLabel:     profile?.unit_label ?? null,
        loads: null, spaceLeft: null,
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
  }
  return [...racks.values()].sort((a, b) => b.pieces - a.pieces)
}

const addInto = (into: Record<string, number>, from: Record<string, number>) => {
  for (const [k, v] of Object.entries(from)) into[k] = (into[k] ?? 0) + v
}

/**
 * Forecast a run of booked hogs.
 *
 * Loads are counted BY KILL DATE. Eight separate one-hog bookings on the same
 * day are one day's work and share the racks; two kill dates a month apart do
 * not, so their part-full loads can't be added together into one. Summing per
 * BOOKING was the first cut of this and it read 34 loads for 52 hogs — every
 * single-hog booking paying for its own ham load and its own bacon load.
 *
 * The run also reports loadsIfCombined: the same pieces as one big cure. That
 * is a floor, not a plan — it only holds when the dates are close enough to
 * cure together.
 */
export function forecastRun(
  appts:     ApptRow[],
  sheets:    SheetRow[],
  profiles:  CookProfile[],
  rate?:     HogRate,
): RunForecast {
  const learned = rate ?? learnHogRate(sheets)
  const byAppt = new Map<string, SheetRow[]>()
  for (const s of sheets) {
    if (!s.appointment_id) continue
    const list = byAppt.get(s.appointment_id) ?? []
    list.push(s)
    byAppt.set(s.appointment_id, list)
  }

  // Gather each kill date's head and its sheets before any rate is applied.
  // Rounding to whole pieces has to happen once per DAY, not once per booking,
  // or eleven bookings of one hog each round eleven separate remainders up.
  interface Day {
    date: string | null; bookings: number; head: number
    onSheet: number; pieces: Record<string, number>
  }
  const byDay = new Map<string, Day>()

  for (const a of appts) {
    const head = a.head_count ?? 0
    if (head <= 0) continue
    const key = a.harvest_date ?? 'unscheduled'
    let day = byDay.get(key)
    if (!day) {
      day = { date: a.harvest_date, bookings: 0, head: 0, onSheet: 0, pieces: {} }
      byDay.set(key, day)
    }

    let headOnSheet = 0
    for (const s of byAppt.get(a.id) ?? []) {
      headOnSheet += hogFraction(s.data)
      addInto(day.pieces, sheetCurePieces(s.species, s.data))
    }
    // A sheet can only speak for as much hog as was booked — a mis-linked card
    // must not make the run look bigger than the head count.
    headOnSheet = Math.min(headOnSheet, head)

    day.bookings++
    day.head    += head
    day.onSheet += headOnSheet
  }

  const out: DayForecast[] = []
  for (const day of byDay.values()) {
    const pieces = { ...day.pieces }
    const headProjected = Math.max(0, day.head - day.onSheet)
    if (headProjected > 0 && learned.usable) {
      for (const [name, per] of Object.entries(learned.perHog)) {
        pieces[name] = (pieces[name] ?? 0) + per * headProjected
      }
    }
    for (const k of Object.keys(pieces)) {
      pieces[k] = Math.round(pieces[k])
      if (!pieces[k]) delete pieces[k]
    }

    const racks = racksFromCounts(pieces, profiles)
    out.push({
      date: day.date, bookings: day.bookings, head: day.head,
      headOnSheet:   Math.round(day.onSheet * 10) / 10,
      headProjected: Math.round(headProjected * 10) / 10,
      pieces, racks,
      loads: racks.some(r => r.loads != null)
        ? racks.reduce((n, r) => n + (r.loads ?? 0), 0)
        : null,
    })
  }

  out.sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))

  const pieces: Record<string, number> = {}
  for (const d of out) addInto(pieces, d.pieces)
  const combined = racksFromCounts(pieces, profiles)
  const dates = out.map(d => d.date).filter(Boolean) as string[]

  return {
    rate:          learned,
    days:          out,
    head:          out.reduce((n, d) => n + d.head, 0),
    headOnSheet:   Math.round(out.reduce((n, d) => n + d.headOnSheet, 0) * 10) / 10,
    headProjected: Math.round(out.reduce((n, d) => n + d.headProjected, 0) * 10) / 10,
    pieces,
    racks:         combined,
    loads:         out.some(d => d.loads != null)
      ? out.reduce((n, d) => n + (d.loads ?? 0), 0)
      : null,
    loadsIfCombined: combined.some(r => r.loads != null)
      ? combined.reduce((n, r) => n + (r.loads ?? 0), 0)
      : null,
    firstDate: dates.length ? dates[0] : null,
    lastDate:  dates.length ? dates[dates.length - 1] : null,
  }
}
