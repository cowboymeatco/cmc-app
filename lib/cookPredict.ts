// Value-add scheduling model: how long a cook takes, when it comes out, and
// what the house can hold in a day.
//
// The numbers come from 1048 real smokehouse cook cycles (2019-2023 controller
// logs in "Cooking Record"). Three facts out of that history shape everything
// here:
//
//   1. THE HOUSE IS ONE LANE. Peak observed concurrency was 2, and that was
//      0.1% of transitions. Cooks run one at a time, so this is a sequencing
//      problem, not a bin-packing one.
//   2. DURATION IS THE RECIPE, NOT THE LOAD. Summer sausage ran the same
//      6-stage plan on 136 of 143 cycles. The controller schedule sets the
//      clock; how much meat is on the trucks sets the BATCH COUNT. So a job
//      bigger than one load is N cooks back to back, not one longer cook.
//   3. RECIPES DRIFT. Jerky went 6.2h -> 4.5h in 2023 and hot dogs 1.8h ->
//      3.0h. Profiles carry the basis they were fitted on so a stale median
//      is visible rather than silently wrong.
//
// Everything below is pure — no fetching — so the planner page, the API, and
// any future report all predict identically.
import { ValueAddJob } from '@/lib/types'

export interface CookProfile {
  id:                 string
  profile_key:        string
  display_name:       string
  job_type:           string
  active:             boolean
  p10_minutes:        number
  p50_minutes:        number
  p90_minutes:        number
  setup_minutes:      number
  teardown_minutes:   number
  lbs_per_batch:      number | null
  ramp_f_per_hr:      number | null
  target_core_f:      number | null
  typical_start_hour: number | null
  overnight_pct:      number | null
  n_observations:     number
  basis:              string | null
  source:             string
  stage_plan:         { sp_f: number; minutes: number }[] | null
  notes:              string | null
}

export interface CookSettings {
  houses:             number
  changeover_minutes: number
  day_start_hour:     number
  day_end_hour:       number
}

export const DEFAULT_SETTINGS: CookSettings = {
  houses:             1,
  changeover_minutes: 58,   // median cook-out -> next-cook-in on the same shift
  day_start_hour:     6,
  day_end_hour:       17,
}

// ── Matching a job to a profile ──────────────────────────────────────────────
// Jobs are typed by hand ("Make snack sticks", "SNACK STICK 1LB"), so the match
// has to survive loose wording. Explicit profile_key always wins — once someone
// has picked, we never second-guess them.

// Words that carry no product meaning; stripped before comparing so
// "SMOKED BEEF SNACK STICKS 1 LB" still lands on SNACK STICKS.
const NOISE = new Set([
  'make', 'the', 'and', 'with', 'lb', 'lbs', 'oz', 'pack', 'pkg', 'bulk',
  'retail', 'smoked', 'smkd', 'fresh', 'raw', 'cmc', 'beef', 'pork', 'a', 'of',
  // Connectors. 'in' in particular used to count as a real token, which let
  // "BEEF BONE-IN RIB STEAK" cover two thirds of "BONE IN HAM" and get
  // scheduled as a ten-hour ham cook.
  'in', 'on', 'to', 'no', 'for',
])

function tokens(s: string): string[] {
  return s
    .toUpperCase()
    .replace(/[^A-Z0-9 ]+/g, ' ')
    .split(/\s+/)
    .filter(t => t.length > 1 && !NOISE.has(t.toLowerCase()))
}

// Singular/plural and the shop's abbreviations both need to collapse:
// STICKS->STICK, SNACKSTICK->SNACK STICK, HOTDOG->HOT DOG.
function normalize(t: string): string {
  let x = t
  if (x.endsWith('S') && x.length > 3) x = x.slice(0, -1)
  return x
}

const ALIASES: Record<string, string> = {
  SNACKSTICK: 'SNACK STICK',
  SNCKSTK:    'SNACK STICK',
  HOTDOG:     'HOT DOG',
  WIENER:     'HOT DOG',
  FRANK:      'HOT DOG',
  BRAT:       'BRAT',
  BRATWURST:  'BRAT',
  SS:         'SUMMER SAUSAGE',
  JERKY:      'JERKY',
  BACON:      'BACON',
  HAM:        'HAM',
  BRISKET:    'BRISKET',
  BUTT:       'PORK BUTT',
  CHEESE:     'CHEESE',
}

function expand(text: string): Set<string> {
  const out = new Set<string>()
  for (const raw of tokens(text)) {
    const t = normalize(raw)
    const alias = ALIASES[raw] ?? ALIASES[t]
    if (alias) for (const a of tokens(alias)) out.add(normalize(a))
    out.add(t)
  }
  return out
}

