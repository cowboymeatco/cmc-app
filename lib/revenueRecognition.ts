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

export type EnterpriseKey = 'harvest' | 'processing' | 'valueAdd' | 'retail' | 'wholesale'

/** Where an enterprise's numbers come from. The two are not interchangeable and
 *  the page says which is which:
 *  - 'schedule': modelled from the plant's own records at the QBO service rates.
 *    The only way to separate the kill floor from the cut floor, because
 *    QuickBooks posts both to one "CMC Custom … Processing" account. Carries a
 *    forward book.
 *  - 'books': the actual daily P&L. Nothing schedules a walk-in or a pallet
 *    going out the door, so retail, the smokehouse and wholesale have no
 *    forward book and stop at today. */
export type EnterpriseSource = 'schedule' | 'books'

export const ENTERPRISES: { key: EnterpriseKey; label: string; source: EnterpriseSource; blurb: string }[] = [
  { key: 'harvest',    label: 'Harvest',    source: 'schedule', blurb: 'kill fees, recognized on kill day' },
  { key: 'processing', label: 'Processing', source: 'schedule', blurb: 'cut & wrap, recognized on the day the carcass is broken' },
  { key: 'valueAdd',   label: 'Value add',  source: 'books',    blurb: 'the smokehouse: custom smoking plus its own product over the counter' },
  { key: 'retail',     label: 'Retail',     source: 'books',    blurb: 'the case — beef, hog, lamb, organ and vendor sales' },
  { key: 'wholesale',  label: 'Wholesale',  source: 'books',    blurb: 'carcasses and boxes sold on, mostly our own animals' },
]

// ── Which income account belongs to which enterprise ──────────────────────────
// QuickBooks already splits the plant the way Charlie thinks about it, so the
// mapping is by account name rather than by guessing at line items.
//
// 'Smokehouse Sales' is a counter sale, but it is the smokehouse's own product
// and the question this section answers is whether the house earns its keep —
// so it sits with the custom smoking rather than with the case. One line to
// move if that's the wrong call.
//
// Wholesale is where our OWN animals turn into money. They're held out of
// harvest and processing on purpose — we don't invoice ourselves a kill fee —
// so this is the line that shows what that side of the plant actually earns.
//
// Deliberately unmapped, and reported separately underneath: the custom
// kill & processing accounts (that money is what the schedule-fed harvest and
// processing figures model — counting both would double it), wild game,
// shipping, and discounts, which can't be attributed to one floor.
export const INCOME_ACCOUNT_ENTERPRISE: Record<string, EnterpriseKey> = {
  'CMC Custom Smokehouse': 'valueAdd',
  'Smokehouse Sales': 'valueAdd',
  'Beef Retail Sales': 'retail',
  'Hog Retail Sales': 'retail',
  'Lamb/Sheep Retail Sales': 'retail',
  'Organ Sales': 'retail',
  'Vendor Retail Sales': 'retail',
  'CMC Wholesale Beef Sales': 'wholesale',
  'CMC Wholesale Hog Sales': 'wholesale',
  'CMC Wholesale Lamb Sales': 'wholesale',
}

/** Income held out of the enterprises entirely, grouped for the footnote. */
export const UNMAPPED_INCOME: Record<string, keyof BooksContext> = {
  'CMC Custom Beef Processing': 'customProcessing',
  'CMC Custom Hog Processing': 'customProcessing',
  'CMC Custom Lamb/Sheep/Goat Processing': 'customProcessing',
  'Wild Game Processing': 'wildGame',
  'Shipping Income': 'shipping',
  'Discounts': 'discounts',
}

export interface BooksContext {
  /** What QuickBooks actually booked for custom kill & processing over the same
   *  days. Not expected to equal the modelled harvest + processing: the gap is
   *  the invoice lag this whole view exists to remove. */
  customProcessing: number
  wildGame: number
  shipping: number
  discounts: number
  other: number
}

export interface BooksInput {
  /** date -> enterprise -> dollars booked that day. */
  byDay: Map<string, Partial<Record<EnterpriseKey, number>>>
  context: BooksContext
  /** Last day the books cover. Nothing after this is knowable from QuickBooks. */
  through: string
}

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
  source: EnterpriseSource
  blurb: string
  earned: number
  scheduled: number
  total: number
  sharePct: number
  /** Head through this floor — schedule-fed enterprises only; 0 for the books. */
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
  /** Present when the window reaches into days the books cover. */
  books: (BooksContext & { through: string }) | null
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

// ── Books → daily enterprise dollars ──────────────────────────────────────────
/**
 * Fold a daily P&L into the two book-fed enterprises, and total what was held
 * out so the page can account for every dollar it isn't showing.
 *
 * `accounts` must be the Income leaves with one value per day in `dates`
 * (qboReports.leafAccountSeries). Sub-total rows come back in that walk too, so
 * an unrecognized name is NOT silently swept into `other` — only names the P&L
 * actually posts to are counted, and anything genuinely new shows up as a
 * mismatch against the section summary rather than as invented revenue.
 */
