// Server side of smokehouse loads — see scripts/2026-10-26_value_add_loads.sql.
//
// A load is the set of value_add_jobs sharing a load_id. Jobs keep their own
// customer, WIP tag, weights and cut-card link; the load owns the batch code
// and makes the group move as one: one cook on the schedule, one tap in and
// out. Everything here runs on the service role from the API routes.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate } from '@/lib/dates'
import { julianYYDDD } from '@/lib/label'
import { isCureTagNumber, type CureTag, type ValueAddJob, type ValueAddLoad } from '@/lib/types'

// WIP tag code: WIP<julian><seq>, e.g. WIP26205003 for the third job of the
// day. Code 39 only carries A-Z/0-9, so no punctuation. Sequence comes from
// what's already tagged that day — at a handful of jobs a day the read-then-
// write gap is not worth a sequence table, and the unique index catches a tie.
export async function nextTagCode(requestedDate: string): Promise<string> {
  const prefix = `WIP${julianYYDDD(requestedDate)}`
  const { data } = await supabaseAdmin
    .from('value_add_jobs')
    .select('tag_code')
    .like('tag_code', `${prefix}%`)
  const seq = (data ?? []).reduce((max, r) => {
    const n = parseInt(String(r.tag_code ?? '').slice(prefix.length), 10)
    return Number.isFinite(n) && n > max ? n : max
  }, 0) + 1
  return `${prefix}${String(seq).padStart(3, '0')}`
}

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

  // Hams and bacon in the load wear cure seals, not job seals: stamp them so
  // the cure cooler board stops counting them (in) and the bench knows (out).
  if (loadId) {
    const cure: Record<string, unknown> = {}
    if ('smoke_in_at'  in tap) cure.smokehouse_in_at  = tap.smoke_in_at  ?? null
    if ('smoke_out_at' in tap) cure.smokehouse_out_at = tap.smoke_out_at ?? null
    const ct = await supabaseAdmin.from('cure_tags').update(cure).eq('load_id', loadId)
    if (ct.error) throw new Error(ct.error.message)
  }

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

// ── Loads at the door ────────────────────────────────────────────────────────

export interface OpenLoad extends ValueAddLoad {
  jobs:   ValueAddJob[]
  pieces: number
  /** null = nothing in it yet; 'queued' | 'in' | 'out' from the jobs' taps. */
  state:  'empty' | 'queued' | 'in' | 'out'
}

/** Loads the door can still scan into or tap: empty, waiting, or in the house. */
export async function openLoads(): Promise<OpenLoad[]> {
  const [{ data: loads, error }, { data: jobs }, { data: pieces }] = await Promise.all([
    supabaseAdmin.from('value_add_loads').select('*').order('created_at', { ascending: false }).limit(60),
    supabaseAdmin.from('value_add_jobs').select(JOB_WITH_LOAD).not('load_id', 'is', null).neq('status', 'complete'),
    supabaseAdmin.from('cure_tags').select('load_id').not('load_id', 'is', null),
  ])
  if (error) throw new Error(error.message)
  const byLoad = new Map<string, ValueAddJob[]>()
  for (const j of (jobs ?? []) as unknown as ValueAddJob[]) {
    const a = byLoad.get(j.load_id!); if (a) a.push(j); else byLoad.set(j.load_id!, [j])
  }
  const pieceCount = new Map<string, number>()
  for (const t of pieces ?? []) pieceCount.set(t.load_id as string, (pieceCount.get(t.load_id as string) ?? 0) + 1)

  return ((loads ?? []) as ValueAddLoad[]).map(l => {
    const js = byLoad.get(l.id) ?? []
    const state: OpenLoad['state'] = js.length === 0 ? 'empty'
      : js.every(j => j.smoke_out_at) ? 'out'
      : js.some(j => j.smoke_in_at) ? 'in' : 'queued'
    return { ...l, jobs: js, pieces: pieceCount.get(l.id) ?? 0, state }
  }).filter(l => l.state !== 'out')
}

