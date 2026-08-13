// Shared cut-schedule model: priority scoring, saved-order merging, and the
// carcass→cut-job row builder. Used by BOTH the desktop planner
// (app/processing/CutScheduleTab) and the read-only mobile crew view
// (app/cut-schedule) so the two can never drift apart.
import { HarvestAppointment, HarvestLog, CarcassAssignment } from '@/lib/types'
import { isoDate, daysBetweenISO } from '@/lib/dates'

export interface PriorityWeights {
  days_hanging:     number
  has_instructions: number
  portion_size:     number
}

// Portion → fraction of one whole carcass (a carcass is "assigned" once its
// portions sum to a whole).
export const FRACTION: Record<string, number> = { Whole: 1, Half: 0.5, Quarter: 0.25 }

/** One cut customer's claim on a carcass — their portion and their own sheet. */
export interface CutCustomer {
  appointment_customer_id: string
  name:                    string
  portion:                 string
  has_instructions:        boolean
  cutting_instruction_id:  string | null
}

export interface ScheduleEntry {
  type:                      'carcass'
  key:                       string
  harvest_log_id:            string
  appointment_id:            string   // = harvest_log_id (the saved-schedule key; kept for back-compat)
  source_appointment_id:     string | null  // the REAL harvest appointment id (drives the assign modal)
  appointment_customer_id:   string
  customer_name:             string
  producer:                  string
  species:                   string
  portion:                   string
  harvest_date:              string
  carcass_tag:               string
  hot_carcass_weight_lbs:    number | null
  has_instructions:          boolean
  cutting_instruction_id:    string | null
  days_hanging:              number
  priority_score:            number
  rank:                      number
  locked:                    boolean
  entry_notes:               string
  /** Every cut customer on this carcass, one per assigned portion. A whole
   *  animal to one buyer has one; a split has two or more. Empty when nobody
   *  has been assigned yet. `customer_name` and `portion` above are display
   *  summaries of this list. */
  cut_customers:             CutCustomer[]
  customer_count:            number   // # of cut customers on the appointment (>1 & unassigned = collapsed, see buildEntries)
  assigned:                  boolean  // true = this row is a real carcass→customer assignment (one cut job per portion)
  appt_assigned_carcasses:   number   // # of this appointment's carcasses fully assigned (portions sum to a whole)
  appt_total_carcasses:      number   // # of this appointment's carcasses currently in the cooler
}

// A moveable "day break" divider the crew inserts between carcasses to mark
// where one day of cutting ends and the next begins. Lives in the same ordered
// list as carcasses (one manual_rank sequence) so it keeps its relative spot.
export interface BreakItem {
  type:       'break'
  key:        string
  rank:       number
  break_date: string  // ISO 'YYYY-MM-DD', or '' when not yet chosen
}

export type ListItem = ScheduleEntry | BreakItem

export const DEFAULT_WEIGHTS: PriorityWeights = {
  days_hanging:     5,
  has_instructions: 8,
  portion_size:     3,
}

export const WEIGHT_LABELS: Record<keyof PriorityWeights, string> = {
  days_hanging:     'Days Hanging',
  has_instructions: 'Instructions Ready',
  portion_size:     'Portion Size',
}

export type SavedItem = {
  id?:                     string
  kind?:                   'carcass' | 'break'
  schedule_date?:          string
  appointment_id:          string | null
  appointment_customer_id: string | null
  manual_rank:             number
  locked:                  boolean
  notes:                   string
  break_date?:             string | null
}

// A saved plan stays live through the last day it describes — the day it was
// saved under, or its latest day-break date when the planner laid out days
// ahead. Past that, both views must fall back to fresh priority order instead
// of rendering a stale sequence under old day headings.
export function planIsLive(savedItems: SavedItem[], todayISO: string): boolean {
  if (savedItems.length === 0) return false
  let last = ''
  for (const s of savedItems) {
    if (s.schedule_date && s.schedule_date > last) last = s.schedule_date
    if (s.kind === 'break' && s.break_date && s.break_date > last) last = s.break_date
  }
  return last >= todayISO
}