export function booksFromDailyPnl(
  dates: string[],
  accounts: { name: string; values: number[] }[],
  /** The Income section's own daily summary, so `other` is an exact residual
   *  rather than an assumption about which rows the account walk returned. */
  incomeSummary: number[],
  through: string,
): BooksInput {
  const byDay = new Map<string, Partial<Record<EnterpriseKey, number>>>()
  const context: BooksContext = {
    customProcessing: 0, wildGame: 0, shipping: 0, discounts: 0, other: 0,
  }
  let attributed = 0

  for (const a of accounts) {
    // A section can repeat an account name (two "Vendor Retail Sales" under
    // different parents) and both are real, so don't dedupe by name. Sub-total
    // rows come back from the same walk repeating their children's numbers —
    // they're excluded by only ever counting names we recognize.
    const enterprise = INCOME_ACCOUNT_ENTERPRISE[a.name]
    const bucket = UNMAPPED_INCOME[a.name]
    if (!enterprise && !bucket) continue

    let total = 0
    a.values.forEach((v, i) => {
      total += v
      const date = dates[i]
      if (v === 0 || !date || !enterprise) return
      const row = byDay.get(date) ?? {}
      row[enterprise] = (row[enterprise] ?? 0) + v
      byDay.set(date, row)
    })
    attributed += total
    if (bucket) context[bucket] += total
  }

  context.other = incomeSummary.reduce((s, v) => s + v, 0) - attributed
  for (const key of Object.keys(context) as (keyof BooksContext)[]) context[key] = r2(context[key])
  return { byDay, context, through }
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
  /** Daily P&L for the enterprises the schedule can't reach. Omitted when the
   *  window is entirely in the future, where the books have nothing to say. */
  books?: BooksInput
}

const r2 = (n: number) => Math.round(n * 100) / 100

/** Species billed one flat fee that covers kill and cut together. */
const isFlatAllIn = (species: string) => species === 'Lamb' || species === 'Goat'

const zeroByEnterprise = (): Record<EnterpriseKey, number> =>
  ({ harvest: 0, processing: 0, valueAdd: 0, retail: 0, wholesale: 0 })

export function buildRevenueRecognition(input: BuildInput): RevenueRecognition {
  const { start, end, today, harvests, appointments, packDayByLogId, plannedCutDayByLogId, speciesAvgLbs, books } = input

  const byDay = new Map<string, RevenueDay>()
  const dayOf = (date: string): RevenueDay => {
    let d = byDay.get(date)
    if (!d) {
      d = {
        date,
        earned: zeroByEnterprise(),
        scheduled: zeroByEnterprise(),
        total: 0, headHarvested: 0, headCut: 0, headOwn: 0,
      }
      byDay.set(date, d)
    }
    return d
  }
  const inWindow = (date: string) => date >= start && date <= end

  const speciesAgg = new Map<string, { killHead: number; cutHead: number; harvest: number; processing: number }>()
  // Species only means anything on the two floors that handle animals; retail
  // and the smokehouse arrive as dollars off the books, with no head behind them.
  const bumpSpecies = (species: string, key: 'harvest' | 'processing', amount: number, head: number) => {
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

  // ── Retail and the smokehouse, off the books ────────────────────────────────
  // Nothing schedules a walk-in, so these two are whatever QuickBooks posted on
  // the day. All of it counts as earned: the money is already in the books.
  if (books) {
    for (const [date, amounts] of books.byDay) {
      if (!inWindow(date)) continue
      const d = dayOf(date)
      for (const [key, amount] of Object.entries(amounts) as [EnterpriseKey, number][]) {
        d.earned[key] += amount
      }
    }
  }

  // ── Lay the window out day by day, gaps included ─────────────────────────────
  // A day nobody worked is a real answer to "how is harvest doing" — dropping
  // the empty days would draw a chart of only the good ones.
  const keys = ENTERPRISES.map(e => e.key)
  const days: RevenueDay[] = []
  for (let d = start; d <= end; d = addDaysISO(d, 1)) {
    const row = dayOf(d)
    let total = 0
    for (const k of keys) {
      row.earned[k] = r2(row.earned[k])
      row.scheduled[k] = r2(row.scheduled[k])
      total += row.earned[k] + row.scheduled[k]
    }
    row.total = r2(total)
    days.push(row)
  }

  const sum = (pick: (d: RevenueDay) => number) => days.reduce((a, d) => a + pick(d), 0)
  const totalAll = sum(d => d.total)

  const enterprises: EnterpriseTotal[] = ENTERPRISES.map(e => {
    const earned = sum(d => d.earned[e.key])
    const scheduled = sum(d => d.scheduled[e.key])
    const total = earned + scheduled
    // Head is a kill-floor / cut-floor count. Retail and the smokehouse are
    // measured in dollars off the books, not in animals.
    const head = e.key === 'harvest' ? sum(d => d.headHarvested)
      : e.key === 'processing' ? sum(d => d.headCut)
      : 0
    return {
      key: e.key, label: e.label, source: e.source, blurb: e.blurb,
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
      earned: r2(sum(d => keys.reduce((a, k) => a + d.earned[k], 0))),
      scheduled: r2(sum(d => keys.reduce((a, k) => a + d.scheduled[k], 0))),
      total: r2(totalAll),
    },
    books: books ? { ...books.context, through: books.through } : null,
    coverage,
    speciesAvgLbs,
  }
}
