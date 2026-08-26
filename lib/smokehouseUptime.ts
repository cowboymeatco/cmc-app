// How much of the time the smokehouse is actually cooking.
//
// Charlie, 2026-08-26: "Can I get a smokehouse uptime? I would like to see how
// often the smokehouse is running on a basis."
//
// /exec already counts cooks per day and per week. A count doesn't answer this:
// eight short cooks and eight overnight ones are the same number and less than
// half the hours. Time in the house is the measure of the asset.
//
// Pure, and separate from the route, so the arithmetic behind a number Charlie
// makes decisions on can be checked against the raw cook table.

/** Hours in the denominator: the calendar week.
 *
 *  NOT shop hours. The house runs unattended through the night — about a fifth
 *  of its cooks end on a later date than they started, and it runs some
 *  weekends — so an hours-open denominator prints utilisation over 100% and
 *  means nothing. 168 h is the week the oven has. */
export const WEEK_HOURS = 7 * 24

export interface CookRow { started_at: string; ended_at: string | null }

export interface SmokehouseWeek {
  week:    string   // Monday, plant-local, YYYY-MM-DD
  cooks:   number
  hours:   number
  daysRun: number
  utilPct: number
}

export interface SmokehouseSummary {
  weekHours: number
  series: SmokehouseWeek[]
  current: SmokehouseWeek | null
  last4:   { utilPct: number; hours: number; cooks: number; daysRun: number }
  priorUtilPct: number | null
  lastCookEndedAt: string | null
  daysSinceLastCook: number | null
  feedStale: boolean
}

/** Plant-local date (Mountain), as YYYY-MM-DD. */
export const localDate = (d: Date) =>
  d.toLocaleDateString('en-CA', { timeZone: 'America/Denver' })

/** The Monday on or before `iso`. */
export function weekStart(iso: string): string {
  const d = new Date(iso + 'T12:00:00Z')
  const dow = (d.getUTCDay() + 6) % 7            // 0 = Monday
  d.setUTCDate(d.getUTCDate() - dow)
  return d.toISOString().slice(0, 10)
}

const round1 = (n: number) => Math.round(n * 10) / 10
const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0)

/**
 * @param rows  cooks overlapping the window, any order
 * @param weeks how many weekly buckets to return, ending with the current one
 * @param now   evaluation time (injected so this can be tested)
 *
 * A cook counts in the week it STARTED, whole. Splitting the handful that cross
 * midnight on a Sunday across two buckets would move a couple of hours and cost
 * the reader a footnote to understand any number on the page.
 */
export function summariseCooks(rows: CookRow[], weeks: number, now: Date): SmokehouseSummary {
  // Every week in the window, present or not. A week the house never ran is a
  // real zero and has to draw as one — leaving it out would close the gap up
  // and turn an idle fortnight into a continuous line.
  const buckets = new Map<string, { cooks: number; hours: number; days: Set<string> }>()
  const thisWeek = weekStart(localDate(now))
  for (let i = weeks - 1; i >= 0; i--) {
    const d = new Date(thisWeek + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() - i * 7)
    buckets.set(d.toISOString().slice(0, 10), { cooks: 0, hours: 0, days: new Set() })
  }

  let lastEnd: string | null = null
  for (const r of rows) {
    if (!r.started_at) continue
    const startedLocal = localDate(new Date(r.started_at))
    const b = buckets.get(weekStart(startedLocal))
    if (!b) continue                                   // outside the window
    b.cooks++
    b.days.add(startedLocal)
    // A cook with no end never closed out — count that it happened, but don't
    // invent hours for it. Better a slightly low utilisation than a made-up one.
    if (r.ended_at) {
      const h = (new Date(r.ended_at).getTime() - new Date(r.started_at).getTime()) / 3_600_000
      if (h > 0) b.hours += h
      if (!lastEnd || r.ended_at > lastEnd) lastEnd = r.ended_at
    }
  }

  const series: SmokehouseWeek[] = [...buckets.entries()].map(([week, b]) => ({
    week,
    cooks:   b.cooks,
    hours:   round1(b.hours),
    daysRun: b.days.size,
    utilPct: round1((b.hours / WEEK_HOURS) * 100),
  }))

  // The current week is partial, so it is excluded from the averages — a
  // Monday-morning read would otherwise show utilisation collapsing every week.
  const complete = series.slice(0, -1)
  const recent   = complete.slice(-4)

  const daysSinceLastCook = lastEnd
    ? Math.floor((now.getTime() - new Date(lastEnd).getTime()) / 86_400_000)
    : null

  return {
    weekHours: WEEK_HOURS,
    series,
    current: series[series.length - 1] ?? null,
    last4: {
      utilPct: round1(avg(recent.map(w => w.utilPct))),
      hours:   round1(avg(recent.map(w => w.hours))),
      cooks:   round1(avg(recent.map(w => w.cooks))),
      daysRun: round1(avg(recent.map(w => w.daysRun))),
    },
    priorUtilPct: complete.length > 4 ? round1(avg(complete.slice(-8, -4).map(w => w.utilPct))) : null,
    lastCookEndedAt: lastEnd,
    daysSinceLastCook,
    // The cook feed is an FTP script on the packaging kiosk and its failure mode
    // is silence — it went down for four days in August and nothing said so.
    // Zero cooks therefore has two meanings, an idle house or a dead importer,
    // and this flag is the only thing that separates them. Long enough that a
    // genuinely quiet stretch doesn't cry wolf, short enough to catch the
    // importer before a month of cooks is missing.
    feedStale: daysSinceLastCook == null || daysSinceLastCook > 10,
  }
}
