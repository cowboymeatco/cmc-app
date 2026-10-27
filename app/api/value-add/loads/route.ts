export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  BATCH_CODE_RE, createLoad, deleteIfEmpty, isUniqueViolation, jobsInLoad, openLoads,
} from '@/lib/valueAddLoads'

export const dynamic = 'force-dynamic'

// Smokehouse loads — see lib/valueAddLoads.ts and the 2026-10-26 migration.
//
// GET    /api/value-add/loads                    — loads the door can still use:
//        empty, queued, or in the house, each with its jobs and piece count
// GET    /api/value-add/loads?id=<load>          — one load with its jobs
// POST   /api/value-add/loads                    — { job_ids?, day?, load_id?, notes? }
//        Groups the jobs into one load. With load_id the jobs join that load;
//        without, a new load is numbered for `day` (the scheduled cook day,
//        else today). No job_ids at all makes an EMPTY load — what the door
//        starts before scanning hams into it. Chris groups by hand — nothing
//        here guesses what cooks together.
// PATCH  /api/value-add/loads                    — { id, batch_code?, notes? }
// DELETE /api/value-add/loads?id=<load>          — split: every job goes back
//        to standing alone, the load row goes away.
// DELETE /api/value-add/loads?job_id=<job>       — take one job out of its
//        load; the load is dropped once it is empty.

export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) {
    try { return NextResponse.json(await openLoads()) }
    catch (e) { return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 }) }
  }
  const { data: load, error } = await supabaseAdmin.from('value_add_loads').select('*').eq('id', id).maybeSingle()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!load) return NextResponse.json({ error: 'load not found' }, { status: 404 })
  try {
    return NextResponse.json({ load, jobs: await jobsInLoad(id) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as {
    job_ids?: unknown; day?: string | null; load_id?: string | null; notes?: string | null
  }
  const jobIds = Array.isArray(body.job_ids)
    ? Array.from(new Set(body.job_ids.map(String).filter(Boolean)))
    : []
  if (jobIds.length === 0) {
    // An empty load for the door to scan cure pieces into.
    try {
      const load = await createLoad(body.day ?? null, body.notes ?? null)
      return NextResponse.json({ load, jobs: [] })
    } catch (e) {
      return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
    }
  }

  // Only open jobs join a load. A completed one is history; it would only
  // drag a finished weight into a cook it was never in.
  const { data: jobs, error: jErr } = await supabaseAdmin
    .from('value_add_jobs').select('id, status, load_id').in('id', jobIds)
  if (jErr) return NextResponse.json({ error: jErr.message }, { status: 500 })
  const found = new Set((jobs ?? []).map(j => j.id as string))
  const missing = jobIds.filter(id => !found.has(id))
  if (missing.length) return NextResponse.json({ error: `${missing.length} job(s) not found` }, { status: 404 })
  const done = (jobs ?? []).filter(j => j.status === 'complete')
  if (done.length) return NextResponse.json({ error: 'A completed job cannot join a load' }, { status: 400 })

  try {
    let loadId = body.load_id ?? null
    if (loadId) {
      const { data: existing } = await supabaseAdmin.from('value_add_loads').select('id').eq('id', loadId).maybeSingle()
      if (!existing) return NextResponse.json({ error: 'load not found' }, { status: 404 })
    } else {
      loadId = (await createLoad(body.day ?? null, body.notes ?? null)).id
    }

    // Jobs pulled out of some other load leave it; an emptied load is dropped.
    const vacated = new Set((jobs ?? []).map(j => j.load_id as string | null).filter((x): x is string => !!x && x !== loadId))

    const { error: uErr } = await supabaseAdmin
      .from('value_add_jobs')
      .update({ load_id: loadId, updated_at: new Date().toISOString() })
      .in('id', jobIds)
    if (uErr) return NextResponse.json({ error: uErr.message }, { status: 500 })
    for (const v of vacated) await deleteIfEmpty(v)

    const { data: load } = await supabaseAdmin.from('value_add_loads').select('*').eq('id', loadId).single()
    return NextResponse.json({ load, jobs: await jobsInLoad(loadId) })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { id?: string; batch_code?: string; notes?: string | null }
  if (!body.id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const updates: Record<string, unknown> = {}
  if (body.batch_code !== undefined) {
    const code = String(body.batch_code).trim()
    if (!BATCH_CODE_RE.test(code)) {
      return NextResponse.json({ error: 'A batch code is the five-digit julian, a dash, and the cook number: 26299-2' }, { status: 400 })
    }
    updates.batch_code = code
  }
  if (body.notes !== undefined) updates.notes = body.notes
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'nothing to change' }, { status: 400 })

  const { data, error } = await supabaseAdmin.from('value_add_loads').update(updates).eq('id', body.id).select().single()
  if (error) {
    if (isUniqueViolation(error)) return NextResponse.json({ error: `Batch code ${updates.batch_code} is already used by another load` }, { status: 409 })
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function DELETE(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const id = sp.get('id'); const jobId = sp.get('job_id')
  const now = new Date().toISOString()

  if (jobId) {
    const { data: job } = await supabaseAdmin.from('value_add_jobs').select('load_id').eq('id', jobId).maybeSingle()
    const loadId = (job?.load_id as string | null) ?? null
    if (!loadId) return NextResponse.json({ ok: true, removed: 0 })
    const { error } = await supabaseAdmin.from('value_add_jobs').update({ load_id: null, updated_at: now }).eq('id', jobId)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const dropped = await deleteIfEmpty(loadId)
    return NextResponse.json({ ok: true, removed: 1, load_dropped: dropped })
  }

  if (!id) return NextResponse.json({ error: 'id or job_id required' }, { status: 400 })
  const { data: freed, error } = await supabaseAdmin
    .from('value_add_jobs').update({ load_id: null, updated_at: now }).eq('load_id', id).select('id')
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const { error: dErr } = await supabaseAdmin.from('value_add_loads').delete().eq('id', id)
  if (dErr) return NextResponse.json({ error: dErr.message }, { status: 500 })
  return NextResponse.json({ ok: true, removed: freed?.length ?? 0 })
}
