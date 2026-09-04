// What's sitting in the cure cooler, and what it turns into at the smokehouse
// door: how many pieces, how many pounds, how many house loads.
//
// Charlie asked for this two ways in one note (2026-08-26): "24 hams per load,
// 72 bacons per load" and "can we sneak in a scanning module for cure items so
// we know how much weight is going into the smokehouse?". They are the same
// question — the seal scan already happens on every piece, so the pieces are
// already counted; what was missing was the capacity to divide them by and the
// pounds to go with them.
//
// Pounds are the honest weak spot. weight_lbs on a cure tag is optional and
// mostly blank, so this module NEVER quietly totals a partial number as if it
// were the whole: weighed pounds and unweighed pieces are reported separately,
// and an estimate for the unweighed remainder only appears once a product has
// enough weighed pieces behind it to mean something — the same discipline
// lib/loadLearning.ts applies to load size.
import type { CureTag } from '@/lib/types'
import type { CookProfile } from '@/lib/cookPredict'

// Cure products that can only have come off a hog, so they are never offered
// against — or shown on — a customer's beef, lamb or goat.
//
// Bacon is deliberately NOT here: beef bacon is a real thing we cure, and
// 'Other' says nothing about the animal by definition.
//
// ⚠️ Two vocabularies. harvest_log.species says 'Hog'; cutting_instructions
// .species says 'Pork'. Callers pass whichever they hold — hence both spellings.
export const PORK_ONLY_CURE_PRODUCTS = new Set(['Ham', 'Shoulder Bacon', 'Hocks', 'Jowl', 'Bone-In Loin', 'Fresh Side'])

export function cureProductFitsSpecies(product: string, species: string | null | undefined): boolean {
  if (!PORK_ONLY_CURE_PRODUCTS.has(product)) return true
  return species === 'Pork' || species === 'Hog'
}

/** Below this many weighed pieces, a per-piece average is noise, not evidence. */
export const MIN_WEIGHED_FOR_ESTIMATE = 5

// A tag's product → the rack it hangs on, the cook profile that owns that
// rack's capacity, and how many of the piece share one slot on it.
//
// The house is counted in SLOTS, not pieces: a belly takes a whole comb, but
// shoulder bacon hangs two to a comb (Charlie, 2026-08-27), so 30 shoulder
// bacons cost 15 combs against the 72. Jowls and loins have no counted capacity
// yet — they show as pieces and stay out of the load math rather than being
// invented into it.
export interface RackSpec {
  group: string; label: string; profileKey: string | null
  /** Pieces that share one slot on the rack. 1 = one each. */
  perSlot: number
}
const RACK: Record<string, RackSpec> = {
  'Ham':            { group: 'ham',   label: 'Ham rack',   profileKey: 'BONE IN HAM',       perSlot: 1 },
  'Bacon':          { group: 'bacon', label: 'Bacon comb', profileKey: 'SMKD BACON',        perSlot: 1 },
  'Shoulder Bacon': { group: 'bacon', label: 'Bacon comb', profileKey: 'SMKD BACON',        perSlot: 2 },
  'Bone-In Loin':   { group: 'loin',  label: 'Loins',      profileKey: 'BONE IN PORKCHOP',  perSlot: 1 },
  // Hocks ride the ham rack (Charlie, 2026-08-27), so they cost ham capacity
  // rather than sitting outside the load math. Counted one to a slot because
  // that is all that was said — if several hocks share a ham's place, perSlot
  // is the one number to change.
  'Hocks':          { group: 'ham',   label: 'Ham rack',   profileKey: 'BONE IN HAM',       perSlot: 1 },
  'Jowl':           { group: 'jowl',  label: 'Jowls',      profileKey: null,                perSlot: 1 },
  // Fresh side never enters the house — it's tagged so the slab is tracked to
  // the slicer, not because it cures. Its own group so the board doesn't file
  // it under "Other", and no profile so it can't cost smokehouse capacity.
  'Fresh Side':     { group: 'fresh', label: 'Fresh side — slice, no cure', profileKey: null, perSlot: 1 },
}
const OTHER: RackSpec = { group: 'other', label: 'Other', profileKey: null, perSlot: 1 }

export const rackFor = (product: string): RackSpec => RACK[product] ?? OTHER

export interface ProductLine {
  product:     string
  pieces:      number
  /** Rack slots those pieces cost — combs, not bellies. */
  slots:       number
  weighed:     number   // pieces with a real weight on the tag
  weighedLbs:  number   // sum of those weights
  /** Median weighed piece, or null when too few weighed pieces to say. */
  perPieceLbs: number | null
}

export interface RackLoad {
  group:    string
  label:    string
  /** Products hanging on this rack, biggest count first. */
  products: ProductLine[]

  pieces:      number
  /** What those pieces cost in rack slots. Equals pieces unless something
      shares a slot, which today only shoulder bacon does. */
  slots:       number
  weighed:     number
  unweighed:   number
  weighedLbs:  number
  /** Pounds inferred for the unweighed pieces. 0 when nothing supports one. */
  estimatedLbs: number
  /** weighedLbs + estimatedLbs. Only a complete figure when unweighed is 0. */
  totalLbs:    number
  /** True once every piece on the rack carries its own weight. */
  weightComplete: boolean

  profileKey:    string | null
  displayName:   string | null
  unitsPerBatch: number | null
  unitLabel:     string | null
  /** Loads this rack needs at the counted capacity. Null when uncounted. */
  loads:         number | null
  /** Slots still free on the last load — how much more the house can take. */
  spaceLeft:     number | null
}

