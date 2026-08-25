// The cut card's packaging sheet — every package this animal owes, in the order
// the packer works down it.
//
// Printed on page 2 of the cut card and checked off live on the scanner as
// packages come over the scale, so both read from this one list rather than
// each having its own idea of what the customer is owed.
import { roundJerkyOrders } from './wipIntent'

export type PackRow = {
  sectionTitle?: string
  cut?:          string
  spec?:         string
  isGrind?:      boolean
  isAddon?:      boolean
  writeIn?:      boolean
}

// Bagged trim (trim.dest === 'bag'): the customer takes their trim un-ground in
// bulk bags, so none of the grind/patty/flavor answers exist on the card. The
// cutters' line has to be loud about it — trim reaching a grinder is not
// recoverable (Jill, 2026-07-28).
export const trimIsBagged = (t: any) => t?.dest === 'bag'

export const bagSizeLabel = (t: any) => (t?.bagSize ? `${t.bagSize} lb bags` : 'bag size not specified')

export const baggedTrimCutterRows = (): Array<[string, string]> => [['Trim', 'BAG — do not grind']]

// v2 beef `trim` prefs split by audience: the blend is the cutters' call
// (cut card), packaging style & size is the packaging side's (packaging sheet)
export function beefTrimCutterRows(t: any): Array<[string, string]> {
  if (trimIsBagged(t)) return baggedTrimCutterRows()
  const rows: Array<[string, string]> = []
  if (t?.fatPct) rows.push(['Grind Blend', t.fatPct])
  // Excess fat is thrown away unless the customer asked for it, and that call
  // gets made at the table while the animal is being broken — long before
  // anything reaches packing. Silent when they didn't ask, so the cutters only
  // read a line that means "don't bin this" (Jill/Charlie, 2026-08-04).
  if (t?.keepFat) rows.push(['Excess Fat', 'SAVE — customer wants it back'])
  return rows
}

export function beefTrimPackRows(t: any): Array<[string, string]> {
  if (!t) return []
  if (trimIsBagged(t)) return baggedTrimPackRows(t)
  const rows: Array<[string, string]> = []
  const pattyPct = Number(t.pattyPct ?? 0)
  // Patties can be ordered as a share of the trim or as a flat weight; the two
  // are never both set (Jill, 2026-08-21). A weight always leaves a remainder,
  // so the loose line is never suppressed on that side.
  const pattyLbs = Number(t.pattyLbs ?? 0)
  const byWeight = pattyLbs > 0

  if (byWeight || pattyPct < 100) {
    const parts = [
      t.loose?.packSize ? `${t.loose.packSize} lb ${t.loose?.rollstock ? 'rollstock' : 'packs'}` : '',
      byWeight ? 'whatever is left after the patties' : pattyPct > 0 ? `${100 - pattyPct}% of trim` : '',
    ].filter(Boolean)
    if (parts.length) rows.push(['Loose Grind', parts.join(' · ')])
  }
  if (byWeight || pattyPct > 0) {
    const parts = [
      t.patties?.size ?? '',
      t.patties?.pkg === '1lb' ? '1 lb pkgs' : t.patties?.pkg === '10lb' ? '10 lb box' : '',
      byWeight ? `${pattyLbs} lb` : pattyPct < 100 ? `${pattyPct}% of trim` : 'all trim',
    ].filter(Boolean)
    rows.push(['Patties', parts.join(' · ')])
  }
  // Saved fat leaves as its own bagged item, so packing has to see it too —
  // same treatment bagged trim gets.
  if (t.keepFat) rows.push(['Excess Fat', 'Bag back — customer renders it'])
  return rows
}

// Office detail view shows the whole picture

// Office detail view shows the whole picture
export function beefTrimRows(t: any): Array<[string, string]> {
  return [...beefTrimCutterRows(t), ...beefTrimPackRows(t)]
}

// v2 pork sausage: flavor is a processing decision, format is packaging —
// the packaging rows keep the flavor so each format is tied to its sausage
// Rows are named for the flavor rather than "Sausage 1 / 2". Plain ground pork
// under a "Sausage 1" label read as a stale leftover row (Jill), and naming the
// flavor still separates two rows that share one — a trim split into pork
// sausage links AND pork sausage patties reads as two clear lines.

// v2 pork sausage: flavor is a processing decision, format is packaging —
// the packaging rows keep the flavor so each format is tied to its sausage
// Rows are named for the flavor rather than "Sausage 1 / 2". Plain ground pork
// under a "Sausage 1" label read as a stale leftover row (Jill), and naming the
// flavor still separates two rows that share one — a trim split into pork
// sausage links AND pork sausage patties reads as two clear lines.
export const trimSplitOf = (t: any) => t?.split === 'yes' && !!t?.flavor2

// The cutter's page carries flavor AND format now, plus each flavor's share, so
// the trim gets divided at the table instead of guessed at (Jill, 2026-07-21).

// The cutter's page carries flavor AND format now, plus each flavor's share, so
// the trim gets divided at the table instead of guessed at (Jill, 2026-07-21).
export function porkTrimCutterRows(t: any, f: (s: string) => string): Array<[string, string]> {
  if (!t) return []
  if (trimIsBagged(t)) return baggedTrimCutterRows()
  const split = trimSplitOf(t)
  const share = split ? '50% of trim' : 'all trim'
  const rows: Array<[string, string]> = []
  if (t.flavor1) rows.push([f(t.flavor1), [f(t.format1 ?? ''), share].filter(Boolean).join(' · ')])
  if (split)     rows.push([f(t.flavor2), [f(t.format2 ?? ''), share].filter(Boolean).join(' · ')])
  return rows
}

export function porkTrimRows(t: any, f: (s: string) => string): Array<[string, string]> {
  if (!t) return []
  if (trimIsBagged(t)) return [...baggedTrimCutterRows(), ...baggedTrimPackRows(t)]
  const split = trimSplitOf(t)
  const share = split ? '50% of trim' : ''
  const rows: Array<[string, string]> = []
  if (t.flavor1) rows.push([f(t.flavor1), [f(t.format1 ?? ''), share].filter(Boolean).join(' · ')])
  if (split)     rows.push([f(t.flavor2), [f(t.format2 ?? ''), share].filter(Boolean).join(' · ')])
  return rows
}

// Lamb/goat trim destination. All three renderers used to hardcode
// "grind ? Ground : Stew", so any new wizard option printed as Stew — a wrong
// instruction to the floor rather than a missing one. One place now, and an
// unknown value falls back to its own name instead of a confident lie.
// `species` names the sausage — "Lamb Sausage", not "Breakfast Sausage" — so the
// card matches what goes on the label (Jill, 2026-07-21).

