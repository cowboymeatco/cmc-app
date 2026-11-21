// How long a carcass should hang before it is ready to cut.
//
// Charlie, 2026-11-21: "default over 10 days unless customer says so". The
// cut cards carry no aging field, so a longer (or shorter) target is set per
// carcass on its QR page and lives on harvest_log.aging_target_days. Blank
// means the species default below. The 10 days is beef; hogs, lambs and goats
// are cut within a few days, so they default to how long they actually hang
// (the cut schedule's DEFAULT_HANG_DAYS medians) rather than reading as
// "not ready" for a week and a half.

import { addDaysISO, daysBetweenISO, isoDate } from '@/lib/dates'
import { DEFAULT_HANG_DAYS } from '@/lib/cutSchedule'

export const BEEF_AGING_DAYS = 10

export function defaultAgingDays(species: string): number {
  if (species === 'Beef') return BEEF_AGING_DAYS
  return DEFAULT_HANG_DAYS[species] ?? 7
}

export function agingTargetDays(species: string, override: number | null | undefined): number {
  return override != null && Number.isFinite(override) && override > 0 ? override : defaultAgingDays(species)
}

export interface AgingState {
  target:    number
  daysHung:  number
  ready:     boolean
  /** ISO date the target is reached (in the past once ready). */
  readyOn:   string
  /** True when the target came off this carcass, not the species default. */
  custom:    boolean
}

export function agingState(harvestDate: string, species: string, override: number | null | undefined, today = isoDate()): AgingState {
  const target   = agingTargetDays(species, override)
  const daysHung = Math.max(0, daysBetweenISO(harvestDate, today))
  return {
    target,
    daysHung,
    ready:   daysHung >= target,
    readyOn: addDaysISO(harvestDate, target),
    custom:  override != null && override > 0,
  }
}

/** "Ready" or "Ready Tue 11/28" — what the floor reads at a glance. */
export function agingLabel(a: AgingState): string {
  if (a.ready) return 'Ready'
  const d = new Date(a.readyOn + 'T12:00:00')
  return `Ready ${d.toLocaleDateString('en-US', { weekday: 'short', month: 'numeric', day: 'numeric' })}`
}
