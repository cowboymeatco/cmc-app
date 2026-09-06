export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { buildPackList, cutKey, expectedLines, packSpecies } from '@/lib/packList'
import { extractValueAdd } from '@/lib/valueAdd'

// GET /api/processing/link-book — every cut line a cut card has ever asked for,
// beside the PLUs it is linked to and the PLUs it might be.
//
// The link table (plu_cut_links) is filled two taps at a time on the scanner,
// which is why it held 23 rows after two months. This route lays the whole
// universe out in one sitting: walk every cutting instruction ever submitted
// through the same buildPackList → expectedLines path the scanner and the
// printed packaging sheet use, so a line here is exactly the line the packer
// will be asked to tick off. A wizard option nobody has ordered yet is not on
// the list — it appears the day a card asks for it, marked unlinked.
//
// Suggestions are name matches and nothing more. They are shown, never saved:
// a wrong link sends the wrong PLU to the scale, so a person confirms each one
// (Charlie's rule — links are tapped in by hand, never guessed).

interface PluRow { plu_number: string; item_name: string; species: string | null; active: boolean; price: number | null; scans: number }
interface LinkRow { species: string; cut_key: string; plu_number: string; item_name: string | null }

export interface BookLine {
  species:    string
  key:        string
  label:      string
  section:    string
  cut:        string
  isGrind:    boolean
  /** Comes out of the smokehouse or the cure, not off the saw. */
  smoked:     boolean
  /** Sausage, jerky, sticks — the PLU lives under Processed, never under the animal. */
  family?:    'processed'
  /** Some suggestion carries every word of the line. False is the scale-readiness flag:
   *  nothing on the PLU list says exactly this, so the product may need a PLU made. */
  exact:      boolean
  cards:      number
  lastSeen:   string
  links:      { plu: string; name: string; active: boolean }[]
  suggested:  { plu: string; name: string; active: boolean; scans: number }[]
}

const SPECIES_PLU: Record<string, string[]> = {
  beef: ['Beef'], pork: ['Pork'], lamb: ['Lamb'], goat: ['Goat'],
}
// Sections and cuts that come out of the smokehouse rather than the saw. Their
// PLUs live under "Processed" whatever animal they came off.
const SMOKED = /sausage|brot|smok|bacon|ham\b|hams\b|jerky|snack|summer|salami|hot dog|polish|cure|pepperoni|bologna|link/i

// Words that say how a line is handled, not what the product is: "Beef Heart ·
// Keep", "Trim to save", "Cured & Smoked Ham · Cut in Half", "Our House Bacon".
const STOP = new Set([
  'beef', 'pork', 'hog', 'lamb', 'goat', 'and', 'the', 'with', 'per', 'lbs', 'lb', 'pack', 'packs', 'for', 'from', 'each',
  'keep', 'save', 'our', 'house', 'cut', 'half', 'quarter', 'whole', 'homemade',
])
// The sheet's word and the scale's word for the same thing.
const SYN: Record<string, string[]> = {
  brot: ['brotwurst'], brots: ['brotwurst'],
  babyback: ['baby', 'back'], pepperjack: ['pepper', 'jack'], helmers: ['helmer'],
}
const tokens = (s: string) =>
  s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').split(' ')
    .flatMap(w => SYN[w] ?? [w])
    .filter(w => w.length >= 3 && !STOP.has(w))

// The scale says SAUSAGE where the sheet says Brots (POLISH SAUSAGE is the
// polish brot), so on the PLU side a sausage counts as a brotwurst too.
const pluTokens = (s: string) => tokens(s).flatMap(w => w === 'sausage' ? ['sausage', 'brotwurst'] : [w])

// Light stemming so "roasts" meets "ROAST" and "steaks" meets "STEAK".
const stem = (w: string) => w.replace(/(ies)$/, 'y').replace(/(es|s)$/, '')

function suggest(line: { label: string; section: string; species: string; smoked?: boolean; family?: 'processed' }, plus: PluRow[]): { p: PluRow; full: boolean }[] {
  const want = new Set(tokens(line.label).map(stem))
  if (want.size === 0) return []
  const smoked = line.smoked || SMOKED.test(line.section) || SMOKED.test(line.label)
  const own = SPECIES_PLU[line.species] ?? []
  const scored: { p: PluRow; s: number; full: boolean }[] = []
  for (const p of plus) {
    if (!p.active) continue
    const sp = p.species ?? ''
    const inFamily = line.family === 'processed' ? sp === 'Processed'
      : smoked ? (sp === 'Processed' || own.includes(sp)) : own.includes(sp)
    if (!inFamily) continue
    const have = new Set(pluTokens(p.item_name).map(stem))
    let shared = 0
    for (const w of want) if (have.has(w)) shared++
    if (shared === 0) continue
    // Share of the line's words the PLU carries, minus a little for every extra
    // word the PLU adds — "BEEF RIBEYE STEAK" should beat "BEEF RIBEYE STEAK
    // BONE-IN THICK CUT" for a plain "Ribeye" line.
    // A PLU the crew has actually scanned this season outranks a look-alike
    // nobody has ever used — the 413xxx series matches by name and has 0 scans.
    const used = Math.min(p.scans, 50) / 50 * 0.25
    const s = shared / want.size - 0.05 * Math.max(0, have.size - shared) + (smoked && sp === 'Processed' ? 0.05 : 0) + used
    scored.push({ p, s, full: shared === want.size })
  }
  return scored.sort((a, b) => b.s - a.s || b.p.scans - a.p.scans || a.p.item_name.localeCompare(b.p.item_name)).slice(0, 3)
}

