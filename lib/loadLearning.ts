// Learning how many pounds go into one smokehouse load.
//
// This is the number nobody has ever had. The controller logs recorded the cook
// schedule but left Batch#/Truck#/Operator blank on all 1,193 files, so the
// history says how LONG a product cooks and nothing about how MUCH.
//
// It has to be learned from work going forward, from JOBS: weight_in_lbs is
// pre-cook pounds — the same basis the customer is charged on, and the same
// basis lbs_per_batch is used on when the scheduler divides a job into loads.
//
// Box scans are deliberately NOT a source here. They are post-shrink, so they
// are the wrong side of the cook to size a load, and reading them by product
// name pulls in raw retail cuts: "BEEF BRISKET" out of a customer's box is a
// fresh brisket, not something that came off the house. Finished weight reaches
// this module the reliable way instead — through a job's own weight_out_lbs,
// which is matched on exact PLU — and shows up as observed yield.
//
// The estimator is deliberately a LOWER BOUND: the largest load actually run is
// proof the house holds at least that much, and it climbs toward the truth as
// bigger loads go through. An average would be an estimate of what the crew
// happens to cook, not of what the house holds.

/** A completed job, in pre-cook pounds. */
export interface ObservedJob {
  profile_key:   string
  weight_in_lbs: number
  batch_count:   number | null
  completed_date: string | null
}

export interface LoadObservation {
  profile_key: string

  // Pre-cook, from jobs. The only thing that can set lbs_per_batch.
  jobs:          number
  maxLoadLbs:    number | null   // biggest single load actually run
  medianLoadLbs: number | null

  /** Suggested lbs_per_batch, or null when the evidence is too thin. */
  suggestion:  number | null
  confidence:  'none' | 'low' | 'medium' | 'high'
  /** How many more single-load jobs before a suggestion is worth making. */
  jobsNeeded:  number
  reason:      string
}

/** Below this many observations a "learned" load size is just noise. */
export const MIN_JOBS_FOR_SUGGESTION = 5

function median(v: number[]): number | null {
  if (v.length === 0) return null
  const s = [...v].sort((a, b) => a - b)
  const m = Math.floor(s.length / 2)
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

function round1(n: number | null): number | null {
  return n === null ? null : Math.round(n * 10) / 10
}

/**
 * What the data currently supports for one product.
 *
 * Only jobs that ran as a SINGLE load tell us anything about capacity — a
 * 300 lb job split across four cooks says nothing about what one load holds,
 * so those are excluded rather than quietly inflating the estimate.
 */
export function observeLoad(
  profileKey: string,
  jobs:       ObservedJob[]
): LoadObservation {
  const mine       = jobs.filter(j => j.profile_key === profileKey && j.weight_in_lbs > 0)
  const singleLoad = mine.filter(j => (j.batch_count ?? 1) === 1)

  const loadLbs = singleLoad.map(j => j.weight_in_lbs)
  const maxLoad = loadLbs.length ? Math.max(...loadLbs) : null
  const n = singleLoad.length

  let suggestion: number | null = null
  let confidence: LoadObservation['confidence'] = 'none'
  let reason: string

  if (n === 0) {
    reason = mine.length > 0
      ? `${mine.length} job${mine.length === 1 ? '' : 's'} recorded, but each ran as more than one load, so none of them size a single load.`
      : 'No completed job has recorded a weight in yet.'
  } else if (n < MIN_JOBS_FOR_SUGGESTION) {
    reason = `Only ${n} single-load job${n === 1 ? '' : 's'} so far — too few to trust. Biggest seen is ${round1(maxLoad)} lbs.`
    confidence = 'low'
  } else {
    // The biggest load that actually fit. A floor on capacity, not a ceiling.
    suggestion = round1(maxLoad)
    confidence = n >= 15 ? 'high' : 'medium'
    reason = `Largest of ${n} single-load jobs. The house holds at least this much; the figure rises if a bigger load goes through.`
  }

  return {
    profile_key: profileKey,
    jobs:        n,
    maxLoadLbs:    round1(maxLoad),
    medianLoadLbs: round1(median(loadLbs)),
    suggestion,
    confidence,
    jobsNeeded:  Math.max(0, MIN_JOBS_FOR_SUGGESTION - n),
    reason,
  }
}

/** Observed yield, so shrink stops being a guess once pairs exist. */
export function observeYield(
  jobs: { profile_key: string; weight_in_lbs: number | null; weight_out_lbs: number | null }[],
  profileKey: string
): { n: number; medianYieldPct: number | null } {
  const pairs = jobs.filter(j =>
    j.profile_key === profileKey &&
    j.weight_in_lbs != null && j.weight_in_lbs > 0 &&
    j.weight_out_lbs != null && j.weight_out_lbs > 0
  )
  const pcts = pairs.map(j => (Number(j.weight_out_lbs) / Number(j.weight_in_lbs)) * 100)
  return { n: pairs.length, medianYieldPct: round1(median(pcts)) }
}
