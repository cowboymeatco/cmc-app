export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCloverItems, type CloverItem } from '@/lib/clover'

// Cross-system catalog alignment: for every active PLU, where it stands on
// the scale (plu_items IS the Hobart book), in Clover (live), and in
// QuickBooks (qbo_items cache). Read-only — fixing links happens in the
// Clover / QuickBooks tabs.

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

interface PluRow {
  id: string
  plu_number: string
  item_name: string
  price: number | null
  retail_price: number | null
  is_retail: boolean
  clover_item_id: string
  quickbooks_item_id: string
}

interface QboRow {
  qbo_id: string
  name: string
  full_name: string
  sales_price: number | null
  active: boolean
}

export async function GET() {
  try {
    const pluPromise = supabase
      .from('plu_items')
      .select('id, plu_number, item_name, price, retail_price, is_retail, clover_item_id, quickbooks_item_id')
      .eq('active', true)
      .order('item_name')
    const qboPromise = supabase
      .from('qbo_items')
      .select('qbo_id, name, full_name, sales_price, active')
      .not('qbo_id', 'is', null)

    // Clover is a live API call — degrade to cache-only alignment if it's down
    let cloverItems: CloverItem[] | null = null
    let cloverError: string | null = null
    const [{ data: plus, error: pluErr }, { data: qbo, error: qboErr }, cloverResult] = await Promise.all([
      pluPromise,
      qboPromise,
      getCloverItems().catch((e: unknown) => { cloverError = e instanceof Error ? e.message : String(e); return null }),
    ])
    if (pluErr) throw new Error(pluErr.message)
    if (qboErr) throw new Error(qboErr.message)
    cloverItems = cloverResult

    const cloverById = new Map((cloverItems ?? []).map(c => [c.id, c]))
    const qboById = new Map(((qbo ?? []) as QboRow[]).map(q => [q.qbo_id, q]))

    const rows = (plus as PluRow[]).map(p => {
      const clover = p.clover_item_id ? cloverById.get(p.clover_item_id) ?? null : null
      const q = p.quickbooks_item_id ? qboById.get(p.quickbooks_item_id) ?? null : null
      const retailCents = p.retail_price != null ? Math.round(p.retail_price * 100) : null
      return {
        plu: { id: p.id, plu_number: p.plu_number, item_name: p.item_name, price: p.price, retail_price: p.retail_price, is_retail: p.is_retail },
        onScale: p.price != null && p.price > 0,
        clover: p.clover_item_id
          ? clover
            ? {
                name: clover.name,
                price: clover.price,
                priceDrift: retailCents != null && retailCents !== clover.price,
                nameDrift: norm(clover.name) !== norm(p.item_name),
              }
            : { missing: true } // linked but gone from Clover
          : null,
        qbo: p.quickbooks_item_id
          ? q
            ? {
                name: q.name,
                fullName: q.full_name,
                salesPrice: q.sales_price,
                inactive: !q.active,
                priceDrift: p.retail_price != null && q.sales_price != null
                  && Math.round(p.retail_price * 100) !== Math.round(q.sales_price * 100),
                nameDrift: norm(q.name) !== norm(p.item_name),
              }
            : { missing: true }
          : null,
      }
    })

    const summary = {
      total: rows.length,
      bothLinked: rows.filter(r => r.clover && r.qbo).length,
      cloverOnly: rows.filter(r => r.clover && !r.qbo).length,
      qboOnly: rows.filter(r => !r.clover && r.qbo).length,
      unlinked: rows.filter(r => !r.clover && !r.qbo).length,
      priceDrift: rows.filter(r =>
        (r.clover && 'priceDrift' in r.clover && r.clover.priceDrift)
        || (r.qbo && 'priceDrift' in r.qbo && r.qbo.priceDrift)).length,
      nameDrift: rows.filter(r =>
        (r.clover && 'nameDrift' in r.clover && r.clover.nameDrift)
        || (r.qbo && 'nameDrift' in r.qbo && r.qbo.nameDrift)).length,
      brokenLinks: rows.filter(r =>
        (r.clover && 'missing' in r.clover) || (r.qbo && 'missing' in r.qbo)).length,
    }

    return NextResponse.json({ rows, summary, cloverError })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// POST /api/alignment — accept Clover's price into the app { pluId }.
// One-time correction path (2026-07-07 drift review): register-side price
// raises never made it into the app, so Clover's current price becomes the
// app's retail AND scale price. App stays the source of truth afterward;
// Clover's price is re-fetched live here so a stale browser tab can't
// write an outdated number.
export async function POST(req: NextRequest) {
  try {
    const { pluId } = await req.json()
    if (!pluId) return NextResponse.json({ error: 'pluId required' }, { status: 400 })

    const { data: plu, error } = await supabase
      .from('plu_items')
      .select('id, item_name, clover_item_id, price, retail_price')
      .eq('id', pluId)
      .single()
    if (error) throw new Error(error.message)
    if (!plu.clover_item_id) return NextResponse.json({ error: 'PLU is not linked to Clover' }, { status: 400 })

    const clover = (await getCloverItems()).find(c => c.id === plu.clover_item_id)
    if (!clover) return NextResponse.json({ error: 'Linked item not found in Clover' }, { status: 404 })
    if (!(clover.price > 0)) return NextResponse.json({ error: 'Clover has no usable price for this item' }, { status: 400 })

    const dollars = clover.price / 100
    const { data, error: updErr } = await supabase
      .from('plu_items')
      .update({ retail_price: dollars, price: dollars, updated_at: new Date().toISOString() })
      .eq('id', pluId)
      .select()
      .single()
    if (updErr) throw new Error(updErr.message)
    return NextResponse.json({ ok: true, applied: dollars, previous: { price: plu.price, retail_price: plu.retail_price }, item: data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
