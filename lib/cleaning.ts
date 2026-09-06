// Cleaning & sanitation — shared types and the logic that decides what is on
// tonight's list.
//
// The whole point of this module is that "what needs cleaning tonight" is a
// derived answer, not a stored one, and it has to be derivable the same way on
// the server (building the shift) and in the admin screen (previewing what a
// task will do). Two rules combine:
//
//   1. FREQUENCY — daily every night; weekly on its weekday; monthly on its
//      day of the month. Anything that came due and was missed stays due.
//   2. PRODUCTION — a task can name the kinds of work that dirty it. If none
//      of those happened today, it doesn't clutter the list.
//
// A task has to pass both to land on the list.

import { addDaysISO, dayOfWeekISO, daysBetweenISO } from '@/lib/dates'

// ── Production signals ──────────────────────────────────────────────────

/**
 * The kinds of production that can pull equipment onto the night's list.
 *
 * This list is deliberately short: it is exactly the set the app can PROVE
 * happened from records it already keeps. Grinding and stuffing are notably
 * absent — value_add_jobs is effectively unused (one row), so a task triggered
 * on "grind" would silently never appear, which is worse than not offering the
 * trigger at all. Equipment whose use we can't detect belongs on a daily task
 * or gets added by hand on the night.
 */
export const PRODUCTION_SIGNALS = ['harvest', 'cut', 'package', 'smoke'] as const
export type ProductionSignal = typeof PRODUCTION_SIGNALS[number]

export const SIGNAL_LABEL: Record<ProductionSignal, string> = {
  harvest: 'Harvest floor',
  cut:     'Cutting & breaking',
  package: 'Packaging',
  smoke:   'Smokehouse',
}

/** How each signal is proven, shown in the admin screen so the rule is legible. */
export const SIGNAL_SOURCE: Record<ProductionSignal, string> = {
  harvest: 'an animal logged on harvest_date',
  cut:     'a carcass or break on the cut schedule',
  package: 'a box packed on pack_date',
  smoke:   'a cook that started that day',
}

// ── Frequency ───────────────────────────────────────────────────────────

export const FREQUENCIES = ['daily', 'weekly', 'monthly', 'quarterly'] as const
export type Frequency = typeof FREQUENCIES[number]

// ── Priority tiers ──────────────────────────────────────────────────────
//
// The list is a forcing function, not a wish list. P1 is what the plant
// cannot open without; it has to be finished inside the shift. P2 is done as
// time allows. P3 is restoration work that is allowed to spill over to the
// first cutter in the morning. The tier lives on the task AND is copied to
// every shift item, so the night's record keeps the tier it was judged by.

export type Priority = 1 | 2 | 3
export const PRIORITIES: Priority[] = [1, 2, 3]

export const PRIORITY_LABEL: Record<Priority, string> = {
  1: 'Must finish tonight',
  2: 'As time allows',
  3: 'Rolls to the morning',
}

export const PRIORITY_BLURB: Record<Priority, string> = {
  1: 'Anything product touches, the defect check, building secure.',
  2: 'Floors, drains, walls, sinks, coolers, trash, bathrooms.',
  3: 'Pens, skid steer, rugs, shelves, sidewalk, office, tidy-up.',
}

export const PHASES = ['teardown', 'clean', 'reassemble'] as const
export type Phase = typeof PHASES[number]

export const PHASE_LABEL: Record<Phase, string> = {
  teardown:   'Take apart',
  clean:      'Clean',
  reassemble: 'Put back together',
}

// 'rolled' is what a P2/P3 item becomes when the shift closes around it: not
// done, not skipped, handed to the first cutter in the morning.
export type ItemStatus  = 'pending' | 'done' | 'na' | 'issue' | 'rolled'
export type ItemSource  = 'scheduled' | 'production' | 'issue' | 'manual'
export type InputType   = 'none' | 'number' | 'text'
export type IssueIntent = 'heads_up' | 'miss'

// ── Row shapes ──────────────────────────────────────────────────────────

