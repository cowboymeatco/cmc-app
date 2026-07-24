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
  brats:   'Brats',
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
export type BoxProduct = 'round' | 'trim' | 'other'

export function classifyBoxProduct(items: { name: string }[]): BoxProduct {
  const names = items.map(i => (i.name || '').toLowerCase())
  if (names.some(n => /\bround\b/.test(n)))                    return 'round'
  if (names.some(n => /\b(trim|grind|ground|burger)\b/.test(n))) return 'trim'
  return 'other'
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
