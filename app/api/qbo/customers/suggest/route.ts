export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { nameKey } from '@/lib/nameKey'

// GET /api/qbo/customers/suggest?name=Rosebud%20Cattlewomen&scope=producer|customer
//
// Which QuickBooks customer a name on a booking bills to (Charlie, 2026-09-14,
// step 5 of "one ID from the kill floor to the invoice"). A link someone already
// confirmed (producer_qbo_links / customer_qbo_links) comes back as `linked`;
// otherwise the closest QBO names come back as `candidates` for a person to
// pick — QBO spells "ROSEBUD CATTLE WOMEN" where the booking says
// "Rosebud Cattlewomen", and no rule should decide that on its own.
export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get('name') ?? '').trim()
  const scope = req.nextUrl.searchParams.get('scope') === 'customer' ? 'customer' : 'producer'
  if (name.length < 2) return NextResponse.json({ linked: null, candidates: [] })

  const table = scope === 'producer' ? 'producer_qbo_links' : 'customer_qbo_links'
  const col = scope === 'producer' ? 'producer_name' : 'customer_name'
  const key = nameKey(name)

  const [{ data: links }, { data: cands }] = await Promise.all([
    supabaseAdmin.from(table).select(`${col}, qbo_customer_id`),
    supabaseAdmin.rpc('qbo_customer_candidates', { names: [name], min_sim: 0.3, per_name: 4 }),
  ])
  const hit = ((links ?? []) as unknown as Record<string, string>[]).find(l => nameKey(l[col]) === key)

  let linked: { qbo_id: string; display_name: string } | null = null
  if (hit?.qbo_customer_id) {
    const { data: q } = await supabaseAdmin.from('qbo_customers').select('qbo_id, display_name').eq('qbo_id', hit.qbo_customer_id).maybeSingle()
    linked = { qbo_id: String(hit.qbo_customer_id), display_name: String(q?.display_name ?? hit.qbo_customer_id) }
  }
  const candidates = ((cands ?? []) as { qbo_id: string; display_name: string; sim: number }[])
    .filter(c => c.qbo_id !== linked?.qbo_id)
    .map(c => ({ qbo_id: String(c.qbo_id), display_name: c.display_name, sim: Math.round(c.sim * 100) / 100 }))

  return NextResponse.json({ linked, candidates })
}
