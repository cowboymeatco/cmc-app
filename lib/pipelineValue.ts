// What each account in the building is worth, and how much work stands
// between us and that money. Feeds In the Building's "$ per labor hour".
//
// Charlie (2026-09-13): "with X amount of effort we free up Y amount of
// dollars. So if something needs just 30 minutes of labor to free up $600 or
// something needs 2 hours to free up $1200 then the first one would be the
// winner." The finish line is paid AND picked up.
//
// Everything here is BROAD on purpose — his words: start with "we did x
// pounds on the kill floor for x amount of labor", then hone in on collecting
// real labor. So:
//   • labor is whole-plant payroll ÷ hanging pounds killed over the same pay
//     weeks (kill, cutting, smokehouse, cleaning, office all in one number);
//   • dollars are QuickBooks when an invoice exists, otherwise the QBO service
//     rates × hanging weight plus smokehouse lbs × the custom item rate;
//   • the office time to invoice / call / collect is a guess he can edit.
// Every number the page shows carries where it came from.

import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { cutWrapCharge, killFeeCharge, isExcludedProducer } from '@/lib/billingRules'
import { LABOR_WEEKS, mondayWeeksBack, mountainToday } from '@/lib/laborSync'
import type { AnimalStage } from '@/lib/animalProgress'

export interface LaborRate {
  /** Payroll dollars per hanging lb killed, over the weeks used. */
  dollarsPerLb: number | null
  /** Crew hours per hanging lb (dollarsPerLb ÷ blendedHourly). */
  hoursPerLb: number | null
  /** Payroll ÷ hours, from the pay weeks that carry hours. */
  blendedHourly: number | null
  /** Pounds packed ÷ hanging pounds over the same weeks. */
  packOut: number | null
  weeksUsed: number
  /** Pay weeks with payroll but no carcass weighed — left out of the rate. */
  weeksSkipped: string[]
  payroll: number
  hangingLbs: number
  from: string | null
  to: string | null
}

export async function loadLaborRate(): Promise<LaborRate> {
  const since = mondayWeeksBack(mountainToday(), LABOR_WEEKS)
  const empty: LaborRate = { dollarsPerLb: null, hoursPerLb: null, blendedHourly: null, packOut: null, weeksUsed: 0, weeksSkipped: [], payroll: 0, hangingLbs: 0, from: null, to: null }

  const { data: weeks } = await supabaseAdmin
    .from('labor_reports')
    .select('week_start, week_end, labor_dollars, labor_hours, throughput_lbs')
    .gte('week_start', since)
    .order('week_start', { ascending: true })
  const rows = (weeks ?? []).filter(w => Number(w.labor_dollars) > 0)
  if (!rows.length) return empty

  const from = rows[0].week_start as string
  const to = rows[rows.length - 1].week_end as string
  const { data: kills } = await supabaseAdmin
    .from('harvest_log')
    .select('harvest_date, hot_carcass_weight_lbs')
    .gte('harvest_date', from)
    .lte('harvest_date', to)

  let payroll = 0, hanging = 0, packed = 0, hourDollars = 0, hours = 0, used = 0
  const skipped: string[] = []
  for (const w of rows) {
    const lbs = (kills ?? [])
      .filter(k => k.harvest_date >= w.week_start && k.harvest_date <= w.week_end)
      .reduce((s, k) => s + (Number(k.hot_carcass_weight_lbs) || 0), 0)
    const dollars = Number(w.labor_dollars)
    if (lbs <= 0) { skipped.push(w.week_start as string); continue }
    used++
    payroll += dollars
    hanging += lbs
    packed += Number(w.throughput_lbs) || 0
    if (Number(w.labor_hours) > 0) { hourDollars += dollars; hours += Number(w.labor_hours) }
  }
  if (!hanging) return { ...empty, weeksSkipped: skipped, from, to }

  const dollarsPerLb = payroll / hanging
  const blendedHourly = hours > 0 ? hourDollars / hours : null
  return {
    dollarsPerLb,
    hoursPerLb: blendedHourly ? dollarsPerLb / blendedHourly : null,
    blendedHourly,
    packOut: packed > 0 ? packed / hanging : null,
    weeksUsed: used,
    weeksSkipped: skipped,
    payroll: Math.round(payroll),
    hangingLbs: Math.round(hanging),
    from, to,
  }
}