// Lamb/goat trim destination. All three renderers used to hardcode
// "grind ? Ground : Stew", so any new wizard option printed as Stew — a wrong
// instruction to the floor rather than a missing one. One place now, and an
// unknown value falls back to its own name instead of a confident lie.
// `species` names the sausage — "Lamb Sausage", not "Breakfast Sausage" — so the
// card matches what goes on the label (Jill, 2026-07-21).
export function lgTrimLabel(style?: string | null, species?: string | null, bagSize?: string | null): string {
  if (!style) return ''
  if (style === 'grind')   return 'Ground — 1 lb packs'
  if (style === 'stew')    return 'Stew — 1 lb packs'
  if (style === 'sausage') return `${v2fmt(species ?? '') || 'Lamb'} Sausage — 1 lb packs`
  if (style === 'bag')     return `BAG — do not grind · ${bagSize ? `${bagSize} lb bags` : 'bag size not specified'}`
  return v2fmt(style)
}

// Smokehouse orders — what the customer wants built out of their trim. These
// never reached any printed sheet, so the floor had no way to know how much
// trim to hold back before the rest went to grind (Charlie, 2026-07-21).

// Smokehouse orders — what the customer wants built out of their trim. These
// never reached any printed sheet, so the floor had no way to know how much
// trim to hold back before the rest went to grind (Charlie, 2026-07-21).
// `data` is the whole cut sheet, not just the smokehouse block: jerky ordered on
// the round step is recorded on the PRIMAL, so a reader looking only at
// `smokehouse.*` never sees it and the smokehouse crew was never told to make it
// (Jill, 2026-08-20). Optional so the block alone still works where that is all
// a caller has.
export function smokehouseRows(sm: any, f: (s: string) => string, data?: any): Array<[string, string]> {
  const jerkyFromRound = roundJerkyOrders(data ?? null)
  if (!sm && !jerkyFromRound.length) return []
  // Round jerky can be the only smokehouse work on a sheet, so the block below
  // has to survive an absent smokehouse object rather than reaching into null.
  sm = sm ?? {}
  const rows: Array<[string, string]> = []
  // Printed first: it's a whole primal committed before any trim is weighed out,
  // so the crew needs it in hand before they start allocating.
  for (const label of jerkyFromRound) {
    rows.push([label, 'From the round — whole primal, no set weight'])
  }
  // A smokehouse order on a multi-head drop-off either repeats on every animal
  // or belongs to a single one. The floor cannot infer that from the card, and
  // getting it wrong is three lambs' worth of brots instead of one — which is
  // exactly what happened to Kristin at VML (2026-08-21). The poundage itself
  // is per animal either way, so only the scope needs saying.
  const heads = Number(data?.headCount) > 1 ? Math.floor(Number(data.headCount)) : 1
  const scopeNote = (key: string): string => {
    if (heads <= 1) return ''
    const sc = sm[`${key}Scope`]
    if (sc === 'one') return 'ONE ANIMAL ONLY — not on every head'
    if (sc === 'all') return `each of ${heads} head`
    return ''
  }
  const add = (label: string, items: any, key: string) => {
    if (!Array.isArray(items)) return
    for (const it of items) {
      const spec = [it?.lbs ? `${it.lbs} lbs` : '', f(it?.flavor ?? ''), it?.cheese ? f(it.cheese) : '', scopeNote(key)]
        .filter(Boolean).join(' · ')
      if (spec) rows.push([label, spec])
    }
  }
  add('Snack Sticks',   sm.sticks, 'sticks')
  // "Brots" — brotwurst is the FSIS name for what we make; the JSON key stays
  // `brats` because that's what every stored order already carries.
  add('Brots',          sm.brats, 'brats')
  add('Summer Sausage', sm.summer, 'summer')
  add('Jerky',          sm.jerky, 'jerky')
  // Jerky comes off the bottom round, which only yields so much. This is the
  // customer's written answer on topping the order up out of our own cooler —
  // the office bills off it, so it prints right under the jerky lines.
  if (sm.jerkySupplement) {
    rows.push(['Jerky Shortfall', sm.jerkySupplement === 'yes'
      ? 'OK to add our bottom round — market price'
      : 'DO NOT supplement — only their own animal'])
  }
  if (sm.hotDogs) {
    const spec = [sm.hotDogs.lbs ? `${sm.hotDogs.lbs} lbs` : '', sm.hotDogs.cheese ? f(sm.hotDogs.cheese) : '', scopeNote('hotDogs')]
      .filter(Boolean).join(' · ')
    if (spec) rows.push(['Hot Dogs', spec])
  }
  return rows
}

// Trim committed to the smokehouse, in lbs — the number that decides how much
// to save back, so the crew doesn't have to add up the lines themselves.

// Trim committed to the smokehouse, in lbs — the number that decides how much
// to save back, so the crew doesn't have to add up the lines themselves.
export function smokehouseTotalLbs(sm: any): number {
  if (!sm) return 0
  const sum = (items: any) => Array.isArray(items)
    ? items.reduce((s: number, i: any) => s + (Number(i?.lbs) || 0), 0) : 0
  return sum(sm.sticks) + sum(sm.brats) + sum(sm.summer) + sum(sm.jerky) + (Number(sm.hotDogs?.lbs) || 0)
}

// Everything weighed as it goes in — curing (bacon, cured hams), sausage work,
// and plain grinding. Billing is on the raw weight, which nothing captured, so
// each of these gets a blank to write on. Driven off the order, so a customer
// who didn't buy bacon never gets a bacon line, and the heading names only the
// work that's actually on the sheet.

