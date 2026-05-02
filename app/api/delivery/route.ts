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

// POST /api/delivery — create a new delivery
export async function POST(req: NextRequest) {
  const body = await req.json()

  const { data, error } = await supabase
    .from('delivery_scans')
    .insert([{
      delivered_at: body.delivered_at ?? new Date().toISOString(),
      driver:       body.driver ?? '',
      customer:     body.customer ?? '',
      barcodes:     body.barcodes ?? [],
      notes:        body.notes ?? '',
      status:       'pending',
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/delivery — update a delivery (status, add barcodes, etc.)
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
