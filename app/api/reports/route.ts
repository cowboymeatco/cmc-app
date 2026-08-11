export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
// v_producer_customer_ties carries customer names and ids. A view reads its
// base tables with the VIEW OWNER's rights, so RLS on `customers` does not
// protect it — the anon grant has to come off the view itself, which means
// this read moves to the service role. Server-side only.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { extractValueAdd } from '@/lib/valueAdd'

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
      supabase.from('cure_tags').select('tag_number, product, customer_name, status'),
    ])
    if (ciErr) return NextResponse.json({ error: ciErr.message }, { status: 500 })

    // Seal tags by customer — the ACTUAL pieces riding through the cure cooler,
    // shown against what the sheet ordered. Tags know their customer, not which
    // of a customer's animals, so a rare multi-sheet customer repeats them.
    const tagsByName = new Map<string, { tag_number: string; product: string; status: string }[]>()
    for (const t of cureTags ?? []) {
      const key = String(t.customer_name ?? '').trim().toLowerCase()
      const list = tagsByName.get(key) ?? []
      list.push({ tag_number: String(t.tag_number), product: String(t.product), status: String(t.status) })
      tagsByName.set(key, list)
    }

    // ci id → scheduled harvest date, and ci id → the customer SLOTS it's linked
    // to (appointment + slot id), which is what points at a real carcass.
    const dateByCi  = new Map<string, string>()
    const slotsByCi = new Map<string, { apptId: string; slotId: string }[]>()
    for (const a of appts ?? []) {
      for (const c of (a.customers as Array<Record<string, unknown>> ?? [])) {
        const id = String(c?.linked_cutting_instruction_id ?? '')
        if (!id) continue
        if (a.harvest_date) dateByCi.set(id, a.harvest_date as string)
        const list = slotsByCi.get(id) ?? []
        list.push({ apptId: String(a.id), slotId: String(c?.id ?? '') })
        slotsByCi.set(id, list)
      }
    }

    // Hanging weight per cut sheet — the same carcass resolution the printed cut
    // card uses (app/cutting-instructions): the explicit assignment for the
    // customer's slot, else the only animal on the check-in. A customer taking
    // more than one animal's worth is linked on several appointments, so the
    // weights of the DISTINCT carcasses add up. Scoped to the linked check-ins
    // so neither table is read whole as they grow.
    const apptIds = [...new Set([...slotsByCi.values()].flat().map(s => s.apptId))]
    const [{ data: logs }, { data: asgs }] = apptIds.length
      ? await Promise.all([
          supabase.from('harvest_log')
            .select('id, appointment_id, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
            .in('appointment_id', apptIds),
          supabase.from('carcass_assignments')
            .select('harvest_log_id, appointment_id, appointment_customer_id, linked_cutting_instruction_id')
            .in('appointment_id', apptIds),
        ])
      : [{ data: [] as Record<string, unknown>[] }, { data: [] as Record<string, unknown>[] }]

    // A buyer can be moved onto an animal booked under a sibling check-in, so an
    // assignment may point outside the set just read. Pull those in too.
    const wtByLog = new Map<string, number | null>()
    const logIdsOn = new Map<string, string[]>()   // appointment id → its carcasses
    const hang = (l: Record<string, unknown>) => {
      const hcw = l.hot_carcass_weight_lbs as number | null
      if (hcw != null) return Number(hcw)
      const h1 = l.half_1_weight_lbs as number | null
      const h2 = l.half_2_weight_lbs as number | null
      return h1 != null || h2 != null ? Number(h1 ?? 0) + Number(h2 ?? 0) : null
    }
    for (const l of logs ?? []) {
      wtByLog.set(String(l.id), hang(l))
      const list = logIdsOn.get(String(l.appointment_id)) ?? []
      list.push(String(l.id)); logIdsOn.set(String(l.appointment_id), list)
    }
    const strayIds = [...new Set((asgs ?? [])
      .map(a => String(a.harvest_log_id ?? ''))
      .filter(id => id && !wtByLog.has(id)))]
    if (strayIds.length) {
      const { data: strays } = await supabase.from('harvest_log')
        .select('id, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
        .in('id', strayIds)
      for (const l of strays ?? []) wtByLog.set(String(l.id), hang(l))
    }

    function carcassesFor(ciId: string): string[] {
      const out: string[] = []
      for (const { apptId, slotId } of slotsByCi.get(ciId) ?? []) {
        const asg = (asgs ?? []).find(a =>
          String(a.appointment_id) === apptId &&
          ((slotId && String(a.appointment_customer_id) === slotId) ||
           String(a.linked_cutting_instruction_id ?? '') === ciId))
        const onAppt = logIdsOn.get(apptId) ?? []
        // No assignment and more than one animal on the check-in — nobody knows
        // which carcass is theirs, so the weight stays blank rather than guessed.
        const logId = asg ? String(asg.harvest_log_id) : onAppt.length === 1 ? onAppt[0] : ''
        if (logId && !out.includes(logId)) out.push(logId)
      }
      return out
    }

    const rows = (cis ?? []).map(ci => {
      const data = ci.data as { killDate?: string; portion?: string } | null
      const kd = data?.killDate
      const date = dateByCi.get(ci.id as string) ?? (kd && kd !== 'Unknown' ? kd : null)
      return {
        id:            ci.id,
        customer_name: ci.customer_name,
        species:       ci.species,
        date,
        portion:       data?.portion ?? null,
        // Whole-carcass hanging weights, the way they print on the cut card —
        // portion rides alongside rather than scaling them. One entry per
        // animal, carrying its id so a split animal counts once in a total.
        carcasses:     carcassesFor(ci.id as string).map(id => ({ id, lbs: wtByLog.get(id) ?? null })),
        products:      extractValueAdd(ci.species as string, ci.data),
        cure_tags:     tagsByName.get(String(ci.customer_name ?? '').trim().toLowerCase()) ?? [],
      }
    }).filter(r =>
      r.products.length > 0 &&
      (!from || (r.date && r.date >= from)) &&
      (!to   || (r.date && r.date <= to))
    )

    return NextResponse.json(rows)
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
