export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadPriceRows, loadCustomerPrices } from '@/lib/priceBook'

// The price list — see lib/priceBook.ts.
//
// GET  → { rows, deals, changes }
// POST { action: 'update', key, rate?, label?, active?, changedBy }
// POST { action: 'add_deal', qbo_customer_id, customer_name, price_key, rate, note?, changedBy }
// POST { action: 'remove_deal', id, changedBy }
//
// Every change is written to price_book_changes. Editing a rate here does NOT
// touch QuickBooks; that's the push on /api/price-book/push, approved
// separately, so a typo is never one click from the books.

export async function GET() {
  try {
    const [rows, deals, changes] = await Promise.all([
      loadPriceRows(),
      loadCustomerPrices(),
      supabaseAdmin.from('price_book_changes').select('*').order('created_at', { ascending: false }).limit(50),
    ])
    if (changes.error) throw new Error(changes.error.message)
    return NextResponse.json({ rows, deals, changes: changes.data })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 })

export async function POST(req: NextRequest) {
  try {
    const body = await req.json()
    const changedBy = typeof body.changedBy === 'string' ? body.changedBy.trim() : ''
    if (!changedBy) return bad('Say who is making the change')

    if (body.action === 'update') {
      const key = String(body.key ?? '')
      const { data: row, error } = await supabaseAdmin.from('price_book').select('*').eq('key', key).maybeSingle()
      if (error) throw new Error(error.message)
      if (!row) return bad(`No price "${key}"`)

      const patch: Record<string, unknown> = {}
      const log: { field: string; old_value: string; new_value: string }[] = []
      if (body.rate !== undefined) {
        const rate = Number(body.rate)
        if (!Number.isFinite(rate) || rate < 0) return bad('Rate must be a number, zero or more')
        if (Math.round(rate * 10000) !== Math.round(Number(row.rate) * 10000)) {
          patch.rate = rate
          log.push({ field: 'rate', old_value: String(Number(row.rate)), new_value: String(rate) })
        }
      }
      if (typeof body.label === 'string' && body.label.trim() && body.label.trim() !== row.label) {
        patch.label = body.label.trim()
        log.push({ field: 'label', old_value: row.label, new_value: body.label.trim() })
      }
      if (typeof body.active === 'boolean' && body.active !== row.active) {
        patch.active = body.active
        log.push({ field: 'active', old_value: String(row.active), new_value: String(body.active) })
      }
      if (!log.length) return NextResponse.json({ ok: true, changed: 0 })

      const { error: upErr } = await supabaseAdmin.from('price_book')
        .update({ ...patch, updated_at: new Date().toISOString(), updated_by: changedBy }).eq('key', key)
      if (upErr) throw new Error(upErr.message)
      const { error: logErr } = await supabaseAdmin.from('price_book_changes')
        .insert(log.map(l => ({ ...l, key, changed_by: changedBy })))
      return NextResponse.json({ ok: true, changed: log.length, logWarning: logErr?.message })
    }

    if (body.action === 'add_deal') {
      const qboId = String(body.qbo_customer_id ?? '').trim()
      const name = String(body.customer_name ?? '').trim()
      const key = String(body.price_key ?? '')
      const rate = Number(body.rate)
      if (!qboId || !name) return bad('Pick the QuickBooks customer')
      if (!Number.isFinite(rate) || rate < 0) return bad('Rate must be a number, zero or more')
      const { data: row } = await supabaseAdmin.from('price_book').select('key').eq('key', key).maybeSingle()
      if (!row) return bad(`No price "${key}"`)
      const { error } = await supabaseAdmin.from('customer_prices').upsert({
        qbo_customer_id: qboId, customer_name: name, price_key: key, rate,
        note: typeof body.note === 'string' ? body.note.trim() || null : null,
        created_by: changedBy, active: true,
      }, { onConflict: 'qbo_customer_id,price_key' })
      if (error) throw new Error(error.message)
      await supabaseAdmin.from('price_book_changes').insert({
        key, field: `deal:${name}`, old_value: null, new_value: String(rate), changed_by: changedBy,
      })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'remove_deal') {
      const { data: deal, error } = await supabaseAdmin.from('customer_prices')
        .update({ active: false }).eq('id', String(body.id ?? '')).select('price_key, customer_name, rate').maybeSingle()
      if (error) throw new Error(error.message)
      if (!deal) return bad('No such customer price')
      await supabaseAdmin.from('price_book_changes').insert({
        key: deal.price_key, field: `deal:${deal.customer_name}`, old_value: String(deal.rate), new_value: 'removed', changed_by: changedBy,
      })
      return NextResponse.json({ ok: true })
    }

    return bad('Unknown action')
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
