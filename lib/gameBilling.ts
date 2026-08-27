// Wild game pricing.
//
// Livestock bills off carcass weight before anything is cut (lib/billingRules.ts).
// Game bills off FINISHED weight, per service, after everything is cut — that is
// how the printed Wild Game Processing slip is laid out and how the counter has
// always quoted it: "burger's a dollar seventy-five a pound, sticks are four
// fifty, five and a quarter with cheese".
//
// ── Rates are DATA, not code ──────────────────────────────────────────────
// They live in the game_rates table and are edited on the Pricing tab, because
// pricing moves and a price change should not need a deploy. The seed below is
// only the shape and the fallback — the live rate always comes from the table.
//
// Rates are STAMPED onto game_outputs at weigh-out. Editing a price never
// rewrites a ticket that was already quoted to a hunter.

import type { BillingCharge } from './billingRules'

export type RateUnit = 'lb' | 'hr' | 'ea'

// Which raw material a service eats. Roasts and trim do not substitute for one
// another: you cannot slice jerky out of a bag of trim, and nobody grinds a
// backstrap into snack sticks by choice.
export type RateSource = 'roast' | 'trim' | 'either'

export interface GameRate {
  key:            string
  label:          string
  unit:           RateUnit
  rate:           number
  cheese_rate:    number | null
  source:         RateSource
  qbo_item_id:    string | null
  qbo_item_name:  string | null
  // A cheese product is a DIFFERENT QuickBooks item, not the same item at a
  // higher price: sticks are item 94, sticks w/cheese are item 93. Billing the
  // right money against the wrong item is only visible at year end.
  cheese_qbo_item_id:   string | null
  cheese_qbo_item_name: string | null
  bucket:         'product' | 'other'
  sort:           number
  active:         boolean
  note:           string
}

// Fallback used only when the table cannot be read. Values are the printed slip
// as of 2026-08-24. Anything that disagrees with game_rates loses.
export const RATE_SEED: Record<string, Pick<GameRate, 'label' | 'unit' | 'rate' | 'cheese_rate' | 'bucket' | 'source'>> = {
  // ── Off the roasts ──────────────────────────────────────────────────────
  jerky:              { label: 'Jerky',                   unit: 'lb', rate: 11.00, cheese_rate: null, bucket: 'product', source: 'roast' },
  slicing:            { label: 'Steaks off the roasts',   unit: 'lb', rate: 2.00, cheese_rate: null, bucket: 'other',   source: 'roast' },
  packaging:          { label: 'Roasts kept whole',       unit: 'lb', rate: 1.50, cheese_rate: null, bucket: 'other',   source: 'roast' },
  // ── Off the trim ────────────────────────────────────────────────────────
  brotwurst:          { label: 'Brotwurst',               unit: 'lb', rate: 4.50, cheese_rate: 5.25, bucket: 'product', source: 'trim' },
  summer:             { label: 'Summer Sausage / Salami', unit: 'lb', rate: 4.50, cheese_rate: 5.25, bucket: 'product', source: 'trim' },
  sticks:             { label: 'Snack Sticks',            unit: 'lb', rate: 4.50, cheese_rate: 5.25, bucket: 'product', source: 'trim' },
  sausage:            { label: 'Bulk Sausage',            unit: 'lb', rate: 3.50, cheese_rate: null, bucket: 'product', source: 'trim' },
  grinding:           { label: 'Ground / burger',         unit: 'lb', rate: 1.75, cheese_rate: null, bucket: 'other',   source: 'trim' },
  // ── Treatments and fees: they consume neither pool ──────────────────────
  curing:             { label: 'Curing',                  unit: 'lb', rate: 2.50, cheese_rate: null, bucket: 'other', source: 'either' },
  add_pork_trim:      { label: 'Add Pork Trim (PT)',      unit: 'lb', rate: 2.79, cheese_rate: null, bucket: 'other', source: 'either' },
  add_beef_trim:      { label: 'Add Beef Trim (BT)',      unit: 'lb', rate: 4.99, cheese_rate: null, bucket: 'other', source: 'either' },
  add_pork_fat:       { label: 'Add Pork Fat (PF)',       unit: 'lb', rate: 1.79, cheese_rate: null, bucket: 'other', source: 'either' },
  add_beef_fat:       { label: 'Add Beef Fat (BF)',       unit: 'lb', rate: 2.59, cheese_rate: null, bucket: 'other', source: 'either' },
  cleaning:           { label: 'Cleaning Fee',            unit: 'hr', rate: 60.00, cheese_rate: null, bucket: 'other', source: 'either' },
  buffalo_receive:    { label: 'Buffalo Receive / Skin / Split', unit: 'ea', rate: 85.00, cheese_rate: null, bucket: 'other', source: 'either' },
  buffalo_processing: { label: 'Buffalo Processing',      unit: 'lb', rate: 1.10, cheese_rate: null, bucket: 'other', source: 'either' },
}

export type RateMap = Record<string, GameRate>

