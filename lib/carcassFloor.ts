'use client'
// The hanging carcasses as the floor sees them: the cut schedule's own answer
// for who is on each carcass and whether their cut card is in, plus how long it
// has hung against its aging target. Shared by the carcass QR page
// (/carcass/[id]) and the staging list (/staging) so the two can never
// disagree with each other or with the cut schedule about a missing card.

import { HarvestLog } from '@/lib/types'
import { isoDate } from '@/lib/dates'
import { buildEntries, DEFAULT_WEIGHTS, loadScheduleData, ScheduleEntry } from '@/lib/cutSchedule'
import { agingState, AgingState } from '@/lib/carcassAging'

export interface FloorCarcass {
  log:   HarvestLog
  /** The cut schedule row for this carcass; null for a kill-only animal. */
  entry: ScheduleEntry | null
  aging: AgingState
}

export async function loadHangingCarcasses(): Promise<FloorCarcass[]> {
  const today = isoDate()
  const d = await loadScheduleData(today)
  const entries = buildEntries(d.logs, d.apptMap, d.instrIds, d.saved, d.assignments, DEFAULT_WEIGHTS, d.futureBookings, d.instrByBuyer)
  const byLog = new Map<string, ScheduleEntry>()
  for (const e of entries) if (e.type === 'carcass' && !byLog.has(e.harvest_log_id)) byLog.set(e.harvest_log_id, e)
  return d.logs.map(log => ({
    log,
    entry: byLog.get(log.id) ?? null,
    aging: agingState(log.harvest_date, log.species, log.aging_target_days, today),
  }))
}

/** Oldest kill first, then tag number — the order the cooler should empty in. */
export function oldestFirst(a: FloorCarcass, b: FloorCarcass): number {
  return a.log.harvest_date.localeCompare(b.log.harvest_date)
    || (a.log.carcass_tag ?? '').localeCompare(b.log.carcass_tag ?? '', undefined, { numeric: true })
}

export type CardState = 'have' | 'waiting' | 'no-buyer' | 'unknown'
export function cardState(c: FloorCarcass): CardState {
  return c.entry?.sheet_state ?? 'unknown'
}
export const CARD_TEXT: Record<CardState, string> = {
  'have':     'Cut card in',
  'waiting':  'No cut card',
  'no-buyer': 'No buyer named',
  'unknown':  'Not on the cut schedule',
}

/** "Fri 11/21 2:14 PM" in Mountain Time. */
export function stampMT(iso: string | null | undefined): string {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-US', {
    timeZone: 'America/Denver', weekday: 'short', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

export function killDateLabel(iso: string): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}
