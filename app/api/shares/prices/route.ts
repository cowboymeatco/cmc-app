import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { SHARE_PORTIONS, SHARE_SPECIES, estimateDollars, isShareSpecies, isSharePortion, shareLbs } from '@/lib/shares'
import { loadPrices, quoteLbs, typicalHangingLbs } from '@/lib/sharesServer'

// The posted price list for whole / half / quarter shares.
//
// GET /api/shares/prices
//   Public — what /buy shows. Each row carries the $/lb hanging price, the
//   typical hanging pounds for that share (our own kills' six-month average,
//   else the number typed on the list) and the dollar estimate they make.
//   A row with no price is not offered. No customer data leaves here.
// GET /api/shares/prices?qbo=beef
//   Staff — QuickBooks items matching, from the qbo_items cache, to pick the
//   item the sale line posts to.
// PUT /api/shares/prices
//   Staff — { rows: [{ species, portion, price_per_lb, qbo_item_id, qbo_item_name, est_hanging_lbs }] }

export async function GET(req: NextRequest) {
  try {
    const qbo = req.nextUrl.searchParams.get('qbo')
    if (qbo != null) {
      const { data, error } = await supabaseAdmin
        .from('qbo_items')
        .select('qbo_id, name, full_name, type, sales_price')
        .eq('active', true)
        .ilike('full_name', `%${qbo.replace(/[%_]/g, '')}%`)
        .order('full_name')
        .limit(25)
      if (error) throw new Error(error.message)
      return NextResponse.json({ items: data ?? [] })
    }

    const [prices, typical] = await Promise.all([loadPrices(), typicalHangingLbs()])
    const rows = prices.map(p => {
      const whole = quoteLbs(p.species, prices, typical)
      return {
        species:         p.species,
        portion:         p.portion,
        price_per_lb:    p.price_per_lb,
        qbo_item_id:     p.qbo_item_id,
        qbo_item_name:   p.qbo_item_name,
        est_hanging_lbs: p.est_hanging_lbs,
        // Whole-animal pounds the quote is built on, and where they came from.
        typical_whole_lbs: whole,
        typical_basis:   typical[p.species] ? `average of our last ${typical[p.species]!.head} ${p.species.toLowerCase()} kills` : (p.est_hanging_lbs != null ? 'typical weight on the price list' : null),
        typical_share_lbs: shareLbs(whole, p.portion),
        estimate:        estimateDollars(whole, p.portion, p.price_per_lb),
      }
    })
    return NextResponse.json({ prices: rows })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function PUT(req: NextRequest) {
  const body = await req.json().catch(() => null) as { rows?: unknown } | null
  if (!body || !Array.isArray(body.rows)) return NextResponse.json({ error: 'rows required' }, { status: 400 })
  const rows: Record<string, unknown>[] = []
  for (const r of body.rows as Record<string, unknown>[]) {
    if (!isShareSpecies(r.species) || !isSharePortion(r.species, r.portion)) {
      return NextResponse.json({ error: `not a share we sell: ${String(r.species)} ${String(r.portion)}` }, { status: 400 })
    }
    const num = (v: unknown) => v === null || v === undefined || v === '' ? null : Number(v)
    const price = num(r.price_per_lb), est = num(r.est_hanging_lbs)
    if (price != null && (!Number.isFinite(price) || price < 0)) return NextResponse.json({ error: 'price must be a number' }, { status: 400 })
    if (est != null && (!Number.isFinite(est) || est <= 0))     return NextResponse.json({ error: 'typical weight must be a number' }, { status: 400 })
    rows.push({
      species: r.species, portion: r.portion,
      price_per_lb:    price != null ? Math.round(price * 100) / 100 : null,
      est_hanging_lbs: est  != null ? Math.round(est * 10) / 10 : null,
      qbo_item_id:     typeof r.qbo_item_id   === 'string' && r.qbo_item_id.trim()   ? r.qbo_item_id.trim()   : null,
      qbo_item_name:   typeof r.qbo_item_name === 'string' && r.qbo_item_name.trim() ? r.qbo_item_name.trim() : null,
      updated_at: new Date().toISOString(),
    })
  }
  const { error } = await supabaseAdmin.from('share_prices').upsert(rows, { onConflict: 'species,portion' })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true, prices: await loadPrices(), sold: SHARE_SPECIES.map(s => ({ species: s, portions: SHARE_PORTIONS[s] })) })
}
