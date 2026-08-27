// The wild game cut sheet — the questions the counter actually asks.
//
// ── Where the flavour list comes from ─────────────────────────────────────
// Not from here. Flavours live in the game_flavors table, seeded from the
// printed Wild Game Processing slip and editable on the Pricing tab, because
// the list changes most seasons. Only the SHAPE of the sheet lives here.
//
// ── Why cheese is a field and not a word in a name ────────────────────────
// The slip has a "w/ Cheese" column and, separately, four cheese codes —
// Cheddar (CH), Pepperjack (PJ), Mozzarella (MZ), Ghost Pepper (GP). Cheese
// is a decision the hunter makes about a flavour, not part of the flavour, and
// it moves the price from $4.50 to $5.25. Inferring it from a product name gets
// Ghost Pepper wrong — there is no cheese word in "Ghost Pepper" — so it is
// asked, stored, and billed as its own field.

// ── The sheet ─────────────────────────────────────────────────────────────
// Game is not a carcass job. It almost always arrives BONED OUT — a cooler of
// trim the hunter or their guide already broke down in the field, handed over
// ready for the smokehouse. There are no primals to argue about, no backstraps
// to portion, no hindquarter decision to take: that all happened before the
// meat got here.
//
// So the sheet is the printed slip and nothing more. "Base Material" and a
// weight at the top — what came through the door and how much of it — then the
// only question that actually matters: what do you want it turned into. An
// earlier version of this file asked about backstraps and round steak, which is
// a beef cut sheet wearing a game sheet's name; it is gone.

import type { Pool } from './gameBilling'
export type { Pool }

// ── The 25# minimum, from the top of the slip ─────────────────────────────
export const MIN_BATCH_LBS = 25

export interface SheetOption { value: string; label: string; note?: string }
export interface SheetField {
  key:     string
  label:   string
  type:    'choice' | 'text' | 'number' | 'toggle'
  options?: SheetOption[]
  help?:   string
  /** Fields that only make sense once something else was chosen. */
  showIf?: { key: string; equals: string[] }
}
export interface SheetSection { key: string; title: string; blurb?: string; fields: SheetField[] }

// The slip prints the grind package options right on the Grind line: 1# 1.5# 2#.
const PKG_SIZE: SheetOption[] = [
  { value: '1',   label: '1 lb' },
  { value: '1.5', label: '1-1/2 lb' },
  { value: '2',   label: '2 lb' },
]

export const GAME_SHEET: SheetSection[] = [
  {
    key: 'smokehouse',
    title: 'Smokehouse',
    blurb: 'The main event. Pick the flavours they want, then put them in the order that matters — the meat gets filled top down, and it runs out where it runs out. Quantities are batches, because 25 lb is the smallest run the smokehouse will do.',
    fields: [],   // rendered from game_flavors, not from a fixed list
  },
  {
    key: 'grind',
    title: 'Burger — how it comes back',
    // HOW MUCH burger, and WHAT GOES IN IT, are both settled on the ranked
    // "Ground / burger" line in the trim list — quantity in batches or "as much
    // as it takes", fat picked per line like every other grinding option. This
    // section is only about how the finished burger is packaged. It used to ask
    // for pounds and added fat as well, which meant two places could disagree
    // about the same order.
    blurb: 'Packaging only. How much burger and what fat goes in it are set on the Ground / burger line in the trim list above.',
    fields: [
      { key: 'grind_pkg', label: 'Package size', type: 'choice', options: PKG_SIZE },
      { key: 'patties', label: 'Some as patties', type: 'toggle' },
      { key: 'patty_lbs', label: 'Patty pounds', type: 'number', showIf: { key: 'patties', equals: ['true'] } },
    ],
  },
  {
    key: 'services',
    title: 'Other Services',
    blurb: 'Work on the meat itself rather than a product made from it. Priced per pound at weigh-out.',
    fields: [
      // "Slicing" on the slip means steaking the roasts. Spelled out here
      // because it is the trigger for the separate-and-mark rule, and a field
      // labelled just "Slicing" gets ticked without anyone realising that.
      { key: 'slicing', label: 'Slicing — steak the roasts', type: 'toggle',
        help: 'Roasts cut into steaks. They get separated and marked for the cut team.' },
      { key: 'slicing_lbs', label: 'Pounds to slice', type: 'number',
        showIf: { key: 'slicing', equals: ['true'] } },
      { key: 'curing', label: 'Curing', type: 'toggle' },
      { key: 'curing_lbs', label: 'Pounds to cure', type: 'number',
        showIf: { key: 'curing', equals: ['true'] } },
    ],
  },
  {
    key: 'returns',
    title: 'Whole animals only',
    blurb: 'Nearly every hunter arrives with a cooler of boned-out trim, and none of this applies. It is here for the ones who bring the animal in whole.',
    fields: [
      { key: 'cape',    label: 'Save the cape', type: 'toggle', help: 'Caping is a taxidermy job - we hold it, we do not mount it.' },
      { key: 'antlers', label: 'Antlers back',  type: 'toggle' },
      { key: 'hide',    label: 'Hide back',     type: 'toggle' },
      { key: 'heart',   label: 'Heart',         type: 'toggle' },
      { key: 'liver',   label: 'Liver',         type: 'toggle' },
      { key: 'bones',   label: 'Bones for the dog', type: 'toggle' },
    ],
  },
]

