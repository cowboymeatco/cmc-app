// Product names for paperwork people read — packing slips, the delivery log.
//
// The pet-food PLUs (10004–10014) are NAMED "NOT FOR HUMAN CONSUMPTION": the
// scale prints the statement as the product name, which is right on the
// package (it's the required legend) and useless on a sheet where it repeats
// six times (Charlie, 2026-09-09: "shorten the names to not include not for
// human consumption"). Display-only — the PLU record and the package label
// keep the statement; see feedback_never_fabricate_label_copy.
const NFHC = /\bNOT\s+FOR\s+HUMAN\s+CONSUMPTION\b/i

export function shortItemName(name: string | null | undefined): string {
  const raw = String(name ?? '').trim()
  if (!NFHC.test(raw)) return raw
  const stripped = raw.replace(new RegExp(NFHC.source, 'gi'), '').replace(/^[\s\-–—·:]+|[\s\-–—·:]+$/g, '').trim()
  return stripped || 'PET FOOD'
}