export interface CleaningArea {
  id: string
  name: string
  sort_order: number
  active: boolean
  notes: string | null
}

export interface CleaningEquipment {
  id: string
  area_id: string
  name: string
  make_model: string | null
  sort_order: number
  active: boolean
  notes: string | null
}

export interface CleaningStep {
  id: string
  asset_id: string
  phase: Phase
  step_no: number
  instruction: string
  photo_url: string | null
  video_url: string | null
  caution: string | null
  translations: Record<string, string>
}

export interface CleaningTask {
  id: string
  area_id: string
  asset_id: string | null
  title: string
  detail: string | null
  sort_order: number
  active: boolean
  frequency: Frequency
  weekday: number | null
  day_of_month: number | null
  production_triggers: string[] | null
  requires_photo: boolean
  input_type: InputType
  input_label: string | null
  input_unit: string | null
  input_min: number | null
  input_max: number | null
  priority: Priority
}

export interface CleaningShiftItem {
  id: string
  shift_id: string
  task_id: string | null
  asset_id: string | null
  title: string
  detail: string | null
  area_name: string
  equipment_name: string | null
  requires_photo: boolean
  input_type: InputType
  input_label: string | null
  input_unit: string | null
  input_min: number | null
  input_max: number | null
  source: ItemSource
  sort_order: number
  priority: Priority
  status: ItemStatus
  done_by_id: string | null
  done_by: string | null
  done_at: string | null
  note: string | null
  value_num: number | null
  value_text: string | null
}

// ── Due logic ───────────────────────────────────────────────────────────

/**
 * Is `task` due on `dateISO`, given when it was last completed?
 *
 * `lastDoneISO` is the last date a shift item for this task was marked done —
 * null if it never has been. It is what makes a missed weekly stay on the list
 * instead of vanishing until its weekday comes round again, which is the whole
 * reason a deep-clean schedule is worth having.
 */
export function isDue(
  task: Pick<CleaningTask, 'frequency' | 'weekday' | 'day_of_month'>,
  dateISO: string,
  lastDoneISO: string | null,
): boolean {
  if (task.frequency === 'daily') return true

  // Never done: due the first time it's asked about. Better to put it in front
  // of someone on night one than to wait for a cycle boundary that may be
  // three months out.
  if (!lastDoneISO) return true

  const sinceDone = daysBetweenISO(lastDoneISO, dateISO)
  if (sinceDone <= 0) return false   // already done today

  switch (task.frequency) {
    case 'weekly': {
      // A weekday-pinned task is due on that day, and stays due afterwards
      // until someone does it. An unpinned weekly is simply due 7 days on.
      if (task.weekday === null) return sinceDone >= 7
      return sinceDone >= 7 || dayOfWeekISO(dateISO) === task.weekday
    }
    case 'monthly':
      if (task.day_of_month === null) return sinceDone >= 30
      return sinceDone >= 28 && dayOfMonth(dateISO) >= task.day_of_month
    case 'quarterly':
      return sinceDone >= 90
    default:
      return true
  }
}

/**
 * How overdue a task is, in days past its interval — 0 when it's due right on
 * schedule. Drives the "3 days overdue" nag in the UI, which is the difference
 * between a schedule people follow and one they drift off.
 */
export function overdueDays(
  task: Pick<CleaningTask, 'frequency'>,
  dateISO: string,
  lastDoneISO: string | null,
): number {
  if (task.frequency === 'daily' || !lastDoneISO) return 0
  const interval = { weekly: 7, monthly: 30, quarterly: 90 }[task.frequency] ?? 0
  return Math.max(0, daysBetweenISO(lastDoneISO, dateISO) - interval)
}

function dayOfMonth(iso: string): number {
  return Number(iso.slice(8, 10))
}

/**
 * Does today's production mean this task applies?
 *
 * No triggers = always applies. Otherwise at least one of its triggers has to
 * have actually happened. `signals` comes from getProductionSignals().
 */
