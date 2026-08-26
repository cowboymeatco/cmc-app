export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  toRateMap, ROAST_CATEGORIES, TRIM_CATEGORIES, CHEESE_TYPES, looksLikeCheese,
  type GameRate,
} from '@/lib/gameBilling'

export const dynamic = 'force-dynamic'

// GET /api/game/catalog — everything the counter screen needs to take an order.
//
// Returned in TWO groups, because that is the order the decision is made in:
// roasts first (steaks, jerky, roasts kept whole — the only things whole muscle
// can become), then trim (sticks, summer, brotwurst, bulk sausage, burger).
// A category with no flavours is still a line a hunter picks — "steak the
// roasts" has no flavour, it is just a thing they want done.
//
// ── The PLU gap is reported, not hidden ───────────────────────────────────
// The slip and the Hobart genuinely disagree. The slip offers Smoked German
// brotwurst and Wild Fire jerky that have no wild game PLU — we can sell those
// but cannot label them — and the scale carries stick flavours the slip never
// offers. Every flavour reports whether it has a PLU, and the counts come back
// so somebody can close the gap.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)

  const [{ data: rateRows, error: rateErr }, { data: flavorRows, error: flavErr }] = await Promise.all([
    supabase.from('game_rates').select('*').order('sort'),
    supabase.from('game_flavors').select('*').eq('active', true).order('sort'),
  ])
  if (rateErr) return NextResponse.json({ error: rateErr.message }, { status: 500 })
  if (flavErr) return NextResponse.json({ error: flavErr.message }, { status: 500 })

  const rates = toRateMap(rateRows as GameRate[] | null)

  type Flavor = { id: string; category: string; name: string; plu_number: string | null; sort: number }
  const byCategory = new Map<string, Flavor[]>()
  for (const f of (flavorRows ?? []) as Flavor[]) {
    const list = byCategory.get(f.category) ?? []
    list.push(f)
    byCategory.set(f.category, list)
  }

  const groupFor = (key: string) => {
    const r = rates[key]
    return {
      key,
      label:      r.label,
      source:     r.source,
      rate:       Number(r.rate),
      cheeseRate: r.cheese_rate == null ? null : Number(r.cheese_rate),
      flavors: (byCategory.get(key) ?? []).map(f => ({
        id:   f.id,
        name: f.name,
        plu:  f.plu_number,
        // Pre-tick the cheese box when the flavour name already carries one
        // ("Smokey Cheddar", "Chili Cheese"). A hint for the counter only —
        // what bills is the stored flag, which they can untick.
        cheeseHint: looksLikeCheese(f.name),
      })),
    }
  }

  const active = (key: string) => rates[key]?.active !== false
  const roast  = ROAST_CATEGORIES.filter(active).map(groupFor)
  const trim   = TRIM_CATEGORIES.filter(active).map(groupFor)

  const missingPlu = [...roast, ...trim].flatMap(g =>
    g.flavors.filter(f => !f.plu).map(f => ({ category: g.key, categoryLabel: g.label, name: f.name })))

  // ?scale=1 — wild game PLUs on the Hobart that no slip flavour claims. The
  // other half of the same gap, for whoever is doing catalogue hygiene.
  let unusedPlus: { plu: string; name: string }[] | undefined
  if (searchParams.get('scale') === '1') {
    const { data: plus } = await supabase
      .from('plu_items').select('plu_number, item_name')
      .eq('active', true).ilike('item_name', 'WILD GAME%').order('item_name')
    const claimed = new Set(
      (flavorRows ?? []).map(f => (f as Flavor).plu_number).filter(Boolean) as string[])
    unusedPlus = (plus ?? [])
      .filter(p => !claimed.has((p as { plu_number: string }).plu_number))
      .map(p => ({ plu: (p as { plu_number: string }).plu_number, name: (p as { item_name: string }).item_name }))
  }

  return NextResponse.json({
    roast, trim,
    cheeseTypes: CHEESE_TYPES,
    rates:       rateRows ?? [],
    missingPlu,
    unusedPlus,
  })
}
