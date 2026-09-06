export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'
import { shiftDateFor, defaultAssignments } from '@/lib/cleaning'
import {
  buildFor, startShift, closeShift, crewNamed, type ShiftRow,
} from '@/lib/cleaningShiftServer'

// GET  /api/cleaning/shift?date=YYYY-MM-DD  → the night's shift and its items,
//                                             or shift:null if nobody has
//                                             started it
// POST /api/cleaning/shift                  → start / update / close / reopen
//
// A shift is opened by a person pressing "Start shift", and by nothing else.
// The old behaviour — build the night the first time anyone loaded the page —
// produced shifts stamped 6 AM, 10 AM, 3 PM, none of them ever closed, and a
// started_at that meant nothing. Now started_at is when the crew clocked on,
// which is the number the hours review is built on.
//
// The list is built once, at start, and then it is the record. `refresh=1`
// re-runs the builder and ADDS anything newly due without touching what's
// already been answered — the escape hatch for "we started grinding after
// the list was built".

async function payload(shift: ShiftRow) {
  const [itemsRes, photosRes, crew] = await Promise.all([
    supabase.from('cleaning_shift_items').select('*')
      .eq('shift_id', shift.id).order('sort_order', { ascending: true }),
    supabase.from('cleaning_photos').select('*')
      .eq('shift_id', shift.id).order('created_at', { ascending: true }),
    crewNamed(shift.crew_ids),
  ])
  return { shift, items: itemsRes.data ?? [], photos: photosRes.data ?? [], crew }
}

export async function GET(req: NextRequest) {
  const url     = new URL(req.url)
  const refresh = url.searchParams.get('refresh') === '1'
  // No date given means "the shift happening right now", which before 4am is
  // still yesterday's cleanup — see shiftDateFor.
  const dateISO = url.searchParams.get('date') || shiftDateFor(new Date(), isoDate())

  const { data: shift, error: findErr } = await supabase
    .from('cleaning_shifts')
    .select('*')
    .eq('shift_date', dateISO)
    .maybeSingle()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })

  if (!shift) {
    return NextResponse.json({ shift: null, items: [], photos: [], crew: [], date: dateISO })
  }

  if (refresh && shift.status === 'open') {
    // Add what's newly due; never remove or reset what the crew already
    // answered. Matching on task_id is what makes this safe to hit twice.
    const { items } = await buildFor(dateISO)
    const { data: have } = await supabase
      .from('cleaning_shift_items').select('task_id').eq('shift_id', shift.id)
    const seen  = new Set((have ?? []).map(r => r.task_id).filter(Boolean))
    const fresh = items.filter(i => i.task_id && !seen.has(i.task_id))
    if (fresh.length) {
      await supabase.from('cleaning_shift_items')
        .insert(fresh.map(i => ({ ...i, shift_id: shift.id })))
    }
  }

  return NextResponse.json(await payload(shift as ShiftRow))
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const { shift_id, action, by, by_id, notes } = body as {
    shift_id?: string; action?: string; by?: string; by_id?: string; notes?: string
  }

  // ── Start ────────────────────────────────────────────────────────────
  if (action === 'start') {
    if (!by?.trim()) {
      return NextResponse.json({ error: 'Pick your name before starting the shift.' }, { status: 400 })
    }
    const dateISO = (body as { date?: string }).date || shiftDateFor(new Date(), isoDate())
    const raw     = (body as { crew_ids?: unknown }).crew_ids
    const crewIds = Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []
    // Whoever pressed the button is on shift even if they forgot to tick
    // themselves.
    if (by_id && !crewIds.includes(by_id)) crewIds.unshift(by_id)

    const res = await startShift(dateISO, by.trim(), crewIds)
    if ('error' in res) return NextResponse.json({ error: res.error }, { status: 500 })
    return NextResponse.json({ ...(await payload(res.shift)), created: res.created })
  }

  if (!shift_id) return NextResponse.json({ error: 'shift_id required' }, { status: 400 })

  // ── Update crew / split / pre-op ─────────────────────────────────────
  if (action === 'update') {
    const b = body as { crew_ids?: unknown; area_assignments?: unknown; preop_time?: unknown }
    const updates: Record<string, unknown> = {}

    if (Array.isArray(b.crew_ids)) {
      updates.crew_ids = b.crew_ids.filter((x): x is string => typeof x === 'string')
    }
    if (b.area_assignments && typeof b.area_assignments === 'object') {
      updates.area_assignments = b.area_assignments
    }
    if (typeof b.preop_time === 'string' && /^\d{2}:\d{2}(:\d{2})?$/.test(b.preop_time)) {
      updates.preop_time = b.preop_time
    }
    if (!Object.keys(updates).length) {
      return NextResponse.json({ error: 'nothing to update' }, { status: 400 })
    }

    // A crew change without an explicit split re-deals the default split, so
    // a second person checking in late gets the B side without another tap.
    if (updates.crew_ids && !updates.area_assignments) {
      const { data: rows } = await supabase
        .from('cleaning_shift_items').select('area_name').eq('shift_id', shift_id)
      const areas = [...new Set((rows ?? []).map(r => r.area_name as string))]
      updates.area_assignments = defaultAssignments(updates.crew_ids as string[], areas)
    }

    const { data, error } = await supabase
      .from('cleaning_shifts').update(updates).eq('id', shift_id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ...data, crew: await crewNamed(data.crew_ids) })
  }

  // ── Reopen ───────────────────────────────────────────────────────────
  if (action === 'reopen') {
    const { data, error } = await supabase
      .from('cleaning_shifts')
      .update({ status: 'open', closed_at: null, closed_by: null })
      .eq('id', shift_id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    // Anything that rolled at close and hasn't been picked up since comes
    // back onto the night's list.
    await supabase.from('cleaning_shift_items')
      .update({ status: 'pending' }).eq('shift_id', shift_id).eq('status', 'rolled')
    return NextResponse.json({ ...data, crew: await crewNamed(data.crew_ids) })
  }

  // ── Close ────────────────────────────────────────────────────────────
  if (!by?.trim()) {
    return NextResponse.json({ error: 'who is closing the shift is required' }, { status: 400 })
  }
  const res = await closeShift(shift_id, by.trim(), notes !== undefined ? { notes } : {})
  if ('error' in res) return NextResponse.json({ error: res.error }, { status: 500 })

  // Closing with P1 still open is allowed but reported back, so the lead sees
  // the number rather than discovering it in the morning.
  return NextResponse.json({
    ...res.shift,
    crew:             await crewNamed(res.shift.crew_ids),
    rolled_count:     res.rolled,
    pending_at_close: res.pending_p1,
  })
}
