// Producer label sets — shared by the API, the Producer Labels page, the
// cutting card and the scanner. See scripts/2026-09-23_producer_labels.sql.

// The package barcode carries the PLU in five digits, so every producer number
// has to fit under 100000. House numbering stops at 11999 (lib/nextPlu), so
// producer blocks start at 20000 and take a thousand numbers each.
export const PRODUCER_BLOCK_MIN  = 20000
export const PRODUCER_BLOCK_SIZE = 1000
export const PRODUCER_BLOCK_LAST = 99000

// A cutting card's Scale label is typed by hand ("Blegen Galloway", "blegen
// galloway "), so a card and a set are matched on this, never on the raw text.
export function labelKey(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// A Hobart label format number, as the PLU record's l1 carries it.
export const LABEL_FORMAT_RE = /^\d{1,5}$/

/** The first free thousand-block at or above PRODUCER_BLOCK_MIN: not another
 *  set's block, and with no number in it already used by anything. */
export function nextBlockStart(taken: number[], used: Set<number>): number | null {
  const starts = new Set(taken)
  for (let b = PRODUCER_BLOCK_MIN; b <= PRODUCER_BLOCK_LAST; b += PRODUCER_BLOCK_SIZE) {
    if (starts.has(b)) continue
    let clear = true
    for (let n = b; n < b + PRODUCER_BLOCK_SIZE; n++) if (used.has(n)) { clear = false; break }
    if (clear) return b
  }
  return null
}

/** `count` open numbers inside the block, lowest first. Fewer than asked when
 *  the block is full — the caller says so rather than spilling into the next. */
export function assignPluNumbers(blockStart: number, used: Set<number>, count: number): number[] {
  const out: number[] = []
  for (let n = blockStart; n < blockStart + PRODUCER_BLOCK_SIZE && out.length < count; n++) {
    if (!used.has(n)) out.push(n)
  }
  return out
}

// What the scanner needs from a set: which numbers are this producer's, and
// which house PLU each one stands in for.
export interface ScannerProducerSet {
  name: string
  key: string
  label_format: string | null
  loaded_at: string | null
  items: { plu_number: string; house_plu: string }[]
}