export function calcDaysHanging(harvestDate: string): number {
  return Math.max(0, daysBetweenISO(harvestDate, isoDate()))
}

// ── Forward outlook ───────────────────────────────────────────────────────────
// The cut schedule only ever knew about meat already on the rail, so planning
// past the cooler meant reading the harvest calendar and doing the hang
// arithmetic in your head. These project a booked harvest onto the day it will
// most likely be cut (Charlie, 2026-08-13).

/**
 * Days a species actually hangs before it is cut. Measured from 126 carcasses:
 * the harvest date against the day the carcass was first scanned into a cutting
 * session — NOT cut_schedule_items.schedule_date, which is when a plan was saved
 * rather than when anyone cut anything. Beef's 16 agrees with the planner's own
 * "avg at cut" readout, which is the check that these are the real numbers.
 * Goat rides on lamb's figure; three animals is not a sample.
 */
export const HANG_TARGET_DAYS: Record<string, number> = { Beef: 16, Hog: 3, Lamb: 2, Goat: 2 }
export const DEFAULT_HANG_DAYS = 3

/** Median hot carcass weight per species, off 285 logged carcasses. A booked
 *  animal has no weight until it is killed, so a projected day's poundage is
 *  this times head — an estimate, and labelled as one wherever it is shown. */
export const EST_CARCASS_LBS: Record<string, number> = { Beef: 768, Hog: 173, Lamb: 71, Goat: 52 }

export function hangTarget(species: string): number {
  return HANG_TARGET_DAYS[species] ?? DEFAULT_HANG_DAYS
}
export function estCarcassLbs(species: string): number {
  return EST_CARCASS_LBS[species] ?? 0
}

/** One booked appointment's animals, projected onto a cut day. */
export interface ProjectedAppt {
  appointment_id: string
  species:        string
  head:           number   // head still to come (booked minus already harvested)
  harvest_date:   string
  cut_date:       string   // harvest_date + the species hang target
  producer:       string
  customers:      string[]
  est_lbs:        number
}

/** All the animals landing on one projected cut day. */
export interface ProjectedDay {
  date:     string
  head:     number
  est_lbs:  number
  species:  Record<string, number>   // species → head
  appts:    ProjectedAppt[]
}

export function groupProjected(appts: ProjectedAppt[]): ProjectedDay[] {
  const byDay = new Map<string, ProjectedDay>()
  for (const a of appts) {
    let d = byDay.get(a.cut_date)
    if (!d) { d = { date: a.cut_date, head: 0, est_lbs: 0, species: {}, appts: [] }; byDay.set(a.cut_date, d) }
    d.head    += a.head
    d.est_lbs += a.est_lbs
    d.species[a.species] = (d.species[a.species] ?? 0) + a.head
    d.appts.push(a)
  }
  for (const d of byDay.values()) d.appts.sort((x, y) => y.head - x.head || x.producer.localeCompare(y.producer))
  return [...byDay.values()].sort((a, b) => a.date.localeCompare(b.date))
}

// ── Hang projection ───────────────────────────────────────────────────────────
// `days_hanging` is what an animal has hung SO FAR. The planner lays days out
// ahead of today, so a carcass parked under Thursday's break will have hung
// longer by the time anyone picks up a knife — that's the number that decides
// whether it's still fit to cut (Charlie, 2026-08-05).

/** Cut day per carcass row: the date on the nearest day break ABOVE it (a break
 * heads the day below it). Rows above the first dated break aren't scheduled to
 * a day and are left out. */
export function cutDateByKey(list: ListItem[]): Map<string, string> {
  const byKey = new Map<string, string>()
  let day = ''
  for (const item of list) {
    if (item.type === 'break') day = item.break_date || ''
    else if (day) byKey.set(item.key, day)
  }
  return byKey
}

/** Days hung by the scheduled cut day. Never below what it has hung already —
 * a break dated in the past doesn't un-hang an animal. */
export function hangAtCut(harvestDate: string, cutDate: string | undefined, daysHanging: number): number {
  if (!cutDate) return daysHanging
  return Math.max(daysHanging, daysBetweenISO(harvestDate, cutDate))
}

