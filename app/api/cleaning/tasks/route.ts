export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  FREQUENCIES, PRODUCTION_SIGNALS,
  type Frequency, type ProductionSignal, type InputType,
} from '@/lib/cleaning'

// The master checklist template.
//
// The validation here is the guard rail on the tiered, production-aware list:
// a weekly task with no weekday, or a trigger naming production the app can't
// actually detect, would silently never appear. Rejecting those at write time
// is the difference between a schedule people trust and one that quietly drops
// work.

const INPUT_TYPES: InputType[] = ['none', 'number', 'text']

export async function GET(req: NextRequest) {
  const url    = new URL(req.url)
  const areaId = url.searchParams.get('area')
  const all    = url.searchParams.get('all') === '1'

  let q = supabase
    .from('cleaning_tasks')
    .select('*, cleaning_areas(id, name, sort_order), cleaning_equipment(id, name)')
    .order('sort_order', { ascending: true })
  if (!all)    q = q.eq('active', true)
  if (areaId)  q = q.eq('area_id', areaId)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

/** Shared shape checks for POST and PATCH. Returns a message, or null if fine. */
function validate(b: Record<string, unknown>, partial: boolean): string | null {
  const has = (k: string) => b[k] !== undefined

  if (!partial && !String(b.title ?? '').trim()) return 'title required'
  if (!partial && !b.area_id)                     return 'area_id required'

  if (has('frequency') && !FREQUENCIES.includes(b.frequency as Frequency)) {
    return `frequency must be one of ${FREQUENCIES.join(', ')}`
  }
  if (has('input_type') && !INPUT_TYPES.includes(b.input_type as InputType)) {
    return `input_type must be one of ${INPUT_TYPES.join(', ')}`
  }

  const wd = b.weekday
  if (has('weekday') && wd !== null && (typeof wd !== 'number' || wd < 0 || wd > 6)) {
    return 'weekday must be 0 (Sunday) through 6 (Saturday)'
  }
  const dom = b.day_of_month
  if (has('day_of_month') && dom !== null && (typeof dom !== 'number' || dom < 1 || dom > 28)) {
    // Capped at 28 on purpose: a task set for the 31st would skip most months.
    return 'day_of_month must be 1–28'
  }

  if (has('production_triggers') && b.production_triggers !== null) {
    const trig = b.production_triggers
    if (!Array.isArray(trig)) return 'production_triggers must be a list'
    const bad = trig.filter(t => !PRODUCTION_SIGNALS.includes(t as ProductionSignal))
    if (bad.length) {
      // The specific failure worth naming: a trigger the detector can't prove
      // means the task never appears, and nobody would notice for months.
      return `the app can't detect ${bad.join(', ')} — triggers must be from: ${PRODUCTION_SIGNALS.join(', ')}`
    }
  }

  if (b.input_type === 'number' &&
      typeof b.input_min === 'number' && typeof b.input_max === 'number' &&
      b.input_min > b.input_max) {
    return 'the minimum reading is above the maximum'
  }

  return null
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  const bad  = validate(body, false)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_tasks')
    .insert([{
      area_id:      body.area_id,
      equipment_id: body.equipment_id ?? null,
      title:        body.title.trim(),
      detail:       body.detail?.trim() || null,
      sort_order:   body.sort_order ?? 100,
      frequency:    body.frequency ?? 'daily',
      weekday:      body.weekday ?? null,
      day_of_month: body.day_of_month ?? null,
      production_triggers: body.production_triggers?.length ? body.production_triggers : null,
      requires_photo: !!body.requires_photo,
      input_type:   body.input_type ?? 'none',
      input_label:  body.input_label?.trim() || null,
      input_unit:   body.input_unit?.trim()  || null,
      input_min:    body.input_min ?? null,
      input_max:    body.input_max ?? null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const bad = validate(updates, true)
  if (bad) return NextResponse.json({ error: bad }, { status: 400 })

  if (updates.production_triggers?.length === 0) updates.production_triggers = null

  const { data, error } = await supabase
    .from('cleaning_tasks').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Deactivated, never deleted: shift items point at the task they came from, and
// that link is how "when was this last done" is answered.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_tasks').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
