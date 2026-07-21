// How a carcass hangs, and therefore how it gets weighed and tagged.
//
// Beef, sows, and boars are split down the backbone into two sides — each side
// is weighed and tagged separately. Lambs, goats, and market hogs (barrows and
// gilts) hang whole and get a single weight and a single tag. Charlie, kill day
// 2026-07-20: "Lambs, Goats, market hogs are all 1 weight. Sows boars and beef
// will be half half weights."
//
// Sex is what separates a market hog from a sow or boar, so it's required to
// answer for hogs. With no sex recorded yet, a hog is assumed to be a market
// hog — that's the overwhelming majority of what comes through.

export function splitsIntoHalves(species?: string | null, sex?: string | null): boolean {
  const sp = (species ?? '').trim().toLowerCase()
  const sx = (sex ?? '').trim().toLowerCase()
  if (sp === 'beef') return true
  if (sp === 'hog' || sp === 'pork') return sx === 'sow' || sx === 'boar'
  return false   // lamb, goat, and anything else hangs whole
}

// Label for the single-weight case, used on the Part B entry form.
export const WHOLE_WEIGHT_LABEL = 'Carcass Weight (lbs)'
