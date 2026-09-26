// The seasoning order list: what the booked kills will use, against what's on
// the shelf, and when to order.
//
// Demand is the cut sheets' smokehouse block — {flavor, lbs} per line for
// sticks, brots, summer sausage and jerky — for every booked animal killed in
// the window. Heads booked with no sheet yet ride a per-species rate learned
// off every sheet on file, kept as a SEPARATE figure so a guess never passes
// for an order (same rule as lib/smokehouseBook.ts).
//
// Each flavour's pounds × its recipe (lib: smokehouse_recipes) become pounds of
// a seasoning and of a cure. A house BLEND is made from other supplies, so what
// the shelf can't cover explodes into its ingredients by % weight — the order
// list only ever orders BOUGHT things, and says how much blend to mix.
//
// Nothing is ordered automatically. This is a list for a person to act on.
import { addDaysISO } from '@/lib/dates'
import { animalFraction, MIN_ANIMALS_FOR_RATE, SHEET_SPECIES, type ApptRow, type SheetRow } from '@/lib/smokehouseBook'

/** Sheet smokehouse keys that carry {flavor, lbs} lines. */
const SHEET_PRODUCTS = ['sticks', 'brats', 'summer', 'jerky'] as const
const PRODUCT_TITLE: Record<string, string> = {
  sticks: 'Snack Sticks', brats: 'Brots', summer: 'Summer Sausage', jerky: 'Jerky', 'jerky-pork': 'Pork Jerky',
}

export interface FlavorRow  { id: string; product: string; val: string; label: string }
export interface RecipeRow  {
  wizard_flavor_id: string | null
  seasoning_id: string | null; seasoning_lb_per_100: number | null
  cure_id: string | null;      cure_oz_per_100: number | null
}
export interface SupplyRow {
  id: string; name: string; kind: 'bought' | 'blend'; supplier: string | null
  pack_lb: number | null; lead_days: number | null
  on_hand_lb: number | null; counted_at: string | null; cost_per_lb: number | null
  active: boolean
}
export interface BlendLineRow { blend_id: string; ingredient_id: string; pct: number }

interface Need { date: string; lb: number; why: string }

/** One flavour's pounds in the window. */
export interface FlavorDemand {
  key: string; title: string; label: string
  onSheetLb: number; projectedLb: number
}

/** Demand that can't be turned into seasoning yet, and why. */
export interface Gap { title: string; label: string; lb: number; reason: string }

export interface OrderLine {
  supply:     SupplyRow
  needLb:     number            // gross, window
  onHandLb:   number | null
  shortLb:    number            // after the shelf
  needBy:     string | null     // first day the shelf runs out
  orderBy:    string | null     // needBy − lead time
  packs:      number | null
  orderLb:    number            // what to buy: packs × pack size, or the short
  cost:       number | null
  status:     'overdue' | 'order-now' | 'upcoming' | 'covered'
  uses:       { why: string; lb: number }[]
}

export interface MixLine {
  blend:    SupplyRow
  needLb:   number
  onHandLb: number | null
  mixLb:    number
  mixBy:    string | null
  ingredients: { name: string; lb: number; pct: number }[]
  pctTotal: number
  uses:     { why: string; lb: number }[]
}

export interface SeasoningPlan {
  from: string; to: string
  flavors: FlavorDemand[]
  orders:  OrderLine[]
  mixes:   MixLine[]
  gaps:    Gap[]
  headOnSheet: number; headProjected: number
}

const round = (n: number, d = 2) => Math.round(n * 10 ** d) / 10 ** d

type Json = Record<string, unknown>
const asArr = (v: unknown): Json[] => (Array.isArray(v) ? v as Json[] : [])

/** {product:flavor → lbs} off one sheet's smokehouse block. */
export function sheetFlavorLbs(data: unknown): Record<string, number> {
  const out: Record<string, number> = {}
  const sh = ((data as Json | null)?.smokehouse ?? {}) as Json
  for (const p of SHEET_PRODUCTS) {
    for (const it of asArr(sh[p])) {
      const flavor = typeof it.flavor === 'string' ? it.flavor : ''
      const lbs = Number(it.lbs)
      if (!flavor || !(lbs > 0)) continue
      const k = `${p}:${flavor}`
      out[k] = (out[k] ?? 0) + lbs
    }
  }
  return out
}

/** Flavour pounds per whole animal, by sheet species — for heads with no sheet. */
export function learnFlavorRates(sheets: SheetRow[]): Record<string, Record<string, number>> {
  const acc = new Map<string, { animals: number; lbs: Record<string, number> }>()
  for (const s of sheets) {
    const sp = (s.species ?? '').trim()
    if (!sp) continue
    const a = acc.get(sp) ?? { animals: 0, lbs: {} }
    a.animals += animalFraction(s.data)
    for (const [k, v] of Object.entries(sheetFlavorLbs(s.data))) a.lbs[k] = (a.lbs[k] ?? 0) + v
    acc.set(sp, a)
  }
  const out: Record<string, Record<string, number>> = {}
  for (const [sp, a] of acc) {
    if (a.animals < MIN_ANIMALS_FOR_RATE) continue
    out[sp] = Object.fromEntries(Object.entries(a.lbs).map(([k, v]) => [k, v / a.animals]))
  }
  return out
}

