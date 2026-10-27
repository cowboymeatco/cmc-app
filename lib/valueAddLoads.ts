// Server side of smokehouse loads — see scripts/2026-10-26_value_add_loads.sql.
//
// A load is the set of value_add_jobs sharing a load_id. Jobs keep their own
// customer, WIP tag, weights and cut-card link; the load owns the batch code
// and makes the group move as one: one cook on the schedule, one tap in and
// out. Everything here runs on the service role from the API routes.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate } from '@/lib/dates'
import { julianYYDDD } from '@/lib/label'
import { isCureTagNumber, type ValueAddJob, type ValueAddLoad } from '@/lib/types'

/** The job select that carries its load along. */
export const JOB_WITH_LOAD = '*, load:value_add_loads(id, created_at, batch_code, notes)'

export const BATCH_CODE_RE = /^\d{5}-\d{1,2}$/

/** Postgres unique-violation — a batch code or seal already taken. */
export const isUniqueViolation = (e: { code?: string } | null | undefined) => e?.code === '23505'

// Julian of the cook day plus the cook's number that day. The sequence is read
// off what exists — at two or three cooks a day the read-then-write gap is not
// worth a sequence table, and the unique constraint catches a tie, which
// createLoad retries once.
export async function nextBatchCode(day: string): Promise<string> {
  const prefix = julianYYDDD(day)
  const { data } = await supabaseAdmin
    .from('value_add_loads')
    .select('batch_code')
    .like('batch_code', `${prefix}-%`)
  const seq = (data ?? []).reduce((max, r) => {
    const n = parseInt(String(r.batch_code ?? '').slice(prefix.length + 1), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0) + 1
  return `${prefix}-${seq}`
}

/** A new, empty load for the given shop day (today when not given). */
export async function createLoad(day?: string | null, notes?: string | null): Promise<ValueAddLoad> {
  const d = day && /^\d{4}-\d{2}-\d{2}$/.test(day) ? day : isoDate()
  for (let attempt = 0; attempt < 2; attempt++) {
    const batch_code = await nextBatchCode(d)
    const { data, error } = await supabaseAdmin
      .from('value_add_loads')
      .insert([{ batch_code, notes: notes ?? null }])
      .select()
      .single()
    if (!error) return data as ValueAddLoad
    if (!isUniqueViolation(error) || attempt === 1) throw new Error(error.message)
  }
  throw new Error('could not number the load')
}

/** The jobs in a load, oldest first. */
export async function jobsInLoad(loadId: string): Promise<ValueAddJob[]> {
  const { data, error } = await supabaseAdmin
    .from('value_add_jobs')
    .select(JOB_WITH_LOAD)
    .eq('load_id', loadId)
    .order('created_at', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []) as unknown as ValueAddJob[]
}

/** Drop a load that has nothing left in it. */
export async function deleteIfEmpty(loadId: string): Promise<boolean> {
  const { count } = await supabaseAdmin
    .from('value_add_jobs')
    .select('id', { count: 'exact', head: true })
    .eq('load_id', loadId)
  if ((count ?? 0) > 0) return false
  await supabaseAdmin.from('value_add_loads').delete().eq('id', loadId)
  return true
}

export interface TapFields {
  smoke_in_at?:  string | null
  smoke_out_at?: string | null
}

// Tap a job in or out of the house — and with it every job in its load. The
// Enviropak is the master clock (lib/cookMatch.ts); the taps only say WHICH
// jobs were in, and five customers' sticks on one truck were in together.
//
// A job tapped in with no load becomes a load of one, so every cook carries a
// batch code whether or not anybody grouped it. Status rides along: pending
// siblings go in_progress when the load goes in, as the single-job tap did.
export async function tapLoad(jobId: string, tap: TapFields, status?: string | null): Promise<ValueAddJob | null> {
  const { data: job, error } = await supabaseAdmin
    .from('value_add_jobs')
    .select('id, load_id, status')
    .eq('id', jobId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!job) return null

  let loadId: string | null = (job.load_id as string | null) ?? null
  if (!loadId && tap.smoke_in_at) {
    const load = await createLoad(isoDate(new Date(tap.smoke_in_at)))
    loadId = load.id
    await supabaseAdmin.from('value_add_jobs').update({ load_id: loadId }).eq('id', jobId)
  }

  const now = new Date().toISOString()
  const fields: Record<string, unknown> = { updated_at: now }
  if ('smoke_in_at'  in tap) fields.smoke_in_at  = tap.smoke_in_at  ?? null
  if ('smoke_out_at' in tap) fields.smoke_out_at = tap.smoke_out_at ?? null

  const scope = <T extends { eq: (c: string, v: string) => T }>(q: T) =>
    loadId ? q.eq('load_id', loadId) : q.eq('id', jobId)

  const upd = await scope(supabaseAdmin.from('value_add_jobs').update(fields))
  if (upd.error) throw new Error(upd.error.message)

  if (status === 'in_progress') {
    // Only the ones not already further along — a completed sibling stays put.
    const st = await scope(supabaseAdmin.from('value_add_jobs').update({ status, updated_at: now })).eq('status', 'pending')
    if (st.error) throw new Error(st.error.message)
  } else if (status) {
    const st = await supabaseAdmin.from('value_add_jobs').update({ status, updated_at: now }).eq('id', jobId)
    if (st.error) throw new Error(st.error.message)
  }

  const { data: fresh } = await supabaseAdmin
    .from('value_add_jobs')
    .select(JOB_WITH_LOAD)
    .eq('id', jobId)
    .maybeSingle()
  return (fresh as unknown as ValueAddJob) ?? null
}

/** Why a seal can't go on this job, or null when it can. */
export async function sealConflict(seal: string, jobId: string): Promise<string | null> {
  if (!isCureTagNumber(seal)) return 'A seal number is 7 digits with the leading zero, as the gun reads it'
  const [{ data: cure }, { data: other }] = await Promise.all([
    supabaseAdmin.from('cure_tags').select('customer_name, product, status').eq('tag_number', seal).maybeSingle(),
    supabaseAdmin.from('value_add_jobs').select('id, customer_name, output_item_name, description, status')
      .eq('seal_number', seal).neq('id', jobId).maybeSingle(),
  ])
  if (cure && cure.status === 'curing') return `Seal ${seal} is on ${cure.customer_name}'s ${cure.product} in the cure cooler`
  if (other && other.status !== 'complete') {
    return `Seal ${seal} is already on ${other.customer_name ? `${other.customer_name}'s ` : ''}${other.output_item_name || other.description || 'another job'}`
  }
  return null
}

/** The open job wearing this seal, with its load, or null. */
export async function jobBySeal(seal: string): Promise<ValueAddJob | null> {
  const { data } = await supabaseAdmin
    .from('value_add_jobs')
    .select(JOB_WITH_LOAD)
    .eq('seal_number', seal)
    .neq('status', 'complete')
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle()
  return (data as unknown as ValueAddJob) ?? null
}
