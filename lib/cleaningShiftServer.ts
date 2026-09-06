import { supabase } from '@/lib/supabase'
import {
  buildShiftItems, autoCloseFor, p1Complete, defaultAssignments,
  type CleaningTask, type ProductionSignal, type BuiltItem, type Priority,
} from '@/lib/cleaning'

// Server-side shift lifecycle. Shared by the shift API, the morning view, and
// the 3 AM auto-close cron, so a shift closes the same way no matter who
// closes it — a person, the first cutter's phone loading the morning list, or
// the clock.

export interface ShiftRow {
  id: string
  shift_date: string
  status: 'open' | 'closed'
  started_at: string | null
  started_by: string | null
  closed_at: string | null
  closed_by: string | null
  production_seen: string[] | null
  notes: string | null
  p1_complete_at: string | null
  crew_ids: string[]
  area_assignments: Record<string, string>
  preop_time: string
}

export interface CrewName { id: string; name: string }

// ── Building a night's list ─────────────────────────────────────────────

/**
 * What kinds of production actually happened on `dateISO`.
 *
 * Each signal is a record the app already keeps, queried with a limit of 1 —
 * the question is only ever "did any of this happen", never how much.
 */
export async function getProductionSignals(dateISO: string): Promise<ProductionSignal[]> {
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

export async function buildFor(dateISO: string): Promise<{ items: BuiltItem[]; signals: ProductionSignal[] }> {
  const [tasksRes, areasRes, equipRes, signals, lastDone] = await Promise.all([
    supabase.from('cleaning_tasks').select('*').eq('active', true),
    supabase.from('cleaning_areas').select('id, name, sort_order').eq('active', true),
    supabase.from('assets').select('id, name').eq('active', true),
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

// ── Crew ────────────────────────────────────────────────────────────────

export async function crewNamed(ids: string[] | null | undefined): Promise<CrewName[]> {
  if (!ids?.length) return []
  const { data } = await supabase.from('cleaning_crew').select('id, name').in('id', ids)
  // Keep check-in order, not the database's.
  const byId = new Map((data ?? []).map(c => [c.id as string, c.name as string]))
  return ids.filter(id => byId.has(id)).map(id => ({ id, name: byId.get(id)! }))
}

// ── Starting ────────────────────────────────────────────────────────────

/**
 * Open the night. Builds the list, stamps who started it and who is on, and
 * lays down the default area split. A unique-violation means another phone
 * started the same night a moment ago — that's a race, not an error, so the
 * caller gets theirs.
 */
export async function startShift(
  dateISO: string, by: string, crewIds: string[],
): Promise<{ shift: ShiftRow; created: boolean } | { error: string }> {
  const { items, signals } = await buildFor(dateISO)
  const areasTonight = [...new Set(items.map(i => i.area_name))]

  const { data: created, error } = await supabase
    .from('cleaning_shifts')
    .insert([{
      shift_date:       dateISO,
      production_seen:  signals,
      started_at:       new Date().toISOString(),
      started_by:       by,
      crew_ids:         crewIds,
      area_assignments: defaultAssignments(crewIds, areasTonight),
    }])
    .select().single()

  if (error && error.code !== '23505') return { error: error.message }

  if (!created) {
    const { data: raced } = await supabase
      .from('cleaning_shifts').select('*').eq('shift_date', dateISO).single()
    if (!raced) return { error: 'could not open a shift' }
    return { shift: raced as ShiftRow, created: false }
  }

  if (items.length) {
    const { error: itemsErr } = await supabase
      .from('cleaning_shift_items')
      .insert(items.map(i => ({ ...i, shift_id: created.id })))
    if (itemsErr) return { error: itemsErr.message }
  }
  return { shift: created as ShiftRow, created: true }
}

// ── P1 stamp ────────────────────────────────────────────────────────────

/**
 * Keep cleaning_shifts.p1_complete_at honest against the items. Stamped the
 * first time every P1 item is done/na; cleared again if somebody un-ticks one.
 * Called after every write to a P1 item and once more at close.
 */
export async function stampP1(shiftId: string): Promise<string | null> {
  const [{ data: items }, { data: shift }] = await Promise.all([
    supabase.from('cleaning_shift_items').select('status, priority').eq('shift_id', shiftId).eq('priority', 1),
    supabase.from('cleaning_shifts').select('p1_complete_at').eq('id', shiftId).single(),
  ])
  const complete = p1Complete((items ?? []) as { status: 'pending' | 'done' | 'na' | 'issue' | 'rolled'; priority: Priority }[])
  const current  = (shift?.p1_complete_at as string | null) ?? null

  if (complete && !current) {
    const now = new Date().toISOString()
    await supabase.from('cleaning_shifts').update({ p1_complete_at: now }).eq('id', shiftId)
    return now
  }
  if (!complete && current) {
    await supabase.from('cleaning_shifts').update({ p1_complete_at: null }).eq('id', shiftId)
    return null
  }
  return current
}

// ── Closing ─────────────────────────────────────────────────────────────

export interface CloseResult { shift: ShiftRow; rolled: number; pending_p1: number }

/**
 * Close out the night. Open P2/P3 items roll to the morning; open P1 items
 * stay 'pending' so the miss is visible in the record rather than laundered
 * into a roll. `closedAt` is only ever supplied by the auto-close, which
 * stamps the 3 AM cutoff rather than whenever the cron happened to run.
 */
export async function closeShift(
  shiftId: string, by: string, opts: { closedAt?: Date; notes?: string } = {},
): Promise<CloseResult | { error: string }> {
  await stampP1(shiftId)

  const { data: rolledRows, error: rollErr } = await supabase
    .from('cleaning_shift_items')
    .update({ status: 'rolled' })
    .eq('shift_id', shiftId).eq('status', 'pending').in('priority', [2, 3])
    .select('id')
  if (rollErr) return { error: rollErr.message }

  const { data: p1Open } = await supabase
    .from('cleaning_shift_items').select('id')
    .eq('shift_id', shiftId).eq('status', 'pending').eq('priority', 1)

  const updates: Record<string, unknown> = {
    status:    'closed',
    closed_at: (opts.closedAt ?? new Date()).toISOString(),
    closed_by: by,
  }
  if (opts.notes !== undefined) updates.notes = opts.notes.trim() || null

  const { data, error } = await supabase
    .from('cleaning_shifts').update(updates).eq('id', shiftId).select().single()
  if (error) return { error: error.message }

  return { shift: data as ShiftRow, rolled: rolledRows?.length ?? 0, pending_p1: p1Open?.length ?? 0 }
}

/**
 * Close anything still open past its 3 AM cutoff, as 'system'. Idempotent and
 * cheap, so it runs from the cron AND from the morning view's load — the
 * cutter's phone at 6 AM is a perfectly good clock if the cron never fired.
 */
export async function closeStaleShifts(now: Date = new Date()): Promise<{ shift_date: string; rolled: number }[]> {
  const { data: open } = await supabase
    .from('cleaning_shifts').select('id, shift_date').eq('status', 'open')

  const closed: { shift_date: string; rolled: number }[] = []
  for (const s of open ?? []) {
    const cutoff = autoCloseFor(s.shift_date as string)
    if (now.getTime() < cutoff.getTime()) continue
    const res = await closeShift(s.id as string, 'system', { closedAt: cutoff })
    if ('error' in res) continue
    closed.push({ shift_date: s.shift_date as string, rolled: res.rolled })
  }
  return closed
}
