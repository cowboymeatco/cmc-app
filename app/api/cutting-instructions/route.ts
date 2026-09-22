export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { unlinkInstruction } from '@/lib/cuttingLinks'

export const dynamic = 'force-dynamic'

// GET /api/cutting-instructions
//   ?ids_only=1 â€” return just [{ id, customer_id, appointment_id }] rows. The
//   cut schedule needs an existence check per id, plus enough to find a sheet
//   whose back-link into the appointment was never written; the full rows carry
//   the whole form payload, so this keeps the phone-facing response small as
//   the table grows.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const idsOnly  = searchParams.get('ids_only')
  // ?new_since=<ISO>: just [{ id }] of submissions created after that moment,
  // for the dashboard's "new submissions" bubble.
  const newSince = searchParams.get('new_since')

  if (newSince) {
    const { data, error } = await supabase
      .from('cutting_instructions')
      .select('id')
      .gt('created_at', newSince)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  const { data, error } = await supabase
    .from('cutting_instructions')
    .select(idsOnly ? 'id, customer_id, appointment_id' : '*')
    .order('created_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/cutting-instructions â€” create new instruction internally
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase
    .from('cutting_instructions')
    .insert([{ status: 'pending', data: body }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/cutting-instructions â€” update status
// (also used to archive: status='archived' / restore: status='pending')
//
// customer_id (optional) ties the card to a customers-table row so it shows
// in that customer's history on /customers. It's set when linking to an
// appointment and intentionally never cleared here â€” an unlinked or archived
// card still belongs to the same person.
//
// processing_price_per_lb (optional) is the negotiated rate for this one
// animal — see the column comment. Sent on its own, without a status, because
// pricing a card is not a status change and must not quietly move it out of
// the queue it's sitting in.
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { ids, status, customer_id, processing_price_per_lb } = body as {
    ids: string[]
    status?: string
    customer_id?: string | null
    processing_price_per_lb?: number | string | null
  }

  // Omitting the field leaves the existing link alone, so archive/restore never
  // disturbs it. Sending it explicitly — which only the link-to-appointment
  // flow does — is authoritative: the card follows the slot it was just linked
  // to, and null clears. Treating null as "not sent" is how a card kept
  // pointing at the customer from a PREVIOUS link: Sarah Sleaford's cut sheet
  // stayed filed under First State Bank of Forsyth after being re-linked to her
  // own slot, because that slot had no resolved customer at the moment of
  // linking and the stale id silently survived.
  const updates: { status?: string; customer_id?: string | null; processing_price_per_lb?: number | null } = {}
  if (status !== undefined) updates.status = status
  if (customer_id !== undefined) updates.customer_id = customer_id || null
  // Blank clears back to standard pricing. A typed 0 is kept as 0 — "no
  // processing charge on this one" is a real answer and is not the same as
  // "charge the standard rate", so it can't be folded into null.
  if (processing_price_per_lb !== undefined) {
    const raw = typeof processing_price_per_lb === 'string' ? processing_price_per_lb.trim() : processing_price_per_lb
    const n = raw === '' || raw === null ? null : Number(raw)
    if (n !== null && (!Number.isFinite(n) || n < 0)) {
      return NextResponse.json({ error: 'processing_price_per_lb must be a number of 0 or more, or blank' }, { status: 400 })
    }
    updates.processing_price_per_lb = n
  }
  if (!Object.keys(updates).length) {
    return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
  }
  if (!Array.isArray(ids) || !ids.length) {
    return NextResponse.json({ error: 'ids required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('cutting_instructions')
    .update(updates)
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}


// DELETE /api/cutting-instructions?id=... â€” permanently remove one instruction.
// Hard delete for junk (test cards); real cards should be archived via PATCH instead.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Unlink before deleting. If this fails we stop: a card that's merely
  // unlinked can be re-linked, but a deleted card with live references leaves
  // the animal pointing at nothing.
  const { error: unlinkErr } = await unlinkInstruction(id)
  if (unlinkErr) return NextResponse.json({ error: unlinkErr }, { status: 500 })

  const { error } = await supabase
    .from('cutting_instructions')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
