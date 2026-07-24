export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/delivery
export async function GET() {
  const { data, error } = await supabase
    .from('delivery_scans')
    .select('*')
    .order('delivered_at', { ascending: false })

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/delivery â€” create a new delivery
export async function POST(req: NextRequest) {
  const body = await req.json()

  const destination: string = body.destination === 'baker_storage' ? 'baker_storage' : 'customer'
  const sessionRefs = Array.isArray(body.session_refs) ? body.session_refs : []

  const { data, error } = await supabase
    .from('delivery_scans')
    .insert([{
      delivered_at: body.delivered_at ?? new Date().toISOString(),
      driver:       body.driver ?? '',
      customer:     body.customer ?? '',
      barcodes:     body.barcodes ?? [],
      notes:        body.notes ?? '',
      status:       'pending',
      destination,
      session_refs: sessionRefs,
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Move every session that rode along to where the truck left it. A run to
  // Baker parks them in the locker; a run to the customer is a pickup.
  // Best-effort: the delivery is already logged, so a status hiccup here must
  // not fail the save — the scanner still lets you set it by hand.
  const newStatus = destination === 'baker_storage' ? 'baker_storage' : 'picked_up'
  const missed: string[] = []
  for (const ref of sessionRefs as { customer_name?: string; session_date?: string }[]) {
    if (!ref?.customer_name || !ref?.session_date) continue
    const { error: sErr } = await supabase
      .from('processing_sessions')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('customer_name', ref.customer_name)
      .eq('session_date', ref.session_date)
    if (sErr) missed.push(`${ref.customer_name} (${ref.session_date})`)
  }

  return NextResponse.json({ ...data, sessions_updated: sessionRefs.length - missed.length, sessions_missed: missed })
}

// PATCH /api/delivery â€” update a delivery (status, add barcodes, etc.)
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  const { data, error } = await supabase
    .from('delivery_scans')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
