export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { shortItemName } from '@/lib/itemName'

export const dynamic = 'force-dynamic'

// GET /api/delivery/boxes?serials=CMC260807TT0L,CMC260807VAJC
//
// What each box on a logged delivery actually is. The Delivery Log used to
// show a box serial as "Box · packed Aug 7", which is no help when the ask is
// "pull the three cases of kidney fat off this load" (Charlie, 2026-09-09).
// One row per serial: box number, customer, what's in it, weight.
export async function GET(req: NextRequest) {
  const serials = [...new Set(
    (new URL(req.url).searchParams.get('serials') ?? '')
      .split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
  )]
  if (!serials.length) return NextResponse.json({})

  const { data: boxes, error } = await supabase
    .from('boxes')
    .select('id, serial_number, customer_name, pack_date, box_number, total_weight_lbs, picked_up_at, delivery_id')
    .in('serial_number', serials)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (boxes ?? []).map(b => b.id)
  const { data: scans } = ids.length
    ? await supabase.from('box_scans').select('box_id, item_name, weight_lbs').in('box_id', ids)
    : { data: [] as { box_id: string; item_name: string | null; weight_lbs: number | null }[] }

  // Contents as the heaviest few names — "BEEF KIDNEY FAT", or "RIBEYE, SIRLOIN +3".
  const byBox: Record<string, Record<string, number>> = {}
  for (const s of scans ?? []) {
    const name = shortItemName(s.item_name) || 'Unknown'
    ;(byBox[s.box_id] ??= {})[name] = (byBox[s.box_id]?.[name] ?? 0) + (Number(s.weight_lbs) || 0)
  }

  const out: Record<string, unknown> = {}
  for (const b of boxes ?? []) {
    const names = Object.entries(byBox[b.id] ?? {}).sort((a, c) => c[1] - a[1]).map(([n]) => n)
    const contents = names.length === 0 ? '' : names.length <= 2 ? names.join(', ') : `${names.slice(0, 2).join(', ')} +${names.length - 2}`
    out[(b.serial_number ?? '').toUpperCase()] = {
      box_number:    b.box_number,
      customer_name: b.customer_name,
      pack_date:     b.pack_date,
      weight_lbs:    Number(b.total_weight_lbs) || 0,
      contents,
      picked_up_at:  b.picked_up_at,
      delivery_id:   b.delivery_id,
    }
  }
  return NextResponse.json(out)
}
