// ──────────────────────────────────────────────────────────────────────────────
// Hobart .ht exporter — builds the native HT block format that HCT's "Import HT
// File" dialog accepts (a plain CSV is NOT accepted). Pure & framework-agnostic:
// no DOM, no Node, no React — so the round-trip validator (scripts/) and the app
// (app/processing) share ONE implementation.
//
// Format (reverse-engineered & VERIFIED against the shop's full scale export,
// C:\Users\charl\Downloads\backup.ht, 2026-06-26, 367 PLUs):
//   • A file is records concatenated, each TERMINATED by RS (0x1E) — including
//     the last one. The file starts directly with a record (no header/BOM).
//   • Within a record, fields are joined by US (0x1F).
//   • A PLU is record type RT89 with EXACTLY 105 fields in a fixed order — all
//     367 PLUs in backup.ht share one identical field-order signature.
//   • A field = 2-char code + value, e.g. p#100, dtGROUND BEEF, u$569 (price in
//     CENTS), ta0 (tare in GRAMS), up100 (UPC). This matches parseHobartDat()
//     in app/processing/page.tsx, which reads price via /\$(\d+)/ ÷ 100 and
//     tare via /ta(\d+)/ ÷ 453.592.
//   • The "NOT FOR HUMAN CONSUMPTION" style message rides INSIDE dt as a 2nd
//     line joined by \n (0x0A): dt<name>\n<message>.
//   • Ingredient statements are NOT stored on the PLU record. HCT keeps them in
//     a separate Expanded Text library (EXPTXT.DAT), each keyed by a Text number,
//     and the PLU references one by number through Ec. The text itself travels as
//     its own record type, RT97 (d#/r#/rt) — the scale's own export carries all
//     218 of them, ahead of the PLUs. buildHtFile() emits both, so one file (and
//     one "Push to scales") delivers the statement AND the link. See buildRT97().
//
// We generate by CLONING the canonical 105-field skeleton (captured from PLU
// 100) and overwriting only the mapped fields. Every other field keeps the
// exact constant default the scale already uses — faithful by construction.
// ──────────────────────────────────────────────────────────────────────────────

export const RS = '\x1e' // record separator (0x1E) — terminates every record
export const US = '\x1f' // unit separator   (0x1F) — joins fields within a record
const LB_TO_G = 453.592   // tare is stored in grams; parseHobartDat divides ta by this

export interface HobartPlu {
  plu_number: string
  item_name: string
  price: number | null          // dollars per lb  → u$ in cents
  tare_weight?: number | null   // lbs             → ta in grams
  upc?: string | null           // → up; defaults to plu_number (matches 360/367 on scale)
  unit?: string | null          // → u#; defaults to '02' (weight-embedded)
  department?: string | null    // → d#; defaults to '0'
  label_message?: string | null // appended to dt as a \n line (e.g. NOT FOR HUMAN CONSUMPTION)
  ingredients?: string | null   // if non-empty → sets Ec (the "Expanded text" ref) = plu_number,
                                //   linking this PLU to its EXPTXT record. The text itself lives
                                //   in its own RT97 record (see buildRT97), never on the PLU record.
  // This PLU's own RT89 field map as captured from a scale backup (plu_items.
  // ht_skeleton). Supplies every field the app does not own — most importantly
  // l1, the LABEL FORMAT. Without it each record inherits PLU 100's defaults,
  // which stamps format 201 on everything and moves jerky (203), snack sticks
  // and summer sausage (202) and wild game (300) onto the wrong label.
  skeleton?: Record<string, string> | null
}