export function matchesProduction(
  task: Pick<CleaningTask, 'production_triggers'>,
  signals: ProductionSignal[],
): boolean {
  const triggers = task.production_triggers
  if (!triggers || triggers.length === 0) return true
  return triggers.some(t => signals.includes(t as ProductionSignal))
}

/** Why an item is on the list, for the badge the crew sees. */
export function itemSourceLabel(source: ItemSource): string {
  switch (source) {
    case 'production': return 'ran today'
    case 'issue':      return 'reported'
    case 'manual':     return 'added'
    default:           return ''
  }
}

// ── Building a night's list ─────────────────────────────────────────────

export interface BuildInput {
  dateISO:   string
  tasks:     CleaningTask[]
  areas:     Pick<CleaningArea, 'id' | 'name' | 'sort_order'>[]
  equipment: Pick<CleaningEquipment, 'id' | 'name'>[]
  signals:   ProductionSignal[]
  /** task_id → last date it was completed, from previous shifts. */
  lastDone:  Record<string, string>
}

/** A row ready to insert into cleaning_shift_items, minus the shift id. */
export type BuiltItem = Omit<CleaningShiftItem,
  'id' | 'shift_id' | 'status' | 'done_by_id' | 'done_by' | 'done_at' |
  'note' | 'value_num' | 'value_text'
>

/**
 * Turn the master checklist into tonight's items.
 *
 * Everything the item needs to render is copied onto it rather than joined at
 * read time. That is what lets Jill fix a typo in a task title next week
 * without silently rewriting what tonight's record says was done.
 */
export function buildShiftItems(input: BuildInput): BuiltItem[] {
  const { dateISO, tasks, areas, equipment, signals, lastDone } = input

  const areaById  = new Map(areas.map(a => [a.id, a]))
  const equipById = new Map(equipment.map(e => [e.id, e]))

  const due = tasks.filter(t =>
    t.active &&
    isDue(t, dateISO, lastDone[t.id] ?? null) &&
    matchesProduction(t, signals),
  )

  // Walk order: area first (the order the crew moves through the plant), then
  // the task's own order within it.
  due.sort((a, b) => {
    const areaA = areaById.get(a.area_id)?.sort_order ?? 999
    const areaB = areaById.get(b.area_id)?.sort_order ?? 999
    if (areaA !== areaB) return areaA - areaB
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order
    return a.title.localeCompare(b.title)
  })

  return due.map((t, i) => ({
    task_id:        t.id,
    asset_id:       t.asset_id,
    title:          t.title,
    detail:         t.detail,
    area_name:      areaById.get(t.area_id)?.name ?? 'Unassigned',
    equipment_name: t.asset_id ? equipById.get(t.asset_id)?.name ?? null : null,
    requires_photo: t.requires_photo,
    input_type:     t.input_type,
    input_label:    t.input_label,
    input_unit:     t.input_unit,
    input_min:      t.input_min,
    input_max:      t.input_max,
    // A task that only showed up because of what ran today is labelled as such,
    // so a crew member who doesn't recognise an item can tell why it's there.
    source:         (t.production_triggers?.length ? 'production' : 'scheduled') as ItemSource,
    sort_order:     (i + 1) * 10,
    // Copied, not joined: the tier an item was on the night it was (or wasn't)
    // done is part of the record, and Jill re-tiering a task next week must
    // not rewrite it.
    priority:       (PRIORITIES.includes(t.priority) ? t.priority : 2) as Priority,
  }))
}

// ── Progress ────────────────────────────────────────────────────────────

export interface ShiftProgress {
  total: number
  done: number
  na: number
  issue: number
  pending: number
  /** Handed to the morning at close-out. Not answered, not open either. */
  rolled: number
  /** Everything has an answer — not necessarily that everything is 'done'. */
  complete: boolean
  pct: number
}