/** Build a usable map from whatever the table returned, filling any gaps. */
export function toRateMap(rows: GameRate[] | null | undefined): RateMap {
  const map: RateMap = {}
  for (const [key, seed] of Object.entries(RATE_SEED)) {
    map[key] = {
      key, ...seed, qbo_item_id: null, qbo_item_name: null,
      cheese_qbo_item_id: null, cheese_qbo_item_name: null,
      sort: 0, active: true, note: '',
    }
  }
  for (const row of rows ?? []) map[row.key] = { ...map[row.key], ...row }
  return map
}

// ── What a hunter orders, grouped by the material it comes off ─────────────
// Order within each list is the order the picker offers them, which is roughly
// how often they get chosen.
export const ROAST_CATEGORIES = ['slicing', 'jerky', 'packaging'] as const
export const TRIM_CATEGORIES  = ['sticks', 'summer', 'brotwurst', 'sausage', 'grinding'] as const

// Kept for the weigh-out screen, which lists everything that can be weighed.
export const PRODUCT_CATEGORIES = ['brotwurst', 'summer', 'sticks', 'sausage', 'jerky'] as const
export const SERVICE_CATEGORIES = ['packaging', 'grinding', 'slicing', 'curing'] as const

// The two materials a hunter's drop-off splits into. Lives here because it is
// read straight off game_rates.source, which this file owns.
export type Pool = 'roast' | 'trim'
// ── What we sell INTO the grind: our beef and pork ─────────────────────────
export const ADDITION_CATEGORIES = ['add_beef_fat', 'add_pork_fat', 'add_beef_trim', 'add_pork_trim'] as const

export type AdditionKind = (typeof ADDITION_CATEGORIES)[number]

// ── Cheese ─────────────────────────────────────────────────────────────────
// Four cheeses, exactly as printed on the slip. Ghost Pepper is the one a
// name-sniffing rule would miss — "Ghost Pepper" contains no cheese word at
// all — which is precisely why cheese is a field the counter ticks and not
// something inferred from a product name.
export const CHEESE_TYPES = [
  { code: 'CH', label: 'Cheddar' },
  { code: 'PJ', label: 'Pepperjack' },
  { code: 'MZ', label: 'Mozzarella' },
  { code: 'GP', label: 'Ghost Pepper' },
] as const

export type CheeseCode = (typeof CHEESE_TYPES)[number]['code']

export const cheeseLabel = (code: string) =>
  CHEESE_TYPES.find(c => c.code === code)?.label ?? code

// Some flavour names already carry a cheese ("Smokey Cheddar", "Chili Cheese").
// This is a HINT for the counter screen — it pre-ticks the box — never the
// billing decision. The stored `cheese` flag is what bills.
const CHEESE_WORDS = /\b(cheddar|pepper\s*jack|pepperjack|mozzarella|cheese|ghost\s*pepper)\b/i
export const looksLikeCheese = (name?: string | null) => CHEESE_WORDS.test(name ?? '')

const round2 = (n: number) => Math.round(n * 100) / 100

/** The rate a line should bill at, honouring the cheese column. */
export function rateFor(rates: RateMap, category: string, cheese: boolean): number {
  const r = rates[category]
  if (!r) return 0
  return cheese && r.cheese_rate != null ? Number(r.cheese_rate) : Number(r.rate)
}

/** The QuickBooks item a line books against — the cheese twin when it has one. */
export function itemFor(rates: RateMap, category: string, cheese: boolean) {
  const r = rates[category]
  if (!r) return { id: '', name: category }
  if (cheese && r.cheese_qbo_item_id) {
    return { id: r.cheese_qbo_item_id, name: r.cheese_qbo_item_name ?? r.label }
  }
  return { id: r.qbo_item_id ?? '', name: r.qbo_item_name ?? r.label }
}

export interface GameOutputRow {
  category:       string
  product_name?:  string | null
  flavor?:        string | null
  cheese?:        boolean
  cheese_type?:   string | null
  weight_lbs:     number | null
  rate?:          number | null
  rate_override?: boolean
  qbo_item_id?:   string | null
  qbo_item_name?: string | null
  fat_trim_lbs?:  number | null
  fat_trim_kind?: string | null
}

export interface GameAdditionRow {
  kind:       string
  weight_lbs: number | null
  rate?:      number | null
}

export interface GameIntakeForBilling {
  species:        string
  cleaning_hours: number | null
  weight_in_lbs:  number | null
  tag_number:     string
}

/** How a weighed line should read on a ticket: flavour, cheese and all. */
export function describeOutput(out: GameOutputRow, rates: RateMap): string {
  const label = rates[out.category]?.label ?? out.category
  const parts: string[] = []
  if (out.flavor) parts.push(out.flavor)
  parts.push(label)
  if (out.cheese) parts.push(`w/ ${out.cheese_type ? cheeseLabel(out.cheese_type) : 'cheese'}`)
  return parts.join(' ')
}

/**
 * Everything this animal owes, as invoice-shaped lines.
 *
 * Order follows the slip: the products the hunter ordered, then the services on
 * the meat, then the fat and trim that went in, then the flat fees. A
 * zero-weight line is skipped rather than printed at $0.00 — no weight means
 * nobody has weighed it yet, which is not the same as costing nothing.
 */
