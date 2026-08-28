export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
// v_producer_customer_ties carries customer names and ids. A view reads its
// base tables with the VIEW OWNER's rights, so RLS on `customers` does not
// protect it — the anon grant has to come off the view itself, which means
// this read moves to the service role. Server-side only.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { aliasMap, nameKeyWith, type CustomerNameAlias } from '@/lib/nameKey'
import { buildSheetCarcassIndex, sheetSlots, type AssignmentRow, type CarcassRow } from '@/lib/sheetCarcasses'
import { extractValueAdd } from '@/lib/valueAdd'
import { cureProductFitsSpecies } from '@/lib/cureLoad'

export const dynamic = 'force-dynamic'

// GET /api/reports?type=harvest|processing|orders|receiving&from=YYYY-MM-DD&to=YYYY-MM-DD
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const type = searchParams.get('type') ?? 'harvest'
  const from = searchParams.get('from') ?? ''
  const to   = searchParams.get('to')   ?? ''

  if (type === 'harvest') {
    let q = supabase
      .from('harvest_log')
      .select('harvest_date,species,carcass_tag,sex,breed,live_weight_lbs,hot_carcass_weight_lbs,yield_pct,ccp_pass,performed_by,producer,notes')
      .order('harvest_date', { ascending: false })
    if (from) q = q.gte('harvest_date', from)
    if (to)   q = q.lte('harvest_date', to)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (type === 'processing') {
    let q = supabase
      .from('processing_records')
      .select('*')
      .order('processed_at', { ascending: false })
    if (from) q = q.gte('processed_at', `${from}T00:00:00`)
    if (to)   q = q.lte('processed_at', `${to}T23:59:59`)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (type === 'orders') {
    let q = supabase
      .from('retail_orders')
      .select('id,order_date,due_date,customer_name,status,fulfillment_type,taken_by,notes,retail_order_items(item_name,unit,qty_ordered,qty_filled,plu_number)')
      .order('order_date', { ascending: false })
    if (from) q = q.gte('order_date', from)
    if (to)   q = q.lte('order_date', to)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (type === 'receiving') {
    const results: Record<string, unknown>[] = []

    let aq = supabase
      .from('animal_receiving_log')
      .select('received_at,ear_tag,sex,breed,live_weight_lbs,received_by,health_cert_no,brand_insp_no,notes')
      // Removed rows only exist to hold a carcass number — never received stock.
      .neq('status', 'removed')
      .order('received_at', { ascending: false })
    if (from) aq = aq.gte('received_at', `${from}T00:00:00`)
    if (to)   aq = aq.lte('received_at', `${to}T23:59:59`)
    const { data: animals } = await aq
    ;(animals ?? []).forEach(r => results.push({ ...r, record_type: 'Animal' }))

    let bq = supabase
      .from('box_receiving_log')
      .select('received_at,vendor,product,quantity,weight_lbs,invoice_no,lot_no,temp_f,received_by,notes')
      .order('received_at', { ascending: false })
    if (from) bq = bq.gte('received_at', `${from}T00:00:00`)
    if (to)   bq = bq.lte('received_at', `${to}T23:59:59`)
    const { data: boxes } = await bq
    ;(boxes ?? []).forEach(r => results.push({ ...r, record_type: 'Box Product' }))

    return NextResponse.json(results)
  }

  if (type === 'producer_customer') {
    // One row per (animal × cut-customer tie) from v_producer_customer_ties.
    // Producer is on the animal; the customer is the physical carcass
    // assignment when there is one, else the customer booked on the appointment.
    let q = supabaseAdmin
      .from('v_producer_customer_ties')
      .select('harvest_date,species,kill_order,carcass_tag,ear_tag,sex,breed,kill_type,half_1_weight_lbs,half_2_weight_lbs,hanging_weight_lbs,producer,producer_id,customer_name,customer_id,portion,assigned,has_cut_sheet,payment_responsibility,producer_differs,harvest_log_id')
      .order('harvest_date', { ascending: false })
    if (from) q = q.gte('harvest_date', from)
    if (to)   q = q.lte('harvest_date', to)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  if (type === 'value_add') {
    // Who ordered which value-add product, from the CUT SHEETS (what the
    // customer asked for), not the packed scans — the source of truth before
    // anything is made. One object per cut sheet with its value-add items; the
    // page pivots them into a customer × product table.
    const [{ data: cis, error: ciErr }, { data: appts }, { data: cureTags }] = await Promise.all([
      supabase.from('cutting_instructions').select('id, customer_name, species, data, status').neq('status', 'archived'),
      supabase.from('harvest_appointments').select('id, harvest_date, customers'),
      supabase.from('cure_tags').select('tag_number, product, customer_name, status, linked_harvest_id'),
    ])
    // What the floor's shorthand stands for — see lib/nameKey. Read separately
    // so a failure here degrades to plain word-matching instead of blanking the
    // whole report.
    const { data: aliasRows } = await supabase
      .from('customer_name_aliases').select('alias, expands_to')
    const aliases = aliasMap((aliasRows ?? []) as CustomerNameAlias[])
    const key = (raw: string | null | undefined) => nameKeyWith(raw, aliases)
    if (ciErr) return NextResponse.json({ error: ciErr.message }, { status: 500 })

    // Seal tags by customer — the ACTUAL pieces riding through the cure cooler,
    // shown against what the sheet ordered. Tags know their customer, not which
    // of a customer's animals, so a rare multi-sheet customer repeats them.
    //
    // Matched on nameKey() rather than the raw string. The office types the cut
    // sheet and the floor types the cure tag, so the two spellings rarely agree:
    // an exact match lost every tag Kristin had, and her row showed a hanging
    // weight with no pieces against it (Charlie, 2026-08-27). The key closes
    // case, spacing, punctuation, word order and the floor's trailing "2" for a
    // second animal — it cannot close an abbreviation, so whatever is left over
    // is reported below instead of being dropped on the floor.
    const tagsByName = new Map<string, {
      tag_number: string; product: string; status: string; linked_harvest_id: string | null
    }[]>()
    const tagNamesByKey = new Map<string, Set<string>>()
    for (const t of cureTags ?? []) {
      const raw = String(t.customer_name ?? '').trim()
      const k = key(raw)
      const list = tagsByName.get(k) ?? []
      list.push({
        tag_number: String(t.tag_number), product: String(t.product), status: String(t.status),
        linked_harvest_id: t.linked_harvest_id ? String(t.linked_harvest_id) : null,
      })
      tagsByName.set(k, list)
      const names = tagNamesByKey.get(k) ?? new Set<string>()
      names.add(raw)
      tagNamesByKey.set(k, names)
    }

    // Which animals each sheet is about, and what they weigh — see
    // lib/sheetCarcasses. Scoped to the linked check-ins so neither table is
    // read whole as they grow.
    const slots = sheetSlots(appts)
    const apptIds = slots.appointmentIds
    const [{ data: logs }, { data: asgs }] = apptIds.length
      ? await Promise.all([
          supabase.from('harvest_log')
            .select('id, appointment_id, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
            .in('appointment_id', apptIds),
          supabase.from('carcass_assignments')
            .select('harvest_log_id, appointment_id, appointment_customer_id, linked_cutting_instruction_id')
            .in('appointment_id', apptIds),
        ])
      : [{ data: [] as CarcassRow[] }, { data: [] as AssignmentRow[] }]

    // A buyer can be moved onto an animal booked under a sibling check-in, so
    // an assignment may point outside the set just read. Pull those in too.
    const known = new Set((logs ?? []).map(l => String(l.id)))
    const strayIds = [...new Set((asgs ?? [])
      .map(a => String(a.harvest_log_id ?? ''))
      .filter(id => id && !known.has(id)))]
    const strays = strayIds.length
      ? (await supabase.from('harvest_log')
          .select('id, appointment_id, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
          .in('id', strayIds)).data ?? []
      : []

    const carcassIdx = buildSheetCarcassIndex(slots, asgs, [...(logs ?? []), ...strays])
    const dateByCi = slots.dateByCi

    const rows = (cis ?? []).map(ci => {
      const data = ci.data as { killDate?: string; portion?: string } | null
      const kd = data?.killDate
      const date = dateByCi.get(ci.id as string) ?? (kd && kd !== 'Unknown' ? kd : null)
      const carcassIds = carcassIdx.carcassesFor(ci.id as string)
      const sheetCarcassIds = new Set(carcassIds)
      return {
        id:            ci.id,
        customer_name: ci.customer_name,
        species:       ci.species,
        date,
        portion:       data?.portion ?? null,
        // Whole-carcass hanging weights, the way they print on the cut card —
        // portion rides alongside rather than scaling them. One entry per
        // animal, carrying its id so a split animal counts once in a total.
        carcasses:     carcassIds.map(id => ({ id, lbs: carcassIdx.weightOf(id) })),
        products:      extractValueAdd(ci.species as string, ci.data),
        // A tag PINNED to an animal shows only on the sheet that animal is on.
        // Everything else falls back to the customer, because a seal knows
        // whose piece it is and not which of their head — so an unpinned tag
        // appears against each of their sheets. That is tolerable for a hog
        // and a hog; it is nonsense for a ham on a lamb sheet, so products
        // that can ONLY come off a hog are held back. Bacon isn't one: beef
        // bacon is a real thing we cure.
        cure_tags:     (tagsByName.get(key(ci.customer_name as string)) ?? [])
                         .filter(t => t.linked_harvest_id
                           ? sheetCarcassIds.has(t.linked_harvest_id)
                           : cureProductFitsSpecies(t.product, ci.species as string)),
      }
    }).filter(r =>
      r.products.length > 0 &&
      (!from || (r.date && r.date >= from)) &&
      (!to   || (r.date && r.date <= to))
    )

    // Cure tags whose customer matches NO cut sheet at all.
    //
    // These used to vanish: the tag list was keyed off the sheet, so a piece
    // whose name didn't match simply wasn't drawn, and the row read as "this
    // customer has a hanging weight and nothing in the cure cooler" rather than
    // "we can't tell which of her sheets these belong to". Whether the name is
    // an abbreviation, a typo or a customer with no sheet on file is a question
    // for a person — so they are reported, not resolved.
    //
    // Matched against every live sheet, not just the ones inside the date
    // window, so narrowing the dates doesn't manufacture orphans.
    const sheetKeys = new Set((cis ?? []).map(ci => key(ci.customer_name as string)))
    const unmatchedTags = [...tagsByName.entries()]
      .filter(([key]) => !sheetKeys.has(key))
      .map(([key, tags]) => ({
        key,
        names: [...(tagNamesByKey.get(key) ?? [])].sort(),
        tags,
        curing: tags.filter(t => t.status === 'curing').length,
      }))
      .sort((a, b) => b.tags.length - a.tags.length)

    return NextResponse.json({ rows, unmatchedTags })
  }

  if (type === 'appointments') {
    let q = supabase
      .from('harvest_appointments')
      .select('harvest_date,species,head_count,source,status,notes,customers')
      .order('harvest_date', { ascending: false })
    if (from) q = q.gte('harvest_date', from)
    if (to)   q = q.lte('harvest_date', to)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  return NextResponse.json({ error: 'Unknown type' }, { status: 400 })
}
