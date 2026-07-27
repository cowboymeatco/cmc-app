export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import {
  proposeWeightOut, BoxScanRow, packWindow, jobBaseDate,
  MatchWindowSettings, DEFAULT_WINDOW,
} from '@/lib/boxWeight'

// GET /api/value-add/box-weight            — proposals for every open job
// GET /api/value-add/box-weight?id=<uuid>  — proposal for one job
//
// Finished weight is already on the Hobart labels scanned into boxes; this
// finds it instead of asking somebody to read it off and type it in. It only
// ever PROPOSES — see lib/boxWeight.ts for why applying stays a human tap.
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')

  let jobQuery = supabase
    .from('value_add_jobs')
    .select('id, output_plu, customer_name, completed_date, requested_date, scheduled_start, weight_out_lbs, weight_out_source')
    .not('output_plu', 'is', null)

  jobQuery = id ? jobQuery.eq('id', id) : jobQuery.neq('status', 'complete')

  const { data: jobs, error } = await jobQuery
  if (error)   return NextResponse.json({ error: error.message }, { status: 500 })
  if (!jobs?.length) return NextResponse.json({ proposals: [] })

  const { data: settingsRow } = await supabase
    .from('cook_settings')
    .select('match_window_days, match_window_back_days')
    .eq('id', 1)
    .maybeSingle()
  const windowSettings: MatchWindowSettings = settingsRow ?? DEFAULT_WINDOW

  // A job's window has to stop where the next cook of the same product starts,
  // or a long window sums that later run's boxes into this job. That boundary
  // needs EVERY job for the PLU, not just the open ones, so it is a separate
  // lightweight read.
  const plus = Array.from(new Set(jobs.map(j => j.output_plu).filter(Boolean))) as string[]

  const { data: siblingRows, error: sibErr } = await supabase
    .from('value_add_jobs')
    .select('id, output_plu, completed_date, requested_date, scheduled_start')
    .in('output_plu', plus)
  if (sibErr) return NextResponse.json({ error: sibErr.message }, { status: 500 })

  const siblingsByPlu = new Map<string, { id: string; base: string }[]>()
  for (const s of siblingRows ?? []) {
    const key = s.output_plu as string
    const list = siblingsByPlu.get(key) ?? []
    list.push({ id: s.id as string, base: jobBaseDate(s) })
    siblingsByPlu.set(key, list)
  }
  for (const list of siblingsByPlu.values()) list.sort((a, b) => a.base.localeCompare(b.base))

  // The next job for this PLU that is anchored strictly later than this one.
  const nextDateFor = (job: { id: string; output_plu: string | null }): string | null => {
    const list = siblingsByPlu.get(job.output_plu ?? '') ?? []
    const me   = list.find(s => s.id === job.id)
    if (!me) return null
    return list.find(s => s.base > me.base)?.base ?? null
  }

  // One scan query covering every PLU and the widest window any job needs,
  // rather than a round trip per job.
  const windows = jobs.map(j => packWindow(j, windowSettings, nextDateFor(j)))
  const from = windows.reduce((m, w) => (w.from < m ? w.from : m), windows[0].from)
  const to   = windows.reduce((m, w) => (w.to   > m ? w.to   : m), windows[0].to)

  // box_scans holds the weights; boxes holds the customer and pack date, and
  // there is no foreign key between them, so this is two queries joined here.
  //
  // Order matters. Going boxes-first means either a 1000-row truncation (the
  // PostgREST default, which silently drops the tail of a wide window and
  // quietly returns a wrong weight) or a box-id IN list long enough to overflow
  // the query string. Scans filtered to a handful of PLUs is a much smaller
  // set, so we start there and fetch only the boxes those scans reference.
  const PAGE = 1000

  const scanRows: { box_id: string; plu_number: string | null; item_name: string | null; weight_lbs: number | null; quantity: number | null }[] = []
  for (let offset = 0; ; offset += PAGE) {
    const { data, error: e } = await supabase
      .from('box_scans')
      .select('box_id, plu_number, item_name, weight_lbs, quantity')
      .in('plu_number', plus)
      .range(offset, offset + PAGE - 1)
    if (e) return NextResponse.json({ error: e.message }, { status: 500 })
    scanRows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }
  if (scanRows.length === 0) return NextResponse.json({ proposals: [] })

  // Only the boxes those scans landed in, in chunks small enough that the IN
  // list stays inside the query string.
  const CHUNK = 150
  const boxIds = Array.from(new Set(scanRows.map(r => r.box_id).filter(Boolean)))
  const boxById = new Map<string, { id: string; box_label: string | null; customer_name: string | null; pack_date: string | null }>()

  for (let i = 0; i < boxIds.length; i += CHUNK) {
    const { data, error: e } = await supabase
      .from('boxes')
      .select('id, box_label, customer_name, pack_date')
      .in('id', boxIds.slice(i, i + CHUNK))
      .gte('pack_date', from)
      .lte('pack_date', to)
    if (e) return NextResponse.json({ error: e.message }, { status: 500 })
    for (const b of data ?? []) boxById.set(b.id as string, b)
  }

  const scans: BoxScanRow[] = scanRows.flatMap(r => {
    const b = boxById.get(r.box_id)
    if (!b) return []   // scanned into a box outside the window
    return [{
      box_id:        r.box_id,
      plu_number:    r.plu_number,
      item_name:     r.item_name,
      weight_lbs:    r.weight_lbs,
      quantity:      r.quantity,
      box_label:     b.box_label     ?? null,
      customer_name: b.customer_name ?? null,
      pack_date:     b.pack_date     ?? null,
    }]
  })

  const proposals = jobs.flatMap(job => {
    const p = proposeWeightOut(job, scans, windowSettings, nextDateFor(job))
    if (!p) return []
    return [{
      job_id:       job.id,
      current_lbs:  job.weight_out_lbs,
      current_source: job.weight_out_source,
      ...p,
    }]
  })

  return NextResponse.json({ proposals })
}

// POST /api/value-add/box-weight — accept a proposal onto the job.
// Body: { id, lbs }. Stamps the source so a hand-typed weight is never
// silently replaced by a later sweep.
export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body?.id || body.lbs === undefined) {
    return NextResponse.json({ error: 'id and lbs required' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('value_add_jobs')
    .update({
      weight_out_lbs:    body.lbs,
      weight_out_source: 'boxes',
      updated_at:        new Date().toISOString(),
    })
    .eq('id', body.id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
