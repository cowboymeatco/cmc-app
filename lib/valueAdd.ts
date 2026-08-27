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
  qty?:     number   // how many of this exact line (set by extractValueAdd)
  // Pounds ordered, for the smokehouse block where the sheet asks for a weight
  // rather than a count. The same number that's inside `detail`, kept as a
  // number so a schedule can add it up (2026-08-27).
  lbs?:     number
}

type Json = Record<string, unknown>
const asObj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {})
const asArr = (v: unknown): Json[] => (Array.isArray(v) ? v as Json[] : [])
const str   = (v: unknown): string => (typeof v === 'string' ? v : '')
const arrOfStr = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : [])

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

// Ground-trim flavor + format → a sausage product name. Plain grind is NOT
// value-add. The format (loose-pack / links / patties) becomes part of the
// product so links are counted and shown separately from loose sausage
// (Charlie, 2026-07-30). loose-pack is the default and carries no suffix.
const PLAIN_GRIND = new Set(['ground-pork', 'ground', 'ground-beef', 'grind', ''])
function sausageLabel(flavor: string, format: string): string | null {
  if (PLAIN_GRIND.has(flavor)) return null
  const h    = humanize(flavor)
  const base = /sausage/i.test(h) ? h : `${h} Sausage`
  if (format === 'links')   return `${base} Links`
  if (format === 'patties') return `${base} Patties`
  return base
}

// One entry per flavor in a smokehouse array ({flavor, lbs, cheese}).
function smokeItems(raw: unknown, product: string): ValueAddItem[] {
  return asArr(raw).map(it => {
    const detail = [
      str(it.flavor) ? humanize(str(it.flavor)) : '',
      it.lbs ? `${it.lbs} lb` : '',
      str(it.cheese) ? `+${humanize(str(it.cheese))}` : '',
    ].filter(Boolean).join(' · ')
    const lbs = Number(it.lbs)
    return {
      product, category: 'Smokehouse', detail: detail || undefined,
      lbs: Number.isFinite(lbs) && lbs > 0 ? lbs : undefined,
    }
  })
}

// The smokehouse block + ground-trim sausage — identical structure on every
// species' sheet, so shared.
function sharedValueAdd(d: Json): ValueAddItem[] {
  const out: ValueAddItem[] = []
  const trim = asObj(d.trim)
  for (const [f, fmt] of [[trim.flavor1, trim.format1], [trim.flavor2, trim.format2]] as [unknown, unknown][]) {
    const label = sausageLabel(str(f), str(fmt))
    if (label) out.push({ product: label, category: 'Sausage' })
  }
  const sh = asObj(d.smokehouse)
  out.push(...smokeItems(sh.sticks, 'Snack Sticks'))
  out.push(...smokeItems(sh.brats,  'Brots'))
  out.push(...smokeItems(sh.summer, 'Summer Sausage'))
  out.push(...smokeItems(sh.jerky,  'Jerky'))
  const hd = asObj(sh.hotDogs)
  if (Object.keys(hd).length) {
    const detail = [hd.lbs ? `${hd.lbs} lb` : '', str(hd.cheese) ? `+${humanize(str(hd.cheese))}` : ''].filter(Boolean).join(' · ')
    const hdLbs = Number(hd.lbs)
    out.push({
      product: 'Hot Dogs', category: 'Smokehouse', detail: detail || undefined,
      lbs: Number.isFinite(hdLbs) && hdLbs > 0 ? hdLbs : undefined,
    })
  }
  return out
}