// Everything weighed as it goes in — curing (bacon, cured hams), sausage work,
// and plain grinding. Billing is on the raw weight, which nothing captured, so
// each of these gets a blank to write on. Driven off the order, so a customer
// who didn't buy bacon never gets a bacon line, and the heading names only the
// work that's actually on the sheet.
export function rawWeighIn(d: any, f: (s: string) => string): { rows: Array<[string, string]>; title: string } {
  const rows: Array<[string, string]> = []
  const scope = new Set<string>()
  const belly = d?.belly
  if (belly?.cut === 'bacon' || belly?.cut2 === 'bacon') {
    const both = belly.cut === 'bacon' && belly.cut2 === 'bacon'
    rows.push(['Bacon', both ? 'Both bellies · cure & smoke' : 'Cure & smoke'])
    scope.add('Curing')
  }
  // Shoulder bacon is a cured add-on chosen on the shoulder step (data.shoulder
  // .addons, or shoulder2.addons for a split whole hog). Like belly bacon it's
  // billed on the raw weight into the cure, so it earns its own weigh-in line.
  const sh = d?.shoulder
  const shoulderBacon  = Array.isArray(sh?.addons) && sh.addons.includes('shoulder-bacon')
  const shoulderBacon2 = Array.isArray(sh?.shoulder2?.addons) && sh.shoulder2.addons.includes('shoulder-bacon')
  if (shoulderBacon || shoulderBacon2) {
    const both = shoulderBacon && shoulderBacon2
    rows.push(['Shoulder Bacon', both ? 'Both shoulders · cure & smoke' : 'Cure & smoke'])
    scope.add('Curing')
  }
  const ham = d?.ham
  const curedHams = [ham?.style, ham?.style2].filter(s => s === 'cured-smoked').length
  if (curedHams > 0) {
    // Name the cut of the ham actually being cured — with split hams the cured
    // one may be the second, whose cut lives in cut2.
    const curedCuts = [
      ham?.style === 'cured-smoked' ? ham?.cut : null,
      ham?.style2 === 'cured-smoked' ? ham?.cut2 : null,
    ].filter(Boolean).map(c => f(c as string))
    const cutLabel = curedCuts.length === 2 && curedCuts[0] !== curedCuts[1]
      ? curedCuts.join(' / ')
      : curedCuts[0] ?? ''
    rows.push(['Ham — Cure & Smoke', [curedHams > 1 ? 'Both hams' : '', cutLabel].filter(Boolean).join(' · ')])
    scope.add('Curing')
  }
  // Every trim destination gets a weigh-in line, plain ground pork included.
  // Grinding carries no making charge, which is why it used to be left off —
  // but this blank is also the only place the trim's weight gets written down,
  // and without one the ground pork went out unweighed and its poundage landed
  // on whatever else was on the sheet (Charlie, 2026-08-18). Bagged trim never
  // goes through a grinder, so it has nothing to weigh in.
  const t = d?.trim
  const weighTrim = (flavor?: string | null, format?: string | null) => {
    if (!flavor || trimIsBagged(t)) return
    scope.add(flavor === 'ground-pork' ? 'Grinding' : 'Sausage')
    rows.push([f(flavor), f(format ?? '')])
  }
  weighTrim(t?.flavor1, t?.format1)
  if (t?.split === 'yes') weighTrim(t?.flavor2, t?.format2)
  // Smokehouse products used to be repeated down here for their weigh-in
  // blank, which put a "Curing & Sausage" heading on beef cards that have
  // neither (Jill, 2026-07-27). They're weighed on their own Smokehouse rows
  // now, so a beef card with no cure work prints no section at all.
  const parts = ['Curing', 'Sausage', 'Grinding'].filter(p => scope.has(p))
  const scopeLabel = parts.length > 2
    ? `${parts.slice(0, -1).join(', ')} & ${parts[parts.length - 1]}`
    : parts.join(' & ')
  return { rows, title: `Raw Weight In${scopeLabel ? ` — ${scopeLabel}` : ''}` }
}

// ── Cut card field definitions by species ─────────────────────────────────────

export const FMT_OVERRIDES: Record<string, string> = {
  'loose-pack': '1 lb Packs',
  'loin-roast': 'Boneless Loin Roast',
  'whole-ab': 'Whole A|B',
  'whole-abcd': 'Whole A|B|C|D',
  'half-ab': 'Half A|B',
  'three-quarter': '¾ Beef',
  'three-quarter-abc': '¾ A|B|C',
  // Brisket is kept whole; Jill dropped the half options, so the packer/flat
  // slugs read as plain "Packer" / "Flat" instead of "Packer Whole".
  'packer-whole': 'Packer',
  'flat-whole': 'Flat',
}

export function v2fmt(val: string): string {
  if (!val) return ''
  return FMT_OVERRIDES[val] ?? val.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())
}

// Leg steaks carry a thickness and pack count, and a split pair only needs one
// side asking for them.

// Two sides of a split primal. Identical answers collapse to one value —
// "1: Filet 2" / 2: Filet 2"" is just noise when both sides match (Charlie).
export function sidePair(a: string, b: string): string {
  if (!a) return b ?? ''
  if (!b || a === b) return a
  return `1: ${a} / 2: ${b}`
}

// Hocks follow the ham style (the wizard leaves hocks.cut empty). The cutter
// only needs the word: Fresh or Smoked. Whole-hog split hams (style2) can
// differ, so print both when they do; grind hams get no hock line.

// Hocks follow the ham style (the wizard leaves hocks.cut empty). The cutter
// only needs the word: Fresh or Smoked. Whole-hog split hams (style2) can
// differ, so print both when they do; grind hams get no hock line.
export function hockStyle(ham?: { style?: string | null; style2?: string | null }): string {
  const word = (s?: string | null) => (s === 'fresh' ? 'Fresh' : s === 'cured-smoked' ? 'Smoked' : '')
  if (!ham?.style) return ''
  if (ham.style2) {
    const parts = [word(ham.style), word(ham.style2)]
    return parts.every(Boolean) ? sidePair(parts[0], parts[1]) : parts.filter(Boolean).join(' / ')
  }
  return word(ham.style)
}

// The wizard's ham-cut buttons say "Cut in Half" / "Cut in Quarters" but store
// bare values — print the button wording so "Half" can't read as half a ham

// The wizard's ham-cut buttons say "Cut in Half" / "Cut in Quarters" but store
// bare values — print the button wording so "Half" can't read as half a ham
export function hamCut(cut?: string | null): string {
  if (!cut) return ''
  return cut === 'half' ? 'Cut in Half' : cut === 'quarters' ? 'Cut in Quarters' : v2fmt(cut)
}

// Everything cured here also gets smoked, so "Cured & Smoked" is two words of
// noise on a card read at arm's length — it prints as "Cured" (Charlie).

// Everything cured here also gets smoked, so "Cured & Smoked" is two words of
// noise on a card read at arm's length — it prints as "Cured" (Charlie).
export function hamStyleWord(style?: string | null): string {
  return style === 'cured-smoked' ? 'Cured' : v2fmt(style ?? '')
}

// One ham, one line, whole story: "Cured: Cut in Quarters". A ham going to
// grind has no cut, so it's just the style — and any cut is ignored outright,
// since legacy split-ham orders (before the per-ham cut split, 2026-07-22) can
// carry a stale cut under a grind style and would otherwise read as the
// contradiction "Grind: Steaks" (Charlie, 2026-07-23). The packaging sheet keys
// on the bare word "Grind" to route the ham to the grind pile, so dropping the
// cut also stops a ground ham being packed as a whole ham.

// One ham, one line, whole story: "Cured: Cut in Quarters". A ham going to
// grind has no cut, so it's just the style — and any cut is ignored outright,
// since legacy split-ham orders (before the per-ham cut split, 2026-07-22) can
// carry a stale cut under a grind style and would otherwise read as the
// contradiction "Grind: Steaks" (Charlie, 2026-07-23). The packaging sheet keys
// on the bare word "Grind" to route the ham to the grind pile, so dropping the
// cut also stops a ground ham being packed as a whole ham.
export function hamLine(style?: string | null, cut?: string | null): string {
  const s = hamStyleWord(style)
  if (!s) return ''
  if (style === 'grind') return s
  const c = hamCut(cut)
  return c ? `${s}: ${c}` : s
}

// Split hams read as one row each; matched hams collapse to a single
// instruction, since repeating an identical line twice is just more to read.

