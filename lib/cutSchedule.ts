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

export function speciesColor(s: string): string {
  switch (s) {
    case 'Beef': return '#A78BFA'
    case 'Hog':  return '#F59E0B'
    case 'Lamb': return '#60A5FA'
    case 'Goat': return '#4CAF50'
    default:     return '#C9A882'
  }
}

export function speciesIcon(s: string): string {
  switch (s) {
    case 'Beef': return '🐄'
    case 'Hog':  return '🐖'
    case 'Lamb': return '🐑'
    case 'Goat': return '🐐'
    default:     return '🏷'
  }
}

export function portionBadge(p: string): { label: string; color: string } {
  switch (p) {
    case 'Whole':   return { label: 'Whole', color: '#EF4444' }
    case 'Half':    return { label: '½',     color: '#F97316' }
    case 'Quarter': return { label: '¼',     color: '#F59E0B' }
    default:        return { label: p,       color: '#C9A882' }
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
      // ── REAL FIX: this carcass is assigned to one or more cut customers.
      // Emit one cut job per assigned portion (a true split → two rows that
      // share harvest_log_id, so the head count / day totals still count the
      // carcass once — those dedupe by harvest_log_id).
      for (const asg of logAssigns) {
        const cust    = customers.find(c => c.id === asg.appointment_customer_id)
        const instrId = cust?.linked_cutting_instruction_id || asg.linked_cutting_instruction_id || null
        const saved   = savedByKey.get(`${log.id}__${asg.appointment_customer_id}`)
        raw.push({
          key:                     `${log.id}__${asg.appointment_customer_id}`,
          harvest_log_id:          log.id,
          appointment_id:          log.id,
          source_appointment_id:   appt?.id ?? log.appointment_id ?? null,
          appointment_customer_id: asg.appointment_customer_id,
          customer_name:           cust?.customer_name || asg.customer_name || 'Unknown',
          producer:                log.producer ?? '',
          species:                 log.species,
          portion:                 asg.portion || cust?.portion || 'Whole',
          harvest_date:            log.harvest_date,
          carcass_tag:             log.carcass_tag,
          hot_carcass_weight_lbs:  log.hot_carcass_weight_lbs,
          has_instructions:        !!(instrId && instructionIds.has(instrId)),
          cutting_instruction_id:  instrId,
          days_hanging:            daysHanging,
          locked:                  saved?.locked ?? false,
          entry_notes:             saved?.notes  ?? '',
          customer_count:          customers.length,
          assigned:                true,
          appt_assigned_carcasses: apptStats.get(log.appointment_id ?? '')?.assigned ?? 0,
          appt_total_carcasses:    apptStats.get(log.appointment_id ?? '')?.total ?? 0,
        })
      }
      continue
    }

    // INTERIM (2026-06-26): ONE row per carcass, so the head count stays true.
    // This loop used to emit one row per customer on the appointment, so an
    // appointment with N carcasses and M customers produced N×M rows — a
    // cross-join — because the data records WHO the buyers are but not WHICH
    // carcass is whose. We collapse to the carcass and tie it to the producer.
    // This is now the FALLBACK for carcasses with no assignments yet; once the
    // crew assigns them (Assign button → modal), the branch above takes over.
    const single = customers.length === 1 ? customers[0] : null
    const custId = single ? single.id : 'standalone'
    const hasInstructions = single
      ? !!(single.linked_cutting_instruction_id && instructionIds.has(single.linked_cutting_instruction_id))
      : customers.some(c => c.linked_cutting_instruction_id && instructionIds.has(c.linked_cutting_instruction_id))
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

  combined.sort((a, b) => {
    if (useSaved) {
      const ra = a.saved ?? 9999
      const rb = b.saved ?? 9999
      if (ra !== rb) return ra - rb
    }
    return b.score - a.score
  })

  return combined.map((c, i) => ({ ...c.item, rank: i + 1 }))
}
