export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/producers?search=text — ranch / producer name suggestions.
//
// There is no producers table and there shouldn't be one: harvest_appointments
// .producer_id already points at customers, so a third table would fragment
// that. Instead suggest from the names actually in use — the source field on
// past appointments plus harvest_log.producer. Both matter: 66 names appear
// only on appointments, 11 only in the harvest log.
//
// Self-maintaining by construction: every appointment booked feeds the pool.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const search = searchParams.get('search')?.trim()
  if (!search || search.length < 2) return NextResponse.json([])

  // .ilike() parameterises the value, unlike the hand-built .or() filter
  // string in /api/customers — a comma or paren here is just a character.
  const [apptRes, logRes] = await Promise.all([
    supabase.from('harvest_appointments').select('source').ilike('source', `%${search}%`).limit(300),
    supabase.from('harvest_log').select('producer').ilike('producer', `%${search}%`).limit(300),
  ])
  if (apptRes.error) return NextResponse.json({ error: apptRes.error.message }, { status: 500 })

  // Count uses per name so the common ranches sort to the top; a typeahead
  // ordered alphabetically buries the name you almost certainly meant.
  const counts = new Map<string, { name: string; uses: number }>()
  const tally = (raw: unknown) => {
    const name = typeof raw === 'string' ? raw.trim() : ''
    if (!name) return
    const key = name.toLowerCase()
    const hit = counts.get(key)
    if (hit) hit.uses++
    else counts.set(key, { name, uses: 1 })
  }

  for (const r of apptRes.data ?? []) tally(r.source)
  // harvest_log is secondary — if it errors, still serve appointment names.
  for (const r of logRes.data ?? []) tally(r.producer)

  const results = [...counts.values()]
    .sort((a, b) => b.uses - a.uses || a.name.localeCompare(b.name))
    .slice(0, 8)

  return NextResponse.json(results)
}