// Split hams read as one row each; matched hams collapse to a single
// instruction, since repeating an identical line twice is just more to read.
export function hamRows(ham?: { style?: string | null; cut?: string | null; style2?: string | null; cut2?: string | null }): Array<[string, string]> {
  if (!ham?.style) return []
  const one = hamLine(ham.style, ham.cut)
  if (!ham.style2) return one ? [['Ham', one]] : []
  const two = hamLine(ham.style2, ham.cut2)
  if (!two || one === two) return one ? [['Ham', one]] : []
  return [['Ham (1)', one], ['Ham (2)', two]]
}

// A cured belly IS bacon and the packagers know it, so the belly reads the same
// way the ham does rather than naming the product it becomes (Charlie).

// A cured belly IS bacon and the packagers know it, so the belly reads the same
// way the ham does rather than naming the product it becomes (Charlie).
export function bellyWord(cut?: string | null): string {
  return cut === 'bacon' ? 'Cured' : v2fmt(cut ?? '')
}

export function bellyRows(belly?: { cut?: string | null; cut2?: string | null }): Array<[string, string]> {
  if (!belly?.cut) return []
  const one = bellyWord(belly.cut)
  if (!belly.cut2) return [['Belly', one]]
  const two = bellyWord(belly.cut2)
  if (!two || one === two) return [['Belly', one]]
  return [['Belly (1)', one], ['Belly (2)', two]]
}

// Shop-standard steak thicknesses the wizard states in its labels but doesn't
// store — printed on the cards so new cutters don't have to ask

// Shop-standard steak thicknesses the wizard states in its labels but doesn't
// store — printed on the cards so new cutters don't have to ask
export const STEAK_STANDARDS: Record<string, string> = {
  'chuck-steaks':      '1',     // wizard label: Chuck Steaks (1")
  'rancher-steaks':    '0.75',  // wizard label: Rancher Steaks (¾")
  'flat-iron:steaks':  '1',     // flat iron — shop standard per Charlie 2026-07-16
}
// primal disambiguates generic cut values like 'steaks' that several primals share

// primal disambiguates generic cut values like 'steaks' that several primals share
export function stdThick(cut?: string, primal?: string): string {
  if (!cut) return ''
  return STEAK_STANDARDS[`${primal}:${cut}`] ?? STEAK_STANDARDS[cut] ?? ''
}

// Arm / chuck / sirloin-tip roasts are portioned by a count now ("3 Roasts"),
// replacing the old whole/half/thirds/quarters fractions (Jill, 2026-07-23).
//
// The count the customer picked is per side — these primals come one per half —
// so on a whole beef the floor has to cut twice that many. Spell out both
// numbers rather than making the cutter double it (Jill, 2026-07-24).

// Arm / chuck / sirloin-tip roasts are portioned by a count now ("3 Roasts"),
// replacing the old whole/half/thirds/quarters fractions (Jill, 2026-07-23).
//
// The count the customer picked is per side — these primals come one per half —
// so on a whole beef the floor has to cut twice that many. Spell out both
// numbers rather than making the cutter double it (Jill, 2026-07-24).
export function roastText(count?: string | null, perHalf = false): string {
  if (!count) return 'Roasts'
  const n = Number(count)
  const plural = (x: number) => `${x} Roast${x === 1 ? '' : 's'}`
  if (!perHalf || !Number.isFinite(n) || n <= 0) return plural(n || 0)
  return `${count} per half — ${plural(n * 2)} total`
}
// Render a roast-count cut, or fall back to the caller's normal cut formatter.

// Render a roast-count cut, or fall back to the caller's normal cut formatter.
export function roastOr(cut: string | undefined | null, count: string | undefined | null, renderCut: (cut: string) => string, perHalf = false): string {
  return cut === 'roasts' ? roastText(count, perHalf) : renderCut(cut ?? '')
}
// Both halves are in play, so a per-side count doubles. A split primal already
// carries its own count per side, so those never double.

// Both halves are in play, so a per-side count doubles. A split primal already
// carries its own count per side, so those never double.
export function isWholeAnimal(portion?: string | null): boolean {
  return portion === 'whole' || portion === 'whole-ab'
}

// A whole packer/flat brisket can be halved via a toggle (whole/half beef).

// A whole packer/flat brisket can be halved via a toggle (whole/half beef).
export function brisketLabel(cut: string | undefined | null, half: boolean | undefined, f: (c: string) => string): string {
  const base = f(cut ?? '')
  return half && (cut === 'packer-whole' || cut === 'flat-whole') ? `${base} — Cut in Half` : base
}

// Bone-in short loin still yields filets: the tenderloin head runs past the
// last rib, so 3–4 filet mignons come off before the T-bones start. That's why
// the row prints at all on a bone-in loin — the cutter only needs the thickness.

// The wizard offers thicknesses as fractions (¾", 1¼") but stores the decimal.
// Print the fraction the customer actually picked — a cutter reading 0.75" has
// to translate it back to a tape measure anyway (Jill, 2026-07-24).
export const EIGHTHS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞']

export function fracThick(v: string | number | null | undefined): string {
  if (v === null || v === undefined || v === '') return ''
  const n = Number(v)
  if (!Number.isFinite(n) || n <= 0) return String(v)
  const whole = Math.floor(n)
  const eighth = Math.round((n - whole) * 8)
  // Rounded up to the next whole inch (e.g. 1.99)
  if (eighth === 8) return `${whole + 1}"`
  const frac = EIGHTHS[eighth]
  if (!frac) return `${whole}"`
  return whole > 0 ? `${whole}${frac}"` : `${frac}"`
}

// The ribeye's only value-add is Seasoned (roast cuts only), and the wizard
// stores it as a boolean rather than the addons array every other primal uses.
// Older saved forms carry an addons array instead, so merge both shapes and let
// the ribeye print under the same add-on rows as the rest of the card.
export function ribeyeAdds(r?: { addons?: string[]; seasoned?: boolean } | null): string[] {
  const a: string[] = [...(r?.addons ?? [])]
  if (r?.seasoned && !a.includes('seasoned')) a.push('seasoned')
  return a
}

export const baggedTrimPackRows   = (t: any): Array<[string, string]> => [['Bagged Trim', bagSizeLabel(t)]]
export const BONE_IN_FILET_THICKNESS = '2"'
// One pork shoulder as (label, value) pairs. A whole hog's two shoulders can
// be cut differently (one roast, one grind), so each renders through here and
// the pair gets merged below.
export function shoulderFields(sh: any, f: (v: string) => string, t: (v: string) => string): Array<[string, string]> {
  if (!sh?.cut) return []
  const out: Array<[string, string]> = [['Cut', f(sh.cut)]]
  if (sh.cut === 'roast') {
    out.push(['Roast Size', sh.addons?.includes('pulled-pork') ? 'Whole shoulder — pulled pork' : sh.roastSize ? `${sh.roastSize} lb` : ''])
  }
  if (sh.cut === 'steaks' && sh.steakThickness) out.push(['Thickness', t(sh.steakThickness)])
  if (sh.addons?.length) out.push(['Add-ons', sh.addons.map(f).join(', ')])
  return out.filter(([, v]) => v)
}

