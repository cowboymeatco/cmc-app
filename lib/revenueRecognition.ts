// Revenue recognition, day by day, fed from the schedule.
//
// The P&L recognizes a job on its INVOICE date, which at a custom plant is
// pickup day — often weeks after the work, and lumped in with everything else
// on that invoice. So "how did the kill floor do this week against the cut
// floor" has no answer in QuickBooks (Charlie, 2026-08-27).
//
// This recognizes each service on the day the work happens: the kill fee on
// kill day, cut & wrap on the day the carcass is broken. Days behind us come
// from what actually happened; days ahead come from the booked harvest
// calendar — the same schedule the plant runs on — so a booked week shows its
// revenue before a knife touches it.
//
// Rates come from lib/billingRules (the QBO service items), so a dollar here
// is the same dollar the billing detector would put on an invoice.

import { killFeeCharge, cutWrapCharge, isExcludedProducer } from './billingRules'
import { projectedCutDate } from './cutSchedule'
import { addDaysISO } from './dates'

export type EnterpriseKey = 'harvest' | 'processing'

export const ENTERPRISES: { key: EnterpriseKey; label: string; blurb: string }[] = [
  { key: 'harvest',    label: 'Harvest',    blurb: 'kill fees, recognized on kill day' },
  { key: 'processing', label: 'Processing', blurb: 'cut & wrap, recognized on the day the carcass is broken' },
]

// ── What the caller has to hand us ────────────────────────────────────────────
export interface HarvestRow {
  id: string
  harvest_date: string
  species: string
  status: string
  producer: string | null
  carcass_tag: string | null
  hot_carcass_weight_lbs: number | null
  appointment_id: string | null
}

/** A booked harvest that hasn't (fully) reached the kill floor yet. */
export interface AppointmentRow {
  id: string
  harvest_date: string
  species: string
  head_count: number | null
  producer_name: string | null
}

/** One saved cut-plan row, straight out of cut_schedule_items. */
export interface PlanRow {
  kind: string
  schedule_date: string
  manual_rank: number | null
  break_date: string | null
  appointment_id: string | null      // holds the harvest_log id, not an appointment id
  future_appointment_id: string | null
}

export interface RevenueDay {
  date: string
  earned: Record<EnterpriseKey, number>
  scheduled: Record<EnterpriseKey, number>
  total: number
  headHarvested: number
  headCut: number
  headOwn: number
}

export interface EnterpriseTotal {
  key: EnterpriseKey
  label: string
  blurb: string
  earned: number
  scheduled: number
  total: number
  sharePct: number
  head: number
  perHead: number
}

export interface SpeciesRow {
  species: string
  killHead: number
  cutHead: number
  harvest: number
  processing: number
  total: number
  avgCarcassLbs: number | null
  /** What one animal is worth on the way through: its kill fee plus its cut &
   *  wrap. Two independent per-head rates added, not the window total divided
   *  by head — an animal killed before the window is still cut inside it. */
  perHead: number
}

export interface RevenueRecognition {
  start: string
  end: string
  today: string
  days: RevenueDay[]
  enterprises: EnterpriseTotal[]
  species: SpeciesRow[]
  totals: { earned: number; scheduled: number; total: number }
  coverage: {
    carcasses: number
    weighed: number         // priced off a real carcass weight
    weightEstimated: number // priced off the species average
    cutDayScanned: number   // cut day came from a pack scan
    cutDayPlanned: number   // cut day came from the live cut plan
    cutDayProjected: number // cut day projected off typical hang days
    bookedHead: number      // head still only on the harvest calendar
    ownHead: number         // CMC's own animals — no service revenue
    unpriced: string[]      // anything no rule could price
  }
  speciesAvgLbs: Record<string, number>
}

