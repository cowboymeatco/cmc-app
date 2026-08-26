export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Supply requests: the crew flags what's low, somebody who orders things sees
// it. No vendor integration — that's a much bigger scope and this is the part
// that actually stops the plant running out of detergent.
//
// GET   ?status=open|all
// POST  { name_text | supply_id, qty, urgency, requested_by, note }
// PATCH { id, action: ordered|received|cancelled|reopen, by }

/**
 * Where a request alert goes.
 *
 * Falls back to the feedback webhook so this works the day it ships without
 * anyone configuring anything; set ZAPIER_CLEANING_WEBHOOK to split cleaning
 * alerts off from the app-bug punch list, which is where they'd otherwise land.
 */
function alertWebhook(): string | undefined {
  return process.env.ZAPIER_CLEANING_WEBHOOK ?? process.env.ZAPIER_FEEDBACK_WEBHOOK
}

export async function GET(req: NextRequest) {
  const status = new URL(req.url).searchParams.get('status') ?? 'open'

  let q = supabase
    .from('cleaning_supply_requests')
    .select('*, cleaning_supplies(name, unit, vendor)')
    .order('created_at', { ascending: false })
  if (status === 'open')      q = q.in('status', ['open', 'ordered'])
  else if (status !== 'all')  q = q.eq('status', status)

  const { data, error } = await q.limit(300)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { supply_id, name_text, qty, urgency, requested_by, note } =
    body as Record<string, string | undefined>
  const addToCatalog = body.add_to_catalog === true

  if (!requested_by?.trim()) {
    return NextResponse.json({ error: 'Add your name to the request.' }, { status: 400 })
  }

  // A request can name a catalog item or be free text — the crew must never be
  // blocked from asking for something because nobody set it up first.
  let label = name_text?.trim() ?? ''
  let linkedSupplyId = supply_id ?? null
  if (supply_id && !label) {
    const { data } = await supabase
      .from('cleaning_supplies').select('name').eq('id', supply_id).single()
    label = (data?.name as string) ?? ''
  }
  if (!label) {
    return NextResponse.json({ error: 'Say what you need.' }, { status: 400 })
  }

  // Free text asked for something the list has never heard of. Charlie,
  // 2026-08-26: "Can we have a way to request a new supply?" — the request
  // already worked, but it died as one line of text and the catalog stayed
  // empty (one active item the day he asked), so the next person typed the same
  // thing again and nothing could ever hang off it: no vendor, no unit, no
  // reorder card. Adopting it here is what lets the list grow out of the work
  // instead of out of a data-entry session.
  //
  // Curated by the ASKER, not automatic: a checkbox they can clear, so "more of
  // those blue towels" stays a one-off and doesn't become a permanent entry.
  if (addToCatalog && !linkedSupplyId) {
    const { data: existing } = await supabase
      .from('cleaning_supplies').select('id, active').ilike('name', label).maybeSingle()

    if (existing) {
      // Someone retired it before. Asking for it again is as good a reason as
      // any to put it back, and it keeps its vendor and unit.
      if (!existing.active) {
        await supabase.from('cleaning_supplies').update({ active: true }).eq('id', existing.id)
      }
      linkedSupplyId = existing.id as string
      const { data: nm } = await supabase
        .from('cleaning_supplies').select('name').eq('id', existing.id).single()
      if (nm?.name) label = nm.name as string        // keep the catalog's spelling
    } else {
      // A failure here must not lose the request — the list is the thing that
      // stops the plant running out of detergent, and the catalog entry is a
      // convenience on top of it.
      const { data: made } = await supabase
        .from('cleaning_supplies')
        .insert([{ name: label, unit: body.unit?.trim() || null, sort_order: 100 }])
        .select('id').single()
      if (made) linkedSupplyId = made.id as string
    }
  }

  const isOut = urgency === 'out'

  // Don't stack duplicates: if this item is already on the open list, bump it
  // rather than adding a second row. Five people noticing the same empty drum
  // is one order, not five.
  if (linkedSupplyId) {
    const { data: dupe } = await supabase
      .from('cleaning_supply_requests')
      .select('id, note, urgency')
      .eq('supply_id', linkedSupplyId).eq('status', 'open')
      .limit(1).maybeSingle()

    if (dupe) {
      const { data, error } = await supabase
        .from('cleaning_supply_requests')
        .update({
          // Someone reporting "we're out" escalates an existing "getting low".
          urgency: isOut ? 'out' : dupe.urgency,
          note: [dupe.note, `${requested_by.trim()} also asked${note?.trim() ? `: ${note.trim()}` : ''}`]
            .filter(Boolean).join(' · '),
        })
        .eq('id', dupe.id).select().single()
      if (error) return NextResponse.json({ error: error.message }, { status: 500 })
      return NextResponse.json({ ...data, merged: true })
    }
  }

  const { data, error } = await supabase
    .from('cleaning_supply_requests')
    .insert([{
      supply_id:    linkedSupplyId,
      name_text:    label,
      qty:          qty?.trim() || null,
      urgency:      isOut ? 'out' : 'normal',
      requested_by: requested_by.trim(),
      note:         note?.trim() || null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // "We are out" is the one that can stop production tomorrow, so it's the one
  // that interrupts someone. Everything else waits on the list.
  const hook = alertWebhook()
  if (isOut && hook) {
    fetch(hook, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type:        '🧴 OUT of a cleaning supply',
        submitter:   requested_by.trim(),
        page_url:    'cleaning supplies',
        description: `OUT: ${label}${qty?.trim() ? ` (${qty.trim()})` : ''}${note?.trim() ? ` — ${note.trim()}` : ''}`,
      }),
    }).catch(() => { /* already saved; the list is the source of truth */ })
  }

  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, action, by } = body as { id?: string; action?: string; by?: string }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const now = new Date().toISOString()
  const updates: Record<string, unknown> = { handled_by: by?.trim() || null }

  switch (action) {
    case 'ordered':   updates.status = 'ordered';   updates.ordered_at  = now; break
    case 'received':  updates.status = 'received';  updates.received_at = now; break
    case 'cancelled': updates.status = 'cancelled'; break
    case 'reopen':
      updates.status      = 'open'
      updates.ordered_at  = null
      updates.received_at = null
      break
    default:
      return NextResponse.json(
        { error: 'action must be ordered, received, cancelled, or reopen' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('cleaning_supply_requests').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
