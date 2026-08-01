export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateLabel, LabelFlags, LabelAnimal, BoxRecord, BoxScan } from '@/lib/label'
import { generateCMBLabel } from '@/lib/labelCMB'
import { generateWIPLabel, wipDataFromBox, isWIPBoxLabel } from '@/lib/labelWIP'
import { parseSmokehouseOrders, roundJerkyLabel, classifyBoxProduct, allocateIntent, primalValueAdd } from '@/lib/wipIntent'

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

// The compliance/ownership type the crew declared up front for the whole packing
// session (scanner "Box Type" control). Keyed on customer + pack date like every
// other session lookup. Null when never set — the label then falls back to the
// scanned carcass kill type, else USDA-on.
async function resolveSessionBoxType(box: BoxRecord): Promise<string | null> {
  const { data } = await supabase
    .from('processing_sessions')
    .select('box_type')
    .eq('customer_name', box.customer_name)
    .eq('session_date', box.pack_date)
    .maybeSingle()
  return (data?.box_type as string | null) ?? null
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

// Names as the floor writes them vs. as the cut card holds them: the box says
// "Travis Buck 204#", the card says "Travis Buck". Strip the hanging weight and
// punctuation so the two can be compared.
const normName = (n: string) =>
  (n || '')
    .replace(/\s*[·\-]?\s*\d{2,4}\s*(#|lbs?)?\s*$/i, '')
    .toLowerCase()
    .replace(/[^a-z0-9 ]/g, '')
    .replace(/\s+/g, ' ')
    .trim()

interface CIMatch { data: Record<string, unknown>; via: string; name: string }

// Find the customer's cut card. Tries the databased links first, but in
// practice most sessions have neither — carcass_assignments has a handful of
// rows and no cutting instruction carries an appointment_id — so the name match
// is what actually connects a box to its orders today. How it matched gets
// printed on the tag, because a name match deserves to be visible.
async function resolveCuttingInstruction(box: BoxRecord): Promise<CIMatch | null> {
  const pick = (row: { data?: unknown; customer_name?: string } | null, via: string): CIMatch | null =>
    row?.data ? { data: row.data as Record<string, unknown>, via, name: row.customer_name ?? '' } : null

  // 1. Carcass scanned into this session → the assignment made at check-in.
  const inputs = await supabase
    .from('processing_inputs')
    .select('linked_harvest_id')
    .eq('customer_name', box.customer_name)
    .eq('pack_date', box.pack_date)
    .not('linked_harvest_id', 'is', null)
  const harvestIds = [...new Set((inputs.data ?? []).map(r => r.linked_harvest_id).filter(Boolean))]

  if (harvestIds.length) {
    const ca = await supabase
      .from('carcass_assignments')
      .select('linked_cutting_instruction_id')
      .in('harvest_log_id', harvestIds)
      .not('linked_cutting_instruction_id', 'is', null)
    const ciIds = [...new Set((ca.data ?? []).map(r => r.linked_cutting_instruction_id).filter(Boolean))]
    if (ciIds.length === 1) {
      const ci = await supabase.from('cutting_instructions').select('data, customer_name').eq('id', ciIds[0]).maybeSingle()
      const hit = pick(ci.data, 'carcass')
      if (hit) return hit
    }

    // 2. Appointment key, for once cut cards start carrying one.
    const hl = await supabase.from('harvest_log').select('appointment_id').in('id', harvestIds)
    const appts = [...new Set((hl.data ?? []).map(r => r.appointment_id).filter(Boolean))]
    if (appts.length) {
      const ci = await supabase
        .from('cutting_instructions')
        .select('data, customer_name')
        .in('appointment_id', appts)
        .order('last_modified', { ascending: false })
        .limit(1)
        .maybeSingle()
      const hit = pick(ci.data, 'appointment')
      if (hit) return hit
    }
  }

  // 3. Name. Only when exactly one card matches — two customers sharing a name
  // means we cook somebody else's order, so leave it to the crew.
  const target = normName(box.customer_name)
  if (!target) return null
  const all = await supabase.from('cutting_instructions').select('data, customer_name, species')
  const matches = (all.data ?? []).filter(r => normName(r.customer_name ?? '') === target)
  if (matches.length !== 1) return null
  return pick(matches[0], 'name')
}

type WIPIntentHit = {
  label:  string
  source: string
  // Full order list off the cut card, for the tag's scope block. The assigned
  // order is flagged so the crew can see where this box lands in the whole.
  orders: { label: string; lbs: number | null; current: boolean }[]
}

// Decide what this box is for and remember it. Assignment is sticky: once a box
// has started filling an order, reprinting its tag must not move it.
async function resolveWIPIntent(box: BoxRecord, items: { name: string; weight?: number }[], boxLbs: number): Promise<WIPIntentHit | null> {
  const product = classifyBoxProduct(items)

  // Already assigned on an earlier print — reuse it verbatim. No source note:
  // the decision is settled, and how it was first reached is no longer news.
  // The order list still resolves fresh — it's scope, not assignment, and a
  // two-flavor order must show both flavors even on a reprint.
  if (box.wip_intent_label) {
    let orders: WIPIntentHit['orders'] = []
    if (product === 'trim') {
      const match = await resolveCuttingInstruction(box)
      if (match) {
        orders = parseSmokehouseOrders(match.data)
          .map(o => ({ label: o.label, lbs: o.lbs, current: o.key === box.wip_intent_key }))
      }
    }
    return { label: box.wip_intent_label, source: '', orders }
  }

  const match = await resolveCuttingInstruction(box)
  if (!match) return null
  const data = match.data

  let assignment: { key: string; label: string } | null = null
  let allOrders: ReturnType<typeof parseSmokehouseOrders> = []

  if (product === 'round') {
    const jerky = roundJerkyLabel(data)
    if (jerky) assignment = { key: 'round#jerky', label: jerky }
  }

  // Only trim feeds the smokehouse orders. A box of chops or roasts tagged WIP
  // — which happens whenever a whole session is moved to the Value Add queue —
  // must not consume the customer's brat order.
  if (!assignment && product === 'trim') {
    const orders = parseSmokehouseOrders(data)
    allOrders = orders
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
      assignment = allocateIntent(orders, assigned, boxLbs)
    }
  }

  // A box of a primal — shoulder roasts, chops, ham, belly — carries whatever
  // value-add the customer ordered ON that cut. This is a separate pool from the
  // trim orders: pulled pork is made from the shoulder that's in the box, so it
  // never competes for the brat pounds and never needs allocating.
  if (!assignment) assignment = primalValueAdd(data, product)

  if (!assignment) return null

  // Only remember the assignment once the box is closed. An open box is still
  // being filled, so its weight — and therefore what it can cover — is not
  // final; freezing it now would hand the next order a number that changes.
  if (box.is_closed) {
    await supabase
      .from('boxes')
      .update({ wip_intent_key: assignment.key, wip_intent_label: assignment.label })
      .eq('id', box.id)
  }

  return {
    label:  assignment.label,
    source: match.via,
    orders: allOrders.map(o => ({ label: o.label, lbs: o.lbs, current: o.key === assignment!.key })),
  }
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
  const [animal, sessionType] = await Promise.all([
    resolveAnimal(box),
    resolveSessionBoxType(box),
  ])

  // Compliance mark precedence:
  //   1. ?usda / ?nfs URL params — an explicit per-print override, always win.
  //   2. A carcass scanned as Custom — custom-exempt meat can't be sold, so this
  //      is a legal floor: NOT FOR SALE even if the session was tagged USDA/CMC.
  //   3. The session's declared Box Type (USDA / Custom / CMC).
  //   4. The scanned carcass USDA kill type.
  //   5. Default: USDA on (Charlie's rule for the unresolved case).
  // USDA and CMC both carry the USDA bug (both are inspected, for sale); only
  // Custom reads NOT FOR SALE.
  const kt = animal?.killType
  const isCustom =
    kt === 'Custom' ? true :          // legal floor — can't be sold
    sessionType === 'Custom' ? true : // crew declared custom-exempt
    false                             // USDA / CMC / unresolved → USDA-on
  const usdaParam = searchParams.get('usda')
  const nfsParam  = searchParams.get('nfs')
  const flags: LabelFlags = {
    usda_bug:      usdaParam != null ? usdaParam !== '0' : !isCustom,
    not_for_sale:  nfsParam  != null ? nfsParam === '1'  : isCustom,
    retail_exempt: searchParams.get('exempt') === '1',
  }

  const format = searchParams.get('format')
  const useWIP = format === 'wip' || (format == null && await isWIPBox(box))
  const useCMB = format === 'cmb' || (!useWIP && isCMBCustomer(box.customer_name) && format !== 'std')

  // The WIP tag carries the same inspection flags as the finished box label, so
  // value add can see what level the product left the processing room under.
  let html: string
  if (useWIP) {
    const base = wipDataFromBox(box, scans, animal)
    const hit  = await resolveWIPIntent(box, base.items, base.weightLbs ?? 0)
    html = generateWIPLabel(
      hit ? { ...base, intent: hit.label, intentSource: hit.source, orders: hit.orders } : base,
      flags)
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
