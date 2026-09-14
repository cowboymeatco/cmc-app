export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { cutWrapCharge, killFeeCharge, isExcludedProducer } from '@/lib/billingRules'
import { LABOR_WEEKS, mondayWeeksBack, mountainToday } from '@/lib/laborSync'
import { loadSmokeRates, smokeLines, smokeRate } from '@/lib/pipelineValue'
import { addDaysISO, mondayOfISO } from '@/lib/dates'

// GET /api/schedule/dollars — kill + processing dollars booked per harvest
// week, against what a week needs.
//
// Charlie (2026-09-13): "when we are getting low enough on available dollar
// in the plant we know to get out and get some animals coming in."
//
// A booked animal has no weight yet, so it's priced at the plant's recent
// average hanging weight for its species × the QBO kill + cut & wrap rates
// (lamb and goat are flat per head). Once it's killed, its real hanging
// weight takes over. Smokehouse pounds on a linked cut card add at the custom
// raw-lb rate. Our own animals (Cowboy Meat Company) are left out — they're
// crew work, not an invoice. The week's target defaults to average weekly
// payroll: "does what's booked cover the crew?" Charlie can set his own.

const WEEKS = 12

export interface BookedWeek {
  week_start: string
  dollars: number
  head: Record<string, number>
  appointments: number
  own_head: number
  accounts: string[]
}

export interface BookedDollarsResponse {
  weeks: BookedWeek[]
  target: number | null
  target_source: 'set' | 'payroll' | 'none'
  payroll_weekly: number | null
  per_head: Record<string, { hanging_lbs: number | null; dollars: number; kills: number }>
}

export async function GET() {
  const today = mountainToday()
  const first = mondayOfISO(today)
  const end = addDaysISO(first, WEEKS * 7)

  const [appts, recent, labor, settings, smokeRates] = await Promise.all([
    supabase.from('harvest_appointments').select('id, harvest_date, species, head_count, source').gte('harvest_date', first).lt('harvest_date', end),
    supabase.from('harvest_log').select('species, hot_carcass_weight_lbs').gte('harvest_date', addDaysISO(today, -180)).gt('hot_carcass_weight_lbs', 0),
    supabaseAdmin.from('labor_reports').select('labor_dollars').gte('week_start', mondayWeeksBack(today, LABOR_WEEKS)),
    supabaseAdmin.from('capacity_settings').select('schedule_weekly_target').eq('id', 1).maybeSingle(),
    loadSmokeRates(),
  ])
  if (appts.error) return NextResponse.json({ error: appts.error.message }, { status: 500 })

  // What a head brings in, off the last six months of kills.
  const per_head: BookedDollarsResponse['per_head'] = {}
  for (const sp of ['Beef', 'Hog', 'Lamb', 'Goat']) {
    const w = (recent.data ?? []).filter(r => r.species === sp).map(r => Number(r.hot_carcass_weight_lbs))
    const avg = w.length ? w.reduce((s, x) => s + x, 0) / w.length : null
    per_head[sp] = { hanging_lbs: avg != null ? Math.round(avg) : null, dollars: animalDollars(sp, avg), kills: w.length }
  }

  const rows = appts.data ?? []
  const ids = rows.map(a => a.id)
  const [kills, cards] = ids.length
    ? await Promise.all([
        supabase.from('harvest_log').select('appointment_id, hot_carcass_weight_lbs').in('appointment_id', ids),
        supabase.from('cutting_instructions').select('appointment_id, data').in('appointment_id', ids),
      ])
    : [{ data: [] }, { data: [] }]

  const weeks: BookedWeek[] = Array.from({ length: WEEKS }, (_, i) => ({
    week_start: addDaysISO(first, i * 7), dollars: 0, head: {}, appointments: 0, own_head: 0, accounts: [],
  }))
  for (const a of rows) {
    const wk = weeks.find(w => a.harvest_date >= w.week_start && a.harvest_date < addDaysISO(w.week_start, 7))
    if (!wk) continue
    const species = a.species ?? ''
    const head = Math.max(1, Number(a.head_count) || 1)
    if (isExcludedProducer(a.source ?? '')) { wk.own_head += head; continue }

    // Killed already: its own weights. Not yet: the species average per head.
    const weighed = (kills.data ?? []).filter(k => k.appointment_id === a.id && Number(k.hot_carcass_weight_lbs) > 0)
    let dollars = weighed.reduce((s, k) => s + animalDollars(species, Number(k.hot_carcass_weight_lbs)), 0)
      + (per_head[species]?.dollars ?? 0) * Math.max(0, head - weighed.length)
    for (const c of (cards.data ?? []).filter(c => c.appointment_id === a.id)) {
      for (const line of smokeLines(c.data)) dollars += line.lbs * (smokeRate(smokeRates, species, line) ?? 0)
    }

    wk.dollars += dollars
    wk.head[species] = (wk.head[species] ?? 0) + head
    wk.appointments++
    const name = (a.source ?? '').trim()
    if (name && !wk.accounts.includes(name)) wk.accounts.push(name)
  }
  for (const w of weeks) w.dollars = Math.round(w.dollars)

  const pay = (labor.data ?? []).map(r => Number(r.labor_dollars)).filter(n => n > 0)
  const payroll_weekly = pay.length ? Math.round(pay.reduce((s, n) => s + n, 0) / pay.length) : null
  const set = settings.data?.schedule_weekly_target != null ? Number(settings.data.schedule_weekly_target) : null

  return NextResponse.json({
    weeks,
    target: set ?? payroll_weekly,
    target_source: set != null ? 'set' : payroll_weekly != null ? 'payroll' : 'none',
    payroll_weekly,
    per_head,
  } satisfies BookedDollarsResponse)
}

// Kill + cut & wrap for one animal at a hanging weight (flat for lamb/goat).
function animalDollars(species: string, hangingLbs: number | null): number {
  if (species === 'Lamb' || species === 'Goat') return cutWrapCharge(species, null, 1, '')?.amount ?? 0
  if (!hangingLbs) return 0
  return (killFeeCharge(species, hangingLbs, 1, '')?.amount ?? 0) + (cutWrapCharge(species, hangingLbs, 1, '')?.amount ?? 0)
}

// POST { target } — Charlie's own weekly number; null goes back to payroll.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}))
  const target = body.target === null || body.target === '' ? null : Number(body.target)
  if (target !== null && (!Number.isFinite(target) || target < 0 || target > 1_000_000)) {
    return NextResponse.json({ error: 'target must be a dollar amount' }, { status: 400 })
  }
  const { error } = await supabaseAdmin.from('capacity_settings').update({ schedule_weekly_target: target }).eq('id', 1)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ target })
}
