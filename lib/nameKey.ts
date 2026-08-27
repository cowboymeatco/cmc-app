// One customer, typed five different ways.
//
// Names reach us as free text from whoever had the keyboard: the office types a
// cut sheet, the floor types a cure tag, QuickBooks holds a third spelling. So
// "Kristin Montana Veterans Meat Locker", "MT Veterans Meat Locker Kristin" and
// "Kristin  Montana Veterans Meat Locker" (two spaces) are all the same person,
// and an exact match finds none of them.
//
// This was written twice already — app/api/exec/receivables and
// app/api/exec/turnover both carried a copy with a "keep the two in step"
// comment on it. It lives here now so there is one of it.
//
// It mirrors the Postgres function exec_name_key(). THOSE STILL HAVE TO BE KEPT
// IN STEP — change one, change the other. (The alias expansion below is
// app-side only; exec_name_key has no equivalent, which is fine because the
// receivables and turnover boards match against QuickBooks, where the office's
// spelling is the one in use.)

/** UPPER, punctuation to spaces, trailing numeric tokens dropped. */
function tokens(raw: string | null | undefined): string[] {
  return (raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    // A hanging weight or carcass tag ("Steve Rosh 78", "Kyle Barner 177B"),
    // and the floor's "MVML KRISTIN 2" for a customer's second animal.
    .replace(/(\s+[0-9]+[A-Z]?)+\s*$/g, '')
    .trim()
    .split(' ')
    .filter(Boolean)
}

/**
 * A comparable key for a customer name: the words above, sorted, so
 * "LAST, FIRST" and "First Last" land on the same key.
 *
 * It closes the gap on case, spacing, punctuation and word order. It does NOT
 * close the gap on abbreviations — see nameKeyWith().
 */
export function nameKey(raw: string | null | undefined): string {
  return tokens(raw).sort().join(' ')
}

/**
 * The same key, with the floor's shorthand expanded first.
 *
 * Nothing in a string can say that "MVML" is Montana Veterans Meat Locker —
 * that fact only a person has, and guessing at it would put one customer's ham
 * on another's slip. So it comes in as data from `customer_name_aliases`
 * (Charlie confirmed MVML, 2026-08-27) rather than being inferred here.
 *
 * Expansion is per TOKEN and happens before the words are sorted, so "MVML
 * KRISTIN" and "Kristin Montana Veterans Meat Locker" reach the same key and
 * word order still doesn't matter.
 *
 * @param aliases UPPERCASE token → what it stands for. An empty map degrades to
 *                plain word-matching rather than failing, which is what should
 *                happen if the alias table can't be read.
 *
 * Deliberately NOT short-circuiting to nameKey() on an empty map: this dedupes
 * words and nameKey() doesn't, so taking the shortcut would mean a name keyed
 * one way with aliases loaded and another way without. Both sides of a join
 * use the same call, so a consistent key matters more than matching nameKey.
 */
export function nameKeyWith(raw: string | null | undefined, aliases: Map<string, string>): string {
  const out: string[] = []
  for (const t of tokens(raw)) {
    const expansion = aliases.get(t)
    if (expansion) out.push(...tokens(expansion))
    else out.push(t)
  }
  // An expansion can repeat a word the name already carried ("MT Veterans Meat
  // Locker" -> MONTANA VETERANS MEAT LOCKER VETERANS MEAT LOCKER), so the key
  // is the SET of words. Two names built from the same words are the same
  // customer either way.
  return [...new Set(out)].sort().join(' ')
}

/** Row shape of customer_name_aliases, for callers loading the table. */
export interface CustomerNameAlias { alias: string; expands_to: string }

export function aliasMap(rows: CustomerNameAlias[] | null | undefined): Map<string, string> {
  return new Map((rows ?? []).map(r => [r.alias.toUpperCase(), r.expands_to]))
}