// ── Smokehouse picks ──────────────────────────────────────────────────────
// One row per thing the hunter wants made — the same five columns the slip
// has: category, flavour, cheese, pounds, and the fat/trim going into it.
// The pounds here are the ORDER; what bills is the finished weight recorded
// at weigh-out.
//
// ── RANK IS THE ARRAY ORDER, AND IT MATTERS ───────────────────────────────
// Hunters routinely order more than they brought: 60 lb of trim through the
// door and 40 sticks + 30 summer + 20 jerky written on the slip. Something has
// to give, and WHICH thing gives is the hunter's call, not the cutter's — so
// the list is ordered, position 1 gets filled first, and the meat runs out
// wherever it runs out. Reordering the array reorders the priority; there is
// no separate rank column to drift out of step with the list.
// ── ASK IN UNITS THE HUNTER OWNS ──────────────────────────────────────────
// A hunter knows the species and knows what they like. They do NOT know how
// much their meat weighs — it is in a cooler in the truck and has never been on
// a scale — and they certainly do not think in "40 lb of snack sticks".
// Demanding pounds asks a question they cannot answer, and they will guess.
//
// What they can answer is BATCHES. The smokehouse will not run a flavour under
// 25 lb anyway, so a batch is both the real production unit and a quantity a
// person can picture: "give me a batch of jalapeño sticks and a batch of
// summer, and turn the rest into burger."
//
// So quantity is expressed as `batches`, or as `takeRest` for the one line that
// soaks up whatever is left. `lbs` is the resolved number the floor works to —
// derived from batches, or filled in by the counter once the meat is weighed.
export interface SmokehousePick {
  category:       string   // 'sticks' | 'summer' | 'brotwurst' | 'sausage' | 'jerky' | 'grinding'
  flavor:         string
  cheese:         boolean
  cheese_type?:   string   // 'CH' | 'PJ' | 'MZ' | 'GP'
  /** How the hunter said it: 1 batch = the 25 lb minimum. */
  batches?:       number
  /** "As much as it takes" — this line absorbs whatever is left at its rank. */
  takeRest?:      boolean
  /** Resolved pounds: batches x 25, or what the counter worked out. */
  lbs:            number
  fat_trim_kind?: string
  fat_trim_lbs?:  number
  plu?:           string | null
}

export interface GameSheet {
  grind?:      Record<string, string>
  services?:   Record<string, string>
  smokehouse?: SmokehousePick[]
  returns?:    Record<string, string>
  notes?:      string
}

type SheetAnswerKey = 'grind' | 'services' | 'returns'

const labelFor = (section: SheetSection, key: string, value: string): string | null => {
  const field = section.fields.find(f => f.key === key)
  if (!field) return null
  if (field.type === 'toggle') return value === 'true' ? field.label : null
  const opt = field.options?.find(o => o.value === value)
  return `${field.label}: ${opt?.label ?? value}`
}