// Canonical RT89 skeleton: [code, defaultValue] in exact on-scale order (PLU 100).
// Item-specific fields (d#, p#, dt, u#, up, u$, ta) are overwritten per item by
// buildRT89(); pn/Ec/r# carry the safe new-PLU default (empty) used by the
// majority of records. Do NOT reorder — field position is part of the spec.
const RT89_TEMPLATE: ReadonlyArray<readonly [string, string]> = [
  ['d#', '0'], ['p#', ''], ['PT', '1'], ['dt', ''], ['u#', '02'], ['up', ''],
  ['pn', ''], ['vn', ''], ['Ec', ''], ['bc', '0'], ['fb', '0'], ['u$', '1'],
  ['fp', '0'], ['pm', '11'], ['xp', '0'], ['Dt', '2'], ['dp', '0'], ['D2', '0'],
  ['D3', '0'], ['ta', '0'], ['fT', '0'], ['pt', '0'], ['nw', '0'], ['sl', '0'],
  ['SL', '0'], ['pl', '0'], ['PL', '0'], ['PS', '0'], ['Pi', '0'], ['PP', '0'],
  ['us', '0'], ['rc', '999999'], ['l1', '201'], ['p1', '0'], ['l2', '0'],
  ['p2', '0'], ['l3', '0'], ['p3', '0'], ['L1', '2'], ['L2', '2'], ['L3', '2'],
  ['ps', '0'], ['im', '0'], ['g#', '0'], ['G1', ''], ['G2', ''], ['G3', ''],
  ['G4', ''], ['r#', ''], ['s#', ''], ['n#', ''], ['N#', ''], ['m#', ''],
  ['y5', ''], ['y6', ''], ['y7', ''], ['y8', ''], ['y9', ''], ['pf', '0'],
  ['tf', '0'], ['xt', '0'], ['i1', ''], ['n1', ''], ['n2', ''], ['C#', ''],
  ['S#', ''], ['cb', '0'], ['ci', ''], ['c7', ''], ['c8', ''], ['c9', ''],
  ['cc', ''], ['cf', '0'], ['co', '0'], ['cs', ''], ['Pp', '0'], ['Bg', '0'],
  ['Bf', '1'], ['Bn', '2'], ['cM', '0'], ['T2', '0'], ['mw', '0'], ['Mw', '0'],
  ['mp', '0'], ['Mp', '0'], ['l4', '0'], ['l5', '0'], ['l6', '0'], ['l7', '0'],
  ['l8', '0'], ['l9', '0'], ['L4', '0'], ['L5', '0'], ['L6', '0'], ['L7', '0'],
  ['L8', '0'], ['L9', '0'], ['La', '0'], ['Lb', '0'], ['Lc', '0'], ['Ld', '0'],
  ['Le', '0'], ['Lf', '0'], ['SM', '0'], ['PM', '0'],
]

// Strip the delimiter bytes (and other C0 controls) from a value so a stray
// byte in an item name can never corrupt the record framing. \n is allowed only
// inside dt, where it legitimately separates the name from the label message.
function sanitize(v: string, allowNewline = false): string {
  const re = allowNewline ? /[\x00-\x09\x0b-\x1f\x7f]/g : /[\x00-\x1f\x7f]/g
  return v.replace(re, ' ')
}

function priceToCents(price: number | null | undefined): string {
  if (price == null || !isFinite(price)) return '1' // placeholder $0.01 — matches scale default
  return String(Math.max(0, Math.round(price * 100)))
}

function tareToGrams(lbs: number | null | undefined): string {
  if (!lbs || !isFinite(lbs) || lbs <= 0) return '0'
  return String(Math.round(lbs * LB_TO_G))
}

// dt = item name plus an optional label-message 2nd line (e.g. NOT FOR HUMAN
// CONSUMPTION), joined by \n. A blank message is dropped so we never emit a
// trailing empty line.
function buildDt(name: string, msg?: string | null): string {
  const base = sanitize((name || '').trim(), false)
  const m = sanitize((msg || '').trim(), false)
  return m ? `${base}\n${m}` : base
}

// ──────────────────────────────────────────────────────────────────────────────
// Label format for a PLU the scale has never sent us a record for.
//
// A new PLU has no skeleton, so every field falls back to the canonical default —
// including l1 201, the FRESH CUT label. That is right for a new steak and wrong
// for everything else: a new brotwurst, snack stick or sliced summer sausage
// belongs on 202, jerky on 203, wild game on 300. Nobody sees it until the label
// prints (Charlie, 2026-08-13: 25 active PLUs the scale had never seen, 17 of them
// on the wrong label).
//
// So instead of one default, ask the book what its siblings use. Three signals,
// most specific first: the product family by name, then wild game (which has its
// own labels whatever the product is), then the PLU number series — the shop
// numbers by product line, so 61xx is brots and 41xx is snack sticks. A signal
// only counts when the group is big enough and agrees strongly; a thin or split
// group falls through, and if nothing is confident we keep the 201 default.
//
// Back-tested by hiding each captured record and inferring it from the rest:
// 341/368 correct. It only ever applies where there is NO captured record, so it
// can never overwrite what the scale actually has.
// ──────────────────────────────────────────────────────────────────────────────

const MIN_SIBLINGS = 3      // fewer than this and the group proves nothing
const MIN_AGREEMENT = 0.75  // a split group is a guess, not a pattern

// Product families that carry their own label. Order matters only for reading;
// an item matches at most one in practice.
const LABEL_FAMILIES: ReadonlyArray<RegExp> = [
  /snack stick/i,
  /jerky/i,
  /summer sausage|salami/i,
  /brotwurst|hot dog|polish sausage/i,
  /smoked .*(cheese|colby|cheddar|jack|swiss)/i,
]

