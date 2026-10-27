export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate } from '@/lib/dates'
import { JOB_WITH_LOAD, isUniqueViolation, jobBySeal, nextTagCode, sealConflict, tapLoad } from '@/lib/valueAddLoads'

export const dynamic = 'force-dynamic'

// GET /api/value-add â€” list all jobs (optionally filtered by status or order)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status   = searchParams.get('status')
  const order_id = searchParams.get('order_id')

  // ?seal=0036013 — the open job wearing this seal (or null), so a seal scanned
  // at the house door or the packing bench can say whose product it is.
  const seal = searchParams.get('seal')
  if (seal) {
    try { return NextResponse.json(await jobBySeal(seal.trim())) }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }) }
  }

  let query = supabaseAdmin
    .from('value_add_jobs')
    .select(JOB_WITH_LOAD)
    .order('requested_date', { ascending: false })

  if (status)   query = query.eq('status', status)
  if (order_id) query = query.eq('linked_order_id', order_id)

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// POST /api/value-add â€” create a new value-add job
export async function POST(req: NextRequest) {
  const body = await req.json()
  const requestedDate = body.requested_date ?? isoDate()

  const { data, error } = await supabaseAdmin
    .from('value_add_jobs')
    .insert([{
      job_type:                      body.job_type                      ?? 'other',
      description:                   body.description                   ?? '',
      source_type:                   body.source_type                   ?? 'general',
      linked_order_id:               body.linked_order_id               ?? null,
      linked_cutting_instruction_id: body.linked_cutting_instruction_id ?? null,
      output_plu:                    body.output_plu                    ?? null,
      output_item_name:              body.output_item_name              ?? '',
      weight_in_lbs:                 body.weight_in_lbs                 ?? null,
      weight_out_lbs:                body.weight_out_lbs                ?? null,
      assigned_to:                   body.assigned_to                   ?? '',
      requested_date:                requestedDate,
      completed_date:                body.completed_date                ?? null,
      status:                        'pending',
      notes:                         body.notes                         ?? '',
      customer_name:                 body.customer_name                 ?? null,
      source_description:            body.source_description            ?? null,
      scheduled_start:               body.scheduled_start               ?? null,
      predicted_minutes:             body.predicted_minutes             ?? null,
      profile_key:                   body.profile_key                   ?? null,
      batch_count:                   body.batch_count                   ?? null,
      resource:                      body.resource                      ?? 'smokehouse',
      tag_code:                      await nextTagCode(requestedDate),
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/value-add â€” update a job (weight in/out, status, etc.)
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  // Auto-set completed_date when status flips to complete
  if (updates.status === 'complete' && !updates.completed_date) {
    updates.completed_date = isoDate()
  }

  // A seal is one job's: refuse one that is live on a cure tag or on another
  // open job, rather than letting two customers' sticks answer to one number.
  if ('seal_number' in updates) {
    const seal = String(updates.seal_number ?? '').trim()
    updates.seal_number = seal || null
    if (seal) {
      const why = await sealConflict(seal, String(id))
      if (why) return NextResponse.json({ error: why }, { status: 409 })
    }
  }

  // In/out taps move the whole load (lib/valueAddLoads.ts). Anything else in
  // the same request still lands on this one job.
  let tapped = null
  if ('smoke_in_at' in updates || 'smoke_out_at' in updates) {
    const { smoke_in_at, smoke_out_at, status, ...rest } = updates
    try {
      tapped = await tapLoad(String(id), {
        ...('smoke_in_at'  in updates ? { smoke_in_at }  : {}),
        ...('smoke_out_at' in updates ? { smoke_out_at } : {}),
      }, status ?? null)
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'tap failed' }, { status: 500 })
    }
    if (!tapped) return NextResponse.json({ error: 'job not found' }, { status: 404 })
    if (Object.keys(rest).length === 0) return NextResponse.json(tapped)
    for (const k of Object.keys(updates)) delete updates[k]
    Object.assign(updates, rest)
  }

  const { data, error } = await supabaseAdmin
    .from('value_add_jobs')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', id)
    .select(JOB_WITH_LOAD)
    .single()

  if (error) {
    if (isUniqueViolation(error) && 'seal_number' in updates) {
      return NextResponse.json({ error: `Seal ${updates.seal_number} is already on another job` }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

// PUT /api/value-add — commit a whole schedule at once.
//
// The planner lays out the entire house queue and the crew presses Publish
// once; sending one request per job would let a dropped connection leave half
// a schedule on the board. Body: { schedule: [{ id, scheduled_start,
// predicted_minutes, profile_key, batch_count, schedule_locked }] }.
export async function PUT(req: NextRequest) {
  const body = await req.json()
  const rows = Array.isArray(body.schedule) ? body.schedule : null
  if (!rows) return NextResponse.json({ error: 'schedule array required' }, { status: 400 })

  const now = new Date().toISOString()
  const results = await Promise.all(rows.map((r: Record<string, unknown>) =>
    supabaseAdmin
      .from('value_add_jobs')
      .update({
        scheduled_start:   r.scheduled_start   ?? null,
        predicted_minutes: r.predicted_minutes ?? null,
        profile_key:       r.profile_key       ?? null,
        batch_count:       r.batch_count       ?? null,
        resource:          r.resource          ?? 'smokehouse',
        schedule_locked:   r.schedule_locked   ?? false,
        updated_at:        now,
      })
      .eq('id', r.id)
      .select()
      .single()
  ))

  const failed = results.filter(r => r.error)
  if (failed.length) {
    return NextResponse.json(
      { error: failed[0].error?.message, failed: failed.length, saved: rows.length - failed.length },
      { status: 500 }
    )
  }
  return NextResponse.json(results.map(r => r.data))
}
