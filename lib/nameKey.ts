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
// IN STEP — change one, change the other.

/**
 * A comparable key for a customer name:
 * upper-case, punctuation to spaces, trailing numeric tokens dropped (a
 * hanging weight or carcass tag — "Steve Rosh 78", "Kyle Barner 177B", and the
 * floor's "MVML KRISTIN 2" for a customer's second animal), then the words
 * sorted so "LAST, FIRST" and "First Last" land on the same key.
 *
 * It closes the gap on case, spacing, punctuation and word order. It does NOT
 * and must not close the gap on abbreviations — nothing here can know that
 * "MVML" is Montana Veterans Meat Locker, and inventing that link would be
 * guessing at whose meat is whose. Callers should surface what it fails to
 * match rather than quietly dropping it.
 */
export function nameKey(raw: string | null | undefined): string {
  return (raw || '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/(\s+[0-9]+[A-Z]?)+\s*$/g, '')
    .trim()
    .split(' ')
    .filter(Boolean)
    .sort()
    .join(' ')
}