export function gameCharges(
  intake: GameIntakeForBilling,
  outputs: GameOutputRow[],
  additions: GameAdditionRow[],
  rates: RateMap,
): BillingCharge[] {
  const charges: BillingCharge[] = []
  const tag = intake.tag_number

  const push = (
    ruleKey: string, category: string, description: string,
    qty: number, unit: 'lb' | 'ea', rate: number, cheese = false,
  ) => {
    const item = itemFor(rates, category, cheese)
    charges.push({
      ruleKey,
      qboItemId:   item.id,
      qboItemName: item.name,
      description, qty, unit, rate, amount: round2(qty * rate),
    })
  }

  // ── Buffalo arrive as an animal, not a cooler of meat ───────────────────
  if (intake.species === 'Buffalo') {
    const recv = rates.buffalo_receive
    if (recv?.active) {
      push('buffalo_receive', 'buffalo_receive', `${recv.label} — ${tag}`, 1, 'ea', Number(recv.rate))
    }
    const proc = rates.buffalo_processing
    if (proc?.active && intake.weight_in_lbs && intake.weight_in_lbs > 0) {
      const qty = round2(intake.weight_in_lbs)
      push('buffalo_processing', 'buffalo_processing', `${proc.label} — ${tag}, ${qty} lbs`, qty, 'lb', Number(proc.rate))
    }
  }

  // ── Weighed product and services ────────────────────────────────────────
  for (const out of outputs) {
    const lbs = Number(out.weight_lbs ?? 0)
    if (!lbs || lbs <= 0) continue
    // A typed-over rate keeps what the counter decided; re-deriving would
    // quietly undo it.
    const rate = out.rate_override && out.rate != null
      ? Number(out.rate)
      : (out.rate != null ? Number(out.rate) : rateFor(rates, out.category, !!out.cheese))
    const qty = round2(lbs)
    push(`game_${out.category}`, out.category, `${describeOutput(out, rates)} — ${qty} lbs`,
      qty, 'lb', rate, !!out.cheese)

    // The "# Fat Trim" column: fat goes in per batch, so it bills per line.
    const fat = Number(out.fat_trim_lbs ?? 0)
    if (fat > 0 && out.fat_trim_kind) {
      const fr = rates[out.fat_trim_kind]
      if (fr) {
        const fqty = round2(fat)
        push(`game_${out.fat_trim_kind}`, out.fat_trim_kind,
          `${fr.label} — into ${describeOutput(out, rates)}, ${fqty} lbs`, fqty, 'lb', Number(fr.rate))
      }
    }
  }

  // ── Fat and trim added outside a specific batch (the burger grind) ──────
  for (const add of additions) {
    const lbs = Number(add.weight_lbs ?? 0)
    if (!lbs || lbs <= 0) continue
    const r = rates[add.kind]
    if (!r) continue
    const qty = round2(lbs)
    push(`game_${add.kind}`, add.kind, `${r.label} — ${qty} lbs`, qty, 'lb',
      add.rate != null ? Number(add.rate) : Number(r.rate))
  }

  // ── Cleaning: PER HOUR, with the hours written on the slip ──────────────
  const hours = Number(intake.cleaning_hours ?? 0)
  if (hours > 0) {
    const c = rates.cleaning
    if (c) {
      const qty = round2(hours)
      push('game_cleaning', 'cleaning',
        `${c.label} — ${tag}, ${qty} ${qty === 1 ? 'hr' : 'hrs'} @ $${Number(c.rate).toFixed(2)}/hr`,
        qty, 'ea', Number(c.rate))
    }
  }

  return charges
}

export const chargeTotal = (charges: BillingCharge[]) =>
  round2(charges.reduce((sum, c) => sum + c.amount, 0))

/** The slip's two subtotals: Total Product and Total Other. */
export function chargeBuckets(charges: BillingCharge[], rates: RateMap) {
  let product = 0, other = 0
  for (const c of charges) {
    const key = c.ruleKey.replace(/^game_/, '')
    if (rates[key]?.bucket === 'product') product += c.amount
    else other += c.amount
  }
  return { product: round2(product), other: round2(other), grand: round2(product + other) }
}

/**
 * Take-home pounds vs pounds through the door.
 *
 * Added fat and trim are excluded from the numerator: beef fat we sold into the
 * grind is not yield off the deer, and counting it produces the 118% yields
 * that make the number worthless. Slicing and curing are excluded as well —
 * they are second operations on meat already counted under another line.
 */
const NON_YIELD = new Set<string>(['slicing', 'curing', 'buffalo_processing', ...ADDITION_CATEGORIES])

export function gameYield(intake: GameIntakeForBilling, outputs: GameOutputRow[]): number | null {
  const inLbs = Number(intake.weight_in_lbs ?? 0)
  if (!inLbs || inLbs <= 0) return null
  const outLbs = outputs
    .filter(o => !NON_YIELD.has(o.category))
    .reduce((s, o) => s + Number(o.weight_lbs ?? 0), 0)
  if (outLbs <= 0) return null
  return Math.round((outLbs / inLbs) * 1000) / 10
}
