export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate } from '@/lib/dates'
import {
  buildShiftItems, shiftDateFor,
  type CleaningTask, type ProductionSignal, type BuiltItem,
} from '@/lib/cleaning'

// GET  /api/cleaning/shift?date=YYYY-MM-DD  → the night's shift and its items,
//                                             building it on first open
// POST /api/cleaning/shift                  → close (or reopen) a shift
//
// The list is built once, on the first open of the night, and then it is the
// record. It is not recomputed on every load: if someone edits a task template
// at 11pm, tonight's crew should not watch items appear and disappear under
// their thumbs. `refresh=1` re-runs the builder and ADDS anything newly due
// without touching what's already been answered — that's the escape hatch for
// "we started grinding after the list was built".

/**
 * What kinds of production actually happened on `dateISO`.
 *
 * Each signal is a record the app already keeps, queried with a limit of 1 —
 * the question is only ever "did any of this happen", never how much.
 */
async function getProductionSignals(dateISO: string): Promise<ProductionSignal[]> {
  const [harvest, cut, pack, smoke] = await Promise.all([
    supabase.from('harvest_log').select('id').eq('harvest_date', dateISO).limit(1),
    supabase.from('cut_schedule_items').select('id').eq('schedule_date', dateISO).limit(1),
    supabase.from('boxes').select('id').eq('pack_date', dateISO).limit(1),
    supabase.from('smokehouse_cook').select('id')
      .gte('started_at', `${dateISO}T00:00:00`)
      .lt('started_at',  `${dateISO}T23:59:59`)
      .limit(1),
  ])

  const signals: ProductionSignal[] = []
  if (harvest.data?.length) signals.push('harvest')
  if (cut.data?.length)     signals.push('cut')
  if (pack.data?.length)    signals.push('package')
  if (smoke.data?.length)   signals.push('smoke')
  return signals
}

/** task_id → the last date that task was completed on any earlier shift. */
async function getLastDone(beforeISO: string): Promise<Record<string, string>> {
  // Ordered oldest-first so the later assignment into the map wins, leaving the
  // most recent completion per task.
  const { data } = await supabase
    .from('cleaning_shift_items')
    .select('task_id, done_at, cleaning_shifts!inner(shift_date)')
    .eq('status', 'done')
    .not('task_id', 'is', null)
    .lt('cleaning_shifts.shift_date', beforeISO)
    .order('done_at', { ascending: true })
    .limit(4000)

  const last: Record<string, string> = {}
  type Row = { task_id: string; cleaning_shifts: { shift_date: string } | { shift_date: string }[] }
  for (const row of (data ?? []) as unknown as Row[]) {
    const shift = Array.isArray(row.cleaning_shifts) ? row.cleaning_shifts[0] : row.cleaning_shifts
    if (shift?.shift_date) last[row.task_id] = shift.shift_date
  }
  return last
}

async function buildFor(dateISO: string): Promise<{ items: BuiltItem[]; signals: ProductionSignal[] }> {
  const [tasksRes, areasRes, equipRes, signals, lastDone] = await Promise.all([
    supabase.from('cleaning_tasks').select('*').eq('active', true),
    supabase.from('cleaning_areas').select('id, name, sort_order').eq('active', true),
    supabase.from('cleaning_equipment').select('id, name').eq('active', true),
    getProductionSignals(dateISO),
    getLastDone(dateISO),
  ])

  const items = buildShiftItems({
    dateISO,
    tasks:     (tasksRes.data ?? []) as CleaningTask[],
    areas:     areasRes.data ?? [],
    equipment: equipRes.data ?? [],
    signals,
    lastDone,
  })
  return { items, signals }
}

