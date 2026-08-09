// Deciding what a box of work-in-progress is FOR.
//
// The customer already told us on the cutting instruction: so many pounds of
// sticks in this flavor, brats in that one, rounds to jerky. What they did not
// tell us is which tub serves which order — so we assign, in order, and keep
// filling. First bag of trim starts the first order; once that order's pounds
// are covered the next bag starts the next one. The floor gets a decision, not
// a menu.

export interface SmokeOrder {
  key:   string          // stable across prints — "sticks#0"
  kind:  string          // sticks | brats | summer | jerky | hotDogs
  label: string          // "Snack Sticks — Jalapeno Cheddar"
  lbs:   number | null   // pounds the customer asked for
}

const KIND_WORDS: Record<string, string> = {
  sticks:  'Snack Sticks',
  brats:   'Brots',
  summer:  'Summer Sausage',
  jerky:   'Jerky',
  hotDogs: 'Hot Dogs',
  salami:  'Salami',
}

// Fixed sequence so the same animal always allocates the same way, no matter
// what order the JSON keys happen to come back in.
const KIND_SEQUENCE = ['sticks', 'brats', 'summer', 'jerky', 'salami', 'hotDogs']

const titleCase = (v: string) =>
  String(v || '').replace(/[-_]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase()).trim()

function flavorLabel(kind: string, item: { flavor?: unknown; cheese?: unknown }): string {
  const parts = [titleCase(String(item.flavor ?? ''))]
  if (item.cheese) parts.push(titleCase(String(item.cheese)))
  const flavor = parts.filter(Boolean).join(' ')
  return flavor ? `${KIND_WORDS[kind] ?? titleCase(kind)} — ${flavor}` : (KIND_WORDS[kind] ?? titleCase(kind))
}

// Pull the customer's smokehouse orders out of a cutting instruction, flattened
// into one ordered list. Each cutting instruction covers one animal, so the
// species question answers itself — a hog's orders are hog orders.
export function parseSmokehouseOrders(data: Record<string, unknown> | null | undefined): SmokeOrder[] {
  const smoke = (data?.smokehouse ?? null) as Record<string, unknown> | null
  if (!smoke || typeof smoke !== 'object') return []

  const orders: SmokeOrder[] = []
  for (const kind of KIND_SEQUENCE) {
    const val = smoke[kind]
    if (!val) continue

    if (Array.isArray(val)) {
      val.forEach((item, i) => {
        if (!item) return
        const lbs = Number((item as { lbs?: unknown }).lbs)
        orders.push({
          key:   `${kind}#${i}`,
          kind,
          label: flavorLabel(kind, item as { flavor?: unknown; cheese?: unknown }),
          lbs:   Number.isFinite(lbs) && lbs > 0 ? lbs : null,
        })
      })
    } else if (typeof val === 'object') {
      // hotDogs is a single {lbs} object rather than a list
      const lbs = Number((val as { lbs?: unknown }).lbs)
      if (Number.isFinite(lbs) && lbs > 0) {
        orders.push({ key: `${kind}#0`, kind, label: KIND_WORDS[kind] ?? titleCase(kind), lbs })
      }
    }
  }
  return orders
}

export interface CICard { data: Record<string, unknown>; customerId: string | null }

const cardEmail = (c: CICard) => String(c.data.customerEmail ?? '').trim().toLowerCase()

/**
 * Are these cut cards all the same customer? One person can have two animals in
 * the same week — a whole hog and a half, each with its own card — and the floor
 * writes one name on both. That is a different thing from two strangers sharing
 * a name, and only the second is dangerous: merging strangers means cooking
 * somebody else's order.
 *
 * Email is the test that actually holds. Daina Green's two cards were written to
 * two different customer rows but carry one address, so customer_id alone would
 * have called her two people — she is the only collision in the data where the
 * two tests disagree. Cards with no email fall back to the id, and anything
 * unproven stays unproven.
 */
export function isSameParty(cards: CICard[]): boolean {
  if (cards.length < 2) return true
  const emails = cards.map(cardEmail)
  if (emails.every(Boolean)) return new Set(emails).size === 1
  const ids = cards.map(c => c.customerId)
  if (ids.every(Boolean)) return new Set(ids).size === 1
  return false
}

// Rounds are their own decision — the customer picks jerky per round on the cut
// card, so a box of rounds never competes for the trim orders.
export function roundJerkyLabel(data: Record<string, unknown> | null | undefined): string | null {
  for (const side of ['topRound', 'bottomRound']) {
    const r = (data?.[side] ?? null) as Record<string, unknown> | null
    if (!r) continue
    for (const cut of [r, (r.round2 ?? null) as Record<string, unknown> | null]) {
      if (cut && cut.cut === 'jerky') {
        const f = titleCase(String(cut.jerkyFlavor ?? ''))
        return f ? `Jerky — ${f}` : 'Jerky'
      }
    }
  }
  return null
}

// What's actually in the box decides which pool it draws from.
export type BoxProduct = 'round' | 'trim' | 'shoulder' | 'loin' | 'ham' | 'belly' | 'other'

// A primal box is raw cut headed for value add. Names that are already the
// finished thing — PORK SHOULDER BACON, PORK CHOPS SMOKED, PORK PULLED — are
// output, not input, and must never be read as "a shoulder to make into
// something": they're what comes back.
const FINISHED_RE = /\b(cured|smoked|bacon|pulled|jerky|sausage|snack|summer|hot ?dogs?)\b/

