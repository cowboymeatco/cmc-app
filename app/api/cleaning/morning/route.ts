export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  shiftProgress, preopFor, hoursBetween,
  type CleaningShiftItem, type Priority,
} from '@/lib/cleaning'
import { closeStaleShifts, crewNamed, type ShiftRow } from '@/lib/cleaningShiftServer'

// GET /api/cleaning/morning — last night, for the first cutter in.
//
// Returns the most recent shift on file with everything the morning needs:
// how the night went (P1 time, hours, who), the items that rolled, and the
// pre-op deadline they have to beat. Loading this also closes any shift still
// open past 3 AM, so the morning view never shows a night as "still going"
// because a cron didn't fire.

export async function GET() {
  const autoClosed = await closeStaleShifts()

  const { data: shift, error } = await supabase
    .from('cleaning_shifts').select('*')
    .order('shift_date', { ascending: false }).limit(1).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!shift) return NextResponse.json({ shift: null, rolled: [], finished_am: [], crew: [] })

  const s = shift as ShiftRow
  const [{ data: itemRows }, crew] = await Promise.all([
    supabase.from('cleaning_shift_items').select('*')
      .eq('shift_id', s.id).order('sort_order', { ascending: true }),
    crewNamed(s.crew_ids),
  ])
  const items = (itemRows ?? []) as CleaningShiftItem[]

  const rolled = items.filter(i => i.status === 'rolled')
  // Picked up after close — the morning's own work, shown struck through so
  // the cutter can see what's already been dealt with.
  const finishedAM = items.filter(i =>
    (i.status === 'done' || i.status === 'na') &&
    i.done_at && s.closed_at && i.done_at > s.closed_at,
  )

  const preop = preopFor(s.shift_date, s.preop_time)
  const tiers = {} as Record<Priority, ReturnType<typeof shiftProgress>>
  for (const p of [1, 2, 3] as Priority[]) tiers[p] = shiftProgress(items.filter(i => i.priority === p))

  return NextResponse.json({
    shift:       s,
    crew,
    rolled,
    finished_am: finishedAM,
    tiers,
    hours:       hoursBetween(s.started_at, s.closed_at),
    preop_at:    preop.toISOString(),
    past_preop:  Date.now() >= preop.getTime() && rolled.length > 0,
    auto_closed: autoClosed,
  })
}
