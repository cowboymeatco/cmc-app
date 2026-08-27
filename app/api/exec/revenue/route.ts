export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabase } from '@/lib/supabase'
import {
  buildRevenueRecognition, placedCutDays, speciesAverages,
  type AppointmentRow, type HarvestRow, type PlanRow,
} from '@/lib/revenueRecognition'
import { addDaysISO } from '@/lib/dates'

// GET /api/exec/revenue?start=YYYY-MM-DD&end=YYYY-MM-DD
//
// Service revenue recognized on the day the work happens rather than the day
// it's invoiced — see lib/revenueRecognition for why and how. Default window
// is the last 30 days plus the next 30, so the same picture carries what was
// earned and what's on the books.

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

// A beef hangs a couple of weeks, so a carcass killed well before the window
// can still be cut inside it. Reach back far enough that its cut & wrap lands
// on the right day instead of vanishing.
const LOOKBACK_DAYS = 120

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    // Plant-local, not UTC — a Montana evening is still today.
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const q = req.nextUrl.searchParams
    const start = DATE_RE.test(q.get('start') ?? '') ? q.get('start')! : addDaysISO(today, -30)
    const end = DATE_RE.test(q.get('end') ?? '') ? q.get('end')! : addDaysISO(today, 30)
    if (end < start) return NextResponse.json({ error: 'end is before start' }, { status: 400 })

    const from = addDaysISO(start, -LOOKBACK_DAYS)

    const [harvestRes, apptRes, planRes, avgRes] = await Promise.all([
      supabase.from('harvest_log')
        .select('id, harvest_date, species, status, producer, carcass_tag, hot_carcass_weight_lbs, appointment_id')
        .gte('harvest_date', from).lte('harvest_date', end),
      supabase.from('harvest_appointments')
        .select('id, harvest_date, species, head_count, producer_id, customers')
        .gte('harvest_date', from).lte('harvest_date', end),
      // The plan is one ordered list under a single schedule_date, so it can't
      // be date-filtered here; the newest few dozen rows always cover it.
      supabase.from('cut_schedule_items')
        .select('kind, schedule_date, manual_rank, break_date, appointment_id, future_appointment_id')
        .order('schedule_date', { ascending: false })
        .order('manual_rank', { ascending: true })
        .limit(500),
      // A year of real carcass weights, for pricing animals that aren't on the
      // rail yet. Wider than the window on purpose — a quiet fortnight would
      // otherwise set the average for every booking behind it.
      supabase.from('harvest_log')
        .select('species, hot_carcass_weight_lbs')
        .gte('harvest_date', addDaysISO(today, -365)),
    ])
    for (const r of [harvestRes, apptRes, planRes, avgRes]) {
      if (r.error) throw new Error(r.error.message)
    }

    const harvests = (harvestRes.data ?? []) as HarvestRow[]
    const logIds = harvests.map(h => h.id)

    // Producer names live on the customer record; harvest_appointments only
    // carries the id. Own animals have to be recognizable by name, so this
    // join isn't optional.
    const producerIds = [...new Set((apptRes.data ?? []).map(a => a.producer_id).filter(Boolean))] as string[]
    const custRes = producerIds.length
      ? await supabase.from('customers').select('id, name').in('id', producerIds)
      : { data: [], error: null }
    if (custRes.error) throw new Error(custRes.error.message)
    const producerName = new Map((custRes.data ?? []).map(c => [c.id as string, (c.name as string) ?? '']))

    const appointments: AppointmentRow[] = (apptRes.data ?? []).map(a => ({
      id: a.id as string,
      harvest_date: a.harvest_date as string,
      species: (a.species as string) ?? '',
      head_count: (a.head_count as number) ?? 0,
      producer_name: a.producer_id ? producerName.get(a.producer_id as string) ?? null : null,
    }))

    // The day each carcass was really broken, off the packing scans.
    const packRes = logIds.length
      ? await supabase.from('processing_inputs')
          .select('linked_harvest_id, pack_date')
          .in('linked_harvest_id', logIds)
          .not('pack_date', 'is', null)
      : { data: [], error: null }
    if (packRes.error) throw new Error(packRes.error.message)
    const packDayByLogId = new Map<string, string>()
    for (const p of packRes.data ?? []) {
      const id = p.linked_harvest_id as string
      const d = p.pack_date as string
      const prev = packDayByLogId.get(id)
      // First scan wins: a carcass packed over two days was cut on the first.
      if (!prev || d < prev) packDayByLogId.set(id, d)
    }

    const result = buildRevenueRecognition({
      start, end, today,
      harvests,
      appointments,
      packDayByLogId,
      plannedCutDayByLogId: placedCutDays((planRes.data ?? []) as PlanRow[], today),
      speciesAvgLbs: speciesAverages((avgRes.data ?? []) as Pick<HarvestRow, 'species' | 'hot_carcass_weight_lbs'>[]),
    })

    return NextResponse.json(result)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