// ── Species average carcass weight ────────────────────────────────────────────
// A booked animal has no weight until it's on the rail, so a projected kill fee
// has to be priced off something. The plant's own trailing average is the only
// honest number — no national table knows what a Wibaux steer weighs.
export function speciesAverages(rows: Pick<HarvestRow, 'species' | 'hot_carcass_weight_lbs'>[]): Record<string, number> {
  const sums = new Map<string, { lbs: number; n: number }>()
  for (const r of rows) {
    const w = r.hot_carcass_weight_lbs
    if (!w || w <= 0 || !r.species) continue
    const s = sums.get(r.species) ?? { lbs: 0, n: 0 }
    s.lbs += w
    s.n += 1
    sums.set(r.species, s)
  }
  const out: Record<string, number> = {}
  for (const [species, s] of sums) out[species] = Math.round(s.lbs / s.n)
  return out
}

// ── Which day the crew has a carcass down for ─────────────────────────────────
// The cut plan is ONE ordered list saved under a single schedule_date, split
// into days by 'break' rows: a break heads the day below it. Walking it in
// manual_rank order is the only way to know a carcass's day — the same walk the
// calendar and the planner do. Only the newest plan counts, and only while it
// still describes a day that hasn't passed; a stale plan is a sequence, not a
// schedule.
export function placedCutDays(plan: PlanRow[], todayISO: string): Map<string, string> {
  const byLogId = new Map<string, string>()
  if (plan.length === 0) return byLogId

  const planDate = plan.reduce((a, r) => (r.schedule_date > a ? r.schedule_date : a), plan[0].schedule_date)
  const rows = plan
    .filter(r => r.schedule_date === planDate)
    .sort((a, b) => (a.manual_rank ?? 0) - (b.manual_rank ?? 0))

  let lastDay = planDate
  for (const r of rows) if (r.kind === 'break' && (r.break_date ?? '') > lastDay) lastDay = r.break_date as string
  if (lastDay < todayISO) return byLogId // stale plan — a sequence, not a schedule

  let day = planDate
  for (const r of rows) {
    if (r.kind === 'break') {
      if (r.break_date) day = r.break_date
      continue
    }
    if (r.kind === 'carcass' && r.appointment_id) byLogId.set(r.appointment_id, day)
  }
  return byLogId
}