export async function GET(req: NextRequest) {
  const url     = new URL(req.url)
  const refresh = url.searchParams.get('refresh') === '1'
  // Read-only mode. Opening a shift is a real event — it stamps the night and
  // freezes its list — so callers that are only displaying a count (the
  // dashboard tile) must not cause one just by rendering.
  const peek    = url.searchParams.get('peek') === '1'
  // No date given means "the shift happening right now", which before 4am is
  // still yesterday's cleanup — see shiftDateFor.
  const dateISO = url.searchParams.get('date') || shiftDateFor(new Date(), isoDate())

  const { data: existing, error: findErr } = await supabase
    .from('cleaning_shifts')
    .select('*')
    .eq('shift_date', dateISO)
    .maybeSingle()
  if (findErr) return NextResponse.json({ error: findErr.message }, { status: 500 })

  let shift = existing

  if (!shift && peek) {
    return NextResponse.json({ shift: null, items: [], photos: [] })
  }

  if (!shift) {
    const { items, signals } = await buildFor(dateISO)

    const { data: created, error: createErr } = await supabase
      .from('cleaning_shifts')
      .insert([{ shift_date: dateISO, production_seen: signals }])
      .select()
      .single()
    // A unique-violation means another phone opened the same night a moment
    // ago. That's a race, not an error — fall through to reading theirs.
    if (createErr && createErr.code !== '23505') {
      return NextResponse.json({ error: createErr.message }, { status: 500 })
    }

    if (created) {
      shift = created
      if (items.length) {
        const { error: itemsErr } = await supabase
          .from('cleaning_shift_items')
          .insert(items.map(i => ({ ...i, shift_id: created.id })))
        if (itemsErr) return NextResponse.json({ error: itemsErr.message }, { status: 500 })
      }
    } else {
      const { data: raced } = await supabase
        .from('cleaning_shifts').select('*').eq('shift_date', dateISO).single()
      shift = raced
    }
  } else if (refresh && !peek) {
    // Add what's newly due; never remove or reset what the crew already
    // answered. Matching on task_id is what makes this safe to hit twice.
    const { items } = await buildFor(dateISO)
    const { data: have } = await supabase
      .from('cleaning_shift_items').select('task_id').eq('shift_id', shift.id)
    const seen  = new Set((have ?? []).map(r => r.task_id).filter(Boolean))
    const fresh = items.filter(i => i.task_id && !seen.has(i.task_id))
    if (fresh.length) {
      await supabase.from('cleaning_shift_items')
        .insert(fresh.map(i => ({ ...i, shift_id: shift!.id })))
    }
  }

  if (!shift) return NextResponse.json({ error: 'could not open a shift' }, { status: 500 })

  const [itemsRes, photosRes] = await Promise.all([
    supabase.from('cleaning_shift_items').select('*')
      .eq('shift_id', shift.id).order('sort_order', { ascending: true }),
    supabase.from('cleaning_photos').select('*')
      .eq('shift_id', shift.id).order('created_at', { ascending: true }),
  ])

  return NextResponse.json({
    shift,
    items:  itemsRes.data  ?? [],
    photos: photosRes.data ?? [],
  })
}

// Close out the night, or reopen one that was closed too early.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { shift_id, action, by, notes } = body as {
    shift_id?: string; action?: string; by?: string; notes?: string
  }
  if (!shift_id) return NextResponse.json({ error: 'shift_id required' }, { status: 400 })

  if (action === 'reopen') {
    const { data, error } = await supabase
      .from('cleaning_shifts')
      .update({ status: 'open', closed_at: null, closed_by: null })
      .eq('id', shift_id).select().single()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (!by?.trim()) {
    return NextResponse.json({ error: 'who is closing the shift is required' }, { status: 400 })
  }

  // Closing with items still unanswered is allowed but reported back, so the
  // lead sees the number rather than discovering it in the morning.
  const { data: items } = await supabase
    .from('cleaning_shift_items').select('status').eq('shift_id', shift_id)
  const pending = (items ?? []).filter(i => i.status === 'pending').length

  const { data, error } = await supabase
    .from('cleaning_shifts')
    .update({
      status:    'closed',
      closed_at: new Date().toISOString(),
      closed_by: by.trim(),
      notes:     notes?.trim() || null,
    })
    .eq('id', shift_id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ ...data, pending_at_close: pending })
}