// One pork loin as (label, value) pairs. A whole hog's two loins can be cut
// differently (one chops, one roast), each with its own tenderloin, so each
// renders through here and the pair gets merged below.
// One pork loin as (label, value) pairs. A whole hog's two loins can be cut
// differently (one chops, one roast), each with its own tenderloin, so each
// renders through here and the pair gets merged below.
export function loinFields(loin: any, f: (v: string) => string, t: (v: string) => string): Array<[string, string]> {
  if (!loin?.cut) return []
  const out: Array<[string, string]> = [['Cut', f(loin.cut)]]
  if (loin.cut === 'bone-in-chops' || loin.cut === 'boneless-chops' || loin.cut === 'smoked-chops') {
    if (loin.chopThickness) out.push(['Chop Thickness', t(loin.chopThickness)])
    if (loin.chopPack) out.push(['Per Pack', String(loin.chopPack)])
  }
  if (loin.cut === 'boneless-chops') out.push(['Baby Back Ribs', f(loin.babyBack ?? '')])
  if (loin.cut === 'loin-roast') out.push(['Roast Size', f(loin.roastSize ?? '')])
  // Bone-in chops keep the tenderloin, so it carries no separate line.
  if (loin.cut !== 'bone-in-chops') out.push(['Tenderloin', f(loin.tenderloin ?? '')])
  if (loin.addons?.length) out.push(['Add-ons', loin.addons.map(f).join(', ')])
  return out.filter(([, v]) => v)
}

// Merge the two sides of a split primal row-by-row: a row that comes out the
// same on both sides prints once, unsuffixed; only rows that actually differ
// get labelled (1) / (2). Two loins both yielding a 2" filet is one line.
// Merge the two sides of a split primal row-by-row: a row that comes out the
// same on both sides prints once, unsuffixed; only rows that actually differ
// get labelled (1) / (2). Two loins both yielding a 2" filet is one line.
export function mergeSides(a: Array<[string, string]>, b: Array<[string, string]>): Array<[string, string]> {
  const out: Array<[string, string]> = []
  const usedB = new Set<number>()
  for (const [la, va] of a) {
    const j = b.findIndex(([lb, vb], i) => !usedB.has(i) && lb === la && vb === va)
    if (j >= 0) { usedB.add(j); out.push([la, va]) }
    else out.push([`${la} (1)`, va])
  }
  b.forEach(([lb, vb], i) => { if (!usedB.has(i)) out.push([`${lb} (2)`, vb]) })
  return out
}

