import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate, daysBetweenISO } from '@/lib/dates'
import { cardLabel, expectedOn, leadDays, type Item, type Signal, type Vendor } from '@/lib/kanban'

export const dynamic = 'force-dynamic'

// A kanban signal is one pulled card, start to finish.
//
// POST  { item_id, card_seq?, urgency?, pulled_by, source?, note? }   pull a card
// PATCH { ids: [...], action, by, ... }
//   action = ordered   { po_number?, expected_on? }   expected_on defaults to today + lead
//          = received  { received_qty?, unit_price? } one id at a time when qty/price given
//          = qty       { qty }                         change what a pulled card asks for
//          = cancelled | reopen

/** Where an OUT alert goes. Falls back to the feedback webhook, like cleaning supplies. */
function alertWebhook(): string | undefined {
  return process.env.ZAPIER_KANBAN_WEBHOOK ?? process.env.ZAPIER_FEEDBACK_WEBHOOK
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const who = typeof body.pulled_by === 'string' ? body.pulled_by.trim() : ''
  if (!who) return NextResponse.json({ error: 'Put your name on it so whoever orders can ask.' }, { status: 400 })
  const itemId = typeof body.item_id === 'string' ? body.item_id : ''
  if (!itemId) return NextResponse.json({ error: 'item_id required' }, { status: 400 })
  const isOut = body.urgency === 'out'
  const note = typeof body.note === 'string' ? body.note.trim() || null : null
  const source = body.source === 'scan' ? 'scan' : 'board'

  const { data: item, error: iErr } = await supabaseAdmin
    .from('kanban_items').select('*').eq('id', itemId).maybeSingle<Item>()
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })
  if (!item || !item.active) {
    return NextResponse.json({ error: 'That card is retired — take it off the shelf.' }, { status: 404 })
  }

  const { data: openRows, error: oErr } = await supabaseAdmin
    .from('kanban_signals').select('*').eq('item_id', itemId).in('status', ['pulled', 'ordered'])
  if (oErr) return NextResponse.json({ error: oErr.message }, { status: 500 })
  const open = (openRows ?? []) as Signal[]

  const seqRaw = Number(body.card_seq)
  const seq = Number.isInteger(seqRaw) && seqRaw >= 1 && seqRaw <= item.cards_in_loop ? seqRaw : null

  // The same physical card can't be pulled twice, and a second person noticing
  // the same empty bin before anyone has ordered is one order, not two. Either
  // way the existing signal is returned — escalated if this one says OUT.
  const same = seq != null
    ? open.find(s => s.card_seq === seq)
    : open.find(s => s.status === 'pulled')
  if (same) {
    const updates: Record<string, unknown> = {}
    if (isOut && same.urgency !== 'out') updates.urgency = 'out'
    const extra = `${who} also flagged it${note ? `: ${note}` : ''}`
    updates.note = [same.note, extra].filter(Boolean).join(' · ')
    const { data, error } = await supabaseAdmin
      .from('kanban_signals').update(updates).eq('id', same.id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    if (isOut && same.urgency !== 'out') alert(item, who, note)
    return NextResponse.json({ ...data, merged: true })
  }

  // Board pull with no card named: take the lowest card that isn't already out.
  // If every card in the loop is out, the loop is broken — record it anyway,
  // flagged OUT, because the shelf really is empty.
  let cardSeq = seq
  let allOut = false
  if (cardSeq == null) {
    const taken = new Set(open.map(s => s.card_seq))
    for (let n = 1; n <= item.cards_in_loop; n++) if (!taken.has(n)) { cardSeq = n; break }
    allOut = cardSeq == null
  }

  const urgent = isOut || allOut
  const { data, error } = await supabaseAdmin
    .from('kanban_signals')
    .insert([{
      item_id:    itemId,
      card_seq:   cardSeq,
      status:     'pulled',
      urgency:    urgent ? 'out' : 'normal',
      qty:        item.order_qty,
      source,
      pulled_by:  who,
      vendor_id:  item.vendor_id,
      unit_price: item.price,
      note:       allOut ? ['Every card in the loop was already out', note].filter(Boolean).join(' · ') : note,
    }])
    .select().single()
  if (error) {
    // Two phones scanning the same card at the same moment: the unique index
    // catches the second — it isn't an error to the person holding the phone.
    if (/duplicate key/.test(error.message)) {
      return NextResponse.json({ error: 'That card was just pulled by someone else.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  if (urgent) alert(item, who, note)
  return NextResponse.json({ ...data, all_out: allOut })
}

/** "We're out" is the one that stops production tomorrow, so it interrupts someone. */
function alert(item: Item, who: string, note: string | null) {
  const hook = alertWebhook()
  if (!hook) return
  fetch(hook, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type:        '📦 OUT — kanban card pulled',
      submitter:   who,
      page_url:    'kanban',
      description: `OUT: ${cardLabel(item.card_no)} ${item.name}${item.location ? ` (${item.location})` : ''}${note ? ` — ${note}` : ''}`,
    }),
  }).catch(() => { /* already saved; the board is the source of truth */ })
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const ids: string[] = Array.isArray(body.ids) ? body.ids.filter((x: unknown) => typeof x === 'string')
    : typeof body.id === 'string' ? [body.id] : []
  if (ids.length === 0) return NextResponse.json({ error: 'ids required' }, { status: 400 })
  const by = typeof body.by === 'string' ? body.by.trim() : ''
  if (!by) return NextResponse.json({ error: 'Your name is required' }, { status: 400 })

  const { data: sigRows, error: sErr } = await supabaseAdmin.from('kanban_signals').select('*').in('id', ids)
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })
  const sigs = (sigRows ?? []) as Signal[]
  if (sigs.length !== ids.length) return NextResponse.json({ error: 'Some of those cards no longer exist' }, { status: 404 })

  const now = new Date().toISOString()
  const today = isoDate()

  switch (body.action) {
    case 'qty': {
      const q = Number(body.qty)
      if (!Number.isFinite(q) || q <= 0) return NextResponse.json({ error: 'Quantity must be more than zero' }, { status: 400 })
      const { error } = await supabaseAdmin.from('kanban_signals').update({ qty: q }).in('id', ids).eq('status', 'pulled')
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    case 'ordered': {
      if (sigs.some(s => s.status !== 'pulled')) {
        return NextResponse.json({ error: 'Only pulled cards can be marked ordered' }, { status: 400 })
      }
      const po = typeof body.po_number === 'string' ? body.po_number.trim() || null : null
      const eta = typeof body.expected_on === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(body.expected_on)
        ? body.expected_on : null
      const { items, vendors } = await lookups(sigs)
      for (const s of sigs) {
        const item = items.get(s.item_id)
        const vendor = item?.vendor_id ? vendors.get(item.vendor_id) : undefined
        const lead = item ? leadDays(item, vendor).days : null
        const { error } = await supabaseAdmin.from('kanban_signals').update({
          status: 'ordered', ordered_by: by, ordered_at: now, po_number: po,
          expected_on: eta ?? expectedOn(today, lead),
          // Freeze who and what it cost at the moment it went out the door.
          vendor_id: item?.vendor_id ?? s.vendor_id,
          unit_price: item?.price ?? s.unit_price,
        }).eq('id', s.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
      const itemIds = [...new Set(sigs.map(s => s.item_id))]
      await supabaseAdmin.from('kanban_items').update({ last_ordered_at: now }).in('id', itemIds)
      return NextResponse.json({ ok: true })
    }

    case 'received': {
      if (sigs.some(s => s.status !== 'ordered' && s.status !== 'pulled')) {
        return NextResponse.json({ error: 'That card is already closed' }, { status: 400 })
      }
      const single = sigs.length === 1
      const rq = single && body.received_qty !== undefined && body.received_qty !== '' ? Number(body.received_qty) : null
      const up = single && body.unit_price !== undefined && body.unit_price !== '' ? Number(body.unit_price) : null
      if ((rq != null && (!Number.isFinite(rq) || rq < 0)) || (up != null && (!Number.isFinite(up) || up < 0))) {
        return NextResponse.json({ error: 'Quantity and price must be numbers' }, { status: 400 })
      }
      // A card received straight from Pulled (picked up at the store, the rep
      // dropped it off) keeps ordered_at empty: the order date is unknown, and
      // it stays out of the learned lead time rather than counting as zero.
      for (const s of sigs) {
        const { error } = await supabaseAdmin.from('kanban_signals').update({
          status: 'received', received_by: by, received_at: now,
          received_qty: rq ?? s.qty,
          unit_price: up ?? s.unit_price,
        }).eq('id', s.id)
        if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      }
      // What we just paid is the price now.
      if (single && up != null) {
        const { data: cur } = await supabaseAdmin.from('kanban_items').select('price').eq('id', sigs[0].item_id).maybeSingle()
        if (cur && Number(cur.price ?? NaN) !== up) {
          await supabaseAdmin.from('kanban_items').update({ price: up, price_updated_at: now }).eq('id', sigs[0].item_id)
        }
      }
      for (const itemId of new Set(sigs.map(s => s.item_id))) await relearn(itemId, now)
      return NextResponse.json({ ok: true })
    }

    case 'cancelled': {
      const { error } = await supabaseAdmin.from('kanban_signals')
        .update({ status: 'cancelled', note: noteWith(sigs[0], `cancelled by ${by}`) })
        .in('id', ids).in('status', ['pulled', 'ordered'])
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ok: true })
    }

    case 'reopen': {
      // Back to pulled: an order that fell through, or a Received tapped by mistake.
      const { error } = await supabaseAdmin.from('kanban_signals').update({
        status: 'pulled', ordered_at: null, ordered_by: null, po_number: null, expected_on: null,
        received_at: null, received_by: null, received_qty: null,
      }).in('id', ids)
      if (error) {
        const msg = /duplicate key/.test(error.message) ? 'That card is already out again — close the newer one first' : error.message
        return NextResponse.json({ error: msg }, { status: 400 })
      }
      for (const itemId of new Set(sigs.map(s => s.item_id))) await relearn(itemId, null)
      return NextResponse.json({ ok: true })
    }

    default:
      return NextResponse.json({ error: 'action must be ordered, received, qty, cancelled or reopen' }, { status: 400 })
  }
}