export function shiftProgress(items: Pick<CleaningShiftItem, 'status'>[]): ShiftProgress {
  const total   = items.length
  const done    = items.filter(i => i.status === 'done').length
  const na      = items.filter(i => i.status === 'na').length
  const issue   = items.filter(i => i.status === 'issue').length
  const pending = items.filter(i => i.status === 'pending').length
  const rolled  = items.filter(i => i.status === 'rolled').length
  return {
    total, done, na, issue, pending, rolled,
    complete: total > 0 && pending === 0 && rolled === 0,
    // Answered, not completed: an item marked N/A or flagged is dealt with, and
    // a bar that refuses to fill because of an honest "can't do this one"
    // teaches people to stop being honest.
    pct: total === 0 ? 0 : Math.round(((done + na + issue) / total) * 100),
  }
}

/** Is a reading outside the range the task defines? */
export function outOfSpec(
  item: Pick<CleaningShiftItem, 'input_type' | 'input_min' | 'input_max' | 'value_num'>,
): boolean {
  if (item.input_type !== 'number' || item.value_num === null) return false
  if (item.input_min !== null && item.value_num < item.input_min) return true
  if (item.input_max !== null && item.value_num > item.input_max) return true
  return false
}

// ── Shift dating ────────────────────────────────────────────────────────

/**
 * Which production day a cleaning shift belongs to.
 *
 * The crew works after production, often past midnight. At 1am they are
 * cleaning up after YESTERDAY, and the record has to say so or the night's
 * work lands on a day the plant hadn't run yet. Anything before the cutoff
 * belongs to the previous day.
 */
export const SHIFT_ROLLOVER_HOUR = 4

export function shiftDateFor(now: Date, todayISO: string): string {
  const shopHour = Number(
    now.toLocaleString('en-US', { timeZone: 'America/Denver', hour: '2-digit', hourCycle: 'h23' }),
  )
  return shopHour < SHIFT_ROLLOVER_HOUR ? addDaysISO(todayISO, -1) : todayISO
}

export const CLEANING_PHOTO_BUCKET = 'cleaning-photos'

/**
 * Clips live in the same bucket as the photos — same lifetime, same owner, and
 * one bucket to widen when a phone starts writing some new container.
 *
 * The cap is generous because the alternative to a 60 MB clip is a step nobody
 * writes up. It is not unbounded: a whole teardown filmed in one take is a
 * video nobody scrubs through on the floor, and the steps are the index.
 */
export const CLEANING_VIDEO_TYPES = [
  'video/mp4', 'video/quicktime', 'video/webm', 'video/x-m4v', 'video/3gpp',
]
export const CLEANING_VIDEO_MAX_BYTES = 200 * 1024 * 1024

// ── Plant map ───────────────────────────────────────────────────────────

export interface AreaGeometry {
  map_x: number | null
  map_y: number | null
  map_w: number | null
  map_h: number | null
  map_color: string | null
}

export interface MapSettings {
  background_url: string | null
  background_alpha: number
  canvas_w: number
  canvas_h: number
}

/**
 * What a room is doing right now, in one word.
 *
 * Ordered by what should pull the eye first: a flagged problem beats an
 * unfinished room, which beats a finished one. `untracked` is an honest fourth
 * state — an area with nothing on tonight's list is not "clean", it's simply
 * not being asked about, and colouring it green would be a lie.
 */
export type AreaState = 'flagged' | 'pending' | 'partial' | 'done' | 'untracked'

export const AREA_STATE_LABEL: Record<AreaState, string> = {
  flagged:   'Problem flagged',
  pending:   'Not started',
  partial:   'In progress',
  done:      'Done',
  untracked: 'Nothing scheduled',
}

/**
 * Map colours. Deliberately not red/green alone — roughly one man in twelve
 * can't separate those, and this is a wall-glance tool. Each state also differs
 * in lightness, and the map pairs every colour with a text label and an icon,
 * so colour is never the only carrier of meaning.
 */
