export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST — tip one box into another (Jill, 2026-09-10: "Merge boxes option?").
//
// Two half-full boxes at the end of a session become one box on the pallet, and
// the record has to follow the meat: every scan line moves to the box that's
// actually holding it, the target re-weighs itself off those lines, and the
// emptied box is deleted. Nothing is renumbered — the other boxes' numbers are
// already printed on their labels — so the session simply loses a number, the
// same way it does when a box is reassigned away.
//
// Same session only. Moving meat between two customers' boxes isn't a merge,
// it's a mis-pack, and the fix for that is Reassign.
//
// Body: { source_box_id, target_box_id }
const COLS = 'id, customer_name, pack_date, box_number, is_closed, serial_number, total_weight_lbs, total_cuts, picked_up_at, delivery_id, box_label'

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const sourceId = String(body?.source_box_id ?? '')
  const targetId = String(body?.target_box_id ?? '')

  if (!sourceId || !targetId) {
    return NextResponse.json({ error: 'source_box_id and target_box_id required' }, { status: 400 })
  }
  if (sourceId === targetId) {
    return NextResponse.json({ error: 'a box cannot be merged into itself' }, { status: 400 })
  }

  const { data: rows, error } = await supabase.from('boxes').select(COLS).in('id', [sourceId, targetId])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const source = (rows ?? []).find(b => b.id === sourceId)
  const target = (rows ?? []).find(b => b.id === targetId)
  if (!source) return NextResponse.json({ error: 'source box not found' }, { status: 404 })
  if (!target) return NextResponse.json({ error: 'target box not found' }, { status: 404 })

  if (source.customer_name !== target.customer_name || source.pack_date !== target.pack_date) {
    return NextResponse.json(
      { error: 'Those boxes are in different sessions — reassign one over first.' },
      { status: 409 },
    )
  }

  // A box that already left the building isn't ours to take apart.
  for (const b of [source, target]) {
    if (b.picked_up_at) {
      return NextResponse.json({ error: `Box ${b.box_number} was already picked up — it can't be merged.` }, { status: 409 })
    }
    if (b.delivery_id) {
      return NextResponse.json({ error: `Box ${b.box_number} is loaded on a delivery — pull it off the load first.` }, { status: 409 })
    }
  }

  // Move the lines. box_scans hang off box_id, so this is the whole move.
  const { data: moved, error: mErr } = await supabase
    .from('box_scans')
    .update({ box_id: targetId })
    .eq('box_id', sourceId)
    .select('id')
  if (mErr) return NextResponse.json({ error: mErr.message }, { status: 500 })

  // Re-weigh the target off its lines, never off the two cached headers — the
  // headers are snapshots and the lines are the truth (same rule as closing).
  const { data: lines, error: lErr } = await supabase
    .from('box_scans')
    .select('weight_lbs, quantity')
    .eq('box_id', targetId)
  if (lErr) return NextResponse.json({ error: lErr.message }, { status: 500 })

  const total_weight_lbs = Math.round((lines ?? []).reduce((s, l) => s + (Number(l.weight_lbs) || 0), 0) * 100) / 100
  const total_cuts       = (lines ?? []).reduce((s, l) => s + (Number(l.quantity) || 1), 0)

  const { data: updated, error: uErr } = await supabase
    .from('boxes')
    .update({ total_weight_lbs, total_cuts })
    .eq('id', targetId)
    .select(COLS)
    .single()
  if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })

  // The emptied box goes away — keeping it would leave an empty box on the
  // pallet count and a second label for meat that's in the other box now.
  const { error: dErr } = await supabase.from('boxes').delete().eq('id', sourceId)
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })

  return NextResponse.json({
    ok: true,
    box: updated,
    moved_scans: (moved ?? []).length,
    source: { box_number: source.box_number, serial_number: source.serial_number, was_closed: source.is_closed },
  })
}