/** Green under a week, amber to nine days, red at ten. One definition, so the
 * planner and the crew view can't disagree on when a carcass is hanging long. */
export function hangColor(days: number): string {
  return days >= 10 ? '#EF4444' : days >= 6 ? '#F59E0B' : '#4CAF50'
}

export function calcScore(
  entry: Pick<ScheduleEntry, 'days_hanging' | 'has_instructions' | 'portion'>,
  w: PriorityWeights
): number {
  let score = 0
  score += Math.min(entry.days_hanging, 14) * w.days_hanging
  if (!entry.has_instructions) score -= w.has_instructions * 10
  const portionScore = entry.portion === 'Whole' ? 3 : entry.portion === 'Half' ? 2 : 1
  score += portionScore * w.portion_size
  return score
}

// Canonical species palette — every page imports these so Beef is the same
// color on the cut schedule, capacity, and harvest schedule alike.
export const SPECIES_CLR: Record<string, string> = {
  Beef: '#E8883A', Hog: '#E879A0', Lamb: '#60A5FA', Goat: '#A78BFA',
}
export const SPECIES_EMOJI: Record<string, string> = {
  Beef: '🐄', Hog: '🐷', Lamb: '🐑', Goat: '🐐',
}

export function speciesColor(s: string): string {
  return SPECIES_CLR[s] ?? '#C9A882'
}

export function speciesIcon(s: string): string {
  return SPECIES_EMOJI[s] ?? '🏷'
}

/**
 * The species a carcass input's description opens with. /api/processing/inputs
 * writes exactly two shapes — "Hog Carcass — Tag 03 (Producer)" and
 * "Hog — Tag 03 L Half (Producer)" — so the species is the first word.
 *
 * The scanner had no species to hand and painted a cow on everything, which
 * put a 🐄 on hog sessions (Charlie, 2026-08-09). Returns '' for anything not
 * in the palette, and speciesIcon() falls back to the neutral tag rather than
 * guessing an animal.
 */
export function speciesFromDescription(desc: string | null | undefined): string {
  const first = (desc ?? '').trim().split(/\s+/)[0] ?? ''
  return Object.prototype.hasOwnProperty.call(SPECIES_EMOJI, first) ? first : ''
}

// A split animal shows as 2+ rows that share harvest_log_id but is ONE
// physical carcass — head counts and hanging weight must count it once.
// These are the only two places that rule lives.
export function uniqueCarcasses(entries: ScheduleEntry[]): ScheduleEntry[] {
  return Array.from(new Map(entries.map(e => [e.harvest_log_id, e])).values())
}

export function carcassTotals(entries: ScheduleEntry[]): { head: number; lbs: number } {
  const uniq = uniqueCarcasses(entries)
  return {
    head: uniq.length,
    lbs:  uniq.reduce((s, e) => s + (e.hot_carcass_weight_lbs ?? 0), 0),
  }
}

/**
 * How much of a carcass its assigned portions add up to. Two halves make a
 * Whole; a single assigned half stays a Half, because the rest of that animal
 * is still looking for a buyer and the badge must not imply otherwise.
 */
export function assignedPortion(cutCustomers: CutCustomer[]): string {
  const sum = cutCustomers.reduce((s, c) => s + (FRACTION[c.portion] ?? 0), 0)
  if (sum >= 0.999) return 'Whole'
  if (sum >= 0.499) return 'Half'
  if (sum >= 0.249) return 'Quarter'
  return cutCustomers[0]?.portion ?? 'Whole'
}

export function portionBadge(p: string): { label: string; color: string } {
  switch (p) {
    case 'Whole':   return { label: 'Whole', color: '#EF4444' }
    case 'Half':    return { label: '½',     color: '#F97316' }
    case 'Quarter': return { label: '¼',     color: '#F59E0B' }
    default:        return { label: p,       color: '#C9A882' }
  }
}