export const AREA_STATE_COLOR: Record<AreaState, string> = {
  flagged:   '#F59E0B',
  // Pending is the state the map exists to surface — "work still to do here" —
  // so it gets the lighter tan rather than the dark brown that reads as
  // background on a dark page. The first draft used #75471B and an untouched
  // room was nearly invisible, which is exactly backwards.
  pending:   '#A6785A',
  partial:   '#60A5FA',
  done:      '#4CAF50',
  untracked: '#3A2415',
}

export function areaState(items: Pick<CleaningShiftItem, 'status'>[]): AreaState {
  if (items.length === 0) return 'untracked'
  if (items.some(i => i.status === 'issue')) return 'flagged'
  const answered = items.filter(i => i.status !== 'pending').length
  if (answered === 0)            return 'pending'
  if (answered < items.length)   return 'partial'
  return 'done'
}

/**
 * Which areas saw production today.
 *
 * Derived from the checklist rather than a hardcoded signal→room table: an
 * area counts as used if any of its own tasks names a trigger that fired. That
 * way adding a smokehouse task with a `smoke` trigger lights the smokehouse on
 * the map with no code change, and the map can't drift out of step with the
 * list the way a second mapping would.
 */
export function areasInUse(
  tasks: Pick<CleaningTask, 'area_id' | 'production_triggers'>[],
  signals: ProductionSignal[],
): Set<string> {
  const used = new Set<string>()
  for (const t of tasks) {
    if (t.production_triggers?.some(s => signals.includes(s as ProductionSignal))) {
      used.add(t.area_id)
    }
  }
  return used
}

// ── P1 completion ───────────────────────────────────────────────────────

/**
 * Is P1 finished? Every P1 item is done or didn't apply. A flagged P1 item
 * keeps P1 open on purpose — a saw that couldn't be cleaned is not a clean
 * saw, and the banner must not say otherwise.
 */
export function p1Complete(items: Pick<CleaningShiftItem, 'status' | 'priority'>[]): boolean {
  const p1 = items.filter(i => i.priority === 1)
  return p1.length > 0 && p1.every(i => i.status === 'done' || i.status === 'na')
}

// ── The shift clock ─────────────────────────────────────────────────────
//
// Shift starts 5:00 PM, hard stop 1:30 AM (8 hours worked + 30 min unpaid
// lunch), and anything still open at 3:00 AM is closed by the system. All
// three are shop wall-clock times; the hard stop and auto-close fall on the
// morning AFTER shift_date.

export const SHOP_TZ = 'America/Denver'
export const SHIFT_START = { h: 17, m: 0 }
export const HARD_STOP   = { h: 1,  m: 30 }
export const AUTO_CLOSE  = { h: 3,  m: 0 }

/** The instant that is `h:m` on the shop clock on `dateISO`, DST and all. */
export function shopTime(dateISO: string, h: number, m: number): Date {
  const [y, mo, d] = dateISO.split('-').map(Number)
  // Treat the wall-clock as if it were UTC, then shift by however far the
  // shop clock sits from UTC at that moment. Exact except inside the one
  // hour a year that doesn't exist, which no shift boundary lands in.
  const guess = Date.UTC(y, mo - 1, d, h, m)
  return new Date(guess - shopOffsetMs(new Date(guess)))
}

function shopOffsetMs(at: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: SHOP_TZ, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(at)
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? 0)
  const wall = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'))
  return wall - at.getTime()
}

export function hardStopFor(shiftDate: string): Date {
  return shopTime(addDaysISO(shiftDate, 1), HARD_STOP.h, HARD_STOP.m)
}

export function autoCloseFor(shiftDate: string): Date {
  return shopTime(addDaysISO(shiftDate, 1), AUTO_CLOSE.h, AUTO_CLOSE.m)
}

/** FSIS pre-op the morning after — `preopTime` is Postgres 'HH:MM:SS' or 'HH:MM'. */
export function preopFor(shiftDate: string, preopTime: string): Date {
  const [h, m] = preopTime.split(':').map(Number)
  return shopTime(addDaysISO(shiftDate, 1), h || 0, m || 0)
}