export function buildPackList(d: any, species: string): PackRow[] {
  const sp          = String(species || '').toLowerCase()
  const isBeef      = sp === 'beef'
  const isPork      = sp === 'pork' || sp === 'hog'
  const isLG        = sp === 'lamb' || sp === 'goat'
  const wholeAnimal = isWholeAnimal(d.portion)

  const fmt   = (v: string) => v ? (FMT_OVERRIDES[v] ?? v.replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase())) : ''
  const thick = (v: string) => fracThick(v)
  const withT = (cut: string, t: string) => [fmt(cut), thick(t)].filter(Boolean).join(' — ')
  const adds  = (arr: string[]) => arr?.length ? arr.map(fmt).join(', ') : ''
  // Jill's wording: a kept-whole rack reads "Frenched Rack of Lamb/Goat"
  const rackDisplay = (v?: string) => v === 'whole-rack' ? `Frenched Rack of ${sp === 'goat' ? 'Goat' : 'Lamb'}` : fmt(v ?? '')
  const roundOne = (r: any, perHalf = false) => r?.cut === 'jerky'
    ? `Jerky${r.jerkyFlavor ? ` — ${fmt(r.jerkyFlavor)}` : ''}`
    : roastOr(r?.cut, r?.roastCount, c => withT(c, r?.thickness ?? ''), perHalf)

  // ── Page 2: Packaging Sheet ───────────────────────────────────────────────
  type PR = { sectionTitle?: string; cut?: string; spec?: string; isGrind?: boolean; isAddon?: boolean; writeIn?: boolean }
  const prs: PR[] = []
  const grindFrom: string[] = []

  const ps  = (title: string)                          => prs.push({ sectionTitle: title })
  const pc  = (cut: string, spec: string, isAddon = false) => prs.push({ cut, spec, isAddon })
  const pg  = (src: string)                            => grindFrom.push(src)

  // Nothing the customer turned down belongs on this sheet: every row here is a
  // packing row with a checkbox, so "Liver · Discard" reads like something to
  // put in the box (Charlie + Jill's card, 2026-07-22). The cut card still
  // carries these — the cutter has to know to discard rather than save.
  // The wizard writes 'keep' / 'discard'; older orders used yes/no, so both
  // vocabularies count as declined.
  const wanted = (v?: string | null) => !!v && !['discard', 'no', 'none'].includes(v.toLowerCase())
  if (d.organs) {
    const orgPacks: string[] = []
    if (wanted(d.organs.heart)) orgPacks.push(`Heart · ${fmt(d.organs.heart)}`)
    if (wanted(d.organs.liver)) orgPacks.push(`Liver · ${fmt(d.organs.liver)}`)
    if (isBeef && wanted(d.organs.tongue)) orgPacks.push(`Tongue · ${fmt(d.organs.tongue)}`)
    if (isBeef && wanted(d.organs.oxtail)) orgPacks.push(`Oxtail · ${fmt(d.organs.oxtail)}`)
    if (orgPacks.length) { ps('Organs'); orgPacks.forEach(o => pc(o, '')) }
  }

  if (isBeef && !d.grindWhole) {
    ps('Chuck')
    if (d.brisket?.cut) {
      if (d.brisket.cut === 'grind') { pg('Brisket') }
      else {
        const bSpec = (d.brisket.cut2 ? sidePair(brisketLabel(d.brisket.cut, d.brisket.half, fmt), brisketLabel(d.brisket.cut2, d.brisket.half2, fmt)) : brisketLabel(d.brisket.cut, d.brisket.half, fmt))
          + (d.brisket.fat ? ` · ${fmt(d.brisket.fat)}` : '')
        pc('Brisket', bSpec)
      }
    }
    if (d.shank?.cut) {
      if (d.shank.cut === 'grind' || d.shank.cut === 'grind-marrow') {
        pg('Shank')
        if (d.shank.cut === 'grind-marrow') pc('Shank Marrow Bones', 'Return marrow bones')
      } else { pc('Shank', fmt(d.shank.cut)) }
      if (d.shank.addons?.length) pc('  Add-on', adds(d.shank.addons), true)
    }
    if (d.armRoast?.arm2) {
      if (d.armRoast.cut === 'grind') pg('Arm Roast (1)')
      else if (d.armRoast.cut) { pc('Arm Roast (1)', roastOr(d.armRoast.cut, d.armRoast.roastCount, c => withT(c, stdThick(c)))); if (d.armRoast.addons?.length) pc('  Add-on', adds(d.armRoast.addons), true) }
      if (d.armRoast.arm2.cut === 'grind') pg('Arm Roast (2)')
      else if (d.armRoast.arm2.cut) { pc('Arm Roast (2)', roastOr(d.armRoast.arm2.cut, d.armRoast.arm2.roastCount, c => withT(c, stdThick(c)))); if (d.armRoast.arm2.addons?.length) pc('  Add-on', adds(d.armRoast.arm2.addons), true) }
    } else if (d.armRoast?.cut) {
      if (d.armRoast.cut === 'grind') pg('Arm Roast')
      else { pc('Arm Roast', roastOr(d.armRoast.cut, d.armRoast.roastCount, c => withT(c, stdThick(c)), wholeAnimal)); if (d.armRoast.addons?.length) pc('  Add-on', adds(d.armRoast.addons), true) }
    }
    if (d.flatIron?.cut) { d.flatIron.cut === 'grind' ? pg('Flat Iron') : pc('Flat Iron', withT(d.flatIron.cut, stdThick(d.flatIron.cut, 'flat-iron'))) }
    if (d.chuckRoll?.cut2) {
      if (d.chuckRoll.cut === 'grind') pg('Chuck Roll (1)')
      else if (d.chuckRoll.cut) { pc('Chuck Roll (1)', roastOr(d.chuckRoll.cut, d.chuckRoll.roastCount, c => withT(c, stdThick(c)))); if (d.chuckRoll.addons?.length) pc('  Add-on', adds(d.chuckRoll.addons), true) }
      if (d.chuckRoll.cut2 === 'grind') pg('Chuck Roll (2)')
      else { pc('Chuck Roll (2)', roastOr(d.chuckRoll.cut2, d.chuckRoll.roastCount2, c => withT(c, stdThick(c)))); if (d.chuckRoll.addons2?.length) pc('  Add-on', adds(d.chuckRoll.addons2), true) }
    } else if (d.chuckRoll?.cut) {
      if (d.chuckRoll.cut === 'grind') pg('Chuck Roll')
      else { pc('Chuck Roll', roastOr(d.chuckRoll.cut, d.chuckRoll.roastCount, c => withT(c, stdThick(c)), wholeAnimal)); if (d.chuckRoll.addons?.length) pc('  Add-on', adds(d.chuckRoll.addons), true) }
    }
    ps('Plate & Short Ribs')
    if (d.shortRibs?.cut) {
      if (d.shortRibs.cut === 'grind') pg('Short Ribs')
      else {
        pc('Short Ribs', fmt(d.shortRibs.cut))
        // Keep-half splits the set: half is packed as short ribs, the rest goes
        // to grind, so it has to show up on BOTH lists or the packer loses it.
        if (d.shortRibs.cut === 'keep-half') pg('Short Ribs (half)')
        if (d.shortRibs.addons?.length) pc('  Add-on', adds(d.shortRibs.addons), true)
      }
    }
    if (d.plate?.cut) { d.plate.cut === 'grind' ? pg('Plate') : pc('Plate / Beef Bacon', fmt(d.plate.cut)) }
    ps('Rib')
    // grind lives at the style level for ribeye (the wizard clears cut when style is grind)
    const packRibeye = (r: any, sfx: string) => {
      if (r.style === 'grind' || r.cut === 'grind') { pg(`Rib${sfx}`); return }
      if (!r.cut) return
      pc(`Rib${sfx}`, [fmt(r.style), withT(r.cut, r.thickness ?? '')].filter(Boolean).join(' · '))
      const a = ribeyeAdds(r)
      if (a.length) pc('  Add-on', adds(a), true)
    }
    if (d.ribeye?.ribeye2) {
      packRibeye(d.ribeye, ' (1)')
      packRibeye(d.ribeye.ribeye2, ' (2)')
    } else if (d.ribeye?.style || d.ribeye?.cut) {
      packRibeye(d.ribeye, '')
    }
    ps('Short Loin')
    const sl = d.shortLoin ?? {}
    // Cuts sent to grind leave the packing list and join the grind bucket;
    // the rest merge row-by-row so an identical row prints once.
    const slPackFields = (s: any): Array<[string, string]> => {
      const out: Array<[string, string]> = []
      if (s?.path === 'bone-in') {
        if (s.tBoneThickness) out.push(['T-Bone / Porterhouse', thick(s.tBoneThickness)])
        out.push(['Filet', BONE_IN_FILET_THICKNESS])
      }
      if (s?.path === 'boneless') {
        if (s.tenderloin?.cut === 'grind') pg('Tenderloin')
        else if (s.tenderloin?.cut === 'filet') out.push(['Filet', '2"'])
        else if (s.tenderloin?.cut) out.push(['Tenderloin', fmt(s.tenderloin.cut)])
        if (s.stripLoin?.cut === 'grind') pg('Strip Loin')
        else if (s.stripLoin?.cut) out.push(['Strip Loin (NY Strip)', withT(s.stripLoin.cut, s.stripLoin.thickness ?? '')])
      }
      return out
    }
    const slPacked = sl.loin2 ? mergeSides(slPackFields(sl), slPackFields(sl.loin2)) : slPackFields(sl)
    slPacked.forEach(([label, value]) => pc(label, value))
    ps('Sirloin')
    if (d.topSirloin?.cut) {
      if (d.topSirloin.cut === 'grind') pg('Top Sirloin')
      else { pc('Top Sirloin', withT(d.topSirloin.cut, d.topSirloin.thickness ?? '')); if (d.topSirloin.addons?.length) pc('  Add-on', adds(d.topSirloin.addons), true) }
    }
    if (d.triTip?.cut) {
      if (d.triTip.cut === 'grind') pg('Tri Tip')
      else { pc('Tri Tip', fmt(d.triTip.cut)); if (d.triTip.addons?.length) pc('  Add-on', adds(d.triTip.addons), true) }
    }
    ps('Flank')
    if (d.skirt?.cut)  { d.skirt.cut  === 'grind' ? pg('Skirt')       : pc('Skirt Steak',  fmt(d.skirt.cut)) }
    if (d.flank?.cut)  { d.flank.cut  === 'grind' ? pg('Flank Steak') : pc('Flank Steak',  fmt(d.flank.cut)) }
    ps('Round')
    const packSirloinTip = (t: { cut?: string; roastCount?: string; thickness?: string; addons?: string[] }, sfx: string) => {
      if (t.cut === 'grind') { pg(`Sirloin Tip${sfx}`); return }
      if (!t.cut) return
      pc(`Sirloin Tip${sfx}`, roastOr(t.cut, t.roastCount, c => withT(c, t.thickness ?? '')))
      if (t.addons?.length) pc('  Add-on', adds(t.addons), true)
    }
    const sameTip = (a: any, b: any) => a?.cut === b?.cut && (a?.roastCount ?? '') === (b?.roastCount ?? '') && (a?.thickness ?? '') === (b?.thickness ?? '')
      && adds(a?.addons ?? []) === adds(b?.addons ?? [])
    if (d.sirloinTip?.tip2 && !sameTip(d.sirloinTip, d.sirloinTip.tip2)) {
      packSirloinTip(d.sirloinTip, ' (1)')
      packSirloinTip(d.sirloinTip.tip2, ' (2)')
    } else if (d.sirloinTip?.cut) {
      packSirloinTip(d.sirloinTip, '')
    }
    // Split rounds get a line per side so each is packed separately
    const packRound = (label: string, r: any, sfx = '') => {
      if (!r?.cut) return
      if (r.cut === 'grind') { pg(`${label}${sfx}`); return }
      pc(`${label}${sfx}`, roundOne(r))
      if (r.addons?.length) pc('  Add-on', adds(r.addons), true)
    }
    // roundOne carries the roast count, so differing counts split the lines.
    // Seasoned on one side only is a real packing difference too.
    const sameRound = (a: any, b: any) => roundOne(a) === roundOne(b) && a?.cut === b?.cut
      && adds(a?.addons ?? []) === adds(b?.addons ?? [])
    if (d.bottomRound?.round2 && !sameRound(d.bottomRound, d.bottomRound.round2)) { packRound('Bottom Round', d.bottomRound, ' (1)'); packRound('Bottom Round', d.bottomRound.round2, ' (2)') }
    else packRound('Bottom Round', d.bottomRound)
    if (d.eyeOfRound?.cut)  { d.eyeOfRound.cut  === 'grind' ? pg('Eye of Round')  : pc('Eye of Round',  withT(d.eyeOfRound.cut,  d.eyeOfRound.thickness  ?? '')) }
    if (d.rumpRoast?.cut)   { d.rumpRoast.cut   === 'grind' ? pg('Rump Roast')    : pc('Rump Roast',    withT(d.rumpRoast.cut,   d.rumpRoast.thickness   ?? '')) }
    if (d.topRound?.round2 && !sameRound(d.topRound, d.topRound.round2)) { packRound('Top Round', d.topRound, ' (1)'); packRound('Top Round', d.topRound.round2, ' (2)') }
    else packRound('Top Round', d.topRound)
    if (wanted(d.roundShank?.marrow)) pc('Round Shank / Marrow', fmt(d.roundShank.marrow))
  }

  if (isPork && !d.grindWhole) {
    const loin = d.loin ?? {}
    ps('Shoulder')
    // A whole hog's two shoulders can be cut differently — pack each one that
    // isn't ground, labelling the sides only when they actually differ.
    const packShoulder = (sh: any, sfx: string) => {
      if (!sh?.cut) return
      if (sh.cut === 'grind') { pg(`Shoulder${sfx}`); return }
      pc(`Shoulder${sfx}`, [
        fmt(sh.cut),
        sh.cut === 'roast'  && sh.roastSize      ? `${sh.roastSize} lb`      : '',
        sh.cut === 'steaks' && sh.steakThickness ? thick(sh.steakThickness)  : '',
      ].filter(Boolean).join(' · '))
      if (sh.addons?.length) pc('  Add-on', adds(sh.addons), true)
    }
    const sh2 = d.shoulder?.shoulder2
    const sameShoulder = sh2 && JSON.stringify(shoulderFields(d.shoulder, fmt, thick)) === JSON.stringify(shoulderFields(sh2, fmt, thick))
    if (sh2 && !sameShoulder) { packShoulder(d.shoulder, ' (1)'); packShoulder(sh2, ' (2)') }
    else packShoulder(d.shoulder, '')
    ps('Loin')
    // A whole hog's two loins can be cut differently, so each side packs on its
    // own line — labelled (1)/(2) only when they actually differ.
    const packLoin = (ln: any, sfx: string) => {
      if (!ln?.cut) return
      if (ln.cut === 'grind') { pg(`Loin${sfx}`); return }
      if (ln.cut === 'bone-in-chops' || ln.cut === 'boneless-chops' || ln.cut === 'smoked-chops') {
        pc(`Chops${sfx}`, [fmt(ln.cut), thick(ln.chopThickness ?? ''), ln.chopPack ? `${ln.chopPack}/pkg` : ''].filter(Boolean).join(' · '))
        if (ln.cut === 'boneless-chops' && ln.babyBack) pc(`Baby Back Ribs${sfx}`, fmt(ln.babyBack))
      } else if (ln.cut === 'loin-roast') {
        pc(`Boneless Loin Roast${sfx}`, fmt(ln.roastSize ?? ''))
      } else {
        // Anything else the wizard offers (e.g. cubed pork) still has to reach
        // the packagers — without this the loin silently left the sheet.
        pc(`Loin${sfx}`, fmt(ln.cut))
      }
      if (ln.tenderloin === 'grind') pg(`Tenderloin${sfx}`)
      else if (ln.tenderloin) pc(`Tenderloin${sfx}`, fmt(ln.tenderloin))
      if (ln.addons?.length) pc('  Add-on', adds(ln.addons), true)
    }
    const loin2 = loin.loin2
    const sameLoin = loin2 && JSON.stringify(loinFields(loin, fmt, thick)) === JSON.stringify(loinFields(loin2, fmt, thick))
    if (loin2 && !sameLoin) { packLoin(loin, ' (1)'); packLoin(loin2, ' (2)') }
    else packLoin(loin, '')
    ps('Belly')
    if (d.belly?.cut === 'grind' && !d.belly?.cut2) pg('Belly')
    else bellyRows(d.belly).forEach(([l, v]) => (v === 'Grind' ? pg(l) : pc(l, v)))
    ps('Ham & Hocks')
    if (d.ham?.style === 'grind' && !d.ham?.style2) pg('Ham')
    else hamRows(d.ham).forEach(([l, v]) => (v === 'Grind' ? pg(l) : pc(l, v)))
    // Hocks always come the way the hams do, so the spec column only repeated
    // the line above it. The packer needs the row and its checkbox, not the
    // wording (Charlie, 2026-07-22). hockStyle is still what decides whether
    // there are hocks at all — a ham sent to grind leaves none.
    if (d.hocks?.cut || hockStyle(d.ham)) pc('Hocks', '')
    ps('Country Style Ribs')
    if (d.spareRibs?.cut) pc('Country Style Ribs', fmt(d.spareRibs.cut))
  }

  if (isLG) {
    ps('Primals')
    if (d.rack?.cut)     { d.rack.cut     === 'grind' ? pg('Rack')     : pc('Rack',     rackDisplay(d.rack.cut)) }
    if (d.loin?.cut) {
      d.loin.cut === 'grind' ? pg('Loin')
        : pc('Loin', [fmt(d.loin.cut), thick(d.loin.chopThickness ?? ''), d.loin.chopPack ? `${d.loin.chopPack}/pkg` : ''].filter(Boolean).join(' · '))
    }
    // Split legs and shoulders get a line per side so each is packed separately
    const packLeg = (cut: string, sfx: string) => {
      if (!cut) return
      if (cut === 'grind') { pg(`Leg${sfx}`); return }
      pc(`Leg${sfx}`, [fmt(cut), cut === 'leg-steaks' ? thick(d.leg.steakThickness ?? '') : '',
        cut === 'leg-steaks' && d.leg.steakPack ? `${d.leg.steakPack}/pkg` : ''].filter(Boolean).join(' · '))
    }
    if (d.leg?.cut2 && d.leg.cut2 !== d.leg.cut) { packLeg(d.leg.cut, ' (1)'); packLeg(d.leg.cut2, ' (2)') }
    else packLeg(d.leg?.cut ?? '', '')
    const packShoulder = (cut: string, sfx: string) => {
      if (!cut) return
      cut === 'grind' ? pg(`Shoulder${sfx}`) : pc(`Shoulder${sfx}`, fmt(cut))
    }
    if (d.shoulder?.cut2 && d.shoulder.cut2 !== d.shoulder.cut) { packShoulder(d.shoulder.cut, ' (1)'); packShoulder(d.shoulder.cut2, ' (2)') }
    else packShoulder(d.shoulder?.cut ?? '', '')
    if (d.shank?.cut)    { d.shank.cut    === 'grind' ? pg('Shank')    : pc('Shank',    fmt(d.shank.cut)) }
    if (d.trim?.style)   { d.trim.style   === 'grind' ? pg('Trim')     : pc('Trim',     lgTrimLabel(d.trim.style, species, d.trim.bagSize)) }
  }

  // Strip section headers that have no cut rows under them
  const activeSectionIdxs = new Set<number>()
  prs.forEach((pr, i) => {
    if (!pr.sectionTitle) {
      for (let j = i - 1; j >= 0; j--) { if (prs[j].sectionTitle) { activeSectionIdxs.add(j); break } }
    }
  })
  const filteredPrs = prs.filter((pr, i) => !pr.sectionTitle || activeSectionIdxs.has(i))

  // Ground/trim section: packaging style & size from the v2 trim step, plus which cuts went to grind
  const trimPrs = isBeef ? beefTrimPackRows(d.trim) : isPork ? porkTrimRows(d.trim, fmt) : []
  if (trimPrs.length || grindFrom.length) {
    filteredPrs.push({ sectionTitle: trimIsBagged(d.trim) ? 'Trim' : isPork ? 'Sausage / Trim' : `Ground ${species}` })
    trimPrs.forEach(([l, v]) => filteredPrs.push({ cut: l, spec: v }))
    // On pork everything sent to grind BECOMES the sausage listed above, so a
    // separate "Ground Pork · From: Hams" row read as though the ham were a
    // second, different product — the opposite of what it means (Charlie, on
    // Kyle Barner's card). Only name the grind sources when there's no sausage
    // for them to go into, so the destination is never lost.
    const namesGrindSources = grindFrom.length > 0 && !(isPork && trimPrs.length > 0)
    if (namesGrindSources) filteredPrs.push({ cut: `Ground ${species}`, spec: `From: ${grindFrom.join(', ')}`, isGrind: true })
  }

  // Smokehouse: what to build from this animal's trim, and the total to hold
  // back before the rest is ground.
  const smokeRows = smokehouseRows(d.smokehouse, fmt, d)
  if (smokeRows.length) {
    filteredPrs.push({ sectionTitle: 'Smokehouse' })
    // Each product gets a ruled blank for the raw trim weight going in — the
    // number the making charge is billed on, which nothing captured before
    // (Jill, 2026-07-27).
    smokeRows.forEach(([l, v]) => filteredPrs.push({ cut: l, spec: v, writeIn: true }))
    const totalLbs = smokehouseTotalLbs(d.smokehouse)
    if (totalLbs > 0) {
      filteredPrs.push({ cut: 'Trim to save', spec: `${+totalLbs.toFixed(1)} lbs total for the smokehouse`, isGrind: true })
    }
  }

  // Raw weight in, for billing the cure and sausage work and for allocating the
  // grind. Blank by design — the Wt (lbs) column is where it gets written as
  // each batch goes in.
  const weighIn = rawWeighIn(d, fmt)
  if (weighIn.rows.length) {
    filteredPrs.push({ sectionTitle: weighIn.title })
    weighIn.rows.forEach(([l, v]) => filteredPrs.push({ cut: l, spec: v, writeIn: true }))
  }

  return filteredPrs
}

