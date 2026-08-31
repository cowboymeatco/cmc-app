export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/scanner/customer-names — the names the packing scanner should offer
// when a session is opened.
//
// The customer on a session is free text, and everything downstream inherits
// it: the boxes, the processing inputs, and the cure tags. When the floor types
// "MVML KRISTIN" and the office typed "MT Veterans Meat Locker Kristin", her
// pieces belong to nobody — 52 tagged pieces were sitting under 8 names no cut
// sheet used (Charlie, 2026-08-27). Matching them up afterwards is guesswork;
// offering the office's spelling at the moment of typing is not.
//
// CUT SHEETS come first and are the ones worth picking: they are what the cure
// sheet and the value-add report join against. Recent session names follow, so
// retail and repack work — which has no cut sheet — still autocompletes.

export async function GET() {
  const since = new Date(Date.now() - 120 * 86_400_000).toISOString().slice(0, 10)

  const [sheetRes, sessRes, aliasRes] = await Promise.all([
    supabase.from('cutting_instructions')
      .select('id, customer_name, species, created_at')
      .neq('status', 'archived')
      .order('created_at', { ascending: false }),
    supabase.from('processing_sessions')
      .select('customer_name, session_date')
      .gte('session_date', since)
      .order('session_date', { ascending: false }),
    supabase.from('customer_name_aliases').select('alias, expands_to'),
  ])
  if (sheetRes.error) return NextResponse.json({ error: sheetRes.error.message }, { status: 500 })

  interface Name { name: string; source: 'sheet' | 'recent'; species: string | null; lastSeen: string; ids?: string[] }
  const byName = new Map<string, Name>()

  // The first 8 hex chars of the instruction id — what the packaging sheet's
  // CI-xxxxxxxx barcode carries, so a scanned slip resolves to its sheet name.
  const id8 = (id: unknown) => String(id ?? '').replace(/-/g, '').slice(0, 8).toUpperCase()

  for (const r of sheetRes.data ?? []) {
    const name = String(r.customer_name ?? '').trim()
    if (!name) continue
    const prev = byName.get(name)
    // A customer with several sheets keeps the newest date and, when the
    // species differ, no single species rather than an arbitrary one. Every
    // sheet's barcode still has to open the session, so the ids accumulate.
    if (prev) {
      if (prev.species && prev.species !== (r.species ?? null)) prev.species = null
      if (r.id) prev.ids!.push(id8(r.id))
      continue
    }
    byName.set(name, {
      name, source: 'sheet',
      species: (r.species as string) ?? null,
      lastSeen: String(r.created_at ?? '').slice(0, 10),
      ids: r.id ? [id8(r.id)] : [],
    })
  }

  for (const r of sessRes.data ?? []) {
    const name = String(r.customer_name ?? '').trim()
    // A name already on a cut sheet stays labelled as one — that's the
    // spelling worth reusing.
    if (!name || byName.has(name)) continue
    byName.set(name, { name, source: 'recent', species: null, lastSeen: String(r.session_date ?? '') })
  }

  const names = [...byName.values()].sort((a, b) =>
    (a.source === b.source ? 0 : a.source === 'sheet' ? -1 : 1) ||
    b.lastSeen.localeCompare(a.lastSeen))

  return NextResponse.json({ names, aliases: aliasRes.data ?? [] })
}