/** '9:52 PM' on the shop clock. */
export function fmtShopTime(d: Date | string | null | undefined): string {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-US', { timeZone: SHOP_TZ, hour: 'numeric', minute: '2-digit' })
}

/** '3h 14m'. Negative spans come back as '0m' — the caller says "over". */
export function fmtSpan(ms: number): string {
  const mins = Math.max(0, Math.round(ms / 60000))
  const h = Math.floor(mins / 60), m = mins % 60
  return h > 0 ? `${h}h ${String(m).padStart(2, '0')}m` : `${m}m`
}

/** Hours between two stamps, one decimal; null when either is missing. */
export function hoursBetween(startISO: string | null, endISO: string | null): number | null {
  if (!startISO || !endISO) return null
  return Math.round((new Date(endISO).getTime() - new Date(startISO).getTime()) / 360000) / 10
}

// ── Breaks ──────────────────────────────────────────────────────────────
//
// Display only. Nothing here is enforced — the strip exists so nobody has to
// remember the times, and so two people don't both leave the floor at once.

export interface BreakSlot { label: string; start: string; end: string }   // 'HH:MM' shop clock

const SOLO: BreakSlot[] = [
  { label: 'Break', start: '19:00', end: '19:15' },
  { label: 'Lunch', start: '21:15', end: '21:45' },
  { label: 'Break', start: '23:45', end: '00:00' },
]
const STAGGER_A: BreakSlot[] = [
  { label: 'Break', start: '18:45', end: '19:00' },
  { label: 'Lunch', start: '21:00', end: '21:30' },
  { label: 'Break', start: '23:30', end: '23:45' },
]
const STAGGER_B: BreakSlot[] = [
  { label: 'Break', start: '19:00', end: '19:15' },
  { label: 'Lunch', start: '21:30', end: '22:00' },
  { label: 'Break', start: '23:45', end: '00:00' },
]

export interface BreakPlan { who: string; slots: BreakSlot[] }

/**
 * One line per person. Alone: the single schedule. Two or more: staggered,
 * alternating A/B down the crew list so the floor is never empty.
 */
export function breakPlan(crewNames: string[]): BreakPlan[] {
  if (crewNames.length <= 1) return [{ who: crewNames[0] ?? 'Crew', slots: SOLO }]
  return crewNames.map((who, i) => ({ who, slots: i % 2 === 0 ? STAGGER_A : STAGGER_B }))
}

/** '19:15' → '7:15'. */
export function fmtClock(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const h12 = h % 12 === 0 ? 12 : h % 12
  return `${h12}:${String(m).padStart(2, '0')}`
}

// ── Area split ──────────────────────────────────────────────────────────
//
// With two on shift the plant divides into a harvest-side walk and a
// processing-side walk. This is the default only: the shift stores its own
// copy (cleaning_shifts.area_assignments) and the crew can move any room.
// Keyed by area NAME because shift items carry the name, not the id.

const SPLIT_A = ['Harvest Room', 'Inedible Room', 'Carcass Hallway', 'Value Add', 'Old Cooler', 'New Cooler']
const SPLIT_B = ['Processing Room', 'Packaging Area', 'Storage Room', 'Retail', 'Retail Bathroom']

/** Which side a room falls on by default; null = shared, either person. */
export function defaultSide(areaName: string): 'A' | 'B' | null {
  if (SPLIT_A.includes(areaName)) return 'A'
  if (SPLIT_B.includes(areaName)) return 'B'
  // "Freezers" on the B list covers every freezer the plant has, by name.
  if (/freezer/i.test(areaName)) return 'B'
  return null
}

/** area name → crew id. Empty for a one-person shift: everything is theirs. */
export function defaultAssignments(crewIds: string[], areaNames: string[]): Record<string, string> {
  if (crewIds.length < 2) return {}
  const out: Record<string, string> = {}
  for (const name of areaNames) {
    const side = defaultSide(name)
    if (side === 'A') out[name] = crewIds[0]
    if (side === 'B') out[name] = crewIds[1]
  }
  return out
}
