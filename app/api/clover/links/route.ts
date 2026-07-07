export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCloverItems, type CloverItem } from '@/lib/clover'

// Linking layer between plu_items (master) and the Clover catalog.
// Numbers can't be auto-keyed (PLU numbers collide with nothing in Clover),
// so links are name-suggested and human-confirmed, stored in plu_items.clover_item_id.

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

interface PluRow {
  id: string
  plu_number: string
  item_name: string
  retail_price: number | null
  is_retail: boolean
  clover_item_id: string
  active: boolean
}

// GET /api/clover/links — current links + name-match suggestions
export async function GET() {
  try {
    const [{ data: plus, error }, cloverItems] = await Promise.all([
      supabase
        .from('plu_items')
        .select('id, plu_number, item_name, retail_price, is_retail, clover_item_id, active')
        .eq('active', true)
        .order('item_name'),
      getCloverItems(),
    ])
    if (error) throw new Error(error.message)

    const linkedIds = new Set((plus as PluRow[]).map(p => p.clover_item_id).filter(Boolean))
    const byNorm = new Map<string, CloverItem[]>()
    for (const c of cloverItems) {
      const k = norm(c.name)
      byNorm.set(k, [...(byNorm.get(k) ?? []), c])
    }

    const linked = []
    const suggestions = []
    const unmatched = []
    for (const p of plus as PluRow[]) {
      if (p.clover_item_id) {
        const c = cloverItems.find(i => i.id === p.clover_item_id)
        linked.push({ plu: p, clover: c ?? null }) // null = link points at a deleted Clover item
        continue
      }
      const exact = (byNorm.get(norm(p.item_name)) ?? []).filter(c => !linkedIds.has(c.id))
      if (exact.length > 0) suggestions.push({ plu: p, clover: exact[0], confidence: 'exact' })
      else unmatched.push(p)
    }

    // Clover items nothing links or matches to (candidates for manual linking)
    const suggestedIds = new Set(suggestions.map(s => s.clover.id))
    const unclaimedClover = cloverItems.filter(c => !linkedIds.has(c.id) && !suggestedIds.has(c.id))

    return NextResponse.json({ linked, suggestions, unmatched, unclaimedClover })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// POST /api/clover/links — confirm a link { pluId, cloverItemId, seedPrice }
// seedPrice: copy Clover's current price into retail_price when the app has none
// (the one-time seed; after that the app is the source of truth).
export async function POST(req: NextRequest) {
  try {
    const { pluId, cloverItemId, seedPrice } = await req.json()
    if (!pluId || !cloverItemId) {
      return NextResponse.json({ error: 'pluId and cloverItemId required' }, { status: 400 })
    }

    const updates: Record<string, unknown> = {
      clover_item_id: cloverItemId,
      is_retail: true,
      updated_at: new Date().toISOString(),
    }

    if (seedPrice) {
      const items = await getCloverItems()
      const clover = items.find(i => i.id === cloverItemId)
      if (!clover) return NextResponse.json({ error: 'Clover item not found' }, { status: 404 })
      const { data: existing } = await supabase
        .from('plu_items').select('retail_price').eq('id', pluId).single()
      if (existing?.retail_price == null && clover.price > 0) {
        updates.retail_price = clover.price / 100
      }
    }

    const { data, error } = await supabase
      .from('plu_items').update(updates).eq('id', pluId).select().single()
    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// DELETE /api/clover/links?pluId= — unlink
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const pluId = searchParams.get('pluId')
  if (!pluId) return NextResponse.json({ error: 'pluId required' }, { status: 400 })
  const { error } = await supabase
    .from('plu_items')
    .update({ clover_item_id: '', updated_at: new Date().toISOString() })
    .eq('id', pluId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
