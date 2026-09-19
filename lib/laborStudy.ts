// Timing studies — measure the WORK, not the workers (Charlie, 2026-09-18).
//
// A few times a year Charlie times each hands-on step of a product on a real
// job: how long, with how many people. The crew does nothing new. Those
// studies become the standard (crew-minutes per finished lb) and each step's
// share of the price, and the app can then value every job it already
// records, step by step.
//
// Pounds come from records the plant already keeps, so nothing has to be
// weighed: cure tags say how many bellies went in on a cut day and whose they
// were, and the packing scans weigh the finished bacon for those same
// customers to the tenth of a pound. The customer name is the thread — the
// cure tag, the carcass input and the box are all written under the session
// name.

export interface StudyStep { key: string; label: string; hint: string }

export interface StudyProduct {
  key: string
  label: string
  /** cure_tags.product values that belong to this product */
  cureProducts: string[]
  /** box_scans.item_name values that are this product finished */
  finishedItems: string[]
  steps: StudyStep[]
}

export const STUDY_PRODUCTS: StudyProduct[] = [
  {
    key: 'bacon',
    label: 'Bacon',
    cureProducts: ['Bacon', 'Shoulder Bacon'],
    finishedItems: ['PORK BACON', 'PORK SHOULDER BACON'],
    steps: [
      { key: 'cure',    label: 'Cure',    hint: 'trim, inject, tag and rack the bellies' },
      { key: 'smoke',   label: 'Smoke',   hint: 'load the truck in and pull it out — not the cook' },
      { key: 'slice',   label: 'Slice',   hint: 'press, slice and lay out' },
      { key: 'package', label: 'Package', hint: 'bag, seal, weigh and label' },
      { key: 'box',     label: 'Box',     hint: 'scan into boxes and close them' },
    ],
  },
]

export const studyProduct = (key: string) => STUDY_PRODUCTS.find(p => p.key === key)

export interface Segment { step: string; crew: number; started_at: string; ended_at: string | null }

/** Crew-minutes per step. A running segment counts up to `now`. */
export function crewMinutesByStep(segments: Segment[], now = Date.now()): Record<string, number> {
  const out: Record<string, number> = {}
  for (const s of segments) {
    const end = s.ended_at ? Date.parse(s.ended_at) : now
    const mins = Math.max(0, (end - Date.parse(s.started_at)) / 60000)
    out[s.step] = (out[s.step] ?? 0) + mins * s.crew
  }
  return out
}