export async function GET() {
  try {
    const since = new Date(Date.now() - 180 * 86_400_000).toISOString().slice(0, 10)
    const [cardsRes, linksRes, plusRes, scansRes] = await Promise.all([
      supabaseAdmin.from('cutting_instructions').select('id, species, data, created_at').order('created_at', { ascending: true }),
      supabaseAdmin.from('plu_cut_links').select('species, cut_key, plu_number, item_name'),
      supabaseAdmin.from('plu_items').select('plu_number, item_name, species, active, price').order('item_name'),
      supabaseAdmin.rpc('plu_scan_counts', { since }),
    ])
    for (const r of [cardsRes, linksRes, plusRes, scansRes]) if (r.error) throw new Error(r.error.message)

    const scanCount = new Map<string, number>(
      ((scansRes.data ?? []) as { plu_number: string; n: number }[]).map(r => [r.plu_number, Number(r.n)]))
    const plus: PluRow[] = ((plusRes.data ?? []) as Omit<PluRow, 'scans'>[]).map(p => ({ ...p, scans: scanCount.get(p.plu_number) ?? 0 }))
    const pluByNumber = new Map(plus.map(p => [p.plu_number, p]))
    const links = (linksRes.data ?? []) as LinkRow[]

    // One entry per (species, cut key) across every card ever filed.
    const lines = new Map<string, Omit<BookLine, 'links' | 'suggested' | 'exact'>>()
    let cardsRead = 0
    for (const card of cardsRes.data ?? []) {
      const data = (card.data ?? {}) as Record<string, unknown>
      const species = packSpecies((data.species as string) ?? (card.species as string) ?? 'Beef')
      let rows
      try { rows = buildPackList(data, species) } catch { continue }   // a malformed old card must not blank the book
      cardsRead++
      const seen = (card.created_at as string).slice(0, 10)
      for (const l of expectedLines(rows, species)) {
        if (l.writeIn) continue   // free text — one-offs, not a product with a PLU
        const id = `${species}|${l.key}`
        const cur = lines.get(id)
        if (cur) { cur.cards++; if (seen > cur.lastSeen) cur.lastSeen = seen; continue }
        lines.set(id, { species, key: l.key, label: l.label, section: l.section, cut: l.cut, isGrind: l.isGrind, smoked: false, cards: 1, lastSeen: seen })
      }

      // The packaging sheet lists smokehouse products as write-in rows (a blank
      // for the trim weight), so they were skipped above. They are exactly the
      // products the scale is most often missing — Cheddar Polish Dogs had no
      // PLU the week it was ordered — so they get their own lines here, read
      // the way the value-add report reads them. Ground-trim sausage flavours
      // are already pack-list lines under "Sausage / Trim" and are not repeated.
      for (const v of extractValueAdd(species, data)) {
        if (v.category === 'Sausage') continue
        // A weight is an amount, not a product: "Brotwurst · Cheddar · 25 lb"
        // and "… · 40 lb" are one line.
        const detail = (v.detail ?? '').split(' · ').filter(part => !/^\d+(\.\d+)?\s*lbs?$/.test(part)).join(' · ')
        const label = detail ? `${v.product} · ${detail}` : v.product
        const key = cutKey(label)
        if (!key) continue
        const id = `${species}|${key}`
        const cur = lines.get(id)
        if (cur) { cur.cards++; if (seen > cur.lastSeen) cur.lastSeen = seen; continue }
        lines.set(id, {
          species, key, label, section: `Value add · ${v.category}`, cut: label, isGrind: false, smoked: true,
          family: v.category === 'Smokehouse' ? 'processed' : undefined, cards: 1, lastSeen: seen,
        })
      }
    }

    const linksByLine = new Map<string, LinkRow[]>()
    for (const l of links) {
      const id = `${l.species}|${l.cut_key}`
      linksByLine.set(id, [...(linksByLine.get(id) ?? []), l])
    }

    const SPECIES_ORDER = ['beef', 'pork', 'lamb', 'goat']
    const out: BookLine[] = [...lines.entries()].map(([id, l]) => {
      const mine = (linksByLine.get(id) ?? []).map(k => {
        const p = pluByNumber.get(k.plu_number)
        return { plu: k.plu_number, name: p?.item_name ?? k.item_name ?? '', active: p?.active ?? false }
      })
      const found = mine.length ? [] : suggest(l, plus)
      const suggested = found.map(({ p }) => ({ plu: p.plu_number, name: p.item_name, active: p.active, scans: p.scans }))
      return { ...l, links: mine, suggested, exact: mine.length > 0 || found.some(f => f.full) }
    }).sort((a, b) =>
      SPECIES_ORDER.indexOf(a.species) - SPECIES_ORDER.indexOf(b.species)
      || a.section.localeCompare(b.section)
      || a.label.localeCompare(b.label))

    // Links whose cut line no card has ever produced — made on the bench against
    // a key the pack list no longer emits, or a typo. Shown so they can be pulled.
    const orphans = links.filter(l => !lines.has(`${l.species}|${l.cut_key}`)).map(l => ({
      species: l.species, key: l.cut_key, plu: l.plu_number,
      name: pluByNumber.get(l.plu_number)?.item_name ?? l.item_name ?? '',
    }))

    const stats = {
      cards: cardsRead,
      lines: out.length,
      linked: out.filter(l => l.links.length > 0).length,
      unlinked: out.filter(l => l.links.length === 0).length,
      noExact: out.filter(l => !l.exact).length,
      deletedPlu: out.filter(l => l.links.some(k => !k.active)).length,
    }

    return NextResponse.json({
      stats,
      lines: out,
      orphans,
      plus: plus.filter(p => p.active).map(p => ({ plu: p.plu_number, name: p.item_name, species: p.species ?? '', scans: p.scans })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
