export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { studyProduct, type StudyProduct } from '@/lib/laborStudy'
import { addDaysISO } from '@/lib/dates'

// /api/exec/study — timing studies (see lib/laborStudy).
//   GET ?product=bacon                  → cut days, open + past studies
//   GET ?product=bacon&date=YYYY-MM-DD  → what that cut day put into cure
//   POST { action, ... }                → create | start | stop | update | close | delete

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

async function finishedLbs(p: StudyProduct, customers: string[], since: string): Promise<number> {
  if (customers.length === 0) return 0
  const { data: boxes, error } = await supabaseAdmin.from('boxes').select('id').in('customer_name', customers).gte('pack_date', since)
  if (error) throw new Error(error.message)
  const ids = (boxes ?? []).map(b => b.id as string)
  if (ids.length === 0) return 0
  const { data: scans, error: e2 } = await supabaseAdmin.from('box_scans').select('weight_lbs').in('box_id', ids).in('item_name', p.finishedItems)
  if (e2) throw new Error(e2.message)
  return (scans ?? []).reduce((a, s) => a + Number(s.weight_lbs ?? 0), 0)
}

/** What one cut day put into cure for this product. */
async function cutDay(p: StudyProduct, date: string) {
  const { data: tags, error } = await supabaseAdmin.from('cure_tags')
    .select('customer_name, weight_lbs, status').eq('session_date', date).in('product', p.cureProducts)
  if (error) throw new Error(error.message)
  const byCustomer = new Map<string, number>()
  let weighedLbs = 0, weighed = 0, done = 0
  for (const t of tags ?? []) {
    const c = (t.customer_name as string) ?? ''
    byCustomer.set(c, (byCustomer.get(c) ?? 0) + 1)
    if (t.weight_lbs != null) { weighed++; weighedLbs += Number(t.weight_lbs) }
    if (t.status === 'done') done++
  }
  const customers = [...byCustomer.keys()].filter(Boolean)

  // The carcasses those bellies came off, for scale.
  const { data: inputs, error: e2 } = customers.length
    ? await supabaseAdmin.from('processing_inputs').select('linked_harvest_id').eq('session_date', date).in('customer_name', customers).not('linked_harvest_id', 'is', null)
    : { data: [], error: null }
  if (e2) throw new Error(e2.message)
  const hogIds = [...new Set((inputs ?? []).map(i => i.linked_harvest_id as string))]
  const { data: hogs, error: e3 } = hogIds.length
    ? await supabaseAdmin.from('harvest_log').select('hot_carcass_weight_lbs').in('id', hogIds)
    : { data: [], error: null }
  if (e3) throw new Error(e3.message)

  return {
    date,
    tags: (tags ?? []).length,
    tagsDone: done,
    weighed, weighedLbs,
    customers: [...byCustomer].map(([name, n]) => ({ name, tags: n })).sort((a, b) => a.name.localeCompare(b.name)),
    head: hogIds.length,
    carcassLbs: (hogs ?? []).reduce((a, h) => a + Number(h.hot_carcass_weight_lbs ?? 0), 0),
    finishedSoFar: await finishedLbs(p, customers, date),
  }
}

/** Finished lb per cure tag, from cut days that have been packed. The crew
 *  doesn't scan out every tag (shoulder bacon lingers as "curing" after it's
 *  sold), so "mostly done" counts: three in four tags scanned out. */
async function lbPerTag(p: StudyProduct, days: string[]) {
  let tags = 0, lbs = 0, runs = 0
  for (const c of await Promise.all(days.map(d => cutDay(p, d)))) {
    if (c.tags === 0 || c.tagsDone < c.tags * 0.75 || c.finishedSoFar === 0) continue
    tags += c.tags; lbs += c.finishedSoFar; runs++
  }
  return tags ? { lbPerTag: lbs / tags, runs, tags } : null
}

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const q = req.nextUrl.searchParams
    const p = studyProduct(q.get('product') ?? 'bacon')
    if (!p) return NextResponse.json({ error: 'unknown product' }, { status: 400 })
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })

    const { data: recent, error } = await supabaseAdmin.from('cure_tags')
      .select('session_date').in('product', p.cureProducts).gte('session_date', addDaysISO(today, -60))
    if (error) throw new Error(error.message)
    const counts = new Map<string, number>()
    for (const r of recent ?? []) counts.set(r.session_date as string, (counts.get(r.session_date as string) ?? 0) + 1)
    const cutDays = [...counts].map(([date, tags]) => ({ date, tags })).sort((a, b) => b.date.localeCompare(a.date))

    const history = await lbPerTag(p, cutDays.map(c => c.date))

    const date = q.get('date')
    if (date) {
      if (!DATE_RE.test(date)) return NextResponse.json({ error: 'bad date' }, { status: 400 })
      return NextResponse.json({ day: await cutDay(p, date), history })
    }

    const { data: studies, error: e2 } = await supabaseAdmin.from('labor_studies')
      .select('*, segments:labor_study_segments(id, step, crew, started_at, ended_at)')
      .eq('product', p.key).order('created_at', { ascending: false }).limit(20)
    if (e2) throw new Error(e2.message)
    const withLbs = await Promise.all((studies ?? []).map(async s => ({
      ...s, finishedLbs: await finishedLbs(p, s.customers as string[], s.cut_date as string),
    })))

    return NextResponse.json({ product: p, cutDays, history, studies: withLbs })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response
  try {
    const b = await req.json()
    const now = new Date().toISOString()
    const fail = (msg: string) => NextResponse.json({ error: msg }, { status: 400 })
    let res: { error: { message: string } | null }

    switch (b.action) {
      case 'create': {
        const p = studyProduct(b.product)
        if (!p || !DATE_RE.test(b.cut_date ?? '')) return fail('product and cut day required')
        const day = await cutDay(p, b.cut_date)
        res = await supabaseAdmin.from('labor_studies').insert({
          product: p.key, cut_date: b.cut_date,
          customers: day.customers.map(c => c.name), tag_count: day.tags,
        })
        break
      }
      case 'start': {
        const crew = Math.min(20, Math.max(1, Number(b.crew) || 1))
        res = await supabaseAdmin.from('labor_study_segments').insert({ study_id: b.study_id, step: b.step, crew, started_at: now })
        break
      }
      case 'stop':
        res = await supabaseAdmin.from('labor_study_segments').update({ ended_at: now })
          .eq('study_id', b.study_id).eq('step', b.step).is('ended_at', null)
        break
      case 'update': {
        const patch: Record<string, unknown> = {}
        if ('green_lbs' in b) patch.green_lbs = b.green_lbs === '' || b.green_lbs == null ? null : Number(b.green_lbs)
        if ('notes' in b) patch.notes = b.notes || null
        res = await supabaseAdmin.from('labor_studies').update(patch).eq('id', b.study_id)
        break
      }
      case 'close':
        await supabaseAdmin.from('labor_study_segments').update({ ended_at: now }).eq('study_id', b.study_id).is('ended_at', null)
        res = await supabaseAdmin.from('labor_studies').update({ status: 'closed', closed_at: now }).eq('id', b.study_id)
        break
      case 'reopen':
        res = await supabaseAdmin.from('labor_studies').update({ status: 'open', closed_at: null }).eq('id', b.study_id)
        break
      case 'delete':
        res = await supabaseAdmin.from('labor_studies').delete().eq('id', b.study_id)
        break
      default:
        return fail('unknown action')
    }
    if (res.error) throw new Error(res.error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
