export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { resolveCuttingInstruction } from '@/lib/cutCardLookup'
import { buildPackList, expectedLines, packSpecies, ExpectedLine } from '@/lib/packList'

export const dynamic = 'force-dynamic'

// What this packing session still owes the customer.
//
// The list is the cut card's packaging sheet — the same one that prints on page
// 2 — and the links are how a scanned PLU knows which line it belongs to. The
// scanner does the ticking off; this route only says what is expected and what
// has been linked before.

type Line = ExpectedLine & { card: number }

// GET /api/processing/expected?customer_name=X&date=YYYY-MM-DD
//   ?all=1 → every link, no session — the cut card prints a call-up barcode on
//   each packaging-sheet line whose cut resolves to exactly one PLU.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  if (searchParams.get('all')) {
    const links = await supabaseAdmin
      .from('plu_cut_links')
      .select('species, cut_key, plu_number, item_name')
    return NextResponse.json({ links: links.data ?? [] })
  }

  const customerName = searchParams.get('customer_name')
  const date         = searchParams.get('date')
  if (!customerName || !date) {
    return NextResponse.json({ error: 'customer_name and date required' }, { status: 400 })
  }

  const match = await resolveCuttingInstruction(customerName, date)
  if (!match) return NextResponse.json({ found: false, lines: [], links: [] })

  const lines: Line[] = []
  const speciesSeen = new Set<string>()
  match.cards.forEach((card, i) => {
    const species = packSpecies((card.data?.species as string) ?? card.species ?? 'Beef')
    speciesSeen.add(species)
    for (const l of expectedLines(buildPackList(card.data, species), species)) {
      lines.push({ ...l, card: i })
    }
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
    links:   links.data ?? [],
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
