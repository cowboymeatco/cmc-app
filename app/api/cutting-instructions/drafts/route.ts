export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

export const dynamic = 'force-dynamic'

// Cutting-instruction DRAFTS — cards somebody started online and never
// submitted. The wizard autosaves into cutting_instruction_drafts and deletes
// the row when the real card inserts, so anything still here is a card that
// didn't make it (Wanda Gibson, 2026-09-28 — see
// scripts/2026-10-02_cutting_instruction_drafts.sql).
//
// Service role only: the browser roles can write a draft but never list them,
// because drafts carry names and phone numbers typed by customers.

// A draft touched in the last few minutes is somebody still typing, not an
// abandoned card. Only older ones are worth the office's attention.
const QUIET_MINUTES = 30

export type DraftSummary = {
  id: string
  created_at: string
  updated_at: string
  source: string
  species: string | null
  step: number
  step_label: string | null
  customer_name: string | null
  phone: string | null
  appointment_id: string | null
  customer_id: string | null
}

// GET /api/cutting-instructions/drafts — abandoned drafts, newest first.
//   ?all=1 includes ones still being typed (for debugging a live form).
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const all = searchParams.get('all') === '1'

  let query = supabaseAdmin
    .from('cutting_instruction_drafts')
    .select('id, created_at, updated_at, source, species, step, step_label, customer_name, phone, appointment_id, customer_id')
    .order('updated_at', { ascending: false })
  if (!all) {
    query = query.lt('updated_at', new Date(Date.now() - QUIET_MINUTES * 60_000).toISOString())
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json((data ?? []) as DraftSummary[])
}

// DELETE /api/cutting-instructions/drafts?id=... — the office dismissed it
// (took the card down another way, or it was a test). Hard delete: a draft is
// not a record of anything, and the purge would take it in 30 days anyway.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return NextResponse.json({ error: 'id (uuid) required' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('cutting_instruction_drafts').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
