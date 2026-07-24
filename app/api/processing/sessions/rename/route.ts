export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST — rename a scanner session's customer, keeping the same date.
// Boxes carry no session id — they're keyed by customer_name + pack_date — so a
// rename is: re-point this session's boxes, processing_inputs, and the session
// record from old_name to new_name for the one session_date. Scans hang off
// box_id, so they follow their box automatically.
//
// If a session already exists under new_name on the same date this would collide
// two distinct sessions into one key; that's what Merge is for, so we refuse and
// say so rather than silently fusing them.
//
// Body: { session_date, old_name, new_name }
export async function POST(req: NextRequest) {
  const body = await req.json()
  const session_date = body?.session_date as string | undefined
  const old_name = typeof body?.old_name === 'string' ? body.old_name : undefined
  // Trim: a stray trailing space would split later boxes onto a phantom twin key
  const new_name = typeof body?.new_name === 'string' ? body.new_name.trim() : undefined

  if (!session_date || !old_name || !new_name) {
    return NextResponse.json({ error: 'session_date, old_name and new_name required' }, { status: 400 })
  }
  if (old_name === new_name) {
    return NextResponse.json({ ok: true, unchanged: true })
  }

  // Collision guard — does anything already live under the new key on this date?
  const [{ data: clashBoxes }, { data: clashSession }] = await Promise.all([
    supabase
      .from('boxes')
      .select('id')
      .eq('customer_name', new_name)
      .eq('pack_date', session_date)
      .limit(1),
    supabase
      .from('processing_sessions')
      .select('id')
      .eq('customer_name', new_name)
      .eq('session_date', session_date)
      .limit(1),
  ])
  if ((clashBoxes && clashBoxes.length) || (clashSession && clashSession.length)) {
    return NextResponse.json(
      { error: `A session for "${new_name}" already exists on ${session_date}. Use Merge to combine them.` },
      { status: 409 },
    )
  }

  // Re-key boxes
  const { error: bErr } = await supabase
    .from('boxes')
    .update({ customer_name: new_name })
    .eq('customer_name', old_name)
    .eq('pack_date', session_date)
  if (bErr) return NextResponse.json({ error: bErr.message }, { status: 500 })

  // Re-key inputs so yield math stays with the session
  const { error: iErr } = await supabase
    .from('processing_inputs')
    .update({ customer_name: new_name })
    .eq('customer_name', old_name)
    .eq('session_date', session_date)
  if (iErr) return NextResponse.json({ error: iErr.message }, { status: 500 })

  // Re-key the session record (may not exist — sessions can be boxes-only)
  const { error: sErr } = await supabase
    .from('processing_sessions')
    .update({ customer_name: new_name, updated_at: new Date().toISOString() })
    .eq('customer_name', old_name)
    .eq('session_date', session_date)
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  return NextResponse.json({ ok: true, customer_name: new_name })
}