/** Spend the shelf against dated needs, earliest first; what's left over is short. */
function afterShelf(needs: Need[], onHand: number): Need[] {
  let left = onHand
  const out: Need[] = []
  for (const n of [...needs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (left >= n.lb) { left -= n.lb; continue }
    out.push({ ...n, lb: n.lb - left })
    left = 0
  }
  return out
}

function usesOf(needs: Need[]) {
  const m = new Map<string, number>()
  for (const n of needs) m.set(n.why, (m.get(n.why) ?? 0) + n.lb)
  return [...m].map(([why, lb]) => ({ why, lb: round(lb) })).sort((a, b) => b.lb - a.lb)
}

export function buildSeasoningPlan(args: {
  appts: ApptRow[]; sheets: SheetRow[]
  flavors: FlavorRow[]; recipes: RecipeRow[]
  supplies: SupplyRow[]; blendLines: BlendLineRow[]
  from: string; to: string; today: string
}): SeasoningPlan {
  const { appts, sheets, flavors, recipes, supplies, blendLines, from, to, today } = args
  const rates = learnFlavorRates(sheets)

  const sheetsByAppt = new Map<string, SheetRow[]>()
  for (const s of sheets) {
    if (!s.appointment_id) continue
    sheetsByAppt.set(s.appointment_id, [...(sheetsByAppt.get(s.appointment_id) ?? []), s])
  }

  // ── 1. Flavour pounds, dated by kill day ──────────────────────────────────
  const demand = new Map<string, { onSheet: Need[]; projected: Need[] }>()
  const slot = (k: string) => {
    let d = demand.get(k)
    if (!d) { d = { onSheet: [], projected: [] }; demand.set(k, d) }
    return d
  }
  let headOnSheet = 0, headProjected = 0
  for (const a of appts) {
    const head = a.head_count ?? 0
    if (head <= 0 || !a.harvest_date) continue
    // Seasoning has to be on the shelf by the kill day — a kill already past
    // still needs it now.
    const date = a.harvest_date < today ? today : a.harvest_date
    let covered = 0
    for (const s of sheetsByAppt.get(a.id) ?? []) {
      covered += animalFraction(s.data)
      for (const [k, lb] of Object.entries(sheetFlavorLbs(s.data))) slot(k).onSheet.push({ date, lb, why: k })
    }
    covered = Math.min(covered, head)
    headOnSheet += covered
    const short = head - covered
    if (short <= 0) continue
    headProjected += short
    const species = (a.species ?? '').trim()
    const rate = rates[SHEET_SPECIES[species] ?? species]
    if (!rate) continue
    for (const [k, perHead] of Object.entries(rate)) slot(k).projected.push({ date, lb: perHead * short, why: k })
  }

  // ── 2. Flavour → recipe ───────────────────────────────────────────────────
  const flavorByKey = new Map(flavors.map(f => [`${f.product}:${f.val}`, f]))
  const recipeByFlavor = new Map(recipes.filter(r => r.wizard_flavor_id).map(r => [r.wizard_flavor_id!, r]))
  const findFlavor = (k: string) => {
    const hit = flavorByKey.get(k)
    if (hit) return hit
    // Pork jerky rides the sheet's jerky block with its own flavour list.
    const [p, v] = k.split(':')
    return p === 'jerky' ? flavorByKey.get(`jerky-pork:${v}`) ?? null : null
  }

  const flavorsOut: FlavorDemand[] = []
  const gaps: Gap[] = []
  const needs = new Map<string, Need[]>()   // supply id → dated needs
  const push = (id: string, n: Need) => needs.set(id, [...(needs.get(id) ?? []), n])

  for (const [k, d] of demand) {
    const f = findFlavor(k)
    const [p, v] = k.split(':')
    const title = PRODUCT_TITLE[f?.product ?? p] ?? p
    const label = f?.label ?? v
    const onSheetLb = d.onSheet.reduce((n, x) => n + x.lb, 0)
    const projectedLb = d.projected.reduce((n, x) => n + x.lb, 0)
    flavorsOut.push({ key: k, title, label, onSheetLb: round(onSheetLb, 1), projectedLb: round(projectedLb, 1) })

    const all = [...d.onSheet, ...d.projected]
    const lb = onSheetLb + projectedLb
    const r = f ? recipeByFlavor.get(f.id) : undefined
    const why = `${title} — ${label}`
    if (!f)      { gaps.push({ title, label, lb: round(lb, 1), reason: 'Not a flavour in the wizard list' }); continue }
    if (!r || !r.seasoning_id || r.seasoning_lb_per_100 == null) {
      gaps.push({ title, label, lb: round(lb, 1), reason: !r ? 'No recipe written down' : 'Recipe has no seasoning + ratio' })
    } else {
      for (const n of all) push(r.seasoning_id, { date: n.date, lb: n.lb * r.seasoning_lb_per_100 / 100, why })
    }
    if (r?.cure_id && r.cure_oz_per_100 != null) {
      for (const n of all) push(r.cure_id, { date: n.date, lb: n.lb * r.cure_oz_per_100 / 100 / 16, why })
    }
  }

  // ── 3. Blends: shelf first, then explode the shortfall into ingredients ──
  const byId = new Map(supplies.map(s => [s.id, s]))
  const linesOf = new Map<string, BlendLineRow[]>()
  for (const l of blendLines) linesOf.set(l.blend_id, [...(linesOf.get(l.blend_id) ?? []), l])

  // A blend is ready once every blend that uses it has exploded into it.
  const usedBy = new Map<string, Set<string>>()
  for (const l of blendLines) {
    if (byId.get(l.ingredient_id)?.kind !== 'blend') continue
    usedBy.set(l.ingredient_id, (usedBy.get(l.ingredient_id) ?? new Set()).add(l.blend_id))
  }
  const blends = supplies.filter(s => s.kind === 'blend')
  const done = new Set<string>()
  const mixes: MixLine[] = []
  for (let pass = 0; pass < blends.length + 1; pass++) {
    for (const b of blends) {
      if (done.has(b.id)) continue
      if ([...(usedBy.get(b.id) ?? [])].some(u => !done.has(u))) continue
      done.add(b.id)
      const bNeeds = needs.get(b.id) ?? []
      if (!bNeeds.length) continue
      const short = afterShelf(bNeeds, b.on_hand_lb ?? 0)
      const mixLb = short.reduce((n, x) => n + x.lb, 0)
      const lines = linesOf.get(b.id) ?? []
      const pctTotal = lines.reduce((n, l) => n + Number(l.pct), 0)
      for (const n of short) for (const l of lines) {
        push(l.ingredient_id, { date: n.date, lb: n.lb * Number(l.pct) / 100, why: `${b.name} (blend)` })
      }
      mixes.push({
        blend: b, needLb: round(bNeeds.reduce((n, x) => n + x.lb, 0)), onHandLb: b.on_hand_lb,
        mixLb: round(mixLb), mixBy: short[0]?.date ?? null,
        ingredients: lines.map(l => ({ name: byId.get(l.ingredient_id)?.name ?? '?', pct: Number(l.pct), lb: round(mixLb * Number(l.pct) / 100) }))
          .sort((a, b2) => b2.pct - a.pct),
        pctTotal: round(pctTotal),
        uses: usesOf(bNeeds),
      })
    }
  }
  // Anything left undone sits in a blend loop — say so rather than drop it.
  for (const b of blends) if (!done.has(b.id) && (needs.get(b.id) ?? []).length) {
    gaps.push({ title: 'Blend', label: b.name, lb: 0, reason: 'Blend contains itself (loop in its ingredients)' })
  }

  // ── 4. Bought things: what to order and by when ──────────────────────────
  const orders: OrderLine[] = []
  for (const [id, list] of needs) {
    const s = byId.get(id)
    if (!s || s.kind !== 'bought') continue
    const needLb = list.reduce((n, x) => n + x.lb, 0)
    const short = afterShelf(list, s.on_hand_lb ?? 0)
    const shortLb = short.reduce((n, x) => n + x.lb, 0)
    const needBy = short[0]?.date ?? null
    const orderBy = needBy ? addDaysISO(needBy, -(s.lead_days ?? 0)) : null
    const pack = s.pack_lb && s.pack_lb > 0 ? Number(s.pack_lb) : null
    const packs = shortLb > 0 && pack ? Math.ceil(shortLb / pack) : null
    const orderLb = packs && pack ? packs * pack : shortLb
    const status: OrderLine['status'] = !orderBy ? 'covered'
      : orderBy < today ? 'overdue'
      : orderBy <= addDaysISO(today, 3) ? 'order-now' : 'upcoming'
    orders.push({
      supply: s, needLb: round(needLb), onHandLb: s.on_hand_lb, shortLb: round(shortLb),
      needBy, orderBy, packs, orderLb: round(orderLb),
      cost: s.cost_per_lb != null && orderLb > 0 ? round(orderLb * Number(s.cost_per_lb)) : null,
      status, uses: usesOf(list),
    })
  }
  const rank = { overdue: 0, 'order-now': 1, upcoming: 2, covered: 3 }
  orders.sort((a, b) => rank[a.status] - rank[b.status] || (a.orderBy ?? '9').localeCompare(b.orderBy ?? '9'))

  flavorsOut.sort((a, b) => (b.onSheetLb + b.projectedLb) - (a.onSheetLb + a.projectedLb))
  gaps.sort((a, b) => b.lb - a.lb)
  return {
    from, to, flavors: flavorsOut, orders, mixes, gaps,
    headOnSheet: round(headOnSheet, 1), headProjected: round(headProjected, 1),
  }
}
