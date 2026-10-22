// What a packing session still owes, as the bench screen shows it.
//
// The same arithmetic the scanner's still-to-pack list does, pulled out so a
// second screen reads the card the same way: a PLU can serve several lines,
// a line can be served by several PLUs, and a line that shares its cut key
// with another stays up until the whole group is covered. Pure, so it can be
// checked against a real card without a browser.

export interface BenchExpectedLine {
  key: string; section: string; cut: string; label: string
  species: string; spec: string; card: number
}
export interface BenchPluLink { species: string; cut_key: string; plu_number: string; item_name: string | null }
export interface BenchScan { plu_number: string; weight_lbs: number | null }

export interface BenchRow {
  line: BenchExpectedLine
  /** Lines on this session that ask for this cut, and how many are packed. */
  of: number
  done: number
  /** The PLU(s) linked to this line; empty when nobody has linked one yet. */
  plus: { plu: string; name: string }[]
}

export function benchRows(lines: BenchExpectedLine[], links: BenchPluLink[], scans: BenchScan[]): BenchRow[] {
  const keysForPlu = new Map<string, string[]>()
  const plusForKey = new Map<string, { plu: string; name: string }[]>()
  for (const l of links) {
    const ks = keysForPlu.get(l.plu_number) ?? []
    ks.push(l.cut_key)
    keysForPlu.set(l.plu_number, ks)
    const ps = plusForKey.get(l.cut_key) ?? []
    if (!ps.some(p => p.plu === l.plu_number)) ps.push({ plu: l.plu_number, name: l.item_name ?? '' })
    plusForKey.set(l.cut_key, ps)
  }
  const packedByKey = new Map<string, number>()
  for (const sc of scans) {
    for (const key of keysForPlu.get(sc.plu_number) ?? []) packedByKey.set(key, (packedByKey.get(key) ?? 0) + 1)
  }
  const keyTotals = new Map<string, number>()
  for (const l of lines) keyTotals.set(l.key, (keyTotals.get(l.key) ?? 0) + 1)

  const out: BenchRow[] = []
  for (const line of lines) {
    const of = keyTotals.get(line.key) ?? 1
    const done = Math.min(packedByKey.get(line.key) ?? 0, of)
    if (done < of) out.push({ line, of, done, plus: plusForKey.get(line.key) ?? [] })
  }
  return out
}

/** How many of the card's distinct cuts are fully covered, for the header. */
export function benchProgress(lines: BenchExpectedLine[], links: BenchPluLink[], scans: BenchScan[]): { packed: number; total: number } {
  const keys = [...new Set(lines.map(l => l.key))]
  const remaining = new Set(benchRows(lines, links, scans).map(r => r.line.key))
  return { packed: keys.length - remaining.size, total: keys.length }
}