// ── Smokehouse ────────────────────────────────────────────────────────────
// Billed per raw lb IN (Charlie, 2026-09-13), at the custom item's QBO price.
// The cut sheet's smokehouse block: sticks/brats/summer/jerky are arrays of
// { flavor, lbs, cheese }; hotDogs is one { lbs, cheese }.

type Json = Record<string, unknown>
const asObj = (v: unknown): Json => (v && typeof v === 'object' ? v as Json : {})
const asArr = (v: unknown): Json[] => (Array.isArray(v) ? v as Json[] : [])

export interface SmokeLine { item: 'sticks' | 'brats' | 'summer' | 'jerky' | 'hotDogs'; lbs: number; cheese: boolean }

export function smokeLines(data: unknown): SmokeLine[] {
  const sh = asObj(asObj(data).smokehouse)
  const out: SmokeLine[] = []
  for (const item of ['sticks', 'brats', 'summer', 'jerky'] as const) {
    for (const it of asArr(sh[item])) {
      const lbs = Number(it.lbs)
      if (lbs > 0) out.push({ item, lbs, cheese: Boolean(it.cheese) })
    }
  }
  const hd = asObj(sh.hotDogs)
  if (Number(hd.lbs) > 0) out.push({ item: 'hotDogs', lbs: Number(hd.lbs), cheese: Boolean(hd.cheese) })
  return out
}

// QBO names, e.g. "BEEF CUSTOM STICKS W/CHEESE", "PORK CUSTOM BROTWURST WITH
// CHEESE", "CUSTOM BEEF JERKY". Pork and lamb carry only some of them, so a
// missing one falls back to the beef item.
const SMOKE_NAMES: Record<SmokeLine['item'], (sp: string, cheese: boolean) => string[]> = {
  sticks:  (sp, c) => [`${sp} CUSTOM STICKS${c ? ' W/CHEESE' : ''}`],
  brats:   (sp, c) => [`${sp} CUSTOM BROTWURST${c ? ' WITH CHEESE' : ''}`],
  summer:  (sp, c) => [`${sp} CUSTOM SUMMERS/SALAMI${c ? ' W/CHEESE' : ''}`],
  hotDogs: (sp, c) => [`${sp} CUSTOM HOT DOGS${c ? ' W/CHEESE' : ''}`],
  jerky:   (sp)    => [`CUSTOM ${sp} JERKY`],
}
const SPECIES_WORD: Record<string, string> = { Beef: 'BEEF', Hog: 'PORK', Lamb: 'LAMB' }

export async function loadSmokeRates(): Promise<Map<string, number>> {
  const { data } = await supabaseAdmin.from('qbo_items').select('name, sales_price, active').ilike('name', '%CUSTOM%')
  return new Map((data ?? []).filter(r => r.active !== false && Number(r.sales_price) > 0)
    .map(r => [String(r.name).toUpperCase().trim(), Number(r.sales_price)]))
}

export function smokeRate(rates: Map<string, number>, species: string, line: SmokeLine): number | null {
  for (const sp of [SPECIES_WORD[species] ?? 'BEEF', 'BEEF']) {
    for (const name of SMOKE_NAMES[line.item](sp, line.cheese)) {
      const r = rates.get(name)
      if (r != null) return r
    }
  }
  return null
}

// ── Per account ───────────────────────────────────────────────────────────

export type ValueKind = 'estimate' | 'open' | 'paid' | 'own' | 'no_weight' | 'unknown'
export type MoneyBucket = 'aging' | 'cutting' | 'smokehouse' | 'ready_unbilled' | 'billed_unpaid' | 'paid' | 'own' | 'none'

export interface AccountValue {
  kind: ValueKind
  bucket: MoneyBucket
  /** Dollars this account frees when it's paid: QBO balance, or the estimate. */
  dollars: number | null
  /** Estimated crew hours still ahead of it, office time included. */
  hours_left: number | null
  labor_left: number | null
  per_hour: number | null
  /** Short "where this came from" lines for the tooltip / detail. */
  basis: string[]
}

export interface ValueInputs {
  account: string
  species: string
  head_count: number
  stage: AnimalStage
  hanging_weight_lbs: number | null
  billing: { status: 'paid' | 'open' | 'none' | 'unknown'; balance: number }
  /** Pounds already boxed in this account's sessions. */
  boxed_lbs: number
  smoke: SmokeLine[]
}

const money = (n: number) => `$${n.toLocaleString('en-US', { maximumFractionDigits: 2 })}`
const r2 = (n: number) => Math.round(n * 100) / 100