// ── The same list, as the scanner checks it off ──────────────────────────────

export type ExpectedLine = {
  key:     string    // what a PLU gets linked to — stable across cards
  section: string
  cut:     string
  label:   string    // `cut`, said out loud: "Beef Brisket" rather than "Brisket"
  species: string    // the card this line came off, for the PLU link it earns
  spec:    string
  isGrind: boolean
  writeIn: boolean
}

// Two cards word the same package differently ("Leg (1)" on a split lamb, "Leg"
// on a whole one) and a link made once has to hold for both, so the side marker
// and the punctuation come off before anything is keyed on it.
export function cutKey(cut: string): string {
  return String(cut || '')
    .replace(/\s*\(\s*\d+\s*\)\s*$/, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

export function packSpecies(s?: string | null): string {
  const v = String(s || '').toLowerCase()
  if (v === 'hog' || v === 'pork') return 'pork'
  if (v === 'lamb' || v === 'goat' || v === 'beef') return v
  return 'beef'
}

// A packing line says which animal it came off: "Beef Brisket", not "Brisket".
// The bench packs beef and pork in the same afternoon and the card's section
// headers scroll off, so a bare cut name left the packer guessing which species
// the line meant (Chris, 2026-08-25).
//
// Silent where the species is already said — "Ground Beef", "Plate / Beef
// Bacon", "Frenched Rack of Lamb", anything under a "Ground Beef" header — and
// on the grind and weigh-in rows, which name a batch rather than a package.
export function packLabel(cut: string, species: string, section = '', plain = false): string {
  const word = species ? species[0].toUpperCase() + species.slice(1) : ''
  if (!word || plain) return cut
  const says = (s: string) => s.toLowerCase().includes(word.toLowerCase())
  if (says(cut) || says(section)) return cut
  return `${word} ${cut}`
}

// Add-on rows ("· seasoned") are how a cut is packed, not a package of their
// own, so they never become a line to tick off.
export function expectedLines(rows: PackRow[], species = ''): ExpectedLine[] {
  const out: ExpectedLine[] = []
  let section = ''
  for (const r of rows) {
    if (r.sectionTitle) { section = r.sectionTitle; continue }
    if (r.isAddon) continue
    const cut = String(r.cut ?? '').trim()
    if (!cut) continue
    out.push({
      key:     cutKey(cut),
      section,
      cut,
      label:   packLabel(cut, species, section, !!r.isGrind || !!r.writeIn),
      species,
      spec:    String(r.spec ?? ''),
      isGrind: !!r.isGrind,
      writeIn: !!r.writeIn,
    })
  }
  return out
}
