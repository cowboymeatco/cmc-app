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
  const { supply_id, name_text, qty, urgency, requested_by, note } = body as Record<string, string | undefined>

  if (!requested_by?.trim()) {
    return NextResponse.json({ error: 'Add your name to the request.' }, { status: 400 })
  }

  // A request can name a catalog item or be free text — the crew must never be
  // blocked from asking for something because nobody set it up first.
  let label = name_text?.trim() ?? ''
  if (supply_id && !label) {
    const { data } = await supabase
      .from('cleaning_supplies').select('name').eq('id', supply_id).single()
    label = (data?.name as string) ?? ''
  }
  if (!label) {
    return NextResponse.json({ error: 'Say what you need.' }, { status: 400 })
  }

  const isOut = urgency === 'out'

  // Don't stack duplicates: if this item is already on the open list, bump it
  // rather than adding a second row. Five people noticing the same empty drum
  // is one order, not five.
  if (supply_id) {
    const { data: dupe } = await supabase
      .from('cleaning_supply_requests')
      .select('id, note, urgency')
      .eq('supply_id', supply_id).eq('status', 'open')
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
      supply_id:    supply_id ?? null,
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
