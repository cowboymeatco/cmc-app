// "Next open PLU" for the New PLU form (Charlie, 2026-09-18).
//
// The shop numbers PLUs by product line (21xx lamb, 61xx brots, 41xx sticks),
// so "next" means next in the line you're adding to, not the lowest hole in
// the whole book. Taken = in plu_items (active or not) or ever scanned into a
// box (view v_used_plu_numbers) — a deleted PLU's number can still be on a
// Hobart and printed on old boxes, so it never comes back.

// Same ranges as detectSpecies() in the Processing and Scanner pages.
export const SPECIES_RANGES: Record<string, [number, number]> = {
  Beef:        [100, 999],
  Pork:        [1000, 1999],
  Lamb:        [2000, 2999],
  Goat:        [3000, 3999],
  Processed:   [4000, 7999],
  'Wild Game': [8000, 8999],
  Cheese:      [9000, 11999],
  Wholesale:   [413000, 999999],
}

function rangeOf(n: number): [number, number] | null {
  for (const r of Object.values(SPECIES_RANGES)) if (n >= r[0] && n <= r[1]) return r
  return null
}

/**
 * Typed a number → the first open number at or after it (so "6100" finds the
 * next open brot). Otherwise a species → one past the highest number used in
 * its range, falling back to the lowest gap once the range is full.
 * Null when there's nothing to go on or the range has no room.
 */
export function nextOpenPlu(used: Set<number>, opts: { from?: string; species?: string }): number | null {
  const from = parseInt((opts.from ?? '').trim(), 10)
  if (!isNaN(from) && from > 0) {
    const end = rangeOf(from)?.[1] ?? from + 100000
    for (let n = from; n <= end; n++) if (!used.has(n)) return n
    return null
  }
  const range = opts.species ? SPECIES_RANGES[opts.species] : undefined
  if (!range) return null
  const [lo, hi] = range
  let max = lo - 1
  for (const n of used) if (n >= lo && n <= hi && n > max) max = n
  for (let n = max + 1; n <= hi; n++) if (!used.has(n)) return n
  for (let n = lo; n <= hi; n++) if (!used.has(n)) return n
  return null
}