export interface ProfileMatch {
  profile:    CookProfile
  score:      number
  /** true when the job named the profile outright, so the UI can stop hedging */
  explicit:   boolean
}

/**
 * Best profile for a job, or null when nothing plausibly matches. Scores by
 * how much of the PROFILE's name the job text covers — "snack sticks" fully
 * covers SNACK STICKS, while a bare "sausage" covers only half of SUMMER
 * SAUSAGE and loses to a better candidate.
 */
export function matchProfile(
  job:      Pick<ValueAddJob, 'output_item_name' | 'description' | 'job_type'> & { profile_key?: string | null },
  profiles: CookProfile[]
): ProfileMatch | null {
  const active = profiles.filter(p => p.active)

  if (job.profile_key) {
    const picked = active.find(p => p.profile_key === job.profile_key)
    if (picked) return { profile: picked, score: 1, explicit: true }
  }

  const text = `${job.output_item_name ?? ''} ${job.description ?? ''}`
  const jobTokens = expand(text)
  if (jobTokens.size === 0) return null

  let best: ProfileMatch | null = null
  for (const p of active) {
    const nameTokens = expand(`${p.profile_key} ${p.display_name}`)
    if (nameTokens.size === 0) continue

    // The product noun the profile is actually named for — HAM, STICK, BACON.
    // Shared modifiers are not enough on their own: "bone" is common to
    // BONE IN HAM and BONE IN PORKCHOP and to half the retail steak case, so a
    // match that misses the noun is not a match at all.
    const head = headNoun(p.profile_key) ?? headNoun(p.display_name)
    if (head && !jobTokens.has(head)) continue

    let hit = 0
    for (const t of nameTokens) if (jobTokens.has(t)) hit++
    if (hit === 0) continue

    // Coverage of the profile name, nudged by job-type agreement so a
    // smokehouse job prefers a smokehouse profile on an otherwise even tie.
    let score = hit / nameTokens.size
    if (p.job_type === job.job_type) score += 0.05

    if (!best || score > best.score) best = { profile: p, score, explicit: false }
  }

  // A single shared word out of a long name ("beef" against BEEF JERKY) is
  // noise, not a match. Demand most of the profile name: at half, "PORK
  // SAUSAGE" covered SUMMER SAUSAGE and fresh sausage read as summer sausage.
  return best && best.score >= 0.6 ? best : null
}

/** Last meaningful word of a product name — what the thing actually is. */
function headNoun(name: string): string | null {
  const t = tokens(name).map(normalize)
  return t.length ? t[t.length - 1] : null
}

// ── Duration ─────────────────────────────────────────────────────────────────

export interface Prediction {
  minutes:      number        // p50, what the schedule is laid out on
  optimistic:   number        // p10
  pessimistic:  number        // p90
  batches:      number
  cookMinutes:  number        // time in the house, all batches + changeovers
  setupMinutes: number
  teardownMinutes: number
  profile:      CookProfile
  /** Why the crew should or shouldn't trust this number. */
  confidence:   'high' | 'medium' | 'low'
  basis:        string
}

/** How many house loads a job needs. Unknown batch size = one load. */
export function batchesFor(profile: CookProfile, lbs: number | null): number {
  if (!lbs || !profile.lbs_per_batch || profile.lbs_per_batch <= 0) return 1
  return Math.max(1, Math.ceil(lbs / profile.lbs_per_batch))
}

/**
 * Total wall-clock a job occupies, from the crew picking it up to it being
 * out and packed. Multi-batch jobs pay the house changeover between loads.
 */
export function predict(
  profile:  CookProfile,
  lbs:      number | null,
  settings: CookSettings = DEFAULT_SETTINGS
): Prediction {
  const batches = batchesFor(profile, lbs)
  const between = (batches - 1) * settings.changeover_minutes

  const scale = (m: number) => m * batches + between

  // n and spread together say how much to trust the median. A profile fitted
  // on 200 tight cycles is a promise; one fitted on 9 loose ones is a guess.
  const spread = profile.p50_minutes > 0
    ? (profile.p90_minutes - profile.p10_minutes) / profile.p50_minutes
    : 1
  const confidence: Prediction['confidence'] =
    profile.n_observations >= 40 && spread <= 0.5 ? 'high'
      : profile.n_observations >= 15 && spread <= 1.2 ? 'medium'
        : 'low'

  return {
    minutes:         scale(profile.p50_minutes) + profile.setup_minutes + profile.teardown_minutes,
    optimistic:      scale(profile.p10_minutes) + profile.setup_minutes + profile.teardown_minutes,
    pessimistic:     scale(profile.p90_minutes) + profile.setup_minutes + profile.teardown_minutes,
    batches,
    cookMinutes:     scale(profile.p50_minutes),
    setupMinutes:    profile.setup_minutes,
    teardownMinutes: profile.teardown_minutes,
    profile,
    confidence,
    basis:           profile.basis ?? 'all history',
  }
}

