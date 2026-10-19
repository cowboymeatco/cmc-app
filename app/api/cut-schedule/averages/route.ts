export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate, addDaysISO } from '@/lib/dates'

export const dynamic = 'force-dynamic'

// GET /api/cut-schedule/averages
//   → { window_days, since, species: { Beef: { avg, median, n }, … } }
//
// Average hot carcass weight per species off our own harvest log, trailing
// year. The cut schedule's week view and its "lay out by weight" use it to
// weigh an animal that isn't on the rail yet (Charlie, 2026-10-18: "start
// utilizing our average carcass sizes, taking in all our past data"), so a
// day's pounds are a real number before the kill, not a head count.
//
// Mean, not median, so one big bull moves the number the way it moves the
// day. The median rides along for the tooltip.

const WINDOW_DAYS = 365
const PAGE = 1000

export async function GET() {
  const since = addDaysISO(isoDate(), -WINDOW_DAYS)
  const rows: { species: string | null; hot_carcass_weight_lbs: number | null }[] = []
  // supabase-js caps a select at 1000 rows; a year is a couple of thousand.
  for (let from = 0; from < 20000; from += PAGE) {
    const { data, error } = await supabaseAdmin
      .from('harvest_log')
      .select('species, hot_carcass_weight_lbs')
      .gte('harvest_date', since)
      .not('hot_carcass_weight_lbs', 'is', null)
      .gt('hot_carcass_weight_lbs', 0)
      .order('harvest_date', { ascending: true })
      .range(from, from + PAGE - 1)
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    rows.push(...(data ?? []))
    if (!data || data.length < PAGE) break
  }

  const by = new Map<string, number[]>()
  for (const r of rows) {
    const sp = (r.species ?? '').trim()
    if (!sp || r.hot_carcass_weight_lbs == null) continue
    const list = by.get(sp) ?? []
    list.push(Number(r.hot_carcass_weight_lbs))
    by.set(sp, list)
  }
  const species: Record<string, { avg: number; median: number; n: number }> = {}
  for (const [sp, list] of by) {
    list.sort((a, b) => a - b)
    const n = list.length
    const avg = list.reduce((s, x) => s + x, 0) / n
    const median = n % 2 ? list[(n - 1) / 2] : (list[n / 2 - 1] + list[n / 2]) / 2
    species[sp] = { avg: Math.round(avg), median: Math.round(median), n }
  }
  return NextResponse.json({ window_days: WINDOW_DAYS, since, species })
}