// ── The engine ────────────────────────────────────────────────────────────────
export interface BuildInput {
  start: string
  end: string
  today: string
  harvests: HarvestRow[]
  appointments: AppointmentRow[]
  /** harvest_log.id -> first pack-scan date: the day the carcass was really broken. */
  packDayByLogId: Map<string, string>
  /** harvest_log.id -> the day the live cut plan has it down for. */
  plannedCutDayByLogId: Map<string, string>
  speciesAvgLbs: Record<string, number>
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Species billed one flat fee that covers kill and cut together. */
const isFlatAllIn = (species: string) => species === 'Lamb' || species === 'Goat'

export function buildRevenueRecognition(input: BuildInput): RevenueRecognition {
  const { start, end, today, harvests, appointments, packDayByLogId, plannedCutDayByLogId, speciesAvgLbs } = input

  const byDay = new Map<string, RevenueDay>()
  const dayOf = (date: string): RevenueDay => {
    let d = byDay.get(date)
    if (!d) {
      d = {
        date,
        earned: { harvest: 0, processing: 0 },
        scheduled: { harvest: 0, processing: 0 },
        total: 0, headHarvested: 0, headCut: 0, headOwn: 0,
      }
      byDay.set(date, d)
    }
    return d
  }
  const inWindow = (date: string) => date >= start && date <= end

  const speciesAgg = new Map<string, { killHead: number; cutHead: number; harvest: number; processing: number }>()
  const bumpSpecies = (species: string, key: EnterpriseKey, amount: number, head: number) => {
    const s = speciesAgg.get(species) ?? { killHead: 0, cutHead: 0, harvest: 0, processing: 0 }
    s[key] += amount
    if (key === 'harvest') s.killHead += head
    else s.cutHead += head
    speciesAgg.set(species, s)
  }

  const coverage = {
    carcasses: 0, weighed: 0, weightEstimated: 0,
    cutDayScanned: 0, cutDayPlanned: 0, cutDayProjected: 0,
    bookedHead: 0, ownHead: 0, unpriced: [] as string[],
  }
  const unpriced = new Set<string>()

  // Every carcass is priced as one whole unit. Quarters carry a nickel-a-pound
  // premium over whole/half, but who pays for which quarter is a billing
  // question, not an enterprise one, and the shares always add back up to one
  // carcass. Ignoring the premium understates beef cut & wrap by well under a
  // percent; guessing at it would be worse.
  const WHOLE = 1

  for (const h of harvests) {
    const species = h.species || ''
    const tag = h.carcass_tag || h.id.slice(0, 8)

    // Own animals never generate a service charge — their money shows up in
    // retail when the cuts sell, not here. They still cost a kill-floor day,
    // so the head count stays visible.
    if (isExcludedProducer(h.producer ?? '')) {
      coverage.ownHead += 1
      if (inWindow(h.harvest_date)) dayOf(h.harvest_date).headOwn += 1
      continue
    }

    coverage.carcasses += 1
    const realWeight = h.hot_carcass_weight_lbs && h.hot_carcass_weight_lbs > 0 ? h.hot_carcass_weight_lbs : null
    const lbs = realWeight ?? speciesAvgLbs[species] ?? null
    if (realWeight) coverage.weighed += 1
    else if (lbs) coverage.weightEstimated += 1

    // ── Kill fee, on kill day ────────────────────────────────────────────────
    // Lamb and goat are one flat all-in fee charged at cut time: goat's kill has
    // always been inside it, and for lamb the $180 supersedes the $50 kill-only
    // fee the moment the animal is fully processed (see billingRules). Their
    // whole ticket therefore lands on the cut floor — recognizing a kill fee
    // too would be revenue that never reaches an invoice.
    if (!isFlatAllIn(species)) {
      const kill = killFeeCharge(species, lbs, WHOLE, tag)
      if (kill && inWindow(h.harvest_date)) {
        const d = dayOf(h.harvest_date)
        const bucket = h.harvest_date <= today ? d.earned : d.scheduled
        bucket.harvest += kill.amount
        d.headHarvested += 1
        bumpSpecies(species, 'harvest', kill.amount, 1)
      } else if (!kill) {
        unpriced.add(`${species}: no kill rate${lbs ? '' : ' and no carcass weight'}`)
      }
    } else if (inWindow(h.harvest_date)) {
      // Still a head through the kill floor, just not a separate charge.
      dayOf(h.harvest_date).headHarvested += 1
    }

    // ── Cut & wrap, on the day the carcass is broken ─────────────────────────
    // Best day first: a pack scan is what actually happened, the live plan is
    // where the crew put it, and the hang projection is the fallback so a
    // carcass in the cooler isn't invisible until someone opens the planner.
    const scanned = packDayByLogId.get(h.id)
    const planned = plannedCutDayByLogId.get(h.id)
    const cutDay = scanned ?? planned ?? projectedCutDate(h.harvest_date, species)
    if (scanned) coverage.cutDayScanned += 1
    else if (planned) coverage.cutDayPlanned += 1
    else coverage.cutDayProjected += 1

    const cut = cutWrapCharge(species, lbs, WHOLE, tag)
    if (cut && inWindow(cutDay)) {
      const d = dayOf(cutDay)
      // Earned means the knife work is done: the carcass is marked cut, or a
      // pack scan says so. A day in the past with the animal still hanging is
      // scheduled work, just late.
      const done = h.status === 'cut' || Boolean(scanned)
      const bucket = done && cutDay <= today ? d.earned : d.scheduled
      bucket.processing += cut.amount
      d.headCut += 1
      bumpSpecies(species, 'processing', cut.amount, 1)
    } else if (!cut) {
      unpriced.add(`${species}: no cut & wrap rate${lbs ? '' : ' and no carcass weight'}`)
    }
  }

  // ── Booked head that hasn't reached the kill floor ───────────────────────────
  // head_count minus whatever the harvest log already holds for that booking,
  // so a part-killed day isn't counted twice.
  const harvestedByAppt = new Map<string, number>()
  for (const h of harvests) {
    if (!h.appointment_id) continue
    harvestedByAppt.set(h.appointment_id, (harvestedByAppt.get(h.appointment_id) ?? 0) + 1)
  }

  for (const a of appointments) {
    const remaining = (a.head_count ?? 0) - (harvestedByAppt.get(a.id) ?? 0)
    if (remaining <= 0) continue
    const species = a.species || ''

    if (isExcludedProducer(a.producer_name ?? '')) {
      coverage.ownHead += remaining
      if (inWindow(a.harvest_date)) dayOf(a.harvest_date).headOwn += remaining
      continue
    }

    const lbs = speciesAvgLbs[species] ?? null
    coverage.bookedHead += remaining
    const cutDay = projectedCutDate(a.harvest_date, species)

    const kill = isFlatAllIn(species) ? null : killFeeCharge(species, lbs, WHOLE, 'booked')
    if (kill && inWindow(a.harvest_date)) {
      const d = dayOf(a.harvest_date)
      d.scheduled.harvest += kill.amount * remaining
      d.headHarvested += remaining
      bumpSpecies(species, 'harvest', kill.amount * remaining, remaining)
    } else if (!kill && inWindow(a.harvest_date)) {
      dayOf(a.harvest_date).headHarvested += remaining
    }
    const cut = cutWrapCharge(species, lbs, WHOLE, 'booked')
    if (cut && inWindow(cutDay)) {
      const d = dayOf(cutDay)
      d.scheduled.processing += cut.amount * remaining
      d.headCut += remaining
      bumpSpecies(species, 'processing', cut.amount * remaining, remaining)
    }
  }

  // ── Lay the window out day by day, gaps included ─────────────────────────────
  // A day nobody worked is a real answer to "how is harvest doing" — dropping
  // the empty days would draw a chart of only the good ones.
  const days: RevenueDay[] = []
  for (let d = start; d <= end; d = addDaysISO(d, 1)) {
    const row = dayOf(d)
    row.earned = { harvest: r2(row.earned.harvest), processing: r2(row.earned.processing) }
    row.scheduled = { harvest: r2(row.scheduled.harvest), processing: r2(row.scheduled.processing) }
    row.total = r2(row.earned.harvest + row.earned.processing + row.scheduled.harvest + row.scheduled.processing)
    days.push(row)
  }

  const sum = (pick: (d: RevenueDay) => number) => days.reduce((a, d) => a + pick(d), 0)
  const totalAll = sum(d => d.total)

  const enterprises: EnterpriseTotal[] = ENTERPRISES.map(e => {
    const earned = sum(d => d.earned[e.key])
    const scheduled = sum(d => d.scheduled[e.key])
    const total = earned + scheduled
    const head = e.key === 'harvest' ? sum(d => d.headHarvested) : sum(d => d.headCut)
    return {
      key: e.key, label: e.label, blurb: e.blurb,
      earned: r2(earned), scheduled: r2(scheduled), total: r2(total),
      sharePct: totalAll > 0 ? Math.round((total / totalAll) * 1000) / 10 : 0,
      head,
      perHead: head > 0 ? Math.round(total / head) : 0,
    }
  })

  const species: SpeciesRow[] = [...speciesAgg.entries()]
    .map(([name, s]) => ({
      species: name,
      killHead: s.killHead,
      cutHead: s.cutHead,
      harvest: r2(s.harvest),
      processing: r2(s.processing),
      total: r2(s.harvest + s.processing),
      avgCarcassLbs: speciesAvgLbs[name] ?? null,
      perHead: Math.round(
        (s.killHead > 0 ? s.harvest / s.killHead : 0) + (s.cutHead > 0 ? s.processing / s.cutHead : 0),
      ),
    }))
    .sort((a, b) => b.total - a.total)

  coverage.unpriced = [...unpriced]

  return {
    start, end, today, days, enterprises, species,
    totals: {
      earned: r2(sum(d => d.earned.harvest + d.earned.processing)),
      scheduled: r2(sum(d => d.scheduled.harvest + d.scheduled.processing)),
      total: r2(totalAll),
    },
    coverage,
    speciesAvgLbs,
  }
}
