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
// kill_price_per_lb / processing_price_per_lb (optional) are the negotiated
// rates for this one animal — see the column comments. TWO of them, because
// QBO invoices custom work as a kill line and a processing line and a single
// combined number would have to be split again at invoicing time (Charlie,
// 2026-09-22). Sent on their own, without a status, because pricing a card is
// not a status change and must not quietly move it out of the queue it's
// sitting in.
//
// scale_label (optional) is the producer-specific label this card packs on —
// see scripts/2026-09-22_cutting_instruction_scale_label.sql. Blank clears it
// back to the house label. Same deal as the rates: sent on its own, no status.
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { ids, status, customer_id, processing_price_per_lb, kill_price_per_lb, scale_label } = body as {
    ids: string[]
    status?: string
    customer_id?: string | null
    processing_price_per_lb?: number | string | null
    kill_price_per_lb?: number | string | null
    scale_label?: string | null
  }

  // Omitting the field leaves the existing link alone, so archive/restore never
  // disturbs it. Sending it explicitly — which only the link-to-appointment
  // flow does — is authoritative: the card follows the slot it was just linked
  // to, and null clears. Treating null as "not sent" is how a card kept
  // pointing at the customer from a PREVIOUS link: Sarah Sleaford's cut sheet
  // stayed filed under First State Bank of Forsyth after being re-linked to her
  // own slot, because that slot had no resolved customer at the moment of
  // linking and the stale id silently survived.
  const updates: {
    status?: string; customer_id?: string | null
    processing_price_per_lb?: number | null; kill_price_per_lb?: number | null
    scale_label?: string | null
  } = {}
  if (status !== undefined) updates.status = status
  if (customer_id !== undefined) updates.customer_id = customer_id || null
  // Blank clears back to the standard rate. A typed 0 is kept as 0 — "no
  // charge on this one" is a real answer and is not the same as "charge the
  // standard rate", so it can't be folded into null.
  const rate = (v: number | string | null | undefined): number | null | 'bad' => {
    const raw = typeof v === 'string' ? v.trim() : v
    if (raw === '' || raw === null) return null
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : 'bad'
  }
  for (const [key, val] of [
    ['processing_price_per_lb', processing_price_per_lb],
    ['kill_price_per_lb',       kill_price_per_lb],
  ] as const) {
    if (val === undefined) continue
    const n = rate(val)
    if (n === 'bad') {
      return NextResponse.json({ error: `${key} must be a number of 0 or more, or blank` }, { status: 400 })
    }
    updates[key] = n
  }
  if (scale_label !== undefined) {
    const label = String(scale_label ?? '').trim()
    if (label.length > 80) {
      return NextResponse.json({ error: 'scale_label must be 80 characters or fewer' }, { status: 400 })
    }
    updates.scale_label = label || null
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