export function valueAccount(v: ValueInputs, labor: LaborRate, smokeRates: Map<string, number>, officeMinutes: number): AccountValue {
  const basis: string[] = []
  const office = officeMinutes / 60
  const hrsPerLb = labor.hoursPerLb
  const hcw = v.hanging_weight_lbs && v.hanging_weight_lbs > 0 ? v.hanging_weight_lbs : null
  const smokeLbs = v.smoke.reduce((s, l) => s + l.lbs, 0)

  const stageBucket: MoneyBucket =
    v.stage === 'received' || v.stage === 'harvested' || v.stage === 'aging' ? 'aging'
    : v.stage === 'cutting' ? 'cutting'
    : v.stage === 'smokehouse' ? 'smokehouse'
    : 'ready_unbilled'

  // Work left, in hanging-lb terms, times the plant's hours per hanging lb.
  let workLbs: number | null = 0
  if (stageBucket === 'aging') {
    workLbs = hcw
    if (hcw) basis.push(`${Math.round(hcw)} lb hanging still to cut and pack`)
  } else if (stageBucket === 'cutting') {
    if (hcw && labor.packOut) {
      const expected = hcw * labor.packOut
      const left = Math.max(0, 1 - v.boxed_lbs / expected)
      workLbs = hcw * left
      basis.push(`${Math.round(v.boxed_lbs)} of ~${Math.round(expected)} lb boxed — ${Math.round(left * 100)}% of the cut left`)
    } else workLbs = hcw
  } else if (stageBucket === 'smokehouse') {
    workLbs = smokeLbs
    basis.push(smokeLbs ? `${smokeLbs} lb raw into the smokehouse` : 'no smokehouse pounds on the cut card')
  }
  const hours_left = hrsPerLb != null && workLbs != null ? r2(workLbs * hrsPerLb + office) : null
  basis.push(`+ ${officeMinutes} min office (invoice, pickup call)`)
  const labor_left = hours_left != null && labor.blendedHourly ? r2(hours_left * labor.blendedHourly) : null

  const done = (kind: ValueKind, bucket: MoneyBucket, dollars: number | null): AccountValue => ({
    kind, bucket, dollars: dollars != null ? r2(dollars) : null, hours_left, labor_left,
    per_hour: dollars != null && dollars > 0 && hours_left ? r2(dollars / hours_left) : null,
    basis,
  })

  if (isExcludedProducer(v.account)) {
    basis.unshift('Our own animal — sold at retail, never invoiced')
    return done('own', 'own', null)
  }
  if (v.billing.status === 'paid') {
    basis.unshift('Paid in QuickBooks — nothing left to collect, only the pickup')
    return done('paid', 'paid', 0)
  }
  if (v.billing.status === 'open') {
    basis.unshift(`${money(v.billing.balance)} due on the QuickBooks invoice`)
    return done('open', 'billed_unpaid', v.billing.balance)
  }

  // Not invoiced (or QuickBooks down): estimate from the service rates.
  if (!hcw && (v.species === 'Beef' || v.species === 'Hog')) {
    basis.unshift('No hanging weight yet — can\'t price it')
    return done(v.billing.status === 'unknown' ? 'unknown' : 'no_weight', stageBucket, null)
  }
  let est = 0
  if (v.species === 'Beef' || v.species === 'Hog') {
    const kill = killFeeCharge(v.species, hcw, 1, '')
    const cut = cutWrapCharge(v.species, hcw, 1, '')
    const rate = (kill?.rate ?? 0) + (cut?.rate ?? 0)
    est += (kill?.amount ?? 0) + (cut?.amount ?? 0)
    basis.unshift(`${Math.round(hcw!)} lb × $${rate.toFixed(2)} kill + cut & wrap`)
  } else if (v.species === 'Lamb' || v.species === 'Goat') {
    const head = Math.max(1, v.head_count)
    const flat = cutWrapCharge(v.species, null, 1, '')
    est += (flat?.amount ?? 0) * head
    basis.unshift(`${head} × ${money(flat?.amount ?? 0)} flat fee`)
  }
  const unpriced: string[] = []
  for (const line of v.smoke) {
    const rate = smokeRate(smokeRates, v.species, line)
    if (rate == null) { unpriced.push(line.item); continue }
    est += line.lbs * rate
  }
  if (smokeLbs) basis.splice(1, 0, `+ ${smokeLbs} lb smokehouse at the custom rate${unpriced.length ? ` (no price for ${unpriced.join(', ')})` : ''}`)
  return done(v.billing.status === 'unknown' ? 'unknown' : 'estimate', stageBucket, est)
}