/** Convenience: match + predict in one step. Null when nothing matched. */
export function predictJob(
  job:      Pick<ValueAddJob, 'output_item_name' | 'description' | 'job_type' | 'weight_in_lbs'> & { profile_key?: string | null },
  profiles: CookProfile[],
  settings: CookSettings = DEFAULT_SETTINGS
): Prediction | null {
  const m = matchProfile(job, profiles)
  if (!m) return null
  return predict(m.profile, job.weight_in_lbs, settings)
}

// ── Sequencing the house ─────────────────────────────────────────────────────

export interface PlannedJob {
  job:        ValueAddJob
  start:      Date
  end:        Date
  prediction: Prediction | null
  /** No profile matched — the crew has to say how long it takes. */
  unknown:    boolean
  /** Comes out after the day-end hour, so somebody has to pull it late or overnight. */
  overnight:  boolean
}

export interface Plan {
  scheduled:   PlannedJob[]
  /** Jobs left out because nothing predicts their length. */
  unplannable: ValueAddJob[]
  houseEnd:    Date | null
}

function addMinutes(d: Date, m: number): Date {
  return new Date(d.getTime() + m * 60000)
}

function atHour(day: Date, hour: number): Date {
  const d = new Date(day)
  d.setHours(hour, 0, 0, 0)
  return d
}

/**
 * Lay a queue of jobs into the single house, back to back, starting no earlier
 * than `from`. Jobs already locked to a time hold their slot and everything
 * else flows around them.
 *
 * Order is the caller's order — the planner hands us the crew's priority list,
 * so this does not re-sort behind their back.
 */
export function planHouse(
  jobs:     ValueAddJob[],
  profiles: CookProfile[],
  settings: CookSettings = DEFAULT_SETTINGS,
  from:     Date = new Date()
): Plan {
  const scheduled:   PlannedJob[] = []
  const unplannable: ValueAddJob[] = []

  // Locked jobs are immovable walls; the flowing jobs must not overlap them.
  const locked = jobs
    .filter(j => j.schedule_locked && j.scheduled_start)
    .map(j => {
      const p = predictJob(j, profiles, settings)
      const start = new Date(j.scheduled_start as string)
      return {
        job: j, start, prediction: p,
        end: addMinutes(start, p?.minutes ?? j.predicted_minutes ?? 0),
        unknown: !p && !j.predicted_minutes,
        overnight: false,
      } as PlannedJob
    })
    .sort((a, b) => a.start.getTime() - b.start.getTime())

  let cursor = new Date(from)

  const clearOf = (start: Date, minutes: number): Date => {
    // Push past any locked block this would collide with, then re-check —
    // moving past one wall can land on the next.
    let s = new Date(start)
    let moved = true
    while (moved) {
      moved = false
      for (const l of locked) {
        const e = addMinutes(s, minutes)
        if (s < l.end && e > l.start) {
          s = addMinutes(l.end, settings.changeover_minutes)
          moved = true
        }
      }
    }
    return s
  }

  for (const job of jobs) {
    if (job.schedule_locked && job.scheduled_start) continue  // already placed

    const prediction = predictJob(job, profiles, settings)
    const minutes = prediction?.minutes ?? job.predicted_minutes ?? null
    if (minutes === null) {
      unplannable.push(job)
      continue
    }

    const start = clearOf(cursor, minutes)
    const end   = addMinutes(start, minutes)

    scheduled.push({
      job, start, end, prediction,
      unknown:   !prediction,
      overnight: end.getHours() >= settings.day_end_hour || end.getDate() !== start.getDate(),
    })
    cursor = addMinutes(end, settings.changeover_minutes)
  }

  const all = [...scheduled, ...locked].sort((a, b) => a.start.getTime() - b.start.getTime())
  return {
    scheduled:   all,
    unplannable,
    houseEnd:    all.length ? all[all.length - 1].end : null,
  }
}

/**
 * When should this go in so it comes OUT at a given time? Backwards planning is
 * how the crew actually thinks about an overnight cook — snack sticks have to
 * be out by 6am, so they go in at 17:17 the night before.
 */