function porkValueAdd(d: Json): ValueAddItem[] {
  const out: ValueAddItem[] = []
  // A whole hog (incl. the A|B and A|B|C|D shares — one card for the whole
  // animal) yields TWO of each paired primal; a half/quarter yields one. The
  // sheet records a paired primal once when both sides are cut the same ("same"
  // mode) — that one choice covers both sides, so it counts as perAnimal. In
  // "split" mode each side is its own entry (cut2/style2 set) and counts as one.
  const perAnimal = str(d.portion).startsWith('whole') ? 2 : 1

  const belly = asObj(d.belly)
  if (str(belly.cut2)) {
    for (const cut of [str(belly.cut), str(belly.cut2)]) {
      if (cut === 'bacon') out.push({ product: 'Bacon', category: 'Bacon', qty: 1 })
    }
  } else if (str(belly.cut) === 'bacon') {
    out.push({ product: 'Bacon', category: 'Bacon', qty: perAnimal })
  }
  // The shoulder is a paired primal too (two per whole hog), split-aware via
  // shoulder2. Shoulder bacon and pulled pork are per-shoulder add-ons, so a
  // whole hog with both shoulders bacon'd counts 2 — same rule as belly/ham
  // (Charlie, 2026-07-30: "Shoulder Bacon should be a 1 or 2").
  const shoulder = asObj(d.shoulder)
  const addons1  = arrOfStr(shoulder.addons)
  const shoulder2 = asObj(shoulder.shoulder2)
  const shoulderSplit = Object.keys(shoulder2).length > 0
  const addons2  = arrOfStr(shoulder2.addons)
  const shoulderQty = (addon: string) => shoulderSplit
    ? (addons1.includes(addon) ? 1 : 0) + (addons2.includes(addon) ? 1 : 0)
    : (addons1.includes(addon) ? perAnimal : 0)
  const sbQty = shoulderQty('shoulder-bacon')
  const ppQty = shoulderQty('pulled-pork')
  if (sbQty) out.push({ product: 'Shoulder Bacon', category: 'Bacon',  qty: sbQty })
  if (ppQty) out.push({ product: 'Pulled Pork',    category: 'Smoked', qty: ppQty })

  const ham = asObj(d.ham)
  // Pair each ham's style with its own cut (a split order can steak the fresh
  // ham while the cured one stays whole), so the cured ham carries its cut style.
  if (str(ham.style2)) {
    for (const [style, cut] of [[ham.style, ham.cut], [ham.style2, ham.cut2]] as [unknown, unknown][]) {
      if (str(style) === 'cured-smoked') out.push({ product: 'Cured & Smoked Ham', category: 'Ham', detail: hamCutLabel(str(cut)), qty: 1 })
    }
  } else if (str(ham.style) === 'cured-smoked') {
    out.push({ product: 'Cured & Smoked Ham', category: 'Ham', detail: hamCutLabel(str(ham.cut)), qty: perAnimal })
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

// Beef primal value-add. Only the options the wizard itself marks as add-ons
// count — the ones the customer read as a value-add choice, not ordinary cut
// styles. Jill asked for Beef Bacon and Philly by name (2026-08-20); the rest
// of the beef add-ons come through the same traversal, and leaving them out
// would just be the next report.
//
// A beef card records paired primals once when both sides are cut the same, so
// the pork qty rules don't apply here: brisket, plate and chuck roll are single
// primals on a carcass and each split side is its own entry.
const BEEF_CUT_VALUE_ADD: Record<string, { product: string; category: string }> = {
  'beef-bacon':    { product: 'Beef Bacon',              category: 'Bacon' },
  'smoked-sliced': { product: 'Smoked & Sliced Brisket', category: 'Smoked' },
  'corned-beef':   { product: 'Corned Beef',             category: 'Cured' },
  'philly':        { product: 'Philly Style Sliced',     category: 'Specialty' },
  'smoked-pulled': { product: 'Smoked & Pulled Beef',    category: 'Smoked' },
  'seasoned':      { product: 'Seasoned Short Ribs',     category: 'Specialty' },
  'flanken':       { product: 'Flanken Short Ribs',      category: 'Specialty' },
}

function beefValueAdd(d: Json): ValueAddItem[] {
  const out: ValueAddItem[] = []

  // Primal cut choices that ARE the value-add. cut2 is the other side of a
  // split primal and votes separately.
  const cutHit = (primal: unknown, keys: string[] = ['cut', 'cut2']) => {
    const p = asObj(primal)
    for (const k of keys) {
      const hit = BEEF_CUT_VALUE_ADD[str(p[k])]
      if (hit) out.push({ ...hit, qty: 1 })
    }
  }
  cutHit(d.brisket)
  cutHit(d.plate)
  cutHit(d.chuckRoll)
  cutHit(d.shortRibs, ['cut'])

  // Seasoned roasts — an add-on ticked alongside a roast, on any primal that
  // offers it. One line however many primals carry it; the report answers "did
  // they order seasoned roasts", not which muscle.
  // Each primal names its split side differently — chuckRoll carries addons2
  // inline, the arm and the rounds nest theirs under arm2 / round2.
  const seasonedOn = ['chuckRoll', 'armRoast', 'topRound', 'bottomRound', 'topSirloin', 'triTip']
    .some(k => {
      const p = asObj(d[k])
      return [p, asObj(p.arm2), asObj(p.round2)].some(side => arrOfStr(side.addons).includes('seasoned'))
        || arrOfStr(p.addons2).includes('seasoned')
    })
  if (seasonedOn) out.push({ product: 'Seasoned Roasts', category: 'Specialty' })

  const ribeye = asObj(d.ribeye)
  if (ribeye.seasoned || asObj(ribeye.ribeye2).seasoned) {
    out.push({ product: 'Seasoned Ribeye', category: 'Specialty' })
  }
  if (arrOfStr(asObj(d.shank).addons).includes('canoe-marrow')) {
    out.push({ product: 'Canoed Marrow Bones', category: 'Specialty' })
  }

  // Jerky ordered on the round is a smokehouse product recorded on the primal,
  // so it never reached this report through the smokehouse block.
  for (const side of ['topRound', 'bottomRound']) {
    const r = asObj(d[side])
    for (const cut of [r, asObj(r.round2)]) {
      if (str(cut.cut) === 'jerky') {
        const f = str(cut.jerkyFlavor)
        out.push({ product: 'Jerky', category: 'Smokehouse', detail: f ? humanize(f) : undefined })
      }
    }
  }

  out.push(...sharedValueAdd(d))
  return out
}

export function extractValueAdd(species: string | null | undefined, data: unknown): ValueAddItem[] {
  const d = asObj(data)
  const sp = (species ?? str(d.species)).toLowerCase()
  const items = sp === 'pork' || sp === 'hog' ? porkValueAdd(d)
    : sp === 'beef' ? beefValueAdd(d)
    : sharedValueAdd(d)
  // Roll up identical lines (same product + detail) into a count. A whole hog
  // has two bellies and two hams, so "bacon" or "cured ham" legitimately lands
  // twice — Charlie wants that shown as a quantity (2 bacon, 2 ham), not
  // collapsed to a single check (2026-07-30).
  const byKey = new Map<string, ValueAddItem>()
  for (const it of items) {
    const k   = `${it.product}__${it.detail ?? ''}`
    const add = it.qty ?? 1
    const ex  = byKey.get(k)
    if (ex) {
      ex.qty = (ex.qty ?? 1) + add
      // Identical lines carry identical pounds, so the pounds multiply with the
      // count — two 25 lb country brot lines are 50 lb of country brots.
      if (it.lbs != null) ex.lbs = (ex.lbs ?? 0) + it.lbs * add
    } else {
      byKey.set(k, { ...it, qty: add, ...(it.lbs != null ? { lbs: it.lbs * add } : {}) })
    }
  }
  return [...byKey.values()]
}
