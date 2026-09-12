// Where an appointment's animals actually are, derived from the records the
// crew already writes: receiving log → harvest log → cut schedule → the
// scanner's packing session. Ported from the portal (apps/portal/lib/
// animalProgress.ts) for the in-plant pipeline view; keep the two in step.
//
// WHY DERIVED. harvest_appointments.status stops at 'Processing' for most
// animals and processing_status is dead. The work itself is the record.

import type { SupabaseClient } from '@supabase/supabase-js'

export type AnimalStage =
  | 'scheduled' | 'received' | 'harvested' | 'aging'
  | 'cutting' | 'smokehouse' | 'freezing' | 'ready' | 'at_baker' | 'picked_up'

export const STAGE_RANK: AnimalStage[] = [
  'scheduled', 'received', 'harvested', 'aging',
  'cutting', 'smokehouse', 'freezing', 'ready', 'at_baker', 'picked_up',
]

export type AnimalProgress = {
  stage: AnimalStage
  receivedAt: string | null
  harvestedAt: string | null
  /** Actual cut day once scanned in, otherwise the day it's slotted for. */
  cutDate: string | null
  cutDatePlanned: boolean
  /** When the packing session last moved. */
  sessionAt: string | null
  /** When the freeze-down hold is up. */
  readyAt: string | null
  hangingWeightLbs: number | null
  daysHanging: number | null
  daysHungAtCut: number | null
  /** Harvested long ago and never scanned into a session — the records stopped, not the animal. */
  trailCold: boolean
  /** Packing sessions this appointment's carcasses were scanned into. */
  sessions: { customer_name: string; session_date: string; status: string }[]
}

const COLD_TRAIL_DAYS = 21
const FREEZE_HOLD_HOURS = 48

const SESSION_STAGE: Record<string, AnimalStage> = {
  scanning: 'cutting',
  value_add: 'smokehouse',
  complete: 'freezing',
  baker_storage: 'at_baker',
  picked_up: 'picked_up',
}

function leastAdvanced(stages: AnimalStage[]): AnimalStage | null {
  if (!stages.length) return null
  return stages.reduce((a, b) => (STAGE_RANK.indexOf(b) < STAGE_RANK.indexOf(a) ? b : a))
}

type Row = Record<string, unknown>
const str = (v: unknown) => (typeof v === 'string' ? v : null)
const num = (v: unknown) => (typeof v === 'number' ? v : typeof v === 'string' && v !== '' && !isNaN(Number(v)) ? Number(v) : null)