// One job per customer per product in the load, kept in step with the seals
// scanned into it: piece count always, pounds only when every piece was
// weighed — the cure board's rule, so a half-weighed load never reads as a
// whole number. Deleted when its last piece is scanned back out.
export async function syncCureJob(loadId: string, customer: string, product: string): Promise<ValueAddJob | null> {
  const { data: tags } = await supabaseAdmin
    .from('cure_tags')
    .select('id, weight_lbs, linked_cutting_instruction_id, session_date')
    .eq('load_id', loadId).eq('customer_name', customer).eq('product', product)
  const pieces = tags ?? []

  const { data: existing } = await supabaseAdmin
    .from('value_add_jobs')
    .select('id')
    .eq('load_id', loadId).eq('source_type', 'cure').eq('customer_name', customer).eq('output_item_name', product)
    .neq('status', 'complete')
    .limit(1)
    .maybeSingle()

  if (pieces.length === 0) {
    if (existing) await supabaseAdmin.from('value_add_jobs').delete().eq('id', existing.id)
    return null
  }

  const weights = pieces.map(t => t.weight_lbs).filter((w): w is number => w != null && Number(w) > 0)
  const lbs = weights.length === pieces.length ? weights.reduce((sum, w) => sum + Number(w), 0) : null
  const cards = new Set(pieces.map(t => t.linked_cutting_instruction_id).filter(Boolean))
  const fields = {
    description:                   `${product} · ${pieces.length} piece${pieces.length === 1 ? '' : 's'} off the cure seals`,
    weight_in_lbs:                 lbs,
    piece_count:                   pieces.length,
    linked_cutting_instruction_id: cards.size === 1 ? Array.from(cards)[0] : null,
    updated_at:                    new Date().toISOString(),
  }

  if (existing) {
    const { data, error } = await supabaseAdmin.from('value_add_jobs').update(fields).eq('id', existing.id).select(JOB_WITH_LOAD).single()
    if (error) throw new Error(error.message)
    return data as unknown as ValueAddJob
  }
  const today = isoDate()
  const { data, error } = await supabaseAdmin
    .from('value_add_jobs')
    .insert([{
      ...fields,
      job_type:           'smokehouse',
      source_type:        'cure',
      output_item_name:   product,
      customer_name:      customer,
      source_description: 'Out of cure',
      assigned_to:        '',
      requested_date:     today,
      status:             'pending',
      notes:              '',
      resource:           'smokehouse',
      load_id:            loadId,
      tag_code:           await nextTagCode(today),
    }])
    .select(JOB_WITH_LOAD)
    .single()
  if (error) throw new Error(error.message)
  return data as unknown as ValueAddJob
}

export type SealScan =
  | { kind: 'cure'; tag: CureTag; job: ValueAddJob | null; already: boolean }
  | { kind: 'refused'; status: number; error: string }

/** A cure seal scanned at the door goes into this load. */
export async function attachCureSeal(loadId: string, seal: string): Promise<SealScan> {
  if (!isCureTagNumber(seal)) return { kind: 'refused', status: 400, error: 'A seal number is 7 digits with the leading zero' }
  const { data: tag } = await supabaseAdmin.from('cure_tags').select('*').eq('tag_number', seal).maybeSingle()
  if (!tag) return { kind: 'refused', status: 404, error: `Seal ${seal} isn't on any cure piece — it was never tagged in at the gun` }
  const t = tag as CureTag
  if (t.status === 'done') return { kind: 'refused', status: 409, error: `Seal ${seal} (${t.customer_name}'s ${t.product}) was already packed out` }
  if (t.load_id && t.load_id !== loadId) {
    const { data: other } = await supabaseAdmin.from('value_add_loads').select('batch_code').eq('id', t.load_id).maybeSingle()
    if (t.smokehouse_in_at) return { kind: 'refused', status: 409, error: `Seal ${seal} went into the house on load ${other?.batch_code ?? '?'}` }
    // Still waiting on another load: move it, and tidy the job it leaves.
    await supabaseAdmin.from('cure_tags').update({ load_id: loadId }).eq('id', t.id)
    await syncCureJob(t.load_id, t.customer_name, t.product)
    const job = await syncCureJob(loadId, t.customer_name, t.product)
    return { kind: 'cure', tag: { ...t, load_id: loadId }, job, already: false }
  }
  const already = t.load_id === loadId
  if (!already) {
    const { error } = await supabaseAdmin.from('cure_tags').update({ load_id: loadId }).eq('id', t.id)
    if (error) throw new Error(error.message)
  }
  const job = await syncCureJob(loadId, t.customer_name, t.product)
  return { kind: 'cure', tag: { ...t, load_id: loadId }, job, already }
}

/** A mis-scan: take the piece back out of its load. */
export async function detachCureSeal(seal: string): Promise<{ removed: boolean; error?: string }> {
  const { data: tag } = await supabaseAdmin.from('cure_tags').select('*').eq('tag_number', seal).maybeSingle()
  const t = tag as CureTag | null
  if (!t || !t.load_id) return { removed: false }
  if (t.smokehouse_in_at) return { removed: false, error: `Seal ${seal} already went into the house — tap the load out instead` }
  const loadId = t.load_id
  await supabaseAdmin.from('cure_tags').update({ load_id: null }).eq('id', t.id)
  await syncCureJob(loadId, t.customer_name, t.product)
  return { removed: true }
}
