export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { loadRates } from '@/lib/gameRates'
import { rateFor, itemFor, describeOutput, ADDITION_CATEGORIES, type AdditionKind } from '@/lib/gameBilling'

export const dynamic = 'force-dynamic'

// Weigh-out. One row per weighed line — the same columns the slip has: what it
// is, which flavour, whether it took cheese, the pounds, and the fat or trim
// that went into that batch.
//
// The rate is resolved and STAMPED here rather than looked up when the ticket
// prints. Jill re-pricing in March must not rewrite a ticket quoted in November.

// POST /api/game/outputs
// { intake_id, category, flavor?, cheese?, cheese_type?, plu?, weight_lbs,
//   fat_trim_kind?, fat_trim_lbs?, rate?, notes? }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const {
    intake_id, category, flavor, cheese, cheese_type, plu, weight_lbs,
    fat_trim_kind, fat_trim_lbs, rate, notes,
  } = body as {
    intake_id?: string; category?: string; flavor?: string
    cheese?: boolean; cheese_type?: string; plu?: string; weight_lbs?: number
    fat_trim_kind?: string; fat_trim_lbs?: number; rate?: number; notes?: string
  }
  if (!intake_id) return NextResponse.json({ error: 'intake_id required' }, { status: 400 })
  if (!category)  return NextResponse.json({ error: 'category required' }, { status: 400 })

  const rates = await loadRates()
  const svc = rates[category]
  if (!svc) return NextResponse.json({ error: `unknown category ${category}` }, { status: 400 })

  const hasCheese = !!cheese && svc.cheese_rate != null
  const bookRate  = rateFor(rates, category, hasCheese)
  // A typed rate wins and says so on the row.
  const override  = rate != null && Number(rate) !== bookRate
  const finalRate = rate != null ? Number(rate) : bookRate

  const productName = describeOutput(
    { category, flavor, cheese: hasCheese, cheese_type, weight_lbs: null }, rates)
  const item = itemFor(rates, category, hasCheese)

  const { data, error } = await supabase
    .from('game_outputs')
    .insert([{
      intake_id,
      category,
      flavor:        flavor ?? '',
      cheese:        hasCheese,
      cheese_type:   hasCheese ? (cheese_type ?? '') : '',
      product_name:  productName,
      plu:           plu ?? null,
      weight_lbs:    weight_lbs ?? 0,
      rate:          finalRate,
      qbo_item_id:   item.id,
      qbo_item_name: item.name,
      rate_override: override,
      fat_trim_kind: fat_trim_kind && (ADDITION_CATEGORIES as readonly string[]).includes(fat_trim_kind)
        ? fat_trim_kind : '',
      fat_trim_lbs:  fat_trim_lbs ?? null,
      notes:         notes ?? '',
    }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await supabase.from('game_events').insert([{
    intake_id, event: 'weighed',
    detail: `${productName} — ${weight_lbs ?? 0} lbs @ $${finalRate.toFixed(2)}`,
  }])

  return NextResponse.json(data)
}

// PATCH /api/game/outputs — fix a weight, flip cheese, or type over a rate.
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, weight_lbs, rate, notes, category, cheese, cheese_type, flavor,
          fat_trim_kind, fat_trim_lbs } = body as {
    id?: string; weight_lbs?: number; rate?: number; notes?: string; category?: string
    cheese?: boolean; cheese_type?: string; flavor?: string
    fat_trim_kind?: string; fat_trim_lbs?: number
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: existing, error: readErr } = await supabase
    .from('game_outputs').select('*').eq('id', id).maybeSingle()
  if (readErr) return NextResponse.json({ error: readErr.message }, { status: 500 })
  if (!existing) return NextResponse.json({ error: 'not found' }, { status: 404 })

  const rates = await loadRates()
  const updates: Record<string, unknown> = {}
  if (weight_lbs !== undefined)    updates.weight_lbs = weight_lbs
  if (notes !== undefined)         updates.notes = notes
  if (flavor !== undefined)        updates.flavor = flavor
  if (fat_trim_lbs !== undefined)  updates.fat_trim_lbs = fat_trim_lbs
  if (fat_trim_kind !== undefined) {
    updates.fat_trim_kind = (ADDITION_CATEGORIES as readonly string[]).includes(fat_trim_kind) ? fat_trim_kind : ''
  }

  const nextCategory = category ?? existing.category
  const svc = rates[nextCategory]
  if (!svc) return NextResponse.json({ error: `unknown category ${nextCategory}` }, { status: 400 })

  // Re-categorising or flipping cheese re-prices off the live list unless a
  // rate came with it. Silently keeping the old rate would leave a jerky line
  // billing at stick money, or a cheese line at the plain price.
  const repricing = category !== undefined || cheese !== undefined
  const nextCheese = cheese !== undefined ? (!!cheese && svc.cheese_rate != null) : !!existing.cheese
  if (cheese !== undefined) {
    updates.cheese      = nextCheese
    updates.cheese_type = nextCheese ? (cheese_type ?? existing.cheese_type ?? '') : ''
  } else if (cheese_type !== undefined) {
    updates.cheese_type = existing.cheese ? cheese_type : ''
  }
  // Re-point the QuickBooks item whenever either half of what picks it moved —
  // the category or the cheese flag, since cheese has its own item.
  if (repricing) {
    const item = itemFor(rates, nextCategory, nextCheese)
    updates.category      = nextCategory
    updates.qbo_item_id   = item.id
    updates.qbo_item_name = item.name
  }

  if (rate !== undefined) {
    updates.rate = rate
    updates.rate_override = true
  } else if (repricing) {
    updates.rate = rateFor(rates, nextCategory, nextCheese)
    updates.rate_override = false
  }

  // Keep the printed description in step with whatever just changed.
  if (category !== undefined || cheese !== undefined || cheese_type !== undefined || flavor !== undefined) {
    updates.product_name = describeOutput({
      category:    nextCategory,
      flavor:      flavor ?? existing.flavor,
      cheese:      nextCheese,
      cheese_type: (updates.cheese_type as string) ?? existing.cheese_type,
      weight_lbs:  null,
    }, rates)
  }

  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('game_outputs').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/game/outputs?id=...[&table=additions]
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const table = searchParams.get('table') === 'additions' ? 'game_additions' : 'game_outputs'
  const { error } = await supabase.from(table).delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// PUT /api/game/outputs — fat and trim added to the burger grind rather than to
// one smokehouse batch. Shares this route because it is the same screen and the
// same act: weighing what went in at packout.
// { intake_id, kind, weight_lbs }
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const { intake_id, kind, weight_lbs } = body as {
    intake_id?: string; kind?: string; weight_lbs?: number
  }
  if (!intake_id) return NextResponse.json({ error: 'intake_id required' }, { status: 400 })
  if (!kind || !(ADDITION_CATEGORIES as readonly string[]).includes(kind)) {
    return NextResponse.json({ error: `unknown addition ${kind}` }, { status: 400 })
  }

  const rates = await loadRates()
  const r = rates[kind as AdditionKind]

  const { data, error } = await supabase
    .from('game_additions')
    .insert([{
      intake_id, kind, weight_lbs: weight_lbs ?? 0,
      rate: Number(r.rate),
      qbo_item_id:   r.qbo_item_id ?? '',
      qbo_item_name: r.qbo_item_name ?? r.label,
    }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