export function startForFinish(
  profile:  CookProfile,
  finishAt: Date,
  lbs:      number | null = null,
  settings: CookSettings = DEFAULT_SETTINGS
): Date {
  return addMinutes(finishAt, -predict(profile, lbs, settings).minutes)
}

/** The start hour the crew has historically used for this product. */
export function suggestedStart(profile: CookProfile, day: Date): Date | null {
  if (profile.typical_start_hour === null) return null
  return atHour(day, profile.typical_start_hour)
}

// ── Live ETA for a cook already running ──────────────────────────────────────

export interface LiveEta {
  etaMinutes:  number
  etaAt:       Date
  rampFPerHr:  number
  currentF:    number
  targetF:     number
  /** Fit quality: a stalled or noisy probe should not produce a confident ETA. */
  confidence:  'high' | 'medium' | 'low'
}

/**
 * Project when a running cook reaches target core, from the probe's own recent
 * slope rather than the profile average — a heavy load climbs slower than the
 * median and the crew needs to know that at 2am, not afterwards.
 *
 * Fits a least-squares line over the trailing window. Falls back to the
 * profile's historical ramp when the probe has not moved enough to fit.
 */
export function liveEta(
  readings:      { read_at: string; temp_f: number | null }[],
  targetF:       number,
  fallbackRamp:  number | null = null,
  windowMinutes  = 45
): LiveEta | null {
  const pts = readings
    .filter(r => r.temp_f !== null)
    .map(r => ({ t: new Date(r.read_at).getTime(), f: Number(r.temp_f) }))
    .sort((a, b) => a.t - b.t)

  if (pts.length === 0) return null

  const last    = pts[pts.length - 1]
  const cutoff  = last.t - windowMinutes * 60000
  const win     = pts.filter(p => p.t >= cutoff)

  if (last.f >= targetF) {
    return {
      etaMinutes: 0, etaAt: new Date(last.t), rampFPerHr: 0,
      currentF: last.f, targetF, confidence: 'high',
    }
  }

  // Least-squares slope in °F per hour.
  let ramp: number | null = null
  let confidence: LiveEta['confidence'] = 'low'
  if (win.length >= 4) {
    const n  = win.length
    const t0 = win[0].t
    const xs = win.map(p => (p.t - t0) / 3600000)   // hours
    const ys = win.map(p => p.f)
    const mx = xs.reduce((a, b) => a + b, 0) / n
    const my = ys.reduce((a, b) => a + b, 0) / n
    let num = 0, den = 0
    for (let i = 0; i < n; i++) {
      num += (xs[i] - mx) * (ys[i] - my)
      den += (xs[i] - mx) ** 2
    }
    if (den > 0) {
      const slope = num / den
      if (slope > 0.5) {
        ramp = slope
        // R² tells us whether the probe is climbing steadily or wandering.
        let ssTot = 0, ssRes = 0
        for (let i = 0; i < n; i++) {
          const fit = my + slope * (xs[i] - mx)
          ssRes += (ys[i] - fit) ** 2
          ssTot += (ys[i] - my) ** 2
        }
        const r2 = ssTot > 0 ? 1 - ssRes / ssTot : 0
        confidence = r2 >= 0.9 && n >= 10 ? 'high' : r2 >= 0.6 ? 'medium' : 'low'
      }
    }
  }

  // Probe flat or too few points — fall back to what this product usually does.
  if (ramp === null) {
    if (!fallbackRamp || fallbackRamp <= 0) return null
    ramp = fallbackRamp
    confidence = 'low'
  }

  const etaMinutes = ((targetF - last.f) / ramp) * 60
  return {
    etaMinutes,
    etaAt:      addMinutes(new Date(last.t), etaMinutes),
    rampFPerHr: ramp,
    currentF:   last.f,
    targetF,
    confidence,
  }
}

// ── Formatting ───────────────────────────────────────────────────────────────

export function fmtDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  const h = Math.floor(m / 60)
  const r = m % 60
  if (h === 0) return `${r}m`
  if (r === 0) return `${h}h`
  return `${h}h ${r}m`
}

export function fmtClock(d: Date): string {
  return d.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true })
}

export function fmtDayClock(d: Date, today = new Date()): string {
  const sameDay = d.toDateString() === today.toDateString()
  const tomorrow = new Date(today); tomorrow.setDate(tomorrow.getDate() + 1)
  const isTomorrow = d.toDateString() === tomorrow.toDateString()
  if (sameDay)   return fmtClock(d)
  if (isTomorrow) return `${fmtClock(d)} tomorrow`
  return `${d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })} ${fmtClock(d)}`
}
