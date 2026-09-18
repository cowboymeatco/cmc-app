// Shapes and tallies for a physical inventory count.
//
// The count itself is dumb on purpose — a person, a place, and a list of
// packages they scanned. All the judgement lives either side of it: what a
// pound is worth (lib/carcassCost) and what Jill books (the month-end report).
// Keeping this layer plain is what lets the count be re-tallied at any instant
// without re-deciding anything.

// The plant's own names for its rooms, in Charlie's order (2026-09-18). A count
// is one room, so the one-open-count-per-location guard is one-per-room.
export const COUNT_LOCATIONS = [
  'Showcase Cooler',
  'Showcase Freezer',
  'Showroom',
  'Retail Freezer',
  'Custom Freezer',
  'Old Cooler',
  'New Cooler',
] as const
export type CountLocation = typeof COUNT_LOCATIONS[number]

export interface InventoryCount {
  id: string
  created_at: string
  count_date: string
  location: string
  status: 'open' | 'closed'
  opened_by: string
  opened_at: string
  closed_by: string | null
  closed_at: string | null
  notes: string
}

export interface CountLine {
  id: string
  created_at: string
  count_id: string
  plu_number: string
  item_name: string
  weight_lbs: number | null
  quantity: number
  barcode: string
  counted_by: string
  voided_at: string | null
  voided_by: string | null
  void_reason: string | null
  /** Set when the line came from scanning a sealed box's label. */
  box_id: string | null
  box_serial: string | null
}

export interface PluTally {
  plu_number: string
  item_name: string
  packages: number
  lbs: number
  /** True when no scanned package for this PLU carried a weight. */
  byPiece: boolean
}

export interface CountTotals {
  packages: number
  lbs: number
  plus: number
  voided: number
  /** Packages whose label carried no weight — counted by the piece. */
  pieceOnly: number
  /** Sealed boxes counted by their label rather than package by package. */
  boxes: number
  firstScan: string | null
  lastScan: string | null
}

export interface PersonLabor {
  name: string
  /** Scan events, where a whole box is one event however many packages it held. */
  scans: number
  activeMinutes: number
  firstScan: string
  lastScan: string
}

export interface CountLabor {
  people: PersonLabor[]
  activeMinutes: number
  /** Pounds counted per labor hour. Null until MIN_MINUTES_FOR_RATE are on the clock. */
  lbsPerHour: number | null
  /** Open-to-close, or open-to-now for a count still running. */
  wallMinutes: number | null
}

/**
 * A gap longer than this between one person's scans is a break, a phone call or
 * another job — not counting. Charlie, 2026-09-18: track labor minutes on the
 * count, per person, with no extra taps for the crew.
 *
 * So time is read off the scan timestamps rather than a start/stop button,
 * because a button gets forgotten and a forgotten stop turns a twenty-minute
 * count into a nine-hour one. The cost of doing it this way, said plainly on
 * the page: the minutes before a person's first scan (finding a coat, opening
 * the freezer) and after their last are not on the clock. It undercounts a
 * little, consistently, which beats overcounting by accident.
 */
export const IDLE_GAP_MINUTES = 10

/**
 * Below this much labor, a rate is noise: three scans in twenty seconds works
 * out to fourteen thousand pounds an hour. The rate waits until there is
 * enough time on the clock to mean something.
 */
export const MIN_MINUTES_FOR_RATE = 5

/** Live lines only. A voided line stays in the table but leaves every tally. */
export function liveLines(lines: CountLine[], asOf?: string): CountLine[] {
  return lines.filter(l => {
    if (l.voided_at) return false
    // `asOf` is how a count taken while the plant kept running is cut at an
    // instant: ask for the freezer as it stood at midnight on the 30th and the
    // scans that happened on the 1st simply are not in the answer.
    if (asOf && l.created_at > asOf) return false
    return true
  })
}

export function tallyByPlu(lines: CountLine[]): PluTally[] {
  const byPlu = new Map<string, PluTally>()
  for (const l of lines) {
    const t = byPlu.get(l.plu_number) ?? {
      plu_number: l.plu_number,
      item_name: l.item_name,
      packages: 0,
      lbs: 0,
      byPiece: true,
    }
    t.packages += l.quantity
    if (l.weight_lbs != null) {
      t.lbs += Number(l.weight_lbs) * l.quantity
      t.byPiece = false
    }
    // Later scans win the name, so a PLU renamed mid-count reads as its current
    // label rather than whichever package happened to be scanned first.
    if (l.item_name) t.item_name = l.item_name
    byPlu.set(l.plu_number, t)
  }
  return [...byPlu.values()].sort((a, b) => b.lbs - a.lbs || b.packages - a.packages)
}

