export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
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
    let q = supabase
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
    const [{ data: cis, error: ciErr }, { data: appts }] = await Promise.all([
      supabase.from('cutting_instructions').select('id, customer_name, species, data, status').neq('status', 'archived'),
      supabase.from('harvest_appointments').select('harvest_date, customers'),
    ])
    if (ciErr) return NextResponse.json({ error: ciErr.message }, { status: 500 })

    // ci id → scheduled harvest date, from the appointment slot it's linked to.
    const dateByCi = new Map<string, string>()
    for (const a of appts ?? []) {
      for (const c of (a.customers as Array<Record<string, unknown>> ?? [])) {
        const id = String(c?.linked_cutting_instruction_id ?? '')
        if (id && a.harvest_date) dateByCi.set(id, a.harvest_date as string)
      }
    }

    const rows = (cis ?? []).map(ci => {
      const data = ci.data as { killDate?: string } | null
      const kd = data?.killDate
      const date = dateByCi.get(ci.id as string) ?? (kd && kd !== 'Unknown' ? kd : null)
      return {
        id:            ci.id,
        customer_name: ci.customer_name,
        species:       ci.species,
        date,
        products:      extractValueAdd(ci.species as string, ci.data),
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
