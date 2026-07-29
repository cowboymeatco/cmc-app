export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

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
    // Who got which value-add product, by pack (processing) date, from
    // v_value_add_output. Filtered on pack_date.
    let q = supabase
      .from('v_value_add_output')
      .select('customer_name,pack_date,plu_number,item_name,species,weight_lbs,pieces,boxes')
      .order('pack_date', { ascending: false })
    if (from) q = q.gte('pack_date', from)
    if (to)   q = q.lte('pack_date', to)
    const { data, error } = await q
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
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
