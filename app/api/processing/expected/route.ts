export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { resolveCuttingInstruction } from '@/lib/cutCardLookup'
import { applyAgeRule, buildPackList, expectedLines, packSpecies, ExpectedLine } from '@/lib/packList'
import { extractValueAdd } from '@/lib/valueAdd'
import { cureProductsOnSheet } from '@/lib/cureLoad'

export const dynamic = 'force-dynamic'

// What this packing session still owes the customer.
//
// The list is the cut card's packaging sheet — the same one that prints on page
// 2 — and the links are how a scanned PLU knows which line it belongs to. The
// scanner does the ticking off; this route only says what is expected and what
// has been linked before.

type Line = ExpectedLine & { card: number }

// Is the animal on this bench over 30 months? Same lookup the card resolver
// uses — the carcasses scanned into the session — read for their age instead of
// their card. Every linked animal +30mo → true; none → false; a mix → 'mixed'; no
// linked animal at all (a name-only session) → null, and the sheet stays as
// written, which is what the scanner has always done.
async function sessionAge(customerName: string, packDate: string): Promise<boolean | 'mixed' | null> {
  const inputs = await supabaseAdmin
    .from('processing_inputs')
    .select('linked_harvest_id')
    .eq('customer_name', customerName)
    .eq('pack_date', packDate)
    .not('linked_harvest_id', 'is', null)
  const ids = [...new Set((inputs.data ?? []).map(r => r.linked_harvest_id).filter(Boolean))]
  if (!ids.length) return null
  const hl = await supabaseAdmin.from('harvest_log').select('over_30_months').in('id', ids)
  const ages = (hl.data ?? []).map(r => r.over_30_months === true)
  if (!ages.length) return null
  if (ages.every(a => a)) return true
  if (ages.some(a => a)) return 'mixed'
  return false
}

// A bench with +30mo and under-30 animals on it packs both: T-bones off the young
// ones, strips and filets off the old. The converted card's lines that the
// written card doesn't already carry slot in beside their section.
function withBothAges(asWritten: ExpectedLine[], converted: ExpectedLine[]): ExpectedLine[] {
  const have = new Set(asWritten.map(l => l.key))
  const extra = converted.filter(l => !have.has(l.key))
  if (!extra.length) return asWritten
  const out: ExpectedLine[] = []
  for (let i = 0; i < asWritten.length; i++) {
    out.push(asWritten[i])
    const last = asWritten[i + 1]?.section !== asWritten[i].section
    if (last) out.push(...extra.filter(l => l.section === asWritten[i].section))
  }
  const placed = new Set(out.map(l => l.key))
  out.push(...extra.filter(l => !placed.has(l.key)))
  return out
}

// GET /api/processing/expected?customer_name=X&date=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const customerName = searchParams.get('customer_name')
  const date         = searchParams.get('date')
  if (!customerName || !date) {
    return NextResponse.json({ error: 'customer_name and date required' }, { status: 400 })
  }

  const [match, age] = await Promise.all([resolveCuttingInstruction(customerName, date), sessionAge(customerName, date)])
  if (!match) return NextResponse.json({ found: false, lines: [], links: [] })

  const lines: Line[] = []
  const speciesSeen = new Set<string>()
  // What the sheet sends to cure, so a fresh seal's picker can lead with the
  // pieces this customer actually ordered (Jill, 2026-09-04).
  const sheetProducts = new Set<string>()
  let otm = false
  match.cards.forEach((card, i) => {
    const rawSpecies = (card.data?.species as string) ?? card.species ?? 'Beef'
    const species = packSpecies(rawSpecies)
    speciesSeen.add(species)
    // Over 30 months there is no T-bone to pack — the sheet expects the NY
    // strip and filet the loin was boned out into instead (AE, 2026-10-06).
    // The existing strip-loin / filet PLU links already cover those lines.
    const asWritten = expectedLines(buildPackList(card.data, species), species)
    const rule      = applyAgeRule(card.data, age === true || age === 'mixed')
    if (rule.converted) otm = true
    const cardLines = !rule.converted ? asWritten
      : age === true ? expectedLines(buildPackList(rule.data, species), species)
      : withBothAges(asWritten, expectedLines(buildPackList(rule.data, species), species))
    for (const l of cardLines) lines.push({ ...l, card: i })
    for (const it of extractValueAdd(rawSpecies, card.data)) sheetProducts.add(it.product)
  })

  // Every link for the species on the bench — the packer may be about to scan a
  // PLU that isn't on this card at all, and it still has to resolve.
  const links = await supabaseAdmin
    .from('plu_cut_links')
    .select('species, cut_key, plu_number, item_name')
    .in('species', [...speciesSeen])

  return NextResponse.json({
    found:   true,
    via:     match.via,
    name:    match.name,
    cards:   match.cards.length,
    species: [...speciesSeen],
    lines,
    // Said on the wire so the bench can see why its list has no T-bone line.
    over30:  age,
    otmSwap: otm,
    links:   links.data ?? [],
    cure:    cureProductsOnSheet(sheetProducts),
    // Producer labels the office set on the card(s) — the packager has to
    // switch the scale to it before the first package (Charlie, 2026-09-23).
    scaleLabels: [...new Set(match.cards.map(c => c.scaleLabel?.trim()).filter((l): l is string => !!l))],
  })
}

// POST — the packer taps a scanned PLU onto the line it belongs to. Once.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as
    { species?: string; cut_key?: string; plu_number?: string; item_name?: string } | null
  const species = packSpecies(body?.species)
  const cutKey  = String(body?.cut_key ?? '').trim()
  const plu     = String(body?.plu_number ?? '').trim()
  if (!cutKey || !plu) {
    return NextResponse.json({ error: 'cut_key and plu_number required' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('plu_cut_links')
    .upsert(
      { species, cut_key: cutKey, plu_number: plu, item_name: body?.item_name ?? null },
      { onConflict: 'species,cut_key,plu_number' },
    )
    .select()
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? {})
}

// DELETE /api/processing/expected?species=beef&cut_key=ribeye&plu_number=118
// A link made on the wrong line has to come off the same screen it went on.
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const species = packSpecies(searchParams.get('species'))
  const cutKey  = String(searchParams.get('cut_key') ?? '').trim()
  const plu     = String(searchParams.get('plu_number') ?? '').trim()
  if (!cutKey || !plu) {
    return NextResponse.json({ error: 'cut_key and plu_number required' }, { status: 400 })
  }
  const { error } = await supabaseAdmin
    .from('plu_cut_links')
    .delete()
    .eq('species', species).eq('cut_key', cutKey).eq('plu_number', plu)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
