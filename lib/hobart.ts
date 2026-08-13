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

// Build one RT89 PLU record body (no trailing RS).
export function buildRT89(plu: HobartPlu): string {
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
  // Link to the ingredient statement: Ec ("Expanded text" number) = this PLU's
  // number, matching the RT97 record buildHtFile() emits. Only set when the
  // PLU actually has a statement, so we never blank an existing reference.
  if (String(plu.ingredients ?? '').trim() !== '') overrides['Ec'] = pluNo
  // Prefer this item's own on-scale values for everything we don't override.
  // Falling back to the PLU-100 skeleton is only right for a PLU the scale has
  // never seen; using it for an existing item rewrites its label format.
  const skel = plu.skeleton ?? null
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
export function buildHtFile(plus: HobartPlu[]): string {
  const texts = plus
    .filter((p) => String(p.ingredients ?? '').trim() !== '')
    // Department 0 always: every one of the 218 text records on the scale is d#0,
    // and it is what the EXPTXT CSV path writes, so both routes stay one library.
    .map((p) => buildRT97({ text_number: p.plu_number, text: p.ingredients as string, department: 0 }) + RS)
  return texts.join('') + plus.map((p) => buildRT89(p) + RS).join('')
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
const NEEDS_INGREDIENTS =
  /jerky|sausage|brat|bacon|\bham\b|snack stick|summer|salami|bologna|hot dog|wiener|frank|seasoned|marinade|marinated|cured|smoked|pepperoni|chorizo|\blink|patty|meatball|loaf/i

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
