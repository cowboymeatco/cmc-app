export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateLabel, LabelFlags, LabelAnimal, BoxRecord, BoxScan } from '@/lib/label'
import { generateCMBLabel } from '@/lib/labelCMB'
import { generateWIPLabel, wipDataFromBox, isWIPBoxLabel } from '@/lib/labelWIP'
import { parseSmokehouseOrders, roundJerkyLabel, classifyBoxProduct, allocateIntent } from '@/lib/wipIntent'

// Central Montana Beef cases get their US Foods label (4x6, GTIN barcode)
// instead of the standard CMC box label. Sessions are named "CMB", "CMB 26181",
// "CMB Grind All", etc. Override per-print with ?format=std or ?format=cmb.
const isCMBCustomer = (name: string) => /^\s*(cmb\b|central\s+montana)/i.test(name || '')

// A box is work-in-progress when it isn't finished product leaving the plant —
// it's headed to value add. Recognised two ways, either of which the crew is
// already doing: the box recipient says so ("WIP", "Value Add"), or the whole
// packing session has been moved to the Value Add queue on the scanner.
// Override per-print with ?format=wip or ?format=std.
async function isWIPBox(box: BoxRecord): Promise<boolean> {
  if (isWIPBoxLabel(box.box_label)) return true
  const { data } = await supabase
    .from('processing_sessions')
    .select('status')
    .eq('customer_name', box.customer_name)
    .eq('session_date', box.pack_date)
    .maybeSingle()
  return data?.status === 'value_add'
}

// A box's animal is whatever carcass(es) the crew scanned into its packing
// session. Keyed on customer + pack date (how every session keys). If more than
// one carcass is linked, any Custom makes the whole box Custom (a custom-exempt
// cut can't be sold), producers are joined, and the whole hanging weights sum.
async function resolveAnimal(box: BoxRecord): Promise<LabelAnimal | undefined> {
  const inputsRes = await supabase
    .from('processing_inputs')
    .select('linked_harvest_id')
    .eq('customer_name', box.customer_name)
    .eq('pack_date', box.pack_date)
    .not('linked_harvest_id', 'is', null)
  const ids = [...new Set((inputsRes.data ?? []).map(r => r.linked_harvest_id).filter(Boolean))]
  if (!ids.length) return undefined

  const hlRes = await supabase
    .from('harvest_log')
    .select('producer, hot_carcass_weight_lbs, kill_type')
    .in('id', ids)
  const rows = hlRes.data ?? []
  if (!rows.length) return undefined

  const producers = [...new Set(rows.map(r => r.producer).filter(Boolean) as string[])]
  const killTypes = rows.map(r => r.kill_type).filter(Boolean) as string[]
  const killType  = killTypes.includes('Custom') ? 'Custom' : killTypes.includes('USDA') ? 'USDA' : null
  const hcw = rows.reduce((s, r) => s + (Number(r.hot_carcass_weight_lbs) || 0), 0)

  return {
    producer: producers.join(' / ') || null,
    hangingWeightLbs: hcw > 0 ? Math.round(hcw) : null,
    killType,
  }
}

