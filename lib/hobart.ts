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
//     a separate Expanded Text file (EXPTXT.DAT), each keyed by a Text number,
//     and the PLU references one by number. See buildExptxtCsv() below.
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
                                //   in EXPTXT.DAT (see buildExptxtCsv), never on the PLU record.
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
  // number, matching the EXPTXT record buildExptxtCsv() emits. Only set when the
  // PLU actually has a statement, so we never blank an existing reference.
  if (String(plu.ingredients ?? '').trim() !== '') overrides['Ec'] = pluNo
  const fields = RT89_TEMPLATE.map(([code, def]) =>
    code + (code in overrides ? overrides[code] : def),
  )
  return 'RT89' + US + fields.join(US)
}

// Build a complete .ht file body from a list of PLUs. Each record is terminated
// by RS (including the last), matching backup.ht's framing.
export function buildHtFile(plus: HobartPlu[]): string {
  return plus.map((p) => buildRT89(p) + RS).join('')
}

// ──────────────────────────────────────────────────────────────────────────────
// Expanded Text (EXPTXT.DAT) — the ingredient-statement library. HCT stores
// these separately from PLUs and each PLU references one by its Text number.
// Format VERIFIED against the shop's real HCT "Export CSV" of EXPTXT.DAT
// (export_exptxt.csv, 2026-07, 218 records):
//   • Header row: `Text number,Departmentnumber,Expanded Text,` (note: no space
//     in "Departmentnumber", trailing comma).
//   • Each row: `<textNumber>,<dept>,<text>,` — UNQUOTED. The text keeps its own
//     commas raw; the parser takes the first two comma fields as number + dept
//     and everything after (up to the trailing comma) as the text. Every dept in
//     the shop's export is 0.
//   • `|` inside the text is a label line break; `<ESC>…` prefixes are font/size
//     codes. We emit neither automatically — a caller may include `|` in text.
//   • CRLF line endings (Windows / HCT).
// ──────────────────────────────────────────────────────────────────────────────

export const EXPTXT_HEADER = 'Text number,Departmentnumber,Expanded Text,'

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

// Build an EXPTXT.DAT "Import CSV" body from expanded-text records. Rows with an
// empty number are skipped; empty text is allowed (emits `<num>,<dept>,,`).
export function buildExptxtCsv(rows: ExpandedText[]): string {
  const lines = rows
    .filter((r) => String(r.text_number ?? '').trim() !== '')
    .map((r) => {
      const num  = String(r.text_number).trim()
      const dept = String(r.department ?? '0').trim() || '0'
      const text = sanitizeExpText(String(r.text ?? ''))
      return `${num},${dept},${text},`
    })
  return [EXPTXT_HEADER, ...lines].join('\r\n') + '\r\n'
}
