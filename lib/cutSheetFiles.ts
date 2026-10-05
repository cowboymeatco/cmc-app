// ──────────────────────────────────────────────────────────────────────────────
// Old cutting instructions, migrated as files onto producer records.
//
// Before the online form, a cutting card was a scanned PDF (or an Office Lens
// photo, a Word doc, an Excel sheet) filed on SharePoint — hundreds of
// "Abel, Dave BEEF.pdf" under USB Drive/Cutting Instructions, plus folders per
// producer in Charlie's OneDrive. None of that was reachable from a producer's
// record in the app (Charlie, 2026-10-05: "migrate old cutting instructions
// that are stored on OneDrive and get them to the producers' profiles").
//
// Each migrated file becomes a cutting_instructions card with
// data.formVersion = 'legacy-file', status 'imported' (the "On file" badge the
// customers page already knows), customer_id pointing at the producer, and one
// row here per file. The bytes live in a PRIVATE bucket; the browser only ever
// gets a five-minute signed link through /api/cut-sheet-files/[id].
//
// Two ways in, same result:
//   • SharePoint / OneDrive browsed from inside the app (Microsoft Graph,
//     app-only — see lib/msGraph.ts). Needs the CMC App registration to hold
//     the Files.Read.All and Sites.Read.All APPLICATION permissions with admin
//     consent (Entra admin center → App registrations → CMC App Mailer → API
//     permissions). Until then the page says so and the upload path still works.
//   • Files picked off the office PC (OneDrive syncs them locally anyway),
//     uploaded straight to the bucket with a signed URL, like /haccp/documents.
//
// Table + bucket: scripts/2026-10-05_cutting_instruction_files.sql.
// Nothing here reads a secret, so the page imports it too.
// ──────────────────────────────────────────────────────────────────────────────

export const CUT_SHEET_BUCKET = 'cut-sheet-files'

// Supabase's project-wide per-file ceiling (50 MB on this plan).
export const CUT_SHEET_MAX_BYTES = 50 * 1024 * 1024

export const LEGACY_FORM_VERSION = 'legacy-file'

export interface CutSheetFile {
  id:                     string
  created_at:             string
  cutting_instruction_id: string
  filename:               string
  storage_path:           string
  mime_type:              string | null
  size_bytes:             number | null
  source:                 'sharepoint' | 'upload'
  source_drive_id:        string | null
  source_item_id:         string | null
  source_url:             string | null
  source_path:            string | null
  imported_by:            string | null
}

// The species words the app uses on a card. Appointments say "Hog"; every
// cutting card says "Pork" (see speciesKey on /cutting-instructions).
export const CARD_SPECIES = ['Beef', 'Pork', 'Lamb', 'Goat'] as const
export type CardSpecies = typeof CARD_SPECIES[number]

const SPECIES_WORDS: Record<string, CardSpecies> = {
  beef: 'Beef', cow: 'Beef', bull: 'Beef', steer: 'Beef', heifer: 'Beef',
  hog: 'Pork', hogs: 'Pork', pork: 'Pork', pig: 'Pork', pigs: 'Pork', swine: 'Pork',
  lamb: 'Lamb', lambs: 'Lamb', sheep: 'Lamb', mutton: 'Lamb',
  goat: 'Goat', goats: 'Goat',
}

// Words a scan's filename carries besides the name. Kept as the card's note
// ("GRINDER", "COW", "HIRED MAN") rather than mistaken for part of the name.
const QUALIFIER_WORDS = new Set(['grinder', 'grind', 'cow', 'bull', 'steer', 'heifer', 'hired', 'man', 'raffle', 'bundle', 'wagyu', 'sale', 'for', 'half', 'whole', 'quarter', 'split'])

export interface ParsedFilename {
  /** "First Last" guessed from the file name, or '' when the name is generic. */
  customerName: string
  species:      CardSpecies | null
  /** ISO date when the name carried one ("8-02-24" → 2024-08-02). */
  killDate:     string | null
  /** Anything else the file name said: "GRINDER", "COW", "copy 8". */
  qualifier:    string
}