function noteWith(s: Signal, extra: string): string {
  return [s.note, extra].filter(Boolean).join(' · ')
}

async function lookups(sigs: Signal[]) {
  const itemIds = [...new Set(sigs.map(s => s.item_id))]
  const { data: itemRows } = await supabaseAdmin.from('kanban_items').select('*').in('id', itemIds)
  const items = new Map(((itemRows ?? []) as Item[]).map(i => [i.id, i]))
  const vendorIds = [...new Set([...items.values()].map(i => i.vendor_id).filter(Boolean))] as string[]
  const { data: vRows } = vendorIds.length
    ? await supabaseAdmin.from('kanban_vendors').select('*').in('id', vendorIds)
    : { data: [] }
  const vendors = new Map(((vRows ?? []) as Vendor[]).map(v => [v.id, v]))
  return { items, vendors }
}

/**
 * Learned lead time = average ordered→received days over the last five
 * receipts that have both dates. Shown next to the planned lead time on the
 * card; adopting it is a person's call.
 */
async function relearn(itemId: string, receivedAt: string | null) {
  const { data } = await supabaseAdmin.from('kanban_signals')
    .select('ordered_at, received_at').eq('item_id', itemId).eq('status', 'received')
    .not('ordered_at', 'is', null).not('received_at', 'is', null)
    .order('received_at', { ascending: false }).limit(5)
  const rows = (data ?? []) as { ordered_at: string; received_at: string }[]
  const days = rows.map(r => daysBetweenISO(isoDate(new Date(r.ordered_at)), isoDate(new Date(r.received_at))))
  const learned = days.length ? Math.round((days.reduce((a, b) => a + b, 0) / days.length) * 10) / 10 : null
  const update: Record<string, unknown> = { learned_lead_days: learned }
  if (receivedAt) update.last_received_at = receivedAt
  await supabaseAdmin.from('kanban_items').update(update).eq('id', itemId)
}
