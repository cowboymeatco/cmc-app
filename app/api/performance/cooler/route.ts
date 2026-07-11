export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { isoDate, addDaysISO, daysBetweenISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

// GET /api/performance/cooler
//
// Daily history of what's hanging in the cooler: head count + pounds.
// A carcass enters the cooler on its harvest_date and leaves on its cut date.
//
// Cut dates come from the cut schedule (cut_schedule_items.appointment_id is
// the harvest_log id). Carcasses cut before the cut-schedule feature existed
// have no recorded cut date — for those we estimate harvest_date + the median
// hang time observed on carcasses where both dates ARE known, and report the
// date exact tracking began so the UI can label the estimated stretch.

interface HarvestRow {
  id:                     string
  harvest_date:           string
  status:                 string
  hot_carcass_weight_lbs: number | null
  half_1_weight_lbs:      number | null
  half_2_weight_lbs:      number | null
}

const FALLBACK_HANG_DAYS = 14

function carcassLbs(h: HarvestRow): number {
  if (h.hot_carcass_weight_lbs != null) return Number(h.hot_carcass_weight_lbs)
  return Number(h.half_1_weight_lbs ?? 0) + Number(h.half_2_weight_lbs ?? 0)
}

export async function GET() {
  const [harvestRes, scheduleRes] = await Promise.all([
    supabase
      .from('harvest_log')
      .select('id,harvest_date,status,hot_carcass_weight_lbs,half_1_weight_lbs,half_2_weight_lbs')
      .order('harvest_date', { ascending: true }),
    supabase
      .from('cut_schedule_items')
      .select('appointment_id,schedule_date')
      .not('appointment_id', 'is', null),
  ])
  if (harvestRes.error)  return NextResponse.json({ error: harvestRes.error.message },  { status: 500 })
  if (scheduleRes.error) return NextResponse.json({ error: scheduleRes.error.message }, { status: 500 })

  const carcasses = (harvestRes.data ?? []) as HarvestRow[]
  const today     = isoDate()

  // Earliest scheduled cut date per carcass.
  const cutDateByLog = new Map<string, string>()
  for (const item of scheduleRes.data ?? []) {
    const prev = cutDateByLog.get(item.appointment_id)
    if (!prev || item.schedule_date < prev) cutDateByLog.set(item.appointment_id, item.schedule_date)
  }

  // Median hang time where both dates are known, for estimating the rest.
  const knownHangs = carcasses
    .filter(h => h.status !== 'chilling' && cutDateByLog.has(h.id))
    .map(h => daysBetweenISO(h.harvest_date, cutDateByLog.get(h.id)!))
    .filter(d => d >= 0)
    .sort((a, b) => a - b)
  const medianHangDays = knownHangs.length
    ? knownHangs[Math.floor(knownHangs.length / 2)]
    : FALLBACK_HANG_DAYS

  // First date with an exact (non-estimated) cut record.
  const exactCutDates = carcasses
    .filter(h => h.status !== 'chilling' && cutDateByLog.has(h.id))
    .map(h => cutDateByLog.get(h.id)!)
  const trackingStart = exactCutDates.length ? exactCutDates.sort()[0] : null

  // In/out interval per carcass. Still-chilling carcasses have no exit yet;
  // cut carcasses without a schedule record get the median-hang estimate.
  let estimatedExits = 0
  const intervals = carcasses
    .filter(h => h.harvest_date)
    .map(h => {
      let out: string | null = null
      if (h.status !== 'chilling') {
        out = cutDateByLog.get(h.id) ?? null
        if (!out) {
          out = addDaysISO(h.harvest_date, medianHangDays)
          estimatedExits++
        }
        if (out < h.harvest_date) out = h.harvest_date
        if (out > today) out = today
      }
      return { in: h.harvest_date, out, lbs: carcassLbs(h) }
    })

  // Year-to-date processed = carcasses that have been cut (left the cooler),
  // attributed to the year they were harvested.
  const yearStart = today.slice(0, 4) + '-01-01'
  const ytdCut = carcasses.filter(h =>
    h.status !== 'chilling' && h.harvest_date && h.harvest_date >= yearStart
  )
  const ytd = {
    head:      ytdCut.length,
    lbs:       Math.round(ytdCut.reduce((sum, h) => sum + carcassLbs(h), 0)),
    yearStart,
  }

  // How long the carcasses hanging right now have been in there.
  const hangingDays = carcasses
    .filter(h => h.status === 'chilling' && h.harvest_date)
    .map(h => daysBetweenISO(h.harvest_date, today))
  const hanging = {
    avgDays: hangingDays.length ? Math.round(hangingDays.reduce((a, b) => a + b, 0) / hangingDays.length) : 0,
    maxDays: hangingDays.length ? Math.max(...hangingDays) : 0,
  }

  if (!intervals.length) {
    return NextResponse.json({ series: [], asOf: today, trackingStart, medianHangDays, estimatedExits, hanging, ytd })
  }

  // Daily series: a carcass counts on days [in, out) — it hangs the day it
  // arrives and is gone the day it's cut.
  const firstDay = intervals.reduce((min, c) => (c.in < min ? c.in : min), intervals[0].in)
  const series: { d: string; head: number; lbs: number }[] = []
  for (let d = firstDay; d <= today; d = addDaysISO(d, 1)) {
    let head = 0, lbs = 0
    for (const c of intervals) {
      if (c.in <= d && (c.out === null || c.out > d)) { head++; lbs += c.lbs }
    }
    series.push({ d, head, lbs: Math.round(lbs) })
  }

  return NextResponse.json({ series, asOf: today, trackingStart, medianHangDays, estimatedExits, hanging, ytd })
}
