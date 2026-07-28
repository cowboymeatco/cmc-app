export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/cutting-instructions
//   ?ids_only=1 â€” return just [{ id }] rows. The cut schedule only needs an
//   existence check per id, and the full rows carry the whole form payload,
//   so this keeps the phone-facing response small as the table grows.
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
    .select(idsOnly ? 'id' : '*')
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
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { ids, status, customer_id } = body as { ids: string[]; status: string; customer_id?: string }

  const updates: { status: string; customer_id?: string } = { status }
  if (customer_id) updates.customer_id = customer_id

  const { error } = await supabase
    .from('cutting_instructions')
    .update(updates)
    .in('id', ids)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// Detach a card from everything that points at it: the appointment customer
// slot that owns the link, and the carcass-assignment snapshot that copies it.
// Deleting a card used to leave both behind, so the animal stayed "has
// instructions" and never came back to the link-to-appointment picker — the
// portion was stranded with no way to re-link it (Jill, 2026-07-28).
async function unlinkInstruction(id: string): Promise<string | null> {
  const { data: appts, error: findErr } = await supabase
    .from('harvest_appointments')
    .select('id, customers')
    .contains('customers', [{ linked_cutting_instruction_id: id }])
  if (findErr) return findErr.message

  for (const appt of appts ?? []) {
    // Blank, not null: a fresh customer slot carries '' and every "needs
    // instructions" check in the app is a falsy test, so '' is the shape that
    // already means unlinked.
    const customers = (appt.customers as Array<Record<string, unknown>> ?? []).map(c =>
      c?.linked_cutting_instruction_id === id ? { ...c, linked_cutting_instruction_id: '' } : c
    )
    const { error } = await supabase
      .from('harvest_appointments')
      .update({ customers })
      .eq('id', appt.id)
    if (error) return error.message
  }

  const { error: caErr } = await supabase
    .from('carcass_assignments')
    .update({ linked_cutting_instruction_id: null })
    .eq('linked_cutting_instruction_id', id)
  if (caErr) return caErr.message

  return null
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
  const unlinkErr = await unlinkInstruction(id)
  if (unlinkErr) return NextResponse.json({ error: unlinkErr }, { status: 500 })

  const { error } = await supabase
    .from('cutting_instructions')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
