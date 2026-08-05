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
//
// The daily head count is also broken out by species, because head and pounds
// move independently: a beef runs 600–1,000 lbs and a lamb 60–90, so a day
// that empties the cooler of hogs barely dents the pounds line. Without the
// mix the two panels look like they contradict each other.

interface HarvestRow {
  id:                     string
  harvest_date:           string
  status:                 string
  species:                string | null
  hot_carcass_weight_lbs: number | null
  half_1_weight_lbs:      number | null
  half_2_weight_lbs:      number | null
}

const FALLBACK_HANG_DAYS = 14

// Fixed order — the UI pins a color to each name, so this list must not be
// reordered or derived from volume. Anything unrecognized folds into 'Other'.
export const SPECIES = ['Beef', 'Hog', 'Lamb', 'Goat', 'Other'] as const
type Species = (typeof SPECIES)[number]

function speciesOf(h: HarvestRow): Species {
  const s = (h.species ?? '').trim()
  return (SPECIES as readonly string[]).includes(s) && s !== 'Other' ? (s as Species) : 'Other'
}

function carcassLbs(h: HarvestRow): number {
  if (h.hot_carcass_weight_lbs != null) return Number(h.hot_carcass_weight_lbs)
  return Number(h.half_1_weight_lbs ?? 0) + Number(h.half_2_weight_lbs ?? 0)
}

export async function GET() {
  const [harvestRes, scheduleRes, planRes] = await Promise.all([
    supabase
      .from('harvest_log')
      .select('id,harvest_date,status,species,hot_carcass_weight_lbs,half_1_weight_lbs,half_2_weight_lbs')
      .order('harvest_date', { ascending: true }),
    supabase
      .from('cut_schedule_items')
      .select('appointment_id,schedule_date')
      .not('appointment_id', 'is', null),
    // The CURRENT plan in full — breaks included, in rank order — so we can read
    // the day each carcass is actually laid out for. schedule_date above is only
    // the day a plan was SAVED; the cutting day lives on the day break above the
    // row (see plannedDay below).
    supabase
      .from('cut_schedule_items')
      .select('appointment_id,kind,manual_rank,break_date,schedule_date')
      .order('schedule_date', { ascending: false })
      .order('manual_rank',   { ascending: true }),
  ])
  if (harvestRes.error)  return NextResponse.json({ error: harvestRes.error.message },  { status: 500 })
  if (scheduleRes.error) return NextResponse.json({ error: scheduleRes.error.message }, { status: 500 })
  if (planRes.error)     return NextResponse.json({ error: planRes.error.message },     { status: 500 })

  const carcasses = (harvestRes.data ?? []) as HarvestRow[]
  const today     = isoDate()

  // ── The day each carcass is actually laid out to be cut ─────────────────────
  // A day break heads the rows beneath it, so a carcass's cutting day is the
  // break_date of the nearest break ABOVE it in the current plan — the same rule
  // the planner and crew view use. Rows above the first dated break have no day
  // picked yet and are left out.
  //
  // This is deliberately NOT min(schedule_date): that's the day a plan was
  // saved, uniform across every row in it, so a carcass that showed up in a plan
  // three weeks ago and has been re-planned twice since still read as due back
  // then. It made the "still marked chilling" banner cry wolf over 27 head that
  // were, in the live plan, scheduled for later this week (Charlie, 2026-08-05).
  const planRows  = (planRes.data ?? []) as {
    appointment_id: string | null; kind: string | null; manual_rank: number
    break_date: string | null; schedule_date: string
  }[]
  const planDate  = planRows[0]?.schedule_date ?? null
  const plannedDay = new Map<string, string>()
  {
    let day = ''
    for (const r of planRows) {
      if (r.schedule_date !== planDate) break
      if (r.kind === 'break') day = r.break_date ?? ''
      else if (day && r.appointment_id) plannedDay.set(r.appointment_id, day)
    }
  }

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
      return { in: h.harvest_date, out, lbs: carcassLbs(h), species: speciesOf(h) }
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

  // Carcasses the cut schedule says are already cut but that nobody marked cut
  // on the harvest log. Only the status moves a carcass out of the cooler, so
  // these sit in the count indefinitely and flatten both panels. Reported, not
  // silently corrected — the schedule is a plan, and a slipped cut looks the
  // same as an unrecorded one. The crew marks them cut on /processing.
  const staleRows = carcasses.filter(h =>
    h.status === 'chilling' && (plannedDay.get(h.id) ?? today) < today
  )
  const stale = {
    head:      staleRows.length,
    lbs:       Math.round(staleRows.reduce((sum, h) => sum + carcassLbs(h), 0)),
    oldestDue: staleRows.length
      ? staleRows.map(h => plannedDay.get(h.id)!).sort()[0]
      : null,
  }

  // ── Projected draw-down ─────────────────────────────────────────────────────
  // What the cooler looks like on each day ahead if the plan is cut as laid out:
  // a carcass leaves on its planned day, so day d holds everything still
  // chilling whose day is later than d. Carcasses with no day picked never come
  // off — they're the flat floor the line settles onto, and that gap is the
  // point: it shows what's left unaccounted for at the end of the plan.
  const chilling = carcasses.filter(h => h.status === 'chilling' && h.harvest_date)
  const lastDay  = Array.from(plannedDay.values()).sort().pop() ?? null
  const projection: { d: string; head: number; lbs: number; cut: number; cutLbs: number }[] = []
  if (lastDay && lastDay >= today) {
    for (let d = today; d <= lastDay; d = addDaysISO(d, 1)) {
      let head = 0, lbs = 0, cut = 0, cutLbs = 0
      for (const h of chilling) {
        const day = plannedDay.get(h.id)
        if (!day || day > d) { head++; lbs += carcassLbs(h) }
        else                 { cut++;  cutLbs += carcassLbs(h) }
      }
      projection.push({ d, head, lbs: Math.round(lbs), cut, cutLbs: Math.round(cutLbs) })
    }
  }
  const unplanned = chilling.filter(h => !plannedDay.has(h.id))
  const drawdown = {
    days:      projection,
    planDate,
    lastDay,
    unplanned: {
      head: unplanned.length,
      lbs:  Math.round(unplanned.reduce((s, h) => s + carcassLbs(h), 0)),
    },
  }

  if (!intervals.length) {
    return NextResponse.json({ series: [], asOf: today, trackingStart, medianHangDays, estimatedExits, hanging, ytd, stale, drawdown })
  }

  // Daily series: a carcass counts on days [in, out) — it hangs the day it
  // arrives and is gone the day it's cut.
  const firstDay = intervals.reduce((min, c) => (c.in < min ? c.in : min), intervals[0].in)
  const series: { d: string; head: number; lbs: number; sp: Record<string, number> }[] = []
  for (let d = firstDay; d <= today; d = addDaysISO(d, 1)) {
    let head = 0, lbs = 0
    const sp: Record<string, number> = {}
    for (const c of intervals) {
      if (c.in <= d && (c.out === null || c.out > d)) {
        head++
        lbs += c.lbs
        sp[c.species] = (sp[c.species] ?? 0) + 1
      }
    }
    series.push({ d, head, lbs: Math.round(lbs), sp })
  }

  return NextResponse.json({ series, asOf: today, trackingStart, medianHangDays, estimatedExits, hanging, ytd, stale, drawdown })
}