export function totals(all: CountLine[], asOf?: string): CountTotals {
  const live = liveLines(all, asOf)
  const stamps = live.map(l => l.created_at).sort()
  return {
    packages: live.reduce((s, l) => s + l.quantity, 0),
    lbs: live.reduce((s, l) => s + (l.weight_lbs != null ? Number(l.weight_lbs) * l.quantity : 0), 0),
    plus: new Set(live.map(l => l.plu_number)).size,
    voided: all.filter(l => l.voided_at).length,
    pieceOnly: live.filter(l => l.weight_lbs == null).reduce((s, l) => s + l.quantity, 0),
    boxes: new Set(live.filter(l => l.box_id).map(l => l.box_id)).size,
    firstScan: stamps[0] ?? null,
    lastScan: stamps[stamps.length - 1] ?? null,
  }
}

/**
 * Labor minutes per person, off the scan timestamps.
 *
 * Voided scans stay in: the scan was wrong, but the minute was still worked.
 * A box counted by its label writes all its packages at one instant, so those
 * rows collapse to a single scan event before the gaps are measured.
 */
export function laborByPerson(all: CountLine[], count?: Pick<InventoryCount, 'opened_at' | 'closed_at'>): CountLabor {
  const events = new Map<string, number[]>()
  const seen = new Set<string>()
  for (const l of all) {
    const name = l.counted_by.trim() || '(no name)'
    // One event per box, not one per package inside it.
    const key = l.box_id ? `${name}|box|${l.box_id}|${l.created_at}` : `${name}|line|${l.id}`
    if (seen.has(key)) continue
    seen.add(key)
    const t = Date.parse(l.created_at)
    if (!Number.isFinite(t)) continue
    const list = events.get(name) ?? []
    list.push(t)
    events.set(name, list)
  }

  const cap = IDLE_GAP_MINUTES * 60_000
  const people: PersonLabor[] = []
  for (const [name, stamps] of events) {
    stamps.sort((a, b) => a - b)
    let ms = 0
    for (let i = 1; i < stamps.length; i++) {
      const gap = stamps[i] - stamps[i - 1]
      if (gap <= cap) ms += gap
    }
    people.push({
      name,
      scans: stamps.length,
      activeMinutes: ms / 60_000,
      firstScan: new Date(stamps[0]).toISOString(),
      lastScan: new Date(stamps[stamps.length - 1]).toISOString(),
    })
  }
  people.sort((a, b) => b.activeMinutes - a.activeMinutes)

  const activeMinutes = people.reduce((s, p) => s + p.activeMinutes, 0)
  const lbs = totals(all).lbs
  let wallMinutes: number | null = null
  if (count?.opened_at) {
    const end = count.closed_at ? Date.parse(count.closed_at) : Date.now()
    wallMinutes = Math.max(0, (end - Date.parse(count.opened_at)) / 60_000)
  }
  return {
    people,
    activeMinutes,
    lbsPerHour: activeMinutes >= MIN_MINUTES_FOR_RATE ? lbs / (activeMinutes / 60) : null,
    wallMinutes,
  }
}

/**
 * A loose package that matches one already counted inside a sealed box — same
 * PLU, same weight to the hundredth — was probably pulled out of that box and
 * is about to be counted twice. A Hobart package label carries no box identity
 * of its own, so this is the only handle there is. Identical weights on the
 * same PLU are rare but not impossible, so it warns rather than refuses.
 */
export function matchingBoxedLine(
  all: CountLine[],
  pkg: { plu_number: string; weight_lbs: number | null; id?: string },
): CountLine | null {
  if (pkg.weight_lbs == null) return null
  const w = Math.round(Number(pkg.weight_lbs) * 100)
  return all.find(l =>
    !l.voided_at && l.box_id && l.id !== pkg.id &&
    l.plu_number === pkg.plu_number &&
    l.weight_lbs != null && Math.round(Number(l.weight_lbs) * 100) === w,
  ) ?? null
}
