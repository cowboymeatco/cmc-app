export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
// Service role, not the anon key: `customers` is under RLS (see
// scripts/2026-08-09_rls_customers_phase2_lockdown.sql), and this route is
// staff customer administration that legitimately reads and writes every row.
// The anon key cannot do that any more, and cmc-app has no signed-in user to
// derive an auth.uid() from. Server-side only — the key never reaches a browser.
import { supabaseAdmin as supabase } from '@/lib/supabaseAdmin'

// GET /api/customers
//   ?search=text   â€” search name / ranch_name / phone / email (for autocomplete)
//   ?id=UUID       â€” single customer + their cutting instructions + appointment count
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim()
  const id     = searchParams.get('id')

  // Single customer detail. appointments = ones where they're the producer
  // (live-animal side); cutting_instructions = their cut sheets (buyer side).
  if (id) {
    const [custRes, ciRes, apptRes] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      // Their account's sheets plus the ones they submitted under their own
      // phone/email — a sheet's customer_id is the account the animal is booked
      // under, so the person who filled the form out is often someone else.
      supabase.rpc('customer_cut_sheets', { p_customer_id: id }),
      supabase
        .from('harvest_appointments')
        .select('id, harvest_date, species, head_count, status, animal_description')
        .eq('producer_id', id)
        .order('harvest_date', { ascending: false }),
    ])
    if (custRes.error) return NextResponse.json({ error: custRes.error.message }, { status: 404 })
    return NextResponse.json({
      customer: custRes.data,
      cutting_instructions: ciRes.data ?? [],
      appointments: apptRes.data ?? [],
    })
  }

  // Search / list
  let query = supabase
    .from('customers')
    .select('*')
    .order('name', { ascending: true })
    .limit(200)

  if (search) {
    // ilike search across name, ranch_name, phone, email.
    // The value is double-quoted so commas and parens in a customer name
    // ("Larsen Ranch, Inc.") can't be parsed as filter syntax and break the query.
    const pattern = `"%${search.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}%"`
    query = query.or(
      `name.ilike.${pattern},ranch_name.ilike.${pattern},phone.ilike.${pattern},email.ilike.${pattern}`
    )
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Cut-sheet counts for the list's Cut Sheets column. Secondary: if this
  // read fails the list still serves, just without counts.
  const rows = (data ?? []) as (Record<string, unknown> & { id: string })[]
  if (rows.length > 0) {
    // Counted the same way the detail view lists them, so the column can't
    // promise a number the record then fails to show.
    const { data: cis } = await supabase.rpc('customer_cut_sheet_counts')
    const counts = new Map<string, number>()
    for (const row of (cis ?? []) as { customer_id: string; cut_sheets: number }[]) {
      counts.set(row.customer_id, Number(row.cut_sheets))
    }
    for (const c of rows) c.cut_sheet_count = counts.get(c.id) ?? 0
  }

  return NextResponse.json(rows)
}

// POST /api/customers â€” create a new customer record
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase
    .from('customers')
    .insert([{
      name:              body.name              ?? '',
      ranch_name:        body.ranch_name        ?? '',
      phone:             body.phone             ?? '',
      email:             body.email             ?? '',
      preferred_contact: body.preferred_contact ?? 'Phone Call',
      notes:             body.notes             ?? '',
    }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/customers â€” update customer fields
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { data, error } = await supabase
    .from('customers')
    .update(updates)
    .eq('id', id)
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/customers?id=UUID
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('customers').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
