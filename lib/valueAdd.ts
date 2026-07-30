// Value-add extraction from a cutting-instruction (cut sheet). The report of
// "who got value-add product" is built from what the customer ORDERED on the
// sheet — the source of truth before anything is packed — not from box scans.
//
// Value-add options are scattered across the wizard's per-primal sections plus
// the shared smokehouse block. This turns one cut sheet's `data` JSON into a
// flat list of value-add line items. Pork is covered fully (Charlie asked for
// hogs first); the smokehouse block and the ground-trim sausage are shared
// across every species, so those come through for beef/lamb too.

export interface ValueAddItem {
  product:  string   // e.g. "Bacon", "Cured & Smoked Ham", "Snack Sticks"
  category: string   // Bacon | Ham | Smoked | Sausage | Smokehouse
  detail?:  string   // flavor / lbs / cheese, when the sheet carries it
}

type Json = Record<string, unknown>
const asObj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {})
const asArr = (v: unknown): Json[] => (Array.isArray(v) ? v as Json[] : [])
const str   = (v: unknown): string => (typeof v === 'string' ? v : '')

// "jalapeno-cheddar" → "Jalapeno Cheddar"
function humanize(slug: string): string {
  return slug.split(/[-_ ]+/).filter(Boolean).map(w => w[0].toUpperCase() + w.slice(1)).join(' ')
}

// Ham cut style → a short label for the value-add cell, so the report shows HOW
// the cured ham is cut (steaks vs quarters) behind the check (Charlie, 2026-07-30).
// Mirrors the cut sheet's own review wording: half → "Cut in Half",
// quarters → "Cut in Quarters", everything else humanized (steaks → "Steaks",
// whole → "Whole", cubed-pork → "Cubed Pork").
function hamCutLabel(cut: string): string | undefined {
  if (!cut) return undefined
  if (cut === 'half')     return 'Cut in Half'
  if (cut === 'quarters') return 'Cut in Quarters'
  return humanize(cut)
}

// Ground-trim flavor → a sausage product name. Plain grind is NOT value-add.
const PLAIN_GRIND = new Set(['ground-pork', 'ground', 'ground-beef', 'grind', ''])
function sausageLabel(flavor: string): string | null {
  if (PLAIN_GRIND.has(flavor)) return null
  const h = humanize(flavor)
  return /sausage/i.test(h) ? h : `${h} Sausage`
}

// One entry per flavor in a smokehouse array ({flavor, lbs, cheese}).
function smokeItems(raw: unknown, product: string): ValueAddItem[] {
  return asArr(raw).map(it => {
    const detail = [
      str(it.flavor) ? humanize(str(it.flavor)) : '',
      it.lbs ? `${it.lbs} lb` : '',
      str(it.cheese) ? `+${humanize(str(it.cheese))}` : '',
    ].filter(Boolean).join(' · ')
    return { product, category: 'Smokehouse', detail: detail || undefined }
  })
}

// The smokehouse block + ground-trim sausage — identical structure on every
// species' sheet, so shared.
function sharedValueAdd(d: Json): ValueAddItem[] {
  const out: ValueAddItem[] = []
  const trim = asObj(d.trim)
  for (const f of [str(trim.flavor1), str(trim.flavor2)]) {
    const label = sausageLabel(f)
    if (label) out.push({ product: label, category: 'Sausage' })
  }
  const sh = asObj(d.smokehouse)
  out.push(...smokeItems(sh.sticks, 'Snack Sticks'))
  out.push(...smokeItems(sh.brats,  'Brats'))
  out.push(...smokeItems(sh.summer, 'Summer Sausage'))
  out.push(...smokeItems(sh.jerky,  'Jerky'))
  const hd = asObj(sh.hotDogs)
  if (Object.keys(hd).length) {
    const detail = [hd.lbs ? `${hd.lbs} lb` : '', str(hd.cheese) ? `+${humanize(str(hd.cheese))}` : ''].filter(Boolean).join(' · ')
    out.push({ product: 'Hot Dogs', category: 'Smokehouse', detail: detail || undefined })
  }
  return out
}

function porkValueAdd(d: Json): ValueAddItem[] {
  const out: ValueAddItem[] = []
  const belly = asObj(d.belly)
  for (const cut of [str(belly.cut), str(belly.cut2)]) {
    if (cut === 'bacon') out.push({ product: 'Bacon', category: 'Bacon' })
  }
  // shoulder.addons is an array of plain strings ('shoulder-bacon', 'pulled-pork').
  const shoulderAddons = (Array.isArray(asObj(d.shoulder).addons) ? asObj(d.shoulder).addons as unknown[] : []).map(String)
  if (shoulderAddons.includes('shoulder-bacon')) out.push({ product: 'Shoulder Bacon', category: 'Bacon' })
  if (shoulderAddons.includes('pulled-pork'))    out.push({ product: 'Pulled Pork', category: 'Smoked' })

  const ham = asObj(d.ham)
  // Pair each ham's style with its own cut (a split order can steak the fresh
  // ham while the cured one stays whole), so the cured ham carries its cut style.
  for (const [style, cut] of [[ham.style, ham.cut], [ham.style2, ham.cut2]] as [unknown, unknown][]) {
    if (str(style) === 'cured-smoked') out.push({ product: 'Cured & Smoked Ham', category: 'Ham', detail: hamCutLabel(str(cut)) })
  }
  // Hocks come the same way as the hams — cured & smoked when the ham is.
  if ([str(ham.style), str(ham.style2)].includes('cured-smoked') && str(asObj(d.hocks).cut) !== 'grind') {
    out.push({ product: 'Cured & Smoked Hocks', category: 'Ham' })
  }

  const loinAddons = (Array.isArray(asObj(d.loin).addons) ? asObj(d.loin).addons as unknown[] : []).map(String)
  if (loinAddons.includes('smoked-chops')) out.push({ product: 'Smoked Chops', category: 'Smoked' })

  out.push(...sharedValueAdd(d))
  return out
}

// Beef primal-specific value-add (brisket beef bacon, corned beef, smoked &
// pulled, seasoned roasts) is not yet parsed — only the shared smokehouse and
// ground-trim sausage come through for beef/lamb/goat for now.
export function extractValueAdd(species: string | null | undefined, data: unknown): ValueAddItem[] {
  const d = asObj(data)
  const sp = (species ?? str(d.species)).toLowerCase()
  const items = sp === 'pork' || sp === 'hog' ? porkValueAdd(d) : sharedValueAdd(d)
  // Collapse exact duplicates (same product + detail) that can arise from
  // split primals both landing on the same choice.
  const seen = new Set<string>()
  return items.filter(it => {
    const k = `${it.product}__${it.detail ?? ''}`
    if (seen.has(k)) return false
    seen.add(k); return true
  })
}
