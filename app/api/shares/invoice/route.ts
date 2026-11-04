import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { type ShareOrder } from '@/lib/shares'
import { enrichOrders, loadPrices } from '@/lib/sharesServer'

// POST /api/shares/invoice { id }
//
// The one line QuickBooks gets for a share: hanging pounds × the $/lb the
// buyer was quoted, all-in. Written into billable_events — the same ledger
// kill and cut & wrap land in, reviewed and sent from /billing — under
// rule_key 'share_sale', so nothing downstream had to learn a new table.
//
// /api/billing/detect skips our own animals on purpose (they were never a
// receivable), which is why this route exists: the share IS the receivable.
//
// Needs the carcass weighed (the hanging weight comes off harvest_log through
// the booking slot, see lib/sharesServer), a pinned price, and the QuickBooks
// item set on the price list. Re-running on a still-pending event re-figures
// it (a corrected weight, say); a pushed one is left alone.

const bad = (msg: string, status = 400) => NextResponse.json({ error: msg }, { status })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { id?: unknown } | null
  const id = body && typeof body.id === 'string' ? body.id : ''
  if (!id) return bad('id required')

  const { data: cur, error: curErr } = await supabaseAdmin.from('share_orders').select('*').eq('id', id).single()
  if (curErr || !cur) return bad('order not found', 404)
  const [view] = await enrichOrders([cur as ShareOrder])

  if (!view.appointment_id)      return bad('not on the schedule yet', 409)
  if (view.share_lbs == null)    return bad('no hanging weight on the kill floor record yet', 409)
  if (view.price_per_lb == null) return bad('no price pinned on this order — confirm it first', 409)

  // The QuickBooks item: what was pinned at confirmation, else the list today.
  let itemId = view.qbo_item_id, itemName = view.qbo_item_name
  if (!itemId) {
    const p = (await loadPrices()).find(r => r.species === view.species && r.portion === view.portion)
    itemId = p?.qbo_item_id ?? null; itemName = p?.qbo_item_name ?? null
  }
  if (!itemId) return bad(`no QuickBooks item set for ${view.portion.toLowerCase()} ${view.species.toLowerCase()} sales — set it under Prices`, 409)

  // Their QuickBooks customer, the way billing resolves a cut customer.
  const name = view.customer_name.trim()
  const [{ data: link }, { data: custRow }] = await Promise.all([
    supabaseAdmin.from('customer_qbo_links').select('qbo_customer_id').eq('customer_name', name).limit(1),
    view.customer_id
      ? supabaseAdmin.from('customers').select('qbo_customer_id').eq('id', view.customer_id).single()
      : Promise.resolve({ data: null }),
  ])
  const qboCustomerId = (link?.[0]?.qbo_customer_id as string | undefined) || ((custRow as { qbo_customer_id?: string | null } | null)?.qbo_customer_id ?? '') || ''

  const qty = view.share_lbs
  const rate = view.price_per_lb
  const amount = Math.round(qty * rate * 100) / 100
  const tag = view.carcass_tag || view.appointment_id.slice(0, 8)
  const row = {
    service_date: view.harvest_date ?? new Date().toISOString().slice(0, 10),
    rule_key: 'share_sale',
    source_table: 'share_orders',
    source_id: view.id,
    customer_name: name,
    qbo_customer_id: qboCustomerId,
    qbo_item_id: itemId,
    description: `${view.portion} ${view.species} — carcass ${tag}, ${qty} lbs hanging @ $${rate.toFixed(2)}/lb`,
    qty, unit: 'lb', rate, amount,
    status: 'pending',
  }

  // One event per share: re-figure a pending one, never touch a pushed one.
  const { data: existing } = await supabaseAdmin.from('billable_events')
    .select('id, status').eq('source_table', 'share_orders').eq('source_id', view.id).eq('customer_name', name).limit(1)
  let eventId: string
  if (existing?.[0]) {
    if (!['pending', 'skipped'].includes(existing[0].status as string)) {
      return bad(`already ${existing[0].status} to QuickBooks — correct it there`, 409)
    }
    const { error } = await supabaseAdmin.from('billable_events').update(row).eq('id', existing[0].id)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    eventId = existing[0].id as string
  } else {
    const { data, error } = await supabaseAdmin.from('billable_events').insert([row]).select('id').single()
    if (error || !data) return NextResponse.json({ error: error?.message ?? 'could not write the charge' }, { status: 500 })
    eventId = data.id as string
  }

  const { data, error } = await supabaseAdmin.from('share_orders')
    .update({ billable_event_id: eventId, qbo_item_id: itemId, qbo_item_name: itemName })
    .eq('id', id).select('*').single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ...(await enrichOrders([data as ShareOrder]))[0], charge: row, missing_qbo_customer: !qboCustomerId })
}
