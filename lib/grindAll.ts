// "Grind the whole animal" cut sheets, written in-house.
//
// A house animal has no customer to fill out the public form — CMC's own
// grinder cows, a producer's bull going straight to burger — so it sat in the
// cut schedule reading "⚠ Missing" forever and its priority score stayed
// pinned to the floor (Charlie, 2026-08-19: "23,24,25 all cannot be assigned
// cutting instructions. These should be all grind alls").
//
// What this builds is a REAL cut card, the same v2 payload CuttingWizard emits
// with grindWhole on, so the printed card, the pack list and the scanner read
// it exactly like one that came off the form. There is deliberately no parallel
// "no sheet needed" flag: grindWhole already means every primal section drops
// out, and every reader in the app already honours it.
//
// Nothing is answered on the operator's behalf beyond the grind itself. Organs
// stay blank — that is what an unanswered question looks like everywhere else,
// and a made-up "discard" would print on the card as if someone had said it.

// Appointments get booked as "Hog", cutting instructions all say "Pork"; the
// two halves of the app have to match on the animal, not the spelling.
const SPECIES_KEY: Record<string, string> = {
  hog: 'pork', pork: 'pork', beef: 'beef', lamb: 'lamb', goat: 'goat',
}
export function speciesKey(s?: string | null): string {
  const k = (s ?? '').trim().toLowerCase()
  return SPECIES_KEY[k] ?? k
}

/** What the cutting_instructions row gets filed under: 'Beef' | 'Pork' | … */
export function instructionSpecies(apptSpecies?: string | null): string {
  const k = speciesKey(apptSpecies)
  return k ? k.charAt(0).toUpperCase() + k.slice(1) : ''
}

// Option lists, copied from the wizard steps they stand in for so the answers
// this writes are answers the form could have produced.
export const BEEF_FAT_BLENDS = [
  { val: '75/25', label: '75/25', desc: 'Rich — burgers, meatballs' },
  { val: '85/15', label: '85/15', desc: 'All-purpose' },
  { val: '90/10', label: '90/10', desc: 'Lean' },
  { val: '95/5',  label: '95/5',  desc: 'Extra lean' },
]
export const BEEF_PACK_SIZES = [
  { val: '1',   label: '1 lb' },
  { val: '1.5', label: '1½ lb' },
  { val: '2',   label: '2 lb' },
  { val: '5',   label: '5 lb' },
]
export const PORK_FLAVORS = [
  { val: 'pork-sausage',    label: 'Pork Sausage',      desc: 'Our classic seasoned sausage' },
  { val: 'jumpstart-spicy', label: 'Jumpstart (Spicy)', desc: '' },
  { val: 'italian',         label: 'Italian',           desc: '' },
  { val: 'ground-pork',     label: 'Ground Pork',       desc: 'Plain, no seasoning' },
]
// Links are only made for pork sausage; every other flavor comes in 1 lb chubs.
export const PORK_FORMATS = [
  { val: 'loose-pack', label: '1 lb Packs' },
  { val: 'links',      label: 'Links' },
]
export const LAMB_GOAT_TRIM = [
  { val: 'grind',   label: 'Ground',  desc: '1 lb packs' },
  { val: 'stew',    label: 'Stew',    desc: '1 lb packs' },
  { val: 'sausage', label: 'Sausage', desc: '1 lb packs' },
]

export interface GrindAllChoices {
  /** Appointment species — 'Beef' | 'Hog' | 'Lamb' | 'Goat'. */
  species:      string
  customerName: string
  /** Slot portion as booked ('Whole' / 'Half' / 'Quarter'); stored lowercase. */
  portion:      string
  killDate:     string | null
  notes:        string
  // Beef
  fatPct?:      string
  packSize?:    string
  keepFat?:     boolean
  // Pork
  porkFlavor?:  string
  porkFormat?:  string
  // Lamb & goat
  lgStyle?:     string
}

/** '' when the choices are complete, otherwise what is still unanswered. */
export function grindAllMissing(c: GrindAllChoices): string {
  const k = speciesKey(c.species)
  if (!c.customerName.trim()) return 'a name'
  if (k === 'beef') {
    if (!c.fatPct)   return 'a fat blend'
    if (!c.packSize) return 'a pack size'
    return ''
  }
  if (k === 'pork') {
    if (!c.porkFlavor) return 'a flavor'
    // Only pork sausage is offered in links; the rest are 1 lb chubs.
    if (c.porkFlavor === 'pork-sausage' && !c.porkFormat) return 'a format'
    return ''
  }
  if (k === 'lamb' || k === 'goat') {
    if (!c.lgStyle) return 'a trim style'
    return ''
  }
  return `a grind for ${c.species || 'this species'}`
}

/** The v2 cut-sheet payload. Mirrors CuttingWizard's builder with grindWhole on. */
export function buildGrindAllData(c: GrindAllChoices): Record<string, unknown> {
  const k = speciesKey(c.species)

  const common: Record<string, unknown> = {
    customerName:  c.customerName.trim(),
    customerPhone: null,
    customerEmail: null,
    killDate:      c.killDate || null,
    notes:         c.notes.trim() || null,
    formVersion:   'v2',
    portion:       (c.portion || 'Whole').toLowerCase(),
    grindWhole:    true,
    // Never asked, so never answered. The card prints these blank and the
    // cutter asks, which is the honest outcome for a sheet nobody filled in.
    organs: k === 'beef'
      ? { heart: null, liver: null, tongue: null, oxtail: null }
      : { heart: null, liver: null },
    specialty:  { interest: 'no', notes: '' },
    upsells:    null,
    smokehouse: {
      sticks: null, brats: null, summer: null, jerky: null,
      jerkySupplement: null, hotDogs: null,
    },
    ...(k === 'beef' ? { steakPack: null } : {}),
  }

  if (k === 'beef') {
    return {
      ...common,
      trim: {
        dest: 'grind', bagSize: null,
        fatPct:   c.fatPct,
        keepFat:  !!c.keepFat,
        pattyPct: 0,
        patties:  null,
        loose:    { packSize: c.packSize, rollstock: false },
      },
    }
  }

  if (k === 'pork') {
    return {
      ...common,
      trim: {
        dest: 'grind', bagSize: null,
        flavor1: c.porkFlavor,
        format1: c.porkFlavor === 'pork-sausage' ? c.porkFormat : 'loose-pack',
        split:   'no',
        flavor2: null,
        format2: null,
      },
    }
  }

  // Lamb & goat carry only their trim answer — that IS the grind choice.
  return { ...common, trim: { style: c.lgStyle, bagSize: null } }
}