// ── Fetch everything the schedule needs ───────────────────────────────────────
// One pipeline for both the desktop planner and the crew view, so the two can
// never drift on WHAT they load, only on how they render it. The assignments
// and appointments calls chain off the harvest response (fetching only the
// rows the cooler carcasses reference — both tables grow forever, and the
// crew view re-fetches every time a phone wakes) while the other fetches run,
// so nothing is serialized behind unrelated requests. Throws on a malformed
// core response so callers show an error state instead of a falsely empty
// cooler.
export interface ScheduleData {
  logs:        HarvestLog[]
  apptMap:     Map<string, HarvestAppointment>
  instrIds:    Set<string>
  saved:       SavedItem[]   // already filtered to the live plan (planIsLive)
  assignments: CarcassAssignment[]
}

export async function loadScheduleData(todayISO: string): Promise<ScheduleData> {
  const [harvest, instrData, savedData] = await Promise.all([
    fetch('/api/harvest?status=chilling').then(r => r.json()).then(async data => {
      if (!Array.isArray(data)) throw new Error('unexpected /api/harvest response')
      const logs    = data as HarvestLog[]
      const logIds  = logs.map(l => l.id)
      const apptIds = Array.from(new Set(logs.map(l => l.appointment_id).filter(Boolean)))
      const [assignData, apptData] = await Promise.all([
        logIds.length
          ? fetch(`/api/carcass-assignments?harvest_log_ids=${logIds.join(',')}`)
              .then(r => r.json()).catch(() => [])
          : [],
        apptIds.length
          ? fetch(`/api/appointments?ids=${apptIds.join(',')}`).then(r => r.json())
          : [],
      ])
      if (!Array.isArray(apptData)) throw new Error('unexpected /api/appointments response')
      return {
        logs,
        assignments:  Array.isArray(assignData) ? assignData as CarcassAssignment[] : [],
        appointments: apptData as HarvestAppointment[],
      }
    }),
    fetch('/api/cutting-instructions?ids_only=1').then(r => r.json()),
    fetch('/api/cut-schedule?latest=1').then(r => r.json()).catch(() => []),
  ])
  if (!Array.isArray(instrData)) {
    throw new Error('unexpected API response')
  }
  const savedAll = Array.isArray(savedData) ? (savedData as SavedItem[]) : []
  return {
    logs:        harvest.logs,
    assignments: harvest.assignments,
    apptMap:     new Map(harvest.appointments.map(a => [a.id, a])),
    instrIds:    new Set<string>((instrData as { id: string }[]).map(i => i.id)),
    saved:       planIsLive(savedAll, todayISO) ? savedAll : [],
  }
}

