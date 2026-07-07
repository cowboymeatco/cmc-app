export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Linking layer between plu_items (master) and the cached QuickBooks catalog
// (qbo_items — refreshed via scripts/qbo/import-items.mjs; no app-side OAuth yet).
// Same pattern as Clover: name-suggested, human-confirmed, stored in
// plu_items.quickbooks_item_id ('' = unlinked, else the QBO item Id).

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

interface PluRow {
  id: string
  plu_number: string
  item_name: string
  retail_price: number | null
  quickbooks_item_id: string
  active: boolean
}

export interface QboRow {
  qbo_id: string
  full_name: string
  name: string
  type: string | null
  sales_price: number | null
  taxable: boolean | null
  active: boolean
  synced_at: string
}

// GET /api/qbo/links — current links + name-match suggestions
export async function GET() {
  try {
    const [{ data: plus, error: pluErr }, { data: qbo, error: qboErr }] = await Promise.all([
      supabase
        .from('plu_items')
        .select('id, plu_number, item_name, retail_price, quickbooks_item_id, active')
        .eq('active', true)
        .order('item_name'),
      supabase
        .from('qbo_items')
        .select('qbo_id, full_name, name, type, sales_price, taxable, active, synced_at')
        .not('qbo_id', 'is', null)
        .order('full_name'),
    ])
    if (pluErr) throw new Error(pluErr.message)
    if (qboErr) throw new Error(qboErr.message)

    const qboItems = (qbo ?? []) as QboRow[]
    const activeQbo = qboItems.filter(q => q.active)
    const linkedIds = new Set((plus as PluRow[]).map(p => p.quickbooks_item_id).filter(Boolean))
    const byNorm = new Map<string, QboRow[]>()
    for (const q of activeQbo) {
      const k = norm(q.name)
      byNorm.set(k, [...(byNorm.get(k) ?? []), q])
    }

    const linked = []
    const suggestions = []
    const unmatched = []
    for (const p of plus as PluRow[]) {
      if (p.quickbooks_item_id) {
        const q = qboItems.find(i => i.qbo_id === p.quickbooks_item_id)
        linked.push({ plu: p, qbo: q ?? null }) // null = link points at an item gone from the cache
        continue
      }
      const exact = (byNorm.get(norm(p.item_name)) ?? []).filter(q => !linkedIds.has(q.qbo_id))
      if (exact.length > 0) suggestions.push({ plu: p, qbo: exact[0], confidence: 'exact' })
      else unmatched.push(p)
    }

    // Active QBO items nothing links or matches to (candidates for manual linking)
    const suggestedIds = new Set(suggestions.map(s => s.qbo.qbo_id))
    const unclaimedQbo = activeQbo.filter(q => !linkedIds.has(q.qbo_id) && !suggestedIds.has(q.qbo_id))

    const syncedAt = qboItems[0]?.synced_at ?? null
    return NextResponse.json({ linked, suggestions, unmatched, unclaimedQbo, syncedAt })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// POST /api/qbo/links — confirm a link { pluId, qboId }
// No price seeding: the app is the price authority; QBO prices are shown for
// reference only until push-to-QuickBooks exists.
export async function POST(req: NextRequest) {
  try {
    const { pluId, qboId } = await req.json()
    if (!pluId || !qboId) {
      return NextResponse.json({ error: 'pluId and qboId required' }, { status: 400 })
    }
    const { data, error } = await supabase
      .from('plu_items')
      .update({ quickbooks_item_id: String(qboId), updated_at: new Date().toISOString() })
      .eq('id', pluId)
      .select()
      .single()
    if (error) throw new Error(error.message)
    return NextResponse.json(data)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// DELETE /api/qbo/links?pluId= — unlink
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const pluId = searchParams.get('pluId')
  if (!pluId) return NextResponse.json({ error: 'pluId required' }, { status: 400 })
  const { error } = await supabase
    .from('plu_items')
    .update({ quickbooks_item_id: '', updated_at: new Date().toISOString() })
    .eq('id', pluId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
