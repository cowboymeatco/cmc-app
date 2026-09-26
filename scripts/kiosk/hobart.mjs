// Hobart .ht builder â€” plain-JS mirror of cmc-app/lib/hobart.ts (keep in sync).
// Builds RT89 PLU records: fields joined by US (0x1F), records terminated by RS (0x1E).
export const RS = '\x1e'
export const US = '\x1f'
const LB_TO_G = 453.592

// Canonical 105-field RT89 skeleton (captured from the scale's own export).
const RT89_TEMPLATE = [
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

function sanitize(v, allowNewline = false) {
  const re = allowNewline ? /[\x00-\x09\x0b-\x1f\x7f]/g : /[\x00-\x1f\x7f]/g
  return String(v ?? '').replace(re, ' ')
}
function priceToCents(price) {
  if (price == null || !isFinite(price)) return '1'
  return String(Math.max(0, Math.round(price * 100)))
}
function tareToGrams(lbs) {
  if (!lbs || !isFinite(lbs) || lbs <= 0) return '0'
  return String(Math.round(lbs * LB_TO_G))
}
function buildDt(name, msg) {
  const base = sanitize(String(name ?? '').trim())
  const m = sanitize(String(msg ?? '').trim())
  return m ? `${base}\n${m}` : base
}

// â”€â”€ label format for a PLU the scale has never sent us a record for â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Without a skeleton every field falls back to the canonical default, including
// l1 201 â€” the FRESH CUT label. Right for a new steak, wrong for a new brotwurst
// (202), jerky (203) or wild game (300). Ask the book what this item's siblings
// print on: product family by name, then wild game, then the PLU number series.
// A signal only counts when the group is big enough and agrees strongly.
// Mirrors inferLabelFormat() in cmc-app/lib/hobart.ts â€” keep in sync.
const MIN_SIBLINGS = 3
const MIN_AGREEMENT = 0.75
const LABEL_FAMILIES = [
  /snack stick/i,
  /jerky/i,
  /summer sausage|salami/i,
  /brotwurst|hot dog|polish sausage/i,
  /smoked .*(cheese|colby|cheddar|jack|swiss)/i,
]
const isWildGame = (name) => /wild game/i.test(name ?? '')
const familyOf = (name) => LABEL_FAMILIES.findIndex((re) => re.test(name ?? ''))
const seriesOf = (plu) => String(plu ?? '').replace(/\D/g, '').slice(0, -2) || '0'

function confidentFormat(formats) {
  if (formats.length < MIN_SIBLINGS) return null
  const counts = new Map()
  for (const f of formats) counts.set(f, (counts.get(f) ?? 0) + 1)
  const [top, n] = [...counts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]
  return n / formats.length >= MIN_AGREEMENT ? top : null
}

export function inferLabelFormat(plu, book) {
  const evidence = book.filter((r) => r.plu_number !== plu.plu_number && r.skeleton?.l1)
  const formatsOf = (rows) => rows.map((r) => String(r.skeleton.l1))
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

export function buildRT89(plu, labelFormat) {
  const pluNo = sanitize(String(plu.plu_number ?? '').trim())
  const overrides = {
    'd#': sanitize(String(plu.department ?? '0').trim()) || '0',
    'p#': pluNo,
    'dt': buildDt(plu.item_name, plu.label_message),
    'u#': sanitize(String(plu.unit ?? '02').trim()) || '02',
    'up': sanitize(String(plu.upc ?? '').trim()) || pluNo,
    'u$': priceToCents(plu.price),
    'ta': tareToGrams(plu.tare_weight),
  }
  // The app owns the ingredient link in BOTH directions: point Ec at this PLU's
  // own RT97 record when there is a statement, and clear it when there isn't.
  // A stale pointer used to be left alone; that preserved 51 references to text
  // numbers the scale does not have, and one beef roast printing a pork bacon
  // cure statement (2026-08-13). No statement here means no statement there.
  overrides['Ec'] = String(plu.ingredients ?? '').trim() !== '' ? pluNo : ''
  // Prefer this item's own on-scale values for everything we don't override.
  // Falling back to the PLU-100 skeleton is only right for a PLU the scale has
  // never seen; using it for an existing item rewrites its label format â€” which
  // is exactly what this agent used to do to all 293 PLUs on every push,
  // flattening every processed item onto l1 201 (fresh cut) and clearing Ec.
  const skel = plu.skeleton ?? null
  // No captured record â†’ l1 would fall to the fresh-cut default. Use what the
  // book says this item's siblings print on, when it says anything confident.
  if (!skel && labelFormat) overrides['l1'] = sanitize(String(labelFormat).trim())
  const fields = RT89_TEMPLATE.map(([code, def]) =>
    code + (code in overrides ? overrides[code]
          : skel && code in skel ? sanitize(String(skel[code] ?? ''))
          : def),
  )
  return 'RT89' + US + fields.join(US)
}

// A statement must stay on ONE line: real newlines become '|', HCT's label line
// break, and any other control byte collapses to a space so the RS/US framing
// can't break. Mirrors sanitizeExpText() in lib/hobart.ts.
function sanitizeExpText(v) {
  return String(v ?? '')
    .replace(/\r\n?|\n/g, '|')
    .replace(/[\x00-\x1f\x7f]/g, ' ')
    .replace(/[ \t]+$/g, '')
    .trim()
}

// One RT97 expanded-text record â€” the ingredient statement itself. Field order
// d#, r#, rt is the scale's own; HCT's spec is resources/exptxt.properties
// (record_command=RT97, hts_tags=r#,d#,rt, send=true).
export function buildRT97(row) {
  const num  = sanitize(String(row.text_number ?? '').trim())
  const dept = sanitize(String(row.department ?? '0').trim()) || '0'
  return 'RT97' + US + `d#${dept}` + US + `r#${num}` + US + `rt${sanitizeExpText(row.text)}`
}

// RT97 expanded-text records first (the order the scale's own export uses), then
// the PLUs that point at them. Without the RT97s a push sent only the Ec pointer,
// so an ingredient statement written in the app aimed the label at a text record
// the scale had never been given â€” it printed blank, and the text had to be
// hand-imported through HCT's EXPTXT CSV tab (Jill, 2026-08-13).
// `book` is the evidence for label-format inference and defaults to the PLUs being
// written â€” the agent always sends the whole priced book, so the default is right
// here; the app passes its full book when exporting a filtered subset.
export function buildHtFile(plus, book = plus) {
  const texts = plus
    .filter((p) => String(p.ingredients ?? '').trim() !== '')
    // Department 0 always â€” every text record on the scale is d#0.
    .map((p) => buildRT97({ text_number: p.plu_number, text: p.ingredients, department: 0 }) + RS)
  // A PLU the scale has never seen gets its label format from the rest of the
  // book rather than the fresh-cut default â€” see inferLabelFormat().
  return texts.join('') + plus.map((p) =>
    buildRT89(p, p.skeleton ? null : inferLabelFormat(p, book)) + RS).join('')
}
