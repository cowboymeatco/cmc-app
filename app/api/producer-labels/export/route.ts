export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { buildProducerHtFile, type HobartPlu } from '@/lib/hobart'

// GET /api/producer-labels/export?id=<set> — one producer's PLUs as a Hobart
// .ht file, for HCT's "Import HT File" and a push to the scales. Only this
// producer's records: the house book is untouched, so importing it adds the
// set without rewriting anything else on the scale.
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: set } = await supabaseAdmin.from('producer_labels').select('*').eq('id', id).maybeSingle()
  if (!set) return NextResponse.json({ error: 'No such set' }, { status: 404 })
  // Without it every record would print on the house label — the one thing a
  // set exists to avoid.
  if (!set.label_format) return NextResponse.json({ error: `Set ${set.name}'s label format first` }, { status: 400 })

  const { data: items } = await supabaseAdmin.from('producer_plu_items')
    .select('house_plu, plu_number, item_name').eq('producer_label_id', id)
  if (!items?.length) return NextResponse.json({ error: `${set.name} has no PLUs yet` }, { status: 400 })

  const { data: house } = await supabaseAdmin.from('plu_items')
    .select('plu_number, item_name, price, tare_weight, upc, unit, department, label_message, ingredients, ht_skeleton')
    .in('plu_number', items.map(i => i.house_plu))
  const houseMap = new Map((house ?? []).map(h => [String(h.plu_number), h]))
  const missing = items.filter(i => !houseMap.has(i.house_plu))
  if (missing.length) {
    return NextResponse.json({ error: `House PLU ${missing.map(m => m.house_plu).join(', ')} no longer exists — drop it from the set` }, { status: 400 })
  }

  const ht = buildProducerHtFile(
    items.sort((a, b) => Number(a.plu_number) - Number(b.plu_number)).map(i => {
      const h = houseMap.get(i.house_plu)!
      const hp: HobartPlu = {
        plu_number: String(h.plu_number), item_name: h.item_name, price: h.price, tare_weight: h.tare_weight,
        upc: h.upc, unit: h.unit, department: h.department, label_message: h.label_message,
        ingredients: h.ingredients, skeleton: h.ht_skeleton,
      }
      return { house: hp, plu_number: i.plu_number, item_name: i.item_name }
    }),
    set.label_format,
  )
  // Latin-1, one byte per char, so the 0x1E/0x1F framing matches the scale's
  // own files — same encoding as the Processing page's full export.
  const bytes = new Uint8Array(ht.length)
  for (let n = 0; n < ht.length; n++) bytes[n] = ht.charCodeAt(n) & 0xff
  const file = `${set.name.replace(/[^A-Za-z0-9]+/g, '_')}_PLUs_${new Date().toISOString().slice(0, 10)}.ht`
  return new NextResponse(bytes, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${file}"`,
      'Cache-Control': 'no-store',
    },
  })
}
