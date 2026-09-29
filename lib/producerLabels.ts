// Producer label sets — shared by the API, the Producer Labels page, the
// cutting card and the scanner. See scripts/2026-09-23_producer_labels.sql.

// Producer PLUs are four digits, like every house PLU. The Hobarts look a PLU
// up the moment its last digit is keyed, and that length is one setting for
// the whole scale: set to 5 for a 2xxxx producer block, every 3- and 4-digit
// house item needs an extra key press, and the packers key 4 (Charlie,
// 2026-09-28 — the first Blegen set was 20000+ and the scale jumped to a
// house item after four digits). So producers share 9100–9899, which nothing
// in the book uses (9000–9003 and 99xx are cheese and odds and ends), a
// hundred numbers each: eight producers, and more PLUs each than a set needs.
// lib/nextPlu keeps the New PLU form out of this range.
export const PRODUCER_BLOCK_MIN  = 9100
export const PRODUCER_BLOCK_SIZE = 100
export const PRODUCER_BLOCK_LAST = 9800
export const PRODUCER_RANGE_END  = PRODUCER_BLOCK_LAST + PRODUCER_BLOCK_SIZE - 1 // 9899

/** A number that belongs to the producer range, used or not. */
export const isProducerNumber = (n: number) => n >= PRODUCER_BLOCK_MIN && n <= PRODUCER_RANGE_END

// A cutting card's Scale label is typed by hand ("Blegen Galloway", "blegen
// galloway "), so a card and a set are matched on this, never on the raw text.
export function labelKey(name: string | null | undefined): string {
  return String(name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
}

// A Hobart label format number, as the PLU record's l1 carries it.
export const LABEL_FORMAT_RE = /^\d{1,5}$/

/** The first free block at or above PRODUCER_BLOCK_MIN: not another
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

// A producer's label format carries no barcode — both formats on the scales
// print a logo and text only (Blegen 422, Hollenbeck 418, read off the scale
// 2026-09-26). Nothing packed on one can be scanned, so a producer session is
// packed by the box: each finished box is weighed as one package on a house
// whole-box PLU and that label is what goes over the gun. The producer gives
// up knowing which cuts came out; the yield still gets every pound (Charlie,
// 2026-09-29, after AE couldn't scan Blegen's in).
export const WHOLE_BOX_PLU: Record<string, string> = {
  beef: '207',   // BEEF ASSORTED CUTS
  pork: '1000',  // PORK MEAT BOX
  lamb: '2000',  // LAMB MEAT BOX
  goat: '3000',  // GOAT MEAT BOX
}
export const WHOLE_BOX_FALLBACK_PLU = '1' // MEAT BOX

// What the scanner needs from a set: which numbers are this producer's, and
// which house PLU each one stands in for.
export interface ScannerProducerSet {
  name: string
  key: string
  label_format: string | null
  loaded_at: string | null
  items: { plu_number: string; house_plu: string }[]
}
