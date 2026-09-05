export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateLabel, parseRoll, LabelFlags, LabelAnimal, BoxRecord, BoxScan } from '@/lib/label'
import { generateCMBLabel } from '@/lib/labelCMB'
import { generateWIPLabel, wipDataFromBox, isWIPBoxLabel } from '@/lib/labelWIP'
import { generatePretag } from '@/lib/labelPretag'
import { resolveCuttingInstruction, CIMatch } from '@/lib/cutCardLookup'
import { parseSmokehouseOrders, roundJerkyLabel, classifyBoxProduct, allocateIntent, primalValueAdd, isSameParty, CICard } from '@/lib/wipIntent'

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

function ordersAcross(cards: CICard[]) {
  return cards.flatMap((c, i) =>
    parseSmokehouseOrders(c.data).map(o => ({ ...o, key: cards.length > 1 ? `${i}:${o.key}` : o.key })))
}

/**
 * One answer from several cards, or none. A card that asks for nothing doesn't
 * vote — a customer whose whole hog is pulled pork and whose half is plain
 * roasts has exactly one place for a shoulder that's been sent to value add.
 * Two cards asking for *different* things is a real fork, and that goes back to
 * the crew rather than getting guessed.
 */
function agreedAssignment(
  cards: CICard[],
  fn: (data: Record<string, unknown>) => { key: string; label: string } | null,
): { key: string; label: string } | null {
  const hits = cards.map(c => fn(c.data)).filter(Boolean) as { key: string; label: string }[]
  const distinct = new Map(hits.map(h => [h.label, h]))
  return distinct.size === 1 ? [...distinct.values()][0] : null
}

type WIPIntentHit = {
  // null when the cut card has value-add on it but nothing can say which order
  // THIS box serves — the tag then keeps the crew's own intent and shows the
  // orders as scope.
  label:  string | null
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
    // Scope resolves for every box, not just trim ones — a round or shoulder
    // tub still belongs to an animal that owes a smokehouse order, and the crew
    // reads that list to know what else is coming (Jill, 2026-08-20).
    let orders: WIPIntentHit['orders'] = []
    const match = await resolveCuttingInstruction(box.customer_name, box.pack_date)
    if (match) {
      orders = ordersAcross(match.cards)
        .map(o => ({ label: o.label, lbs: o.lbs, current: o.key === box.wip_intent_key }))
    }
    return { label: box.wip_intent_label, source: '', orders }
  }

  const match = await resolveCuttingInstruction(box.customer_name, box.pack_date)
  if (!match) return null
  const cards = match.cards

  let assignment: { key: string; label: string } | null = null
  // The customer's WHOLE value-add order, resolved for every box — not just the
  // trim ones. This used to be filled in only on the trim path, so a tub of
  // round or shoulder printed a bare intent with no scope, and a box we
  // couldn't classify printed nothing at all: "not pulling the value add on to
  // the WIP label" (Jill, 2026-08-20). Scope is not assignment — the crew needs
  // to see what the animal owes even when nothing here can say which order this
  // particular tub starts.
  let allOrders: ReturnType<typeof ordersAcross> = ordersAcross(cards)

  if (product === 'round') {
    assignment = agreedAssignment(cards, d => {
      const jerky = roundJerkyLabel(d)
      return jerky ? { key: 'round#jerky', label: jerky } : null
    })
  }

  // Only trim feeds the smokehouse orders. A box of chops or roasts tagged WIP
  // — which happens whenever a whole session is moved to the Value Add queue —
  // must not consume the customer's brat order.
  if (!assignment && product === 'trim') {
    const orders = allOrders
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
  if (!assignment) assignment = agreedAssignment(cards, d => primalValueAdd(d, product))

  // Nothing here can say which order this tub starts — a mixed box, or a card
  // whose only value-add is on a primal this box isn't holding. Print the scope
  // anyway and leave the intent as whatever the crew wrote on the box: a
  // GUESSED intent on a WIP tag is how the wrong thing gets made, but printing
  // nothing is how the smokehouse never hears about the order at all.
  if (!assignment) {
    return allOrders.length
      ? {
          label:  null,
          source: match.via,
          orders: allOrders.map(o => ({ label: o.label, lbs: o.lbs, current: false })),
        }
      : null
  }

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

  // Which printer this is coming out of — the packing bench's 4in thermal, or a
  // Brother QL on the 62mm roll. Set per device on the scanner (?roll=62mm).
  const roll = parseRoll(searchParams.get('roll'))

  // The packing tag is pure wayfinding — a number for the inside of the lid,
  // printed before the box holds anything. It needs no scans, no carcass and no
  // compliance mark, so it short-circuits ahead of all that resolution.
  if (searchParams.get('format') === 'pretag') {
    return new NextResponse(generatePretag(box, roll), {
      headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' },
    })
  }

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
  //   3. The session's declared Box Type (USDA / Retail Exempt / Custom / Pet Food).
  //   4. The scanned carcass USDA kill type.
  //   5. Default: USDA on (Charlie's rule for the unresolved case).
  // Only Custom reads NOT FOR SALE; Retail Exempt and Pet Food carry no mark.
  // Sessions typed before 2026-09-04 may still say 'CMC' — that was the
  // ownership flag riding in this column and it reads as USDA (inspected, for
  // sale); ownership now lives in processing_sessions.cmc and prints nothing.
  const kt = animal?.killType
  const isCustom =
    kt === 'Custom' ? true :          // legal floor — can't be sold
    sessionType === 'Custom' ? true : // crew declared custom-exempt
    false                             // USDA / CMC / unresolved → USDA-on
  // Animal food is its own thing: it's sold (so not NOT FOR SALE) but it may not
  // carry the mark of inspection, and it must say NOT FOR HUMAN CONSUMPTION.
  // A pet-food session off a custom-exempt animal gets both statements.
  const isPetFood = sessionType === 'Pet Food'
  const usdaParam = searchParams.get('usda')
  const nfsParam  = searchParams.get('nfs')
  const petParam  = searchParams.get('pet')
  const exemptParam = searchParams.get('exempt')
  const notForHuman = petParam != null ? petParam === '1' : isPetFood
  const flags: LabelFlags = {
    usda_bug:      usdaParam != null ? usdaParam !== '0' : (!isCustom && !notForHuman),
    not_for_sale:  nfsParam  != null ? nfsParam === '1'  : isCustom,
    not_for_human: notForHuman,
    // Retail Exempt is a session type since 2026-09-04 (it used to be a toggle
    // on top of USDA, which promised a mark the label could not carry). The
    // per-print param still wins; absent, the session type decides.
    retail_exempt: exemptParam != null ? exemptParam === '1' : sessionType === 'Retail Exempt',
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
      hit ? { ...base, intent: hit.label ?? base.intent, intentSource: hit.source, orders: hit.orders } : base,
      flags, roll)
  } else if (useCMB) {
    // The US Foods case label is 4x6 because US Foods says so — the dock scans
    // it against a spec we don't own. It ignores ?roll rather than printing a
    // narrow label that would be rejected at receiving.
    html = generateCMBLabel(box, scans, { productGtin: searchParams.get('product'), lot: searchParams.get('lot') })
  } else {
    html = generateLabel(box, scans, flags, animal, roll)
  }

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html;charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