/** How one smokehouse pick reads on a work order. */
export function describePick(p: SmokehousePick, categoryLabel: (key: string) => string, cheeseLabel: (c: string) => string): string {
  const bits   = [p.flavor, categoryLabel(p.category)].filter(Boolean).join(' ')
  const cheese = p.cheese ? ` w/ ${p.cheese_type ? cheeseLabel(p.cheese_type) : 'cheese'}` : ''
  // Print it the way it was ordered. "2 batches" is what the hunter said and
  // what the smokehouse runs; the pounds are the arithmetic, shown alongside.
  const qty = p.takeRest
    ? ' — as much as it takes'
    : p.batches
      ? ` — ${p.batches} batch${p.batches === 1 ? '' : 'es'} (${p.batches * MIN_BATCH_LBS} lb)`
      : p.lbs ? ` — ${p.lbs} lbs` : ''
  const fat = p.fat_trim_lbs ? ` (+${p.fat_trim_lbs} lb ${p.fat_trim_kind?.replace('add_', '').replace('_', ' ')})` : ''
  return `${bits}${cheese}${qty}${fat}`
}

/**
 * The sheet as lines the floor can work from, smokehouse first because that is
 * what most of the meat becomes. Unanswered questions are omitted rather than
 * printed as "not specified" — a page of blanks buries the three that matter.
 */
export function summariseSheet(
  sheet: GameSheet,
  categoryLabel: (key: string) => string = k => k,
  cheeseLabel: (c: string) => string = c => c,
): { title: string; lines: string[] }[] {
  const out: { title: string; lines: string[] }[] = []

  for (const section of GAME_SHEET) {
    if (section.key === 'smokehouse') continue
    const answers = (sheet[section.key as SheetAnswerKey] ?? {}) as Record<string, string>
    const lines: string[] = []
    for (const field of section.fields) {
      const raw = answers[field.key]
      if (raw == null || raw === '' || raw === 'false') continue
      const line = labelFor(section, field.key, String(raw))
      if (line) lines.push(line)
    }
    if (lines.length) out.push({ title: section.title, lines })
  }

  const picks = sheet.smokehouse ?? []
  if (picks.length) {
    // Numbered, because the number IS the instruction: fill 1 before 2. A
    // cutter reading an unnumbered list has no way to know what to drop when
    // the trim runs out, and will guess.
    out.push({
      title: 'Smokehouse — fill in this order',
      lines: picks
        .filter(p => p.flavor || p.category)
        .map((p, i) => `${i + 1}. ${describePick(p, categoryLabel, cheeseLabel)}`),
    })
  }

  if (sheet.notes?.trim()) out.push({ title: 'Notes', lines: [sheet.notes.trim()] })
  return out
}

/** Pounds a pick commits, from however the hunter expressed it. */
export function pickLbs(p: SmokehousePick): number {
  if (p.takeRest) return 0            // sized at fill time, not at order time
  if (p.batches)  return p.batches * MIN_BATCH_LBS
  return Number(p.lbs) || 0
}

// ── The two pools ─────────────────────────────────────────────────────────
// Wild game arrives as two materials that do not substitute. Roasts are whole
// muscle and are the only thing steaks and jerky can be made from; trim is
// everything that goes through the grinder. The roasts get decided first —
// "we take all the roasts they bring and make whatever we can from them,
// whether they want steaks or jerky as their top priority" — and then whatever
// they wanted done with the trim.
//
// So the order is ranked TWICE, once per pool, and a jerky order can never be
// filled out of a bag of trim just because the total weight happened to cover it.

export interface PoolPlans {
  roast: FillPlan
  trim:  FillPlan
}

/**
 * Rank and fill each pool independently.
 *
 * `poolOf` maps a category to its pool and comes from the live price list, so
 * moving a product between pools is a data change. Anything it cannot place —
 * a treatment like curing — is left out of both plans rather than silently
 * charged against one of them.
 */
export function fillPlans(
  sheet: GameSheet,
  poolOf: (category: string) => Pool | null,
  weights: { roastLbs?: number | null; trimLbs?: number | null },
): PoolPlans {
  const picks = sheet.smokehouse ?? []
  return {
    roast: fillPlan(picks.filter(p => poolOf(p.category) === 'roast'), weights.roastLbs),
    trim:  fillPlan(picks.filter(p => poolOf(p.category) === 'trim'),  weights.trimLbs),
  }
}

/**
 * Reorder one pool's line within the FULL pick list.
 *
 * The screen shows two ranked lists but stores one array, so "move the second
 * jerky line up" has to become a swap between two positions in that array. Done
 * by hand rather than by index arithmetic, because the two lists interleave and
 * off-by-one here silently reorders somebody's priorities.
 */
