export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/customers
//   ?search=text   â€” search name / ranch_name / phone / email (for autocomplete)
//   ?id=UUID       â€” single customer + their cutting instructions + appointment count
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim()
  const id     = searchParams.get('id')

  // Single customer detail
  if (id) {
    const [custRes, ciRes] = await Promise.all([
      supabase.from('customers').select('*').eq('id', id).single(),
      supabase
        .from('cutting_instructions')
        .select('*')
        .eq('customer_id', id)
        .order('created_at', { ascending: false }),
    ])
    if (custRes.error) return NextResponse.json({ error: custRes.error.message }, { status: 404 })
    return NextResponse.json({ customer: custRes.data, cutting_instructions: ciRes.data ?? [] })
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
  return NextResponse.json(data)
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