export async function fetchAnimalProgress(
  supabase: SupabaseClient,
  appointments: { id: string; harvest_date?: string | null }[],
): Promise<Map<string, AnimalProgress>> {
  const out = new Map<string, AnimalProgress>()
  const ids = appointments.map(a => a.id)
  if (!ids.length) return out

  const [receiving, harvests, inputs] = await Promise.all([
    supabase.from('animal_receiving_log').select('appointment_id, received_at, created_at').in('appointment_id', ids),
    supabase.from('harvest_log').select('id, appointment_id, status, created_at, harvest_date, hot_carcass_weight_lbs').in('appointment_id', ids),
    supabase.from('processing_inputs').select('linked_appointment_id, customer_name, session_date').in('linked_appointment_id', ids),
  ])

  const harvestRows = (harvests.data ?? []) as Row[]
  const harvestIds = harvestRows.map(h => String(h.id))
  const cuts = harvestIds.length
    ? await supabase
        .from('cut_schedule_items')
        .select('appointment_id, schedule_date, created_at')
        .in('appointment_id', harvestIds)
        .order('created_at', { ascending: true })
    : { data: [] as Row[] }

  const pairs = [...new Set(((inputs.data ?? []) as Row[])
    .map(i => `${str(i.customer_name) ?? ''}|${str(i.session_date) ?? ''}`))]
    .filter(p => p !== '|')
  const sessions = pairs.length
    ? await supabase
        .from('processing_sessions')
        .select('customer_name, session_date, status, updated_at')
        .in('customer_name', [...new Set(pairs.map(p => p.split('|')[0]))])
        .in('session_date', [...new Set(pairs.map(p => p.split('|')[1]))])
    : { data: [] as Row[] }

  const sessionByPair = new Map<string, Row>()
  for (const s of (sessions.data ?? []) as Row[]) sessionByPair.set(`${str(s.customer_name)}|${str(s.session_date)}`, s)
  const cutDateByHarvest = new Map<string, string>()
  for (const c of ((cuts.data ?? []) as Row[])) {
    const key = str(c.appointment_id); const day = str(c.schedule_date)
    if (key && day) cutDateByHarvest.set(key, day)
  }

  const recvRows = (receiving.data ?? []) as Row[]
  const inputRows = (inputs.data ?? []) as Row[]

  for (const appt of appointments) {
    const mine = {
      receiving: recvRows.filter(r => str(r.appointment_id) === appt.id),
      harvests: harvestRows.filter(h => str(h.appointment_id) === appt.id),
      inputs: inputRows.filter(i => str(i.linked_appointment_id) === appt.id),
    }

    const receivedAt = mine.receiving.map(r => str(r.received_at) ?? str(r.created_at)).filter(Boolean).sort()[0] ?? null
    const harvestedAt = mine.harvests.map(h => str(h.created_at)).filter(Boolean).sort()[0] ?? null
    const hangingWeightLbs = mine.harvests
      .map(h => num(h.hot_carcass_weight_lbs))
      .filter((w): w is number => w != null)
      .reduce<number | null>((sum, w) => (sum ?? 0) + w, null)

    // A carcass that left hanging is as done as this pipeline gets — it was
    // never going to be cut here (Charlie, 2026-09-11).
    const carcassStages = mine.harvests.map<AnimalStage>(h => {
      const st = str(h.status)
      if (st === 'delivered') return 'picked_up'
      return st === 'cut' ? 'cutting' : 'aging'
    })

    const pairKeys = [...new Set(mine.inputs.map(i => `${str(i.customer_name)}|${str(i.session_date)}`))]
    const sessionRows = pairKeys.map(k => sessionByPair.get(k)).filter((s): s is Row => !!s)
    const sessionStages = sessionRows.map(s => SESSION_STAGE[str(s.status) ?? '']).filter(Boolean)

    const actualCutDay = mine.inputs.map(i => str(i.session_date)).filter(Boolean).sort()[0] ?? null
    const plannedCutDay = mine.harvests.map(h => cutDateByHarvest.get(String(h.id))).filter((d): d is string => !!d).sort().pop() ?? null

    let stage: AnimalStage = 'scheduled'
    if (receivedAt) stage = 'received'
    if (mine.harvests.length) stage = 'harvested'
    const carcass = leastAdvanced(carcassStages)
    if (carcass) stage = carcass
    const session = leastAdvanced(sessionStages)
    if (session) stage = session

    const sessionAt = sessionRows.map(s => str(s.updated_at)).filter(Boolean).sort().pop() ?? null
    const readyAt = stage === 'freezing' && sessionAt
      ? new Date(new Date(sessionAt).getTime() + FREEZE_HOLD_HOURS * 3600_000).toISOString()
      : null
    if (stage === 'freezing' && (!readyAt || Date.parse(readyAt) <= Date.now())) stage = 'ready'

    const killedAt = appt.harvest_date ? new Date(appt.harvest_date + 'T12:00:00').getTime() : null
    const daysSinceHarvest = killedAt ? Math.floor((Date.now() - killedAt) / 86400_000) : 0
    const daysHanging = killedAt ? Math.max(0, daysSinceHarvest) : null
    const daysHungAtCut = killedAt && actualCutDay
      ? Math.max(0, Math.floor((new Date(actualCutDay + 'T12:00:00').getTime() - killedAt) / 86400_000))
      : null

    out.set(appt.id, {
      stage,
      receivedAt,
      harvestedAt,
      cutDate: actualCutDay ?? plannedCutDay,
      cutDatePlanned: !actualCutDay && !!plannedCutDay,
      sessionAt,
      readyAt,
      hangingWeightLbs,
      daysHanging,
      daysHungAtCut,
      trailCold: !sessionRows.length && mine.harvests.length > 0 && daysSinceHarvest > COLD_TRAIL_DAYS,
      sessions: sessionRows.map(s => ({ customer_name: str(s.customer_name) ?? '', session_date: str(s.session_date) ?? '', status: str(s.status) ?? '' })),
    })
  }
  return out
}

export const STAGE_LABEL: Record<AnimalStage, { label: string; color: string }> = {
  scheduled:  { label: 'Booked',        color: '#A6785A' },
  received:   { label: 'Received',      color: '#C9A882' },
  harvested:  { label: 'Harvested',     color: '#D97706' },
  aging:      { label: 'Hanging',       color: '#3B82F6' },
  cutting:    { label: 'Cutting',       color: '#75471B' },
  smokehouse: { label: 'Smokehouse',    color: '#E8883A' },
  freezing:   { label: 'Freezing down', color: '#7CAFDD' },
  ready:      { label: 'In freezer',    color: '#4CAF50' },
  at_baker:   { label: 'At Baker Storage', color: '#B45309' },
  picked_up:  { label: 'Picked up',     color: '#999' },
}
