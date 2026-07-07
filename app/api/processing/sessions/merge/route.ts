export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST — merge one scanner session into another.
// Boxes carry no session id — they're keyed by customer_name + pack_date — so a
// merge is: re-point the source's boxes (and processing_inputs) at the target's
// key, renumber the boxes to continue after the target's highest, then drop the
// now-empty source session record. Scans hang off box_id, so they follow their
// box automatically.
// Body: { source: { customer_name, session_date }, target: { customer_name, session_date } }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { source, target } = body as {
    source?: { customer_name?: string; session_date?: string }
    target?: { customer_name?: string; session_date?: string }
  }
  if (!source?.customer_name || !source?.session_date || !target?.customer_name || !target?.session_date) {
    return NextResponse.json({ error: 'source and target {customer_name, session_date} required' }, { status: 400 })
  }
  if (source.customer_name === target.customer_name && source.session_date === target.session_date) {
    return NextResponse.json({ error: 'source and target are the same session' }, { status: 400 })
  }

  // Highest box number already in the target — moved boxes continue after it
  const { data: targetBoxes, error: tErr } = await supabase
    .from('boxes')
    .select('box_number')
    .eq('customer_name', target.customer_name)
    .eq('pack_date', target.session_date)
  if (tErr) return NextResponse.json({ error: tErr.message }, { status: 500 })
  let nextNum = (targetBoxes ?? []).reduce((m, b) => Math.max(m, Number(b.box_number) || 0), 0) + 1

  // Source boxes in box-number order so they keep their relative order
  const { data: sourceBoxes, error: sErr } = await supabase
    .from('boxes')
    .select('id, box_number')
    .eq('customer_name', source.customer_name)
    .eq('pack_date', source.session_date)
    .order('box_number', { ascending: true })
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  for (const box of sourceBoxes ?? []) {
    const { error } = await supabase
      .from('boxes')
      .update({ customer_name: target.customer_name, pack_date: target.session_date, box_number: nextNum })
      .eq('id', box.id)
    if (error) return NextResponse.json({ error: `box ${box.id}: ${error.message}` }, { status: 500 })
    nextNum++
  }

  // Inputs are keyed the same way — move them so yield math stays with the session
  const { error: iErr } = await supabase
    .from('processing_inputs')
    .update({ customer_name: target.customer_name, session_date: target.session_date, pack_date: target.session_date })
    .eq('customer_name', source.customer_name)
    .eq('session_date', source.session_date)
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })

  // Fold the source session record into the target before deleting it.
  // Either record may be missing (sessions can exist as boxes only).
  const { data: srcSession } = await supabase
    .from('processing_sessions')
    .select('id, status, notes')
    .eq('customer_name', source.customer_name)
    .eq('session_date', source.session_date)
    .maybeSingle()
  const { data: tgtSession } = await supabase
    .from('processing_sessions')
    .select('id, notes')
    .eq('customer_name', target.customer_name)
    .eq('session_date', target.session_date)
    .maybeSingle()

  if (srcSession && tgtSession && srcSession.notes) {
    const merged = tgtSession.notes ? `${tgtSession.notes}\n${srcSession.notes}` : srcSession.notes
    await supabase
      .from('processing_sessions')
      .update({ notes: merged, updated_at: new Date().toISOString() })
      .eq('id', tgtSession.id)
  } else if (srcSession && !tgtSession) {
    // Target has no record yet — carry the source's status/notes over to it
    await supabase
      .from('processing_sessions')
      .upsert(
        [{ customer_name: target.customer_name, session_date: target.session_date, status: srcSession.status, notes: srcSession.notes, updated_at: new Date().toISOString() }],
        { onConflict: 'customer_name,session_date' }
      )
  }

  if (srcSession) {
    const { error: dErr } = await supabase
      .from('processing_sessions')
      .delete()
      .eq('id', srcSession.id)
    if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
  }

  return NextResponse.json({ ok: true, boxes_moved: (sourceBoxes ?? []).length })
}