const isWildGame = (name: string | null | undefined) => /wild game/i.test(name ?? '')
const familyOf = (name: string | null | undefined) => LABEL_FAMILIES.findIndex((re) => re.test(name ?? ''))
// PLU number series: everything but the last two digits, so 6132 → "61" sits with
// 6100–6199, and 413001 → "4130" with the wholesale block.
const seriesOf = (plu: string) => String(plu ?? '').replace(/\D/g, '').slice(0, -2) || '0'

function confidentFormat(formats: string[]): string | null {
  if (formats.length < MIN_SIBLINGS) return null
  const counts = new Map<string, number>()
  for (const f of formats) counts.set(f, (counts.get(f) ?? 0) + 1)
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return n / formats.length >= MIN_AGREEMENT ? top : null
}

// The label format `plu` should get from the rest of the book, or null if the book
// has nothing confident to say. `book` is the whole PLU list; only entries with a
// captured skeleton count as evidence.
export function inferLabelFormat(plu: HobartPlu, book: HobartPlu[]): string | null {
  const evidence = book.filter((r) => r.plu_number !== plu.plu_number && r.skeleton?.l1)
  const formatsOf = (rows: HobartPlu[]) => rows.map((r) => String(r.skeleton!.l1))
  const game = isWildGame(plu.item_name)
  const family = familyOf(plu.item_name)

  if (family >= 0) {
    const m = confidentFormat(formatsOf(evidence.filter(
      (r) => familyOf(r.item_name) === family && isWildGame(r.item_name) === game)))
    if (m) return m
  }
  if (game) {
    const m = confidentFormat(formatsOf(evidence.filter((r) => isWildGame(r.item_name))))
    if (m) return m
  }
  const series = seriesOf(plu.plu_number)
  return confidentFormat(formatsOf(evidence.filter(
    (r) => seriesOf(r.plu_number) === series && isWildGame(r.item_name) === game)))
}

// Build one RT89 PLU record body (no trailing RS). `labelFormat` is the inferred
// fallback for a PLU with no captured record; it never overrides a real one.
export function buildRT89(plu: HobartPlu, labelFormat?: string | null): string {
  const pluNo = sanitize(String(plu.plu_number ?? '').trim())
  const overrides: Record<string, string> = {
    'd#': sanitize(String(plu.department ?? '0').trim()) || '0',
    'p#': pluNo,
    'dt': buildDt(plu.item_name, plu.label_message),
    'u#': sanitize(String(plu.unit ?? '02').trim()) || '02',
    'up': sanitize(String(plu.upc ?? '').trim()) || pluNo,
    'u$': priceToCents(plu.price),
    'ta': tareToGrams(plu.tare_weight),
  }
  // The app owns the ingredient link in BOTH directions: point Ec ("Expanded
  // text" number) at this PLU's own RT97 record when there is a statement, and
  // clear it when there isn't. Leaving a stale pointer alone was the cautious
  // choice while the scale was the source of truth; now that the app is, it just
  // preserved rubbish — 51 PLUs pointed at text numbers the scale does not have,
  // and BEEF EYE OF ROUND ROAST pointed at a pork bacon cure statement and
  // printed it (2026-08-13). No statement here now means no statement there.
  overrides['Ec'] = String(plu.ingredients ?? '').trim() !== '' ? pluNo : ''
  // Prefer this item's own on-scale values for everything we don't override.
  // Falling back to the PLU-100 skeleton is only right for a PLU the scale has
  // never seen; using it for an existing item rewrites its label format.
  const skel = plu.skeleton ?? null
  // No captured record → l1 would fall to the fresh-cut default. Use what the
  // book says this item's siblings print on, when it says anything confident.
  if (!skel && labelFormat) overrides['l1'] = sanitize(String(labelFormat).trim())
  const fields = RT89_TEMPLATE.map(([code, def]) =>
    code + (code in overrides ? overrides[code]
          : skel && code in skel ? sanitize(String(skel[code] ?? ''))
          : def),
  )
  return 'RT89' + US + fields.join(US)
}

