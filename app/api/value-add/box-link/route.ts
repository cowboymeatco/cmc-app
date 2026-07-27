export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Managing the boxes a person has pointed at a value-add job by hand, and
// finding candidate boxes to point at. See lib/boxWeight.ts for why the manual
// links override the automatic PLU + pack-date match.

interface BoxSummary {
  box_id:        string
  box_label:     string | null
  customer_name: string | null
  pack_date:     string | null
  total_lbs:     number
  packages:      number
  /** Distinct products in the box, so the crew can see it is the right one. */
  items:         { plu_number: string | null; item_name: string | null; lbs: number }[]
  linked:        boolean
}

// Roll a set of boxes up with their contents in one pass.
async function summarize(boxIds: string[], linkedIds: Set<string>): Promise<BoxSummary[]> {
  if (boxIds.length === 0) return []

  const CHUNK = 150
  const boxes: Record<string, unknown>[] = []
  const scans: Record<string, unknown>[] = []

  for (let i = 0; i < boxIds.length; i += CHUNK) {
    const slice = boxIds.slice(i, i + CHUNK)
    const [b, s] = await Promise.all([
      supabase.from('boxes').select('id, box_label, customer_name, pack_date').in('id', slice),
      supabase.from('box_scans').select('box_id, plu_number, item_name, weight_lbs, quantity').in('box_id', slice),
    ])
    boxes.push(...(b.data ?? []))
    scans.push(...(s.data ?? []))
  }

  const byBox = new Map<string, BoxSummary>()
  for (const b of boxes) {
    const id = b.id as string
    byBox.set(id, {
      box_id: id,
      box_label:     (b.box_label as string) ?? null,
      customer_name: (b.customer_name as string) ?? null,
      pack_date:     (b.pack_date as string) ?? null,
      total_lbs: 0, packages: 0, items: [],
      linked: linkedIds.has(id),
    })
  }

  const itemAgg = new Map<string, Map<string, { plu_number: string | null; item_name: string | null; lbs: number }>>()
  for (const s of scans) {
    const box = byBox.get(s.box_id as string)
    if (!box) continue
    const lbs = Number(s.weight_lbs ?? 0)
    box.total_lbs += lbs
    box.packages  += Number(s.quantity ?? 1)

    const key = String(s.plu_number ?? s.item_name ?? '?')
    const items = itemAgg.get(box.box_id) ?? new Map()
    const cur = items.get(key) ?? { plu_number: (s.plu_number as string) ?? null, item_name: (s.item_name as string) ?? null, lbs: 0 }
    cur.lbs += lbs
    items.set(key, cur)
    itemAgg.set(box.box_id, items)
  }

  for (const box of byBox.values()) {
    box.total_lbs = Math.round(box.total_lbs * 10) / 10
    box.items = Array.from(itemAgg.get(box.box_id)?.values() ?? [])
      .map(i => ({ ...i, lbs: Math.round(i.lbs * 10) / 10 }))
      .sort((a, b) => b.lbs - a.lbs)
  }

  return Array.from(byBox.values())
    .sort((a, b) => String(b.pack_date).localeCompare(String(a.pack_date)))
}

// GET /api/value-add/box-link?job_id=X            — boxes currently linked
// GET /api/value-add/box-link?job_id=X&q=term     — candidates to link
//
// The search matches a customer, a box label, or a pack date, because those are
// the three things somebody standing at the rack can actually read off a box.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('job_id')
  const q     = (searchParams.get('q') ?? '').trim()
  if (!jobId) return NextResponse.json({ error: 'job_id required' }, { status: 400 })

  const { data: links, error } = await supabase
    .from('value_add_job_box')
    .select('box_id')
    .eq('job_id', jobId)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const linkedIds = new Set((links ?? []).map(l => l.box_id as string))

  if (!q) {
    return NextResponse.json({ linked: await summarize(Array.from(linkedIds), linkedIds), candidates: [] })
  }

  // A date term filters on pack_date; anything else is a text search.
  const isDate = /^\d{4}-\d{2}-\d{2}$/.test(q)
  let search = supabase.from('boxes').select('id').limit(40)
  search = isDate
    ? search.eq('pack_date', q)
    : search.or(`customer_name.ilike.%${q}%,box_label.ilike.%${q}%`)

  const { data: hits, error: sErr } = await search
  if (sErr) return NextResponse.json({ error: sErr.message }, { status: 500 })

  const candidateIds = (hits ?? []).map(h => h.id as string).filter(id => !linkedIds.has(id))

  const [linked, candidates] = await Promise.all([
    summarize(Array.from(linkedIds), linkedIds),
    summarize(candidateIds, linkedIds),
  ])
  return NextResponse.json({ linked, candidates })
}

// POST /api/value-add/box-link   { job_id, box_id, linked_by? }
export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body?.job_id || !body?.box_id) {
    return NextResponse.json({ error: 'job_id and box_id required' }, { status: 400 })
  }

  const { error } = await supabase
    .from('value_add_job_box')
    .upsert(
      { job_id: body.job_id, box_id: body.box_id, linked_by: body.linked_by ?? null },
      { onConflict: 'job_id,box_id' }
    )

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}

// DELETE /api/value-add/box-link?job_id=X&box_id=Y
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const jobId = searchParams.get('job_id')
  const boxId = searchParams.get('box_id')
  if (!jobId || !boxId) return NextResponse.json({ error: 'job_id and box_id required' }, { status: 400 })

  const { error } = await supabase
    .from('value_add_job_box')
    .delete()
    .eq('job_id', jobId)
    .eq('box_id', boxId)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