// The customer's own cutting instruction for the animal in this box, reached on
// keys rather than names — the box says "Bill Schiffer 207#" while the cut card
// says "Billy Schiffer", so only the appointment id joins them reliably.
async function resolveCuttingInstruction(box: BoxRecord): Promise<Record<string, unknown> | null> {
  const inputs = await supabase
    .from('processing_inputs')
    .select('linked_harvest_id')
    .eq('customer_name', box.customer_name)
    .eq('pack_date', box.pack_date)
    .not('linked_harvest_id', 'is', null)
  const ids = [...new Set((inputs.data ?? []).map(r => r.linked_harvest_id).filter(Boolean))]
  if (!ids.length) return null

  const hl = await supabase.from('harvest_log').select('appointment_id').in('id', ids)
  const appts = [...new Set((hl.data ?? []).map(r => r.appointment_id).filter(Boolean))]
  if (!appts.length) return null

  const ci = await supabase
    .from('cutting_instructions')
    .select('data')
    .in('appointment_id', appts)
    .order('last_modified', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (ci.data?.data ?? null) as Record<string, unknown> | null
}

// Decide what this box is for and remember it. Assignment is sticky: once a box
// has started filling an order, reprinting its tag must not move it.
async function resolveWIPIntent(box: BoxRecord, items: { name: string }[]): Promise<string | null> {
  if (box.wip_intent_label) return box.wip_intent_label

  const data = await resolveCuttingInstruction(box)
  if (!data) return null

  const product = classifyBoxProduct(items)
  let assignment: { key: string; label: string } | null = null

  if (product === 'round') {
    const jerky = roundJerkyLabel(data)
    if (jerky) assignment = { key: 'round#jerky', label: jerky }
  }

  if (!assignment) {
    const orders = parseSmokehouseOrders(data)
    if (orders.length) {
      // What the customer's other boxes have already committed to each order.
      const siblings = await supabase
        .from('boxes')
        .select('id, wip_intent_key, total_weight_lbs')
        .eq('customer_name', box.customer_name)
        .eq('pack_date', box.pack_date)
        .not('wip_intent_key', 'is', null)

      const assigned: Record<string, number> = {}
      for (const s of siblings.data ?? []) {
        if (s.id === box.id) continue
        const k = String(s.wip_intent_key)
        assigned[k] = (assigned[k] ?? 0) + (Number(s.total_weight_lbs) || 0)
      }
      assignment = allocateIntent(orders, assigned, Number(box.total_weight_lbs) || 0)
    }
  }

  if (!assignment) return null

  await supabase
    .from('boxes')
    .update({ wip_intent_key: assignment.key, wip_intent_label: assignment.label })
    .eq('id', box.id)

  return assignment.label
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const box_id = searchParams.get('box_id')
  if (!box_id) return NextResponse.json({ error: 'box_id required' }, { status: 400 })

  const [boxRes, scansRes] = await Promise.all([
    supabase.from('boxes').select('*').eq('id', box_id).single(),
    supabase.from('box_scans').select('*').eq('box_id', box_id),
  ])

  if (boxRes.error)   return NextResponse.json({ error: boxRes.error.message },   { status: 500 })
  if (scansRes.error) return NextResponse.json({ error: scansRes.error.message }, { status: 500 })

  const box   = boxRes.data   as BoxRecord
  const scans = scansRes.data as BoxScan[]

  // Resolve the animal behind this box from the carcass scans of its packing
  // session (customer + pack date): processing_inputs.linked_harvest_id points
  // at the harvest record, which carries producer, hanging weight and kill type.
  const animal = await resolveAnimal(box)

  // Kill type drives the compliance mark: Custom exempt can't carry the USDA
  // mark and must read NOT FOR SALE. Unknown defaults to USDA on (Charlie).
  // ?usda / ?nfs still override per-print for the odd unresolved case.
  const kt = animal?.killType
  const usdaParam = searchParams.get('usda')
  const nfsParam  = searchParams.get('nfs')
  const flags: LabelFlags = {
    usda_bug:      usdaParam != null ? usdaParam !== '0' : kt !== 'Custom',
    not_for_sale:  nfsParam  != null ? nfsParam === '1'  : kt === 'Custom',
    retail_exempt: searchParams.get('exempt') === '1',
  }

  const format = searchParams.get('format')
  const useWIP = format === 'wip' || (format == null && await isWIPBox(box))
  const useCMB = format === 'cmb' || (!useWIP && isCMBCustomer(box.customer_name) && format !== 'std')

  // The WIP tag carries the same inspection flags as the finished box label, so
  // value add can see what level the product left the processing room under.
  let html: string
  if (useWIP) {
    const base   = wipDataFromBox(box, scans, animal)
    const intent = await resolveWIPIntent(box, base.items)
    html = generateWIPLabel(intent ? { ...base, intent } : base, flags)
  } else if (useCMB) {
    html = generateCMBLabel(box, scans, { productGtin: searchParams.get('product'), lot: searchParams.get('lot') })
  } else {
    html = generateLabel(box, scans, flags, animal)
  }

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
