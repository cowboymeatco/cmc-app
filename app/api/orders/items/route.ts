export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { syncPortalAdd, syncPortalQty, syncPortalRemove } from '@/lib/portalOrderSync'

// What a line edit may change. order_id and created_at are not on it: a line
// doesn't move between orders.
const EDITABLE = ['plu_number', 'item_name', 'unit', 'qty_ordered', 'qty_filled', 'notes', 'fresh_or_frozen'] as const

export const dynamic = 'force-dynamic'

// POST /api/orders/items â€” add a line item to an existing order
export async function POST(req: NextRequest) {
  const body = await req.json()

  const { data, error } = await supabaseAdmin
    .from('retail_order_items')
    .insert([{
      order_id:    body.order_id,
      plu_number:  body.plu_number  ?? null,
      item_name:   body.item_name,
      unit:        body.unit        ?? 'LB',
      qty_ordered: body.qty_ordered ?? 0,
      qty_filled:  body.qty_filled  ?? 0,
      notes:       body.notes       ?? '',
      // Only sent when the line differs from the order, so a database that
      // hasn't had the column added yet still takes an ordinary line.
      ...(body.fresh_or_frozen ? { fresh_or_frozen: body.fresh_or_frozen } : {}),
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const warning = await syncPortalAdd(data.order_id, data.plu_number, data.item_name, data.unit, Number(data.qty_ordered) || 0)
  return NextResponse.json(warning ? { ...data, portal_warning: warning } : data)
}

// PATCH /api/orders/items â€” update qty_filled (or other fields) on a line item
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id } = body
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const updates: Record<string, unknown> = {}
  for (const k of EDITABLE) if (k in body) updates[k] = body[k]
  if ('fresh_or_frozen' in updates && !updates.fresh_or_frozen) updates.fresh_or_frozen = null

  // The line as it was, so a rename or a new quantity can find its portal twin
  // under the old name.
  const { data: before } = await supabaseAdmin
    .from('retail_order_items').select('order_id, item_name, unit, qty_ordered').eq('id', id).maybeSingle()

  const { data, error } = await supabaseAdmin
    .from('retail_order_items')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  let warning: string | null = null
  if (before) {
    if (data.item_name !== before.item_name) {
      // A different item: off the portal order under the old name, on under the new.
      warning = await syncPortalRemove(before.order_id, before.item_name)
        ?? await syncPortalAdd(data.order_id, data.plu_number, data.item_name, data.unit, Number(data.qty_ordered) || 0)
    } else if (Number(data.qty_ordered) !== Number(before.qty_ordered) || data.unit !== before.unit) {
      warning = await syncPortalQty(data.order_id, data.item_name, data.unit, Number(data.qty_ordered) || 0)
    }
  }
  return NextResponse.json(warning ? { ...data, portal_warning: warning } : data)
}

// DELETE /api/orders/items?id=... â€” remove a line item
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data: before } = await supabaseAdmin
    .from('retail_order_items').select('order_id, item_name').eq('id', id).maybeSingle()

  const { error } = await supabaseAdmin
    .from('retail_order_items')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const warning = before ? await syncPortalRemove(before.order_id, before.item_name) : null
  return NextResponse.json(warning ? { ok: true, portal_warning: warning } : { ok: true })
}