// ── Build ranked list from cooler inventory ───────────────────────────────────
export function buildEntries(
  harvestLogs:    HarvestLog[],
  apptMap:        Map<string, HarvestAppointment>,
  instructionIds: Set<string>,
  savedItems:     SavedItem[],
  assignments:    CarcassAssignment[],
  w:              PriorityWeights
): ListItem[] {
  const raw: Omit<ScheduleEntry, 'type' | 'priority_score' | 'rank'>[] = []

  // Saved rows keyed the same way entry keys are built, so the per-row lookups
  // below are O(1) instead of scanning savedItems per carcass.
  const savedByKey = new Map(
    savedItems
      .filter(s => s.kind !== 'break')
      .map(s => [`${s.appointment_id}__${s.appointment_customer_id}`, s])
  )

  // Group assignments by the carcass they belong to.
  const assignByLog = new Map<string, CarcassAssignment[]>()
  for (const a of assignments) {
    const bucket = assignByLog.get(a.harvest_log_id)
    if (bucket) bucket.push(a); else assignByLog.set(a.harvest_log_id, [a])
  }

  // Buyers already placed on SOME carcass. A producer's animals can be assigned
  // across their bookings, so an unassigned carcass must not go on claiming a
  // customer who has been moved to the animal next door.
  const placedCustomers = new Set(assignments.map(a => a.appointment_customer_id))

  // Per-appointment progress: how many of its cooler carcasses are FULLY
  // assigned (portions sum to a whole) out of the total in the cooler.
  const fillByLog = new Map<string, number>()
  for (const a of assignments) {
    fillByLog.set(a.harvest_log_id, (fillByLog.get(a.harvest_log_id) ?? 0) + (FRACTION[a.portion] ?? 0))
  }
  const apptStats = new Map<string, { total: number; assigned: number }>()
  for (const log of harvestLogs) {
    const apptId = log.appointment_id ?? ''
    const s = apptStats.get(apptId) ?? { total: 0, assigned: 0 }
    s.total++
    if ((fillByLog.get(log.id) ?? 0) >= 0.999) s.assigned++
    apptStats.set(apptId, s)
  }

  for (const log of harvestLogs) {
    const appt      = log.appointment_id ? apptMap.get(log.appointment_id) : undefined
    const customers = appt?.customers ?? []
    const daysHanging = calcDaysHanging(log.harvest_date)
    const logAssigns  = assignByLog.get(log.id) ?? []

    if (logAssigns.length > 0) {
      // ── This carcass is assigned to one or more cut customers.
      //
      // ONE ROW PER CARCASS, listing every customer on it. A split animal is
      // one thing hanging on the rail that happens to carry two cut sheets;
      // showing it as two rows made a day's card count run ahead of its head
      // count and read as a miscount (Charlie, 2026-08-09 — "one row per
      // carcass with both names is better"). The cut sheets don't disappear,
      // they move into cut_customers and render on the single row.
      //
      // Sorted by name so the key below is stable across loads.
      const cutCustomers: CutCustomer[] = logAssigns
        .map(asg => {
          const cust    = customers.find(c => c.id === asg.appointment_customer_id)
          const instrId = cust?.linked_cutting_instruction_id || asg.linked_cutting_instruction_id || null
          return {
            appointment_customer_id: asg.appointment_customer_id,
            name:                    cust?.customer_name || asg.customer_name || 'Unknown',
            portion:                 asg.portion || cust?.portion || 'Whole',
            has_instructions:        !!(instrId && instructionIds.has(instrId)),
            cutting_instruction_id:  instrId,
          }
        })
        .sort((a, b) => a.name.localeCompare(b.name))

      // The saved plan may still hold a row PER PORTION from before this
      // collapse. Match on any of them and take the earliest slot, so a split
      // carcass keeps the place the planner gave it instead of losing its day
      // and reappearing above the first break as unscheduled.
      const saved = cutCustomers
        .map(cc => savedByKey.get(`${log.id}__${cc.appointment_customer_id}`))
        .filter((s): s is SavedItem => !!s)
        .sort((a, b) => a.manual_rank - b.manual_rank)[0]

      raw.push({
        key:                     `${log.id}__${cutCustomers[0].appointment_customer_id}`,
        harvest_log_id:          log.id,
        appointment_id:          log.id,
        source_appointment_id:   appt?.id ?? log.appointment_id ?? null,
        appointment_customer_id: cutCustomers[0].appointment_customer_id,
        customer_name:           cutCustomers.map(c => c.name).join(' + '),
        producer:                log.producer ?? '',
        species:                 log.species,
        // What of the animal is actually spoken for — two halves make a whole,
        // but a lone assigned half must not claim the carcass is fully placed.
        portion:                 assignedPortion(cutCustomers),
        harvest_date:            log.harvest_date,
        carcass_tag:             log.carcass_tag,
        hot_carcass_weight_lbs:  log.hot_carcass_weight_lbs,
        // Every sheet has to be in before the row is clear — one missing sheet
        // still stops the carcass, so the flag follows the weakest portion.
        has_instructions:        cutCustomers.every(c => c.has_instructions),
        cutting_instruction_id:  cutCustomers.length === 1 ? cutCustomers[0].cutting_instruction_id : null,
        days_hanging:            daysHanging,
        locked:                  saved?.locked ?? false,
        entry_notes:             saved?.notes  ?? '',
        cut_customers:           cutCustomers,
        customer_count:          customers.length,
        assigned:                true,
        appt_assigned_carcasses: apptStats.get(log.appointment_id ?? '')?.assigned ?? 0,
        appt_total_carcasses:    apptStats.get(log.appointment_id ?? '')?.total ?? 0,
      })
      continue
    }

    // INTERIM (2026-06-26): ONE row per carcass, so the head count stays true.
    // This loop used to emit one row per customer on the appointment, so an
    // appointment with N carcasses and M customers produced N×M rows — a
    // cross-join — because the data records WHO the buyers are but not WHICH
    // carcass is whose. We collapse to the carcass and tie it to the producer.
    // This is now the FALLBACK for carcasses with no assignments yet; once the
    // crew assigns them (Assign button → modal), the branch above takes over.
    const lone   = customers.length === 1 ? customers[0] : null
    const single = lone && !placedCustomers.has(lone.id) ? lone : null
    const custId = single ? single.id : 'standalone'
    const open = customers.filter(c => !placedCustomers.has(c.id))
    const hasInstructions = single
      ? !!(single.linked_cutting_instruction_id && instructionIds.has(single.linked_cutting_instruction_id))
      : open.some(c => c.linked_cutting_instruction_id && instructionIds.has(c.linked_cutting_instruction_id))
    const saved = savedByKey.get(`${log.id}__${custId}`)
    raw.push({
      key:                     `${log.id}__${custId}`,
      harvest_log_id:          log.id,
      appointment_id:          log.id,
      source_appointment_id:   appt?.id ?? log.appointment_id ?? null,
      appointment_customer_id: custId,
      customer_name:           single ? single.customer_name : (log.producer || appt?.source || 'Unknown'),
      producer:                log.producer ?? '',
      species:                 log.species,
      portion:                 single ? single.portion : 'Whole',
      harvest_date:            log.harvest_date,
      carcass_tag:             log.carcass_tag,
      hot_carcass_weight_lbs:  log.hot_carcass_weight_lbs,
      has_instructions:        hasInstructions,
      cutting_instruction_id:  single?.linked_cutting_instruction_id || null,
      days_hanging:            daysHanging,
      locked:                  saved?.locked ?? false,
      entry_notes:             saved?.notes  ?? '',
      // Nobody assigned yet — the buyers are known but not which carcass is
      // whose, so there is no per-portion truth to list.
      cut_customers:           [],
      customer_count:          customers.length,
      assigned:                false,
      appt_assigned_carcasses: apptStats.get(log.appointment_id ?? '')?.assigned ?? 0,
      appt_total_carcasses:    apptStats.get(log.appointment_id ?? '')?.total ?? 0,
    })
  }

  const scored: ScheduleEntry[] = raw.map(e => ({
    type: 'carcass' as const,
    ...e,
    priority_score: calcScore(e, w),
    rank: 0,
  }))

  // Saved manual ranks for carcasses (keyed by appointment + customer).
  const savedRank = new Map(
    Array.from(savedByKey, ([key, s]) => [key, s.manual_rank] as const)
  )

  // Day-break dividers come straight from saved rows (they aren't re-derived
  // from inventory). Each carries its own saved rank so it slots back in place.
  const breakWraps = savedItems
    .filter(s => s.kind === 'break')
    .map(s => ({
      item:  { type: 'break' as const, key: `break_${s.id ?? s.manual_rank}`, rank: 0, break_date: s.break_date ?? '' } as ListItem,
      saved: s.manual_rank,
      score: 0,
    }))

  const carcassWraps = scored.map(e => ({
    item:  e as ListItem,
    saved: savedRank.get(e.key),
    score: e.priority_score,
  }))

  const combined = [...carcassWraps, ...breakWraps]
  const useSaved = savedItems.length > 0

  // A carcass the saved plan has never seen — hung since the last save — sorts
  // ABOVE the first day break, not below the last one. Sorting it to the bottom
  // parked it under the final break, where it read as scheduled for that day
  // when in truth nobody had picked a day for it (Charlie, 2026-08-05). Above
  // every break it has no day, which is the honest answer and the one the
  // planner's No Cut Day tally counts. Unplaced carcasses order by score
  // among themselves.
  combined.sort((a, b) => {
    if (useSaved) {
      const ra = a.saved ?? -1
      const rb = b.saved ?? -1
      if (ra !== rb) return ra - rb
    }
    return b.score - a.score
  })

  return combined.map((c, i) => ({ ...c.item, rank: i + 1 }))
}