// Build a complete .ht file body from a list of PLUs. Each record is terminated
// by RS (including the last), matching backup.ht's framing.
//
// Every PLU with an ingredient statement also gets its RT97 expanded-text record,
// written FIRST — the order the scale's own export uses, and the order that means
// the text exists before a PLU points at it. Without these the file ships only the
// Ec pointer, so a statement written in the app aimed the label at a text record
// the scale had never been given and it printed blank. That is why ingredients
// "wouldn't send" (Jill, 2026-08-13): the RT89-only push could not carry them, and
// the text had to be hand-imported through HCT's EXPTXT CSV tab.
// `book` is the evidence for label-format inference and defaults to the PLUs being
// written. Pass the whole book when writing a subset: exporting one species must
// not narrow the siblings an item is compared against.
export function buildHtFile(plus: HobartPlu[], book: HobartPlu[] = plus): string {
  const texts = plus
    .filter((p) => String(p.ingredients ?? '').trim() !== '')
    // Department 0 always: every one of the 218 text records on the scale is d#0,
    // and it is what the EXPTXT CSV path writes, so both routes stay one library.
    .map((p) => buildRT97({ text_number: p.plu_number, text: p.ingredients as string, department: 0 }) + RS)
  // A PLU the scale has never seen gets its label format from the rest of the
  // book rather than the fresh-cut default — see inferLabelFormat().
  return texts.join('') + plus.map((p) =>
    buildRT89(p, p.skeleton ? null : inferLabelFormat(p, book)) + RS).join('')
}

// ──────────────────────────────────────────────────────────────────────────────
// Expanded Text (EXPTXT.DAT) — the ingredient-statement library. HCT stores
// these separately from PLUs and each PLU references one by its Text number; we
// key every statement by its own PLU number, so the app owns the library.
// Verified against the shop's scale export (218 records, all department 0) and
// HCT's own spec, resources/exptxt.properties.
//   • `|` inside the text is a label line break; `<ESC>…` prefixes are font/size
//     codes. We emit neither automatically — a caller may include `|` in text.
// ──────────────────────────────────────────────────────────────────────────────

export interface ExpandedText {
  text_number: string | number      // → Text number (we key by PLU number)
  text: string                       // → Expanded Text (the ingredient statement)
  department?: string | number | null // → Departmentnumber; defaults to '0'
}

// A row's text must stay on ONE physical line (the format is line-delimited and
// unquoted). Real newlines become `|`, HCT's label-line-break convention; tabs
// and any other control bytes collapse to spaces so framing can't break.
function sanitizeExpText(v: string): string {
  return (v ?? '')
    .replace(/\r\n?|\n/g, '|')          // hard line breaks → label line break
    .replace(/[\x00-\x1f\x7f]/g, ' ')   // tabs / stray controls → space
    .replace(/[ \t]+$/g, '')            // trim trailing spaces
    .trim()
}

// Products that have to carry an ingredient statement on the label: anything
// built from more than one ingredient — cured, smoked, seasoned, or ground and
// mixed. A whole-muscle cut (a ribeye, a pork chop) is a single ingredient and
// needs none, so matching on the name keeps the warning down to the items that
// actually matter instead of every PLU in the book.
//
// A PLU that matches this and has a blank `ingredients` prints a label with no
// ingredient statement and nothing anywhere says so — which is how a batch of
// jerky reached the packing table unlabelled (Charlie, 2026-07-29).
// `brotwurst` is the one that matters here and it was missing: the list carried
// `brat`, which matches NOTHING in this catalogue — we make brotwurst, never
// bratwurst ([[Brot vs Brat]]) — so all 32 brotwursts sailed past this check and
// 12 of them sit with no statement, never once flagged (found 2026-08-13). `brat`
// stays only to catch the name being typed wrong. `coil` is the fresh sausage
// coils, seasoned and multi-ingredient like everything else on this list.
const NEEDS_INGREDIENTS =
  /jerky|sausage|brotwurst|brat|coil|bacon|\bham\b|snack stick|summer|salami|bologna|hot dog|wiener|frank|seasoned|marinade|marinated|cured|smoked|pepperoni|chorizo|\blink|patty|meatball|loaf/i

export function needsIngredientStatement(itemName: string | null | undefined): boolean {
  return NEEDS_INGREDIENTS.test(itemName ?? '')
}

// Build one RT97 expanded-text record body (no trailing RS) — the ingredient
// statement itself, in the form that travels inside a .ht file and therefore over
// the wire on a "Push to scales".
//
// Field order d#, r#, rt is the scale's own (all 218 records in backup.ht), and
// HCT's spec for it is resources/exptxt.properties: record_command=RT97,
// hts_tags=r#,d#,rt, send=true. `rt` is the statement; it must stay free of the
// framing bytes, which sanitizeExpText guarantees.
export function buildRT97(row: ExpandedText): string {
  const num  = sanitize(String(row.text_number ?? '').trim())
  const dept = sanitize(String(row.department ?? '0').trim()) || '0'
  const text = sanitizeExpText(String(row.text ?? ''))
  return 'RT97' + US + `d#${dept}` + US + `r#${num}` + US + `rt${text}`
}