// Pull the producer, species and date out of how the office named a scan.
//
//   "Abel, Dave BEEF.pdf"                     → Dave Abel · Beef
//   "Benzel, Ron GRINDER BEEF 14.pdf"         → Ron Benzel · Beef · "GRINDER 14"
//   "Achton Boys (Larry Dorn) BEEF.pdf"       → Achton Boys (Larry Dorn) · Beef
//   "Kurt Kaufman Cutting Instructions 8-02-24.pdf" → Kurt Kaufman · 2024-08-02
//   "Cutting Instructions.docx" in "Coffee Cattle Company" → Coffee Cattle Company
//
// `folder` is the parent folder's name; it names the producer when the file
// itself is generic, and the species when the folder is "Hog Cutting
// Instructions".
export function parseCutSheetFilename(filename: string, folder = ''): ParsedFilename {
  let s = filename.replace(/\.[A-Za-z0-9]{1,5}$/, '')          // extension
  s = s.replace(/[_]+/g, ' ')

  let killDate: string | null = null
  s = s.replace(/\b(\d{1,2})[-./](\d{1,2})[-./](\d{2}|\d{4})\b/, (_m, mo, d, y) => {
    const yy = y.length === 2 ? 2000 + Number(y) : Number(y)
    const m2 = Number(mo), d2 = Number(d)
    if (m2 >= 1 && m2 <= 12 && d2 >= 1 && d2 <= 31) {
      killDate = `${yy}-${String(m2).padStart(2, '0')}-${String(d2).padStart(2, '0')}`
    }
    return ' '
  })

  // A camera's own name ("IMG_2041", "Scan0012") says nothing about anyone.
  if (/^(img|dsc|dscn|pxl|scan|scanned|image|photo|document)[\s-]*\d*$/i.test(s.trim())) s = ''

  // Generic words that say what the file is, not whose it is.
  s = s.replace(/\b(cutting|cut)\s+(instructions?|cards?|sheets?)\b/gi, ' ')
  s = s.replace(/\bcut\s*card\b/gi, ' ')
  s = s.replace(/\b(scan|scanned|img|image|document|doc|office\s+lens)\b/gi, ' ')
  const qualifiers: string[] = []
  s = s.replace(/\s*-\s*copy\b/gi, ' ').replace(/\bcopy\s*\d*\b/gi, m => { qualifiers.push(m.trim()); return ' ' })
  s = s.replace(/\(\s*\d+\s*\)/g, ' ')

  // Anything in parentheses is a name as written — "(DJ Olson Beef)" keeps
  // its Beef — so it sits out the species and qualifier passes.
  const parens: string[] = []
  s = s.replace(/\([^)]*\)/g, m => { parens.push(m); return ` \u0000${parens.length - 1}\u0000 ` })

  let species: CardSpecies | null = null
  s = s.replace(/\b([A-Za-z]+)\b/g, w => {
    const sp = SPECIES_WORDS[w.toLowerCase()]
    if (sp && !species) { species = sp; return ' ' }
    if (sp) return ' '
    return w
  })
  if (!species) species = speciesFromText(folder)

  // Bare numbers after the name ("BEEF 14") and the office's shorthand words.
  // A leading number is the name ("71 Ranch").
  const words = s.split(/\s+/).filter(Boolean)
  const nameWords: string[] = []
  for (const w of words) {
    if (w.includes('\u0000')) { nameWords.push(w); continue }   // a protected parenthetical
    const bare = w.replace(/[^A-Za-z0-9&']/g, '')
    if (/^\d+$/.test(bare) && nameWords.length > 0) qualifiers.push(bare)
    else if (bare && QUALIFIER_WORDS.has(bare.toLowerCase()) && nameWords.length > 0) qualifiers.push(w)
    else nameWords.push(w)
  }
  s = nameWords.join(' ').replace(/\u0000(\d+)\u0000/g, (_m, i) => parens[Number(i)]).replace(/\s+,/g, ',').replace(/\s+\)/g, ')').replace(/\(\s+/g, '(').replace(/\s+/g, ' ').trim()

  // "Last, First" → "First Last". A second comma means a list of people
  // ("Smith, Bob, Jane") — leave that alone.
  if ((s.match(/,/g) ?? []).length === 1) {
    const [last, first] = s.split(',').map(x => x.trim())
    if (last && first) s = `${first} ${last}`
    else s = (first || last)
  }
  s = s.replace(/^[\s\-–—.,]+|[\s\-–—.,]+$/g, '')
  if (/^[\d\s.,-]*$/.test(s)) s = ''   // only a number left: not a name

  // Nothing left ("Cutting Instructions.docx"): the folder is the producer.
  let customerName = s
  if (customerName.length < 2 && folder) {
    customerName = folder.replace(/\b(cutting|cut)\s+(instructions?|cards?|sheets?)\b/gi, ' ').replace(/\s+/g, ' ').trim()
    const generic = /^(beef|hog|hogs|pork|lamb|goat|other|general|misc|old|new|documents?|docs?|attachments?|scans?|pics?|pictures?|photos?|files?|usb|drive|shared|desktop|downloads?|\d+)$/i
    if (customerName.split(' ').every(w => generic.test(w))) customerName = ''
  }

  return { customerName, species, killDate, qualifier: qualifiers.join(' ').trim() }
}

export function speciesFromText(text: string): CardSpecies | null {
  for (const w of (text ?? '').toLowerCase().split(/[^a-z]+/)) {
    const sp = SPECIES_WORDS[w]
    if (sp) return sp
  }
  return null
}

// ── Matching a parsed name to a customers row ────────────────────────────────

export interface BriefCustomer { id: string; name: string; ranch_name: string | null; role?: string | null }
export interface CustomerMatch { customer: BriefCustomer; score: number }

const STOP = new Set(['the', 'and', 'of', 'ranch', 'ranches', 'farm', 'farms', 'cattle', 'co', 'company', 'inc', 'llc', 'beef', 'meats', 'meat', 'land', 'livestock'])

export function nameTokens(s: string | null | undefined): string[] {
  return (s ?? '')
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(t => t.length >= 2)
}

// Best customers for a name off a file. 100 = the same name; 80+ = every word
// of the file's name appears on the record; below 50 isn't worth suggesting.
// Ranch names count, so "Nelson Ranch BEEF.pdf" finds Aaron Nelson of Nelson
// Ranch. Shared surnames (Ackerman ×6) score the same for all of them, which is
// exactly when the office has to pick by hand — the page only auto-selects a
// clear winner.
export function matchCustomers(name: string, customers: BriefCustomer[], limit = 4): CustomerMatch[] {
  const want = nameTokens(name)
  if (!want.length) return []
  const wantKey = want.filter(t => !STOP.has(t))
  const keyTokens = wantKey.length ? wantKey : want
  const full = want.join(' ')
  const out: CustomerMatch[] = []
  for (const c of customers) {
    const nameT = nameTokens(c.name)
    const ranchT = nameTokens(c.ranch_name)
    const have = new Set([...nameT, ...ranchT])
    if (nameT.join(' ') === full || ranchT.join(' ') === full) { out.push({ customer: c, score: 100 }); continue }
    let hit = 0
    for (const t of keyTokens) if (have.has(t)) hit++
    if (!hit) continue
    // Every word matched → 90, scaled down for extra words on the record so
    // "Bob Gray" outranks "Bob Gray (Gray Ranch Partners)" for "Gray, Bob".
    const extra = Math.max(0, nameT.length - hit)
    const score = Math.round((hit / keyTokens.length) * 90 - extra * 4)
    if (score >= 40) out.push({ customer: c, score })
  }
  return out.sort((a, b) => b.score - a.score || a.customer.name.localeCompare(b.customer.name)).slice(0, limit)
}

// Auto-pick only when there's one obvious answer.
export function confidentMatch(matches: CustomerMatch[]): BriefCustomer | null {
  if (!matches.length) return null
  const [a, b] = matches
  if (a.score < 80) return null
  if (b && b.score >= a.score - 10) return null
  return a.customer
}

// What a migrated card carries in `data`. The rest of the app reads
// data.customerName and data.species off every card, so those are set even
// though the columns also hold them.
export function legacyCardData(input: {
  customerName: string
  species: string | null
  killDate?: string | null
  notes?: string | null
  sourceFile: string
  sourceFolder?: string | null
  sourceUrl?: string | null
  importedBy?: string | null
}): Record<string, string> {
  const d: Record<string, string> = {
    formVersion:  LEGACY_FORM_VERSION,
    customerName: input.customerName,
    species:      input.species ?? '',
    sourceFile:   input.sourceFile,
    importedAt:   new Date().toISOString(),
  }
  if (input.killDate)     d.killDate     = input.killDate
  if (input.notes)        d.notes        = input.notes
  if (input.sourceFolder) d.sourceFolder = input.sourceFolder
  if (input.sourceUrl)    d.sourceUrl    = input.sourceUrl
  if (input.importedBy)   d.importedBy   = input.importedBy
  return d
}

export function isLegacyFileCard(data: Record<string, unknown> | null | undefined): boolean {
  return data?.formVersion === LEGACY_FORM_VERSION
}

export function formatBytes(n: number | null | undefined): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

// Storage key for a file. Readable name kept, anything odd stripped, and a
// timestamp so two "Cutting Instructions.docx" never collide.
export function storagePathFor(prefix: string, filename: string): string {
  const safe = filename.replace(/[^A-Za-z0-9._-]+/g, '_').replace(/^_+|_+$/g, '').slice(-120) || 'file'
  return `${prefix}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}-${safe}`
}
