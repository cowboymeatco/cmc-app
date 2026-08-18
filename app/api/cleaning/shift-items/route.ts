export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import type { ItemStatus } from '@/lib/cleaning'

// PATCH /api/cleaning/shift-items — answer one item
// POST  /api/cleaning/shift-items — add an ad-hoc item to tonight's list
//
// Answering is the single most-used write in the whole tool: a wet thumb on a
// phone at 10pm. It has to be one round trip and it has to be idempotent, so
// double-taps and flaky signal retries can't corrupt the record.

const VALID: ItemStatus[] = ['pending', 'done', 'na', 'issue']

export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, status, by, by_id, note, value_num, value_text } = body as {
    id?: string; status?: ItemStatus; by?: string; by_id?: string
    note?: string; value_num?: number | null; value_text?: string | null
  }

  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  if (status && !VALID.includes(status)) {
    return NextResponse.json({ error: `status must be one of ${VALID.join(', ')}` }, { status: 400 })
  }

  const { data: item, error: findErr } = await supabase
    .from('cleaning_shift_items')
    .select('id, shift_id, requires_photo, input_type, status')
    .eq('id', id)
    .single()
  if (findErr || !item) return NextResponse.json({ error: 'item not found' }, { status: 404 })

  // Refuse to write into a closed night. The record for a shift stops moving
  // when the shift is closed — reopening it is a deliberate act with a name on
  // it, not something a stale phone tab does by accident.
  const { data: shift } = await supabase
    .from('cleaning_shifts').select('status').eq('id', item.shift_id).single()
  if (shift?.status === 'closed') {
    return NextResponse.json(
      { error: 'This shift is closed. Reopen it before changing anything.' },
      { status: 409 },
    )
  }

  const marking = status && status !== 'pending'

  // Attribution is the point of the named sign-in. An anonymous completion is
  // worth less than no completion, because it looks like a record and isn't.
  if (marking && !by?.trim()) {
    return NextResponse.json({ error: 'Pick your name before checking items off.' }, { status: 400 })
  }

  if (status === 'done' && item.requires_photo) {
    const { data: photos } = await supabase
      .from('cleaning_photos').select('id').eq('shift_item_id', id).limit(1)
    if (!photos?.length) {
      return NextResponse.json(
        { error: 'This one needs a photo before it can be checked off.', needs_photo: true },
        { status: 400 },
      )
    }
  }

  if (status === 'done' && item.input_type === 'number') {
    const n = typeof value_num === 'number' ? value_num : Number(value_num)
    if (value_num === null || value_num === undefined || Number.isNaN(n)) {
      return NextResponse.json({ error: 'Enter the reading before checking this off.' }, { status: 400 })
    }
  }

  const updates: Record<string, unknown> = {}
  if (status) {
    updates.status = status
    // Clearing back to pending clears the attribution with it — a half-erased
    // record that still names someone is worse than a clean blank.
    updates.done_by    = marking ? by!.trim() : null
    updates.done_by_id = marking ? (by_id ?? null) : null
    updates.done_at    = marking ? new Date().toISOString() : null
  }
  if (note       !== undefined) updates.note       = note?.trim() || null
  if (value_num  !== undefined) updates.value_num  = value_num ?? null
  if (value_text !== undefined) updates.value_text = value_text?.trim() || null

  const { data, error } = await supabase
    .from('cleaning_shift_items').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}

// Something that needs doing tonight but isn't on the template.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { shift_id, title, detail, area_name, asset_id, equipment_name, by } = body as {
    shift_id?: string; title?: string; detail?: string; area_name?: string
    asset_id?: string; equipment_name?: string; by?: string
  }

  if (!shift_id || !title?.trim()) {
    return NextResponse.json({ error: 'shift_id and title required' }, { status: 400 })
  }

  // Land it at the bottom of the list rather than interleaved — an added item
  // is new information and shouldn't hide in the middle of a list someone is
  // already halfway down.
  const { data: last } = await supabase
    .from('cleaning_shift_items').select('sort_order')
    .eq('shift_id', shift_id).order('sort_order', { ascending: false }).limit(1)

  const { data, error } = await supabase
    .from('cleaning_shift_items')
    .insert([{
      shift_id,
      title:          title.trim(),
      detail:         detail?.trim() || (by?.trim() ? `Added by ${by.trim()}` : null),
      area_name:      area_name?.trim() || 'Added tonight',
      asset_id:   asset_id ?? null,
      equipment_name: equipment_name ?? null,
      source:         'manual',
      sort_order:     ((last?.[0]?.sort_order as number) ?? 0) + 10,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json(data)
}