// Raw cut → the primal it came off. Hocks and ribs are deliberately absent:
// nothing on the cut card turns them into a value-add product.
const PRIMAL_RE: [BoxProduct, RegExp][] = [
  ['shoulder', /\b(shoulder|butt)\b/],
  ['loin',     /\b(chops?|loin)\b/],
  ['ham',      /\bham\b/],
  ['belly',    /\b(belly|side)\b/],
]

export function classifyBoxProduct(items: { name: string; weight?: number }[]): BoxProduct {
  const names = items.map(i => (i.name || '').toLowerCase())
  if (names.some(n => /\bround\b/.test(n)))                      return 'round'
  if (names.some(n => /\b(trim|grind|ground|burger)\b/.test(n))) return 'trim'

  // Primals are weighed, not first-matched: a box holding 7 lb of shoulder and
  // 2 lb of spare ribs is a shoulder box, and mixed boxes are normal on the
  // floor. Only raw cuts vote.
  const byPrimal: Partial<Record<BoxProduct, number>> = {}
  let total = 0
  for (const item of items) {
    const w = Number(item.weight) || 1
    total += w
    const n = (item.name || '').toLowerCase()
    if (FINISHED_RE.test(n)) continue
    const hit = PRIMAL_RE.find(([, re]) => re.test(n))
    if (hit) byPrimal[hit[0]] = (byPrimal[hit[0]] ?? 0) + w
  }
  const ranked = Object.entries(byPrimal).sort((a, b) => b[1] - a[1])

  // The winner has to be most of the box, not merely the only thing that voted.
  // Ribs and hocks map to no value-add product, so without this a tub of ribs
  // carrying one stray roast would print PULLED PORK. Claiming nothing is the
  // safer miss: the crew still reads the item list.
  if (!ranked.length || ranked[0][1] * 2 < total) return 'other'
  return ranked[0][0] as BoxProduct
}

// The value-add work a cut card declares ON A PRIMAL, as opposed to the
// smokehouse orders that trim feeds. Only cut-CONSUMING work counts: the wizard
// tells the customer pulled pork "takes the place of your roasts" and smoked
// chops are "your bone-in chops" cured, so a box of those cuts IS that order.
// Shoulder bacon is deliberately absent — the card promises it "doesn't affect
// your roast", so it never speaks for a box of roasts — and side pork is fresh,
// not value add.
//
// Labels match the words the customer read on the cut card, not invented ones.
const asRec = (v: unknown) => (v && typeof v === 'object' ? v as Record<string, unknown> : null)
const addonsOf = (v: unknown): string[] => {
  const a = asRec(v)?.addons
  return Array.isArray(a) ? a.map(String) : []
}

export function primalValueAdd(
  data: Record<string, unknown> | null | undefined,
  primal: BoxProduct,
): Assignment | null {
  if (!data) return null

  // Split primals hold the second half nested (shoulder.shoulder2) or as a
  // sibling field (ham.style2) — check both halves, since a box of roasts sent
  // to value add is going to the one destination roasts have.
  switch (primal) {
    case 'shoulder': {
      const s = asRec(data.shoulder)
      const all = [...addonsOf(s), ...addonsOf(s?.shoulder2)]
      return all.includes('pulled-pork') ? { key: 'shoulder#pulled-pork', label: 'Pulled Pork' } : null
    }
    case 'loin': {
      const l = asRec(data.loin)
      const all = [...addonsOf(l), ...addonsOf(l?.loin2)]
      return all.includes('smoked-chops') ? { key: 'loin#smoked-chops', label: 'Smoked Chops' } : null
    }
    case 'ham': {
      const h = asRec(data.ham)
      const styles = [h?.style, h?.style2].map(String)
      return styles.includes('cured-smoked') ? { key: 'ham#cured-smoked', label: 'Ham — Cured & Smoked' } : null
    }
    case 'belly': {
      const b = asRec(data.belly)
      const cuts = [b?.cut, b?.cut2].map(String)
      return cuts.includes('bacon') ? { key: 'belly#bacon', label: 'Bacon' } : null
    }
    default:
      return null
  }
}

export interface Assignment { key: string; label: string }

// Walk the orders in sequence and hand this box to the first one that still
// needs pounds. Orders with no stated weight count as filled by one box.
// When everything the customer asked for is covered, the rest is grind — which
// is what happens on the floor anyway, and is still a decision.
export function allocateIntent(
  orders: SmokeOrder[],
  assignedLbsByKey: Record<string, number>,
  boxLbs: number,
): Assignment | null {
  if (orders.length === 0) return null

  for (const o of orders) {
    const already = assignedLbsByKey[o.key] ?? 0
    if (o.lbs == null ? already === 0 : already < o.lbs) {
      const target = o.lbs != null ? ` · ${o.lbs} lb order` : ''
      const sofar  = already > 0 ? ` · ${(already + boxLbs).toFixed(1)}/${o.lbs} lb` : target
      return { key: o.key, label: `${o.label}${already > 0 ? sofar : target}` }
    }
  }
  return { key: 'grind#extra', label: 'Grind — Burger (orders covered)' }
}
