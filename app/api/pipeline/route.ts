export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fetchAnimalProgress, STAGE_RANK, type AnimalStage } from '@/lib/animalProgress'

export const dynamic = 'force-dynamic'

// GET /api/pipeline — every account with animals in the building, where each
// one is and how long it has been here.
//
// Charlie (2026-09-09): "a gantt chart of every account that is active in
// the facility ... what stage they are in and how long they have been there
// ... what animals are closest to the finish line to get paid."
//
// One row per harvest appointment that has been received and not picked up.
// Stage is DERIVED from the records the crew writes anyway (receiving log,
// harvest log, cut schedule, packing session) — see lib/animalProgress.ts.
// Appointments the paper trail stopped on (harvested weeks ago, never scanned
// into a session) are flagged trail_cold rather than shown as still hanging.

export interface PipelineRow {
  id: string
  account: string
  customers: string[]
  species: string
  head_count: number
  harvest_date: string | null
  appointment_status: string
  stage: AnimalStage
  stage_rank: number
  received_at: string | null
  harvested_at: string | null
  cut_date: string | null
  cut_date_planned: boolean
  session_at: string | null
  ready_at: string | null
  hanging_weight_lbs: number | null
  days_in: number | null
  trail_cold: boolean
  sessions: { customer_name: string; session_date: string; status: string }[]
}

type ApptRow = {
  id: string; harvest_date: string | null; species: string | null; head_count: number | null
  source: string | null; status: string | null; customers: { customer_name?: string; portion?: string }[] | null
}

export async function GET() {
  // Six months back covers anything still in a cooler or freezer; older than
  // that with no pickup is a records gap, not an animal.
  const since = new Date(Date.now() - 180 * 86400000).toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
  const { data, error } = await supabase
    .from('harvest_appointments')
    .select('id, harvest_date, species, head_count, source, status, customers')
    .in('status', ['AnimalIn', 'Processing', 'Complete'])
    .gte('harvest_date', since)
    .order('harvest_date', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const appts = (data ?? []) as ApptRow[]
  const progress = await fetchAnimalProgress(supabase, appts.map(a => ({ id: a.id, harvest_date: a.harvest_date })))

  const now = Date.now()
  const rows: PipelineRow[] = []
  for (const a of appts) {
    const p = progress.get(a.id)
    if (!p) continue
    if (p.stage === 'picked_up') continue
    // Booked but never received (status flipped by hand) — not in the building.
    if (p.stage === 'scheduled') continue

    const startIso = p.receivedAt ?? p.harvestedAt ?? (a.harvest_date ? a.harvest_date + 'T12:00:00' : null)
    const daysIn = startIso ? Math.max(0, Math.floor((now - Date.parse(startIso)) / 86400000)) : null
    const customers = (a.customers ?? []).map(c => (c.customer_name ?? '').trim()).filter(Boolean)

    rows.push({
      id: a.id,
      account: (a.source ?? '').trim() || customers[0] || 'Unnamed',
      customers,
      species: a.species ?? '',
      head_count: Number(a.head_count) || 0,
      harvest_date: a.harvest_date,
      appointment_status: a.status ?? '',
      stage: p.stage,
      stage_rank: STAGE_RANK.indexOf(p.stage),
      received_at: p.receivedAt,
      harvested_at: p.harvestedAt,
      cut_date: p.cutDate,
      cut_date_planned: p.cutDatePlanned,
      session_at: p.sessionAt,
      ready_at: p.readyAt,
      hanging_weight_lbs: p.hangingWeightLbs,
      days_in: daysIn,
      trail_cold: p.trailCold,
      sessions: p.sessions,
    })
  }

  // Closest to the finish line first, then the ones that have waited longest.
  rows.sort((x, y) => (y.stage_rank - x.stage_rank) || ((y.days_in ?? 0) - (x.days_in ?? 0)))
  return NextResponse.json({ generated_at: new Date().toISOString(), rows })
}
