// Finding a value-add job's finished weight in the box labels.
//
// Post-cook weight is already being recorded: every finished package goes
// across the Hobart scale, gets a PLU label, and is scanned into a customer's
// box. So the number exists — it just lived in box_scans instead of on the job.
//
// The match is PLU + pack date, NOT a hard key, because there is no hard key to
// use: no box in the table carries an order_id. Two things about the real data
// shape this:
//
//   * ONE COOK SERVES MANY CUSTOMERS. The 2026-07-07 bacon run landed in four
//     different customers' boxes on the same day. A job's output is therefore
//     usually a SUM across boxes, not one box.
//   * BOX CUSTOMER NAMES ARE DIRTY — "Brandon Hinebaugh 186#", "26188 CMC
//     Retail", "Retail 26153". They carry hanging weights and ticket numbers,
//     so an equality test on the name finds nothing.
//
// Because the link is inferred rather than keyed, this module only ever
// PROPOSES a weight. Applying it is a human tap. Guessing which customer a box
// belongs to is exactly the kind of attribution that should not happen silently.

export interface BoxScanRow {
  box_id:        string
  plu_number:    string | null
  item_name:     string | null
  weight_lbs:    number | null
  quantity:      number | null
  box_label:     string | null
  customer_name: string | null
  pack_date:     string | null
}

export interface BoxContribution {
  box_id:        string
  box_label:     string | null
  customer_name: string | null
  pack_date:     string | null
  lbs:           number
  packages:      number
  /** The job named a customer and this box appears to be theirs. */
  customerMatch: boolean
}

export interface WeightOutProposal {
  lbs:            number
  packages:       number
  boxes:          BoxContribution[]
  /** True when the job named a customer and we could narrow to their boxes. */
  narrowedToCustomer: boolean
  /** Boxes matching the PLU and window but belonging to somebody else. */
  otherCustomerBoxes: number
  plu:            string
  windowFrom:     string
  windowTo:       string
}

// Strip the ticket numbers and hanging weights the packing screen tacks onto a
// box's customer field, so "Brandon Hinebaugh 186#" can be compared with
// "Brandon Hinebaugh".
export function normalizeCustomer(name: string | null | undefined): string {
  return String(name ?? '')
    .toUpperCase()
    .replace(/\d+\s*#/g, ' ')      // hanging weight: "186#"
    .replace(/#\s*\d+/g, ' ')      // ticket: "#26188"
    .replace(/\b\d{3,}\b/g, ' ')   // bare ticket numbers: "26188", "26153"
    .replace(/[^A-Z ]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Do these two customer strings plausibly name the same person? Containment
 * either way, because the box side often carries extra words the job side
 * does not ("CMC Retail" vs "26188 CMC Retail").
 */
export function sameCustomer(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = normalizeCustomer(a)
  const y = normalizeCustomer(b)
  if (!x || !y) return false
  if (x === y) return true
  // Require the shorter side to be substantial, or "A" would match everything.
  const short = x.length <= y.length ? x : y
  const long  = x.length <= y.length ? y : x
  return short.length >= 4 && long.includes(short)
}

export function isoDay(d: Date): string {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/**
 * The pack-date window a job's output could plausibly fall in. Opens the day
 * before the cook (a cook started late on the 6th can pack on the 6th) and runs
 * two weeks out, which covers product boxed as customers come to collect.
 */
export function packWindow(job: { completed_date: string | null; requested_date: string; scheduled_start?: string | null }): { from: string; to: string } {
  const base = job.completed_date
    ?? (job.scheduled_start ? job.scheduled_start.slice(0, 10) : null)
    ?? job.requested_date
  const start = new Date(`${base}T12:00:00`)
  const from = new Date(start); from.setDate(from.getDate() - 1)
  const to   = new Date(start); to.setDate(to.getDate() + 14)
  return { from: isoDay(from), to: isoDay(to) }
}

/**
 * Sum the scans that plausibly belong to this job.
 *
 * When the job names a customer we narrow to that customer's boxes and report
 * how many same-PLU boxes were left out, so the crew can see the run was
 * shared. When it does not (CMC shelf stock), every box in the window counts —
 * a shelf-stock run has no customer to narrow by, and the crew confirms.
 */
export function proposeWeightOut(
  job:   { output_plu: string | null; customer_name: string | null; completed_date: string | null; requested_date: string; scheduled_start?: string | null },
  scans: BoxScanRow[]
): WeightOutProposal | null {
  if (!job.output_plu) return null

  const { from, to } = packWindow(job)

  const inWindow = scans.filter(s =>
    s.plu_number === job.output_plu &&
    s.pack_date != null && s.pack_date >= from && s.pack_date <= to
  )
  if (inWindow.length === 0) return null

  // Roll scans up per box.
  const byBox = new Map<string, BoxContribution>()
  for (const s of inWindow) {
    const cur = byBox.get(s.box_id) ?? {
      box_id: s.box_id, box_label: s.box_label, customer_name: s.customer_name,
      pack_date: s.pack_date, lbs: 0, packages: 0,
      customerMatch: sameCustomer(job.customer_name, s.customer_name),
    }
    cur.lbs      += Number(s.weight_lbs ?? 0)
    cur.packages += Number(s.quantity ?? 1)
    byBox.set(s.box_id, cur)
  }

  const all = Array.from(byBox.values())
  const matching = all.filter(b => b.customerMatch)

  // Narrow only if the job named a customer AND we actually found their boxes.
  const narrowed = !!job.customer_name && matching.length > 0
  const chosen   = narrowed ? matching : all

  return {
    lbs:      Math.round(chosen.reduce((s, b) => s + b.lbs, 0) * 10) / 10,
    packages: chosen.reduce((s, b) => s + b.packages, 0),
    boxes:    chosen.sort((a, b) => String(a.pack_date).localeCompare(String(b.pack_date))),
    narrowedToCustomer: narrowed,
    otherCustomerBoxes: all.length - chosen.length,
    plu:        job.output_plu,
    windowFrom: from,
    windowTo:   to,
  }
}
