export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST — move a single box (scans follow via box_id) to another session.
// The box takes the next box number in the target; the source's remaining boxes
// keep their numbers, since those may already be printed on closed-box labels.
// Body: { box_id, target: { customer_name, session_date } }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { box_id, target } = body as {
    box_id?: string
    target?: { customer_name?: string; session_date?: string }
  }
  if (!box_id || !target?.customer_name || !target?.session_date) {
    return NextResponse.json({ error: 'box_id and target {customer_name, session_date} required' }, { status: 400 })
  }

  const { data: box, error: bErr } = await supabase
    .from('boxes')
    .select('id, customer_name, pack_date')
    .eq('id', box_id)
    .maybeSingle()
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })
  if (!box) return NextResponse.json({ error: 'box not found' }, { status: 404 })
  if (box.customer_name === target.customer_name && box.pack_date === target.session_date) {
    return NextResponse.json({ error: 'box is already in that session' }, { status: 400 })
  }

  // Next box number in the target session
  const { data: targetBoxes, error: tErr } = await supabase
    .from('boxes')
    .select('box_number')
    .eq('customer_name', target.customer_name)
    .eq('pack_date', target.session_date)
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  const nextNum = (targetBoxes ?? []).reduce((m, b) => Math.max(m, Number(b.box_number) || 0), 0) + 1

  const { data: updated, error: uErr } = await supabase
    .from('boxes')
    .update({ customer_name: target.customer_name, pack_date: target.session_date, box_number: nextNum })
    .eq('id', box_id)
    .select()
    .single()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  // Make sure the target shows up as a session — but never clobber an existing
  // record's status, so reassigning into a value_add session leaves it value_add.
  const { data: tgtSession } = await supabase
    .from('processing_sessions')
    .select('id')
    .eq('customer_name', target.customer_name)
    .eq('session_date', target.session_date)
    .maybeSingle()
  if (!tgtSession) {
    await supabase
      .from('processing_sessions')
      .upsert(
        [{ customer_name: target.customer_name, session_date: target.session_date, status: 'scanning', notes: '', updated_at: new Date().toISOString() }],
        { onConflict: 'customer_name,session_date' }
      )
  }

  return NextResponse.json(updated)
}