export interface CureLoadSummary {
  racks:        RackLoad[]
  pieces:       number
  slots:        number
  unweighed:    number
  weighedLbs:   number
  estimatedLbs: number
  totalLbs:     number
  loads:        number | null   // across racks with a counted capacity only
  oldestDate:   string | null
}

function median(v: number[]): number | null {
  if (!v.length) return null
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

const round1 = (n: number) => Math.round(n * 10) / 10

/** How many loads a slot count needs, and what's left free on the last one. */
export function loadsFor(slots: number, unitsPerBatch: number | null | undefined):
  { loads: number | null; spaceLeft: number | null } {
  if (!unitsPerBatch || unitsPerBatch <= 0) return { loads: null, spaceLeft: null }
  const loads = Math.ceil(slots / unitsPerBatch)
  return { loads, spaceLeft: loads * unitsPerBatch - slots }
}

/**
 * Roll a set of cure tags up into rack loads.
 *
 * Pass only the tags actually in the cooler (status 'curing') — a tag already
 * marked done came out of the house and is nobody's load any more.
 */
export function summarizeCure(tags: CureTag[], profiles: CookProfile[]): CureLoadSummary {
  const byProfile = new Map(profiles.map(p => [p.profile_key, p]))

  interface Line extends ProductLine {
    group: string; label: string; profileKey: string | null
    perSlot: number; weights: number[]
  }
  const lines = new Map<string, Line>()
  let oldest: string | null = null

  for (const t of tags) {
    const rack = rackFor(t.product)
    let line = lines.get(t.product)
    if (!line) {
      line = {
        product: t.product, pieces: 0, slots: 0, weighed: 0, weighedLbs: 0, perPieceLbs: null,
        group: rack.group, label: rack.label, profileKey: rack.profileKey,
        perSlot: rack.perSlot, weights: [],
      }
      lines.set(t.product, line)
    }
    line.pieces++
    const w = t.weight_lbs == null ? null : Number(t.weight_lbs)
    if (w != null && w > 0) {
      line.weighed++
      line.weighedLbs += w
      line.weights.push(w)
    }
    const day = t.session_date ?? t.created_at?.slice(0, 10) ?? null
    if (day && (!oldest || day < oldest)) oldest = day
  }

  for (const line of lines.values()) {
    line.perPieceLbs = line.weighed >= MIN_WEIGHED_FOR_ESTIMATE ? round1(median(line.weights) ?? 0) : null
    line.weighedLbs  = round1(line.weighedLbs)
    // Whole slots per product — you don't leave half a comb for a ham to
    // finish, so the remainder of each product rounds up on its own.
    line.slots = Math.ceil(line.pieces / line.perSlot)
  }

  const racks = new Map<string, RackLoad>()
  for (const line of lines.values()) {
    let rack = racks.get(line.group)
    if (!rack) {
      const profile = line.profileKey ? byProfile.get(line.profileKey) ?? null : null
      rack = {
        group: line.group, label: line.label, products: [],
        pieces: 0, slots: 0, weighed: 0, unweighed: 0, weighedLbs: 0, estimatedLbs: 0, totalLbs: 0,
        weightComplete: false,
        profileKey:    line.profileKey,
        displayName:   profile?.display_name ?? null,
        unitsPerBatch: profile?.units_per_batch ?? null,
        unitLabel:     profile?.unit_label ?? null,
        loads: null, spaceLeft: null,
      }
      racks.set(line.group, rack)
    }
    rack.products.push({
      product:     line.product,
      pieces:      line.pieces,
      slots:       line.slots,
      weighed:     line.weighed,
      weighedLbs:  line.weighedLbs,
      perPieceLbs: line.perPieceLbs,
    })
    rack.pieces     += line.pieces
    rack.slots      += line.slots
    rack.weighed    += line.weighed
    rack.weighedLbs += line.weighedLbs
    // Each product estimates its own remainder — a shoulder bacon is not a
    // belly, so one average across the whole rack would be the wrong number.
    if (line.perPieceLbs != null) rack.estimatedLbs += line.perPieceLbs * (line.pieces - line.weighed)
  }

  for (const rack of racks.values()) {
    rack.products.sort((a, b) => b.pieces - a.pieces)
    rack.unweighed      = rack.pieces - rack.weighed
    rack.weighedLbs     = round1(rack.weighedLbs)
    rack.estimatedLbs   = round1(rack.estimatedLbs)
    rack.totalLbs       = round1(rack.weighedLbs + rack.estimatedLbs)
    rack.weightComplete = rack.unweighed === 0 && rack.pieces > 0
    const cap = loadsFor(rack.slots, rack.unitsPerBatch)
    rack.loads     = cap.loads
    rack.spaceLeft = cap.spaceLeft
  }

  const all     = [...racks.values()].sort((a, b) => b.pieces - a.pieces)
  const counted = all.filter(r => r.loads != null)

  return {
    racks:        all,
    pieces:       all.reduce((n, r) => n + r.pieces, 0),
    slots:        all.reduce((n, r) => n + r.slots, 0),
    unweighed:    all.reduce((n, r) => n + r.unweighed, 0),
    weighedLbs:   round1(all.reduce((n, r) => n + r.weighedLbs, 0)),
    estimatedLbs: round1(all.reduce((n, r) => n + r.estimatedLbs, 0)),
    totalLbs:     round1(all.reduce((n, r) => n + r.totalLbs, 0)),
    loads:        counted.length ? counted.reduce((n, r) => n + (r.loads ?? 0), 0) : null,
    oldestDate:   oldest,
  }
}
