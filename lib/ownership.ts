// Is this product ours, or a producer's?
//
// One definition, because two places now ask the question and would drift:
// /exec values our own meat, and /inventory refuses to count a producer's box
// sitting in our freezer. A producer's custom animal is their inventory — its
// value to us is the processing fee, which receivables already carries.

// The scanner's CMC checkbox (processing_sessions.cmc) is the ownership signal
// since 2026-09-04. The name pattern stays as a fallback for sessions packed
// before it existed and for a box the crew named "CMC Retail 659" but forgot to
// tick: "CMC", "CMC 2", "26188 CMC Retail", "Retail 26153", "Lamb CMC Retail".
// A surname that happens to contain the letters ("Cmcarthy") does not match —
// the token has to stand alone.
export const OWN_SESSION = /(^|\s)(cmc|retail)(\s|$|\d)/i

/** Own animals on the kill floor record, by producer name. */
export const OWN_PRODUCER = /cowboy\s*meat|^\s*cmc\b/i

export function isOwnSession(s: { cmc?: boolean | null; customer_name?: string | null }): boolean {
  return Boolean(s.cmc) || OWN_SESSION.test(s.customer_name ?? '')
}