export function movePickInPool(
  picks: SmokehousePick[],
  poolOf: (category: string) => Pool | null,
  pool: Pool,
  indexInPool: number,
  delta: number,
): SmokehousePick[] {
  const positions = picks
    .map((p, i) => ({ p, i }))
    .filter(x => poolOf(x.p.category) === pool)
    .map(x => x.i)

  const from = positions[indexInPool]
  const to   = positions[indexInPool + delta]
  if (from == null || to == null) return picks

  const next = [...picks]
  ;[next[from], next[to]] = [next[to], next[from]]
  return next
}

export interface FillLine {
  pick:       SmokehousePick
  rank:       number      // 1-based, what the work order prints
  lbs:        number      // what this line commits (0 until sized, for "the rest")
  cumulative: number      // pounds committed through this line
  /** 'full' = the meat reaches it · 'partial' = runs out mid-way · 'short' = nothing left
   *  'rest' = sized from whatever remains · 'unknown' = no weight recorded yet */
  fill:       'full' | 'partial' | 'short' | 'rest' | 'unknown'
  availableLbs: number    // what this line can actually be made from
  belowMinimum: boolean   // sized under the 25 lb batch minimum
}

export interface FillPlan {
  lines:     FillLine[]
  ordered:   number        // fixed pounds asked for
  available: number | null // base material weight, once it is on our scale
  /** Left over after the list takes its cut. Negative = over-ordered. */
  remaining: number | null
  shortBy:   number        // pounds the order exceeds the meat by, 0 when it fits
  hasRest:   boolean
}

/**
 * Who gets filled, in order, against the meat that actually came through the
 * door — and exactly where it runs out.
 *
 * Two things this has to survive. First, no weight: at the counter, and on the
 * hunter's online order, nothing has been on a scale yet. The plan still ranks
 * everything and simply reports 'unknown' rather than inventing a number.
 * Second, "as much as it takes": one line commonly soaks up the remainder, and
 * it is sized here rather than typed by anybody.
 */
function fillPlan(
  input: GameSheet | SmokehousePick[],
  availableLbs: number | null | undefined,
): FillPlan {
  const picks = Array.isArray(input) ? input : (input.smokehouse ?? [])
  // ZERO IS AN ANSWER. "They brought no roasts" is the single most important
  // thing this plan can say — it is what makes a jerky order impossible — so
  // only a genuinely absent weight counts as unknown. Folding 0 into null hid
  // exactly the case the two-pool split exists to catch.
  const raw = availableLbs == null || availableLbs === ('' as unknown) ? null : Number(availableLbs)
  const available = raw == null || !Number.isFinite(raw) || raw < 0 ? null : raw

  let cumulative = 0
  const lines: FillLine[] = picks.map((pick, i) => {
    const wanted = pickLbs(pick)
    const before = cumulative
    const left   = available == null ? null : Math.max(0, available - before)

    let lbs = wanted
    let fill: FillLine['fill'] = 'full'
    let lineAvailable = wanted

    if (pick.takeRest) {
      // Sized from what survives everything ranked above it.
      fill = available == null ? 'unknown' : 'rest'
      lbs = lineAvailable = left ?? 0
    } else if (available == null) {
      fill = 'unknown'
    } else if (left! <= 0) {
      fill = 'short';   lineAvailable = 0
    } else if (left! < wanted) {
      fill = 'partial'; lineAvailable = Math.round(left! * 10) / 10
    }

    cumulative += lbs

    return {
      pick, rank: i + 1, lbs: Math.round(lbs * 10) / 10,
      cumulative: Math.round(cumulative * 10) / 10,
      fill, availableLbs: Math.round(lineAvailable * 10) / 10,
      // A batch the smokehouse will refuse to run. Only meaningful once it has
      // a size — a "the rest" line with no weight yet cannot be judged.
      belowMinimum: lineAvailable > 0 && lineAvailable < MIN_BATCH_LBS,
    }
  })

  const ordered = Math.round(picks.reduce((t, p) => t + pickLbs(p), 0) * 10) / 10
  return {
    lines, ordered, available,
    remaining: available == null ? null : Math.round((available - ordered) * 10) / 10,
    shortBy:   available == null ? 0 : Math.max(0, Math.round((ordered - available) * 10) / 10),
    hasRest:   picks.some(p => !!p.takeRest),
  }
}
