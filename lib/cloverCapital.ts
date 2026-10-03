// ──────────────────────────────────────────────────────────────────────────────
// The Clover Capital advance — where it stands, for the register close email
// and /billing. SERVER-ONLY.
//
// Clover's API can't see Clover Capital (its token can't read deposits or
// funding either — see lib/qboDeposits), so the advance itself is what a
// person reads off the Clover dashboard (Finances → Clover Capital) and
// types on /billing: advance amount, last payment date, paid to date, balance
// due. From there the app carries it forward on its own:
//
//   - each shop day the 5:00 PM report files the day's card batch and the 25%
//     Clover keeps from it (clover_card_days);
//   - Clover pays a day out two business days later (lib/dailyReport
//     expectedBankDate), so the dashboard's "Last Payment Date" says which
//     sales days are already in "paid to date". Later days are "on the way":
//     their holdback comes off the balance when they land;
//   - the recent pace (holdback per calendar day over the days on record)
//     gives an "about when" for the payoff.
//
// A dashboard figure is whole dollars and the holdback is 25% to the cent, so
// the estimate drifts by at most a few dollars a week; re-entering the
// dashboard numbers now and then puts it back on Clover's figure.
// ──────────────────────────────────────────────────────────────────────────────

import { readCloverDay, type DaySummary } from '@/lib/cloverSales'
import { cardGrossCents, defaultHoldbackCents, expectedBankDate } from '@/lib/qboDeposits'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { addDaysISO, daysBetweenISO } from '@/lib/dates'

export interface Advance {
  advance_number: string
  advance_cents: number
  payback_cents: number
  funded_date: string | null
  holdback_rate: number
  last_payment_date: string
  paid_cents: number
  balance_cents: number
  closed_date: string | null
  updated_by: string | null
  updated_at: string
}

export interface CardDay { business_date: string; card_gross_cents: number; holdback_cents: number }

/** The open advance (no closed date), the one most recently entered. */
export async function currentAdvance(): Promise<Advance | null> {
  const { data, error } = await supabaseAdmin.from('clover_capital_advance').select('*')
    .is('closed_date', null).order('updated_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw new Error(`Couldn't read the Clover Capital advance: ${error.message}`)
  if (!data) return null
  return { ...data, holdback_rate: Number(data.holdback_rate) } as Advance
}

export interface AdvanceInput {
  advance_number: string
  advance_cents: number
  funded_date: string | null
  holdback_rate?: number
  last_payment_date: string
  paid_cents: number
  balance_cents: number
  closed_date?: string | null
  updated_by: string
}

const ISO = /^\d{4}-\d{2}-\d{2}$/

/** Save what the Clover dashboard shows. Payback is paid + balance. */
export async function saveAdvance(input: AdvanceInput): Promise<Advance> {
  const num = input.advance_number.trim()
  if (!num) throw new Error('Advance number is required')
  if (!ISO.test(input.last_payment_date)) throw new Error('Last payment date must be YYYY-MM-DD')
  if (input.funded_date && !ISO.test(input.funded_date)) throw new Error('Funded date must be YYYY-MM-DD')
  if (input.closed_date && !ISO.test(input.closed_date)) throw new Error('Closed date must be YYYY-MM-DD')
  for (const [k, v] of [['Advance amount', input.advance_cents], ['Paid to date', input.paid_cents], ['Balance due', input.balance_cents]] as const) {
    if (!Number.isInteger(v) || v < 0) throw new Error(`${k} must be a dollar amount`)
  }
  const rate = input.holdback_rate ?? 0.25
  if (!(rate > 0 && rate <= 1)) throw new Error('Holdback rate must be between 0 and 1')
  const row = {
    advance_number: num,
    advance_cents: input.advance_cents,
    payback_cents: input.paid_cents + input.balance_cents,
    funded_date: input.funded_date || null,
    holdback_rate: rate,
    last_payment_date: input.last_payment_date,
    paid_cents: input.paid_cents,
    balance_cents: input.balance_cents,
    closed_date: input.closed_date || null,
    updated_by: input.updated_by,
    updated_at: new Date().toISOString(),
  }
  const { data, error } = await supabaseAdmin.from('clover_capital_advance').upsert(row).select('*').single()
  if (error) throw new Error(`Couldn't save the advance: ${error.message}`)
  return { ...data, holdback_rate: Number(data.holdback_rate) } as Advance
}

// ── Card days ───────────────────────────────────────────────────────────────

/** File a day's card batch from a summary already in hand (the report's own read). */
export async function recordCardDay(s: DaySummary): Promise<void> {
  const gross = cardGrossCents(s)
  const { error } = await supabaseAdmin.from('clover_card_days').upsert({
    business_date: s.date, card_gross_cents: gross, holdback_cents: defaultHoldbackCents(gross), read_at: new Date().toISOString(),
  })
  if (error) throw new Error(`Couldn't file the card day ${s.date}: ${error.message}`)
}

async function storedDays(from: string, to: string): Promise<Map<string, CardDay>> {
  const { data, error } = await supabaseAdmin.from('clover_card_days')
    .select('business_date, card_gross_cents, holdback_cents').gte('business_date', from).lte('business_date', to)
  if (error) throw new Error(`Couldn't read the card days: ${error.message}`)
  return new Map((data ?? []).map(r => [r.business_date as string, r as CardDay]))
}

function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let d = from; d <= to; d = addDaysISO(d, 1)) out.push(d)
  return out
}

/**
 * Read from Clover, and file, days in [from, to] that aren't on record yet —
 * oldest first, at most `max` of them (a day is a few dozen Clover calls).
 * Returns the days still missing afterwards.
 */
export async function fillCardDays(from: string, to: string, max: number): Promise<string[]> {
  const have = await storedDays(from, to)
  const missing = eachDay(from, to).filter(d => !have.has(d))
  let reads = 0
  for (const d of missing) {
    if (reads >= max) break
    await recordCardDay(await readCloverDay(d))
    reads++
  }
  return missing.slice(reads)
}

// ── Where the advance stands ────────────────────────────────────────────────

export interface CapitalStatus {
  advance: Advance
  /** Sales days Clover hasn't paid out yet (through `today`), whose holdback is still to come off. */
  pending: { from: string; to: string; days: number; holdbackCents: number; missing: string[] }
  /** Balance once the pending days land. */
  estBalanceCents: number
  /** Holdback per calendar day over the days on record, when a week or more is. */
  pace: { perDayCents: number; days: number } | null
  /** About when the advance pays off at that pace. */
  payoffDate: string | null
}

const PACE_DAYS = 28
const PACE_MIN_DAYS = 7

/**
 * The advance as of `today`. Reads up to `maxReads` pending days from Clover
 * that aren't on record yet (the report files today's day itself first).
 */
export async function capitalStatus(today: string, maxReads = 4): Promise<CapitalStatus | null> {
  const advance = await currentAdvance()
  if (!advance) return null

  // Sales days whose payout comes after the dashboard's last payment.
  const lp = advance.last_payment_date
  const pendingDays = eachDay(addDaysISO(lp, -6), today).filter(d => expectedBankDate(d) > lp)
  const from = pendingDays[0] ?? today
  let missing: string[] = []
  if (pendingDays.length) missing = await fillCardDays(from, today, maxReads)

  const windowFrom = addDaysISO(today, -(PACE_DAYS - 1))
  const stored = await storedDays(windowFrom < from ? windowFrom : from, today)

  const holdbackCents = pendingDays.reduce((sum, d) => sum + (stored.get(d)?.holdback_cents ?? 0), 0)
  const estBalanceCents = advance.balance_cents - holdbackCents

  // Pace: the unbroken run of days on record ending today.
  let runFrom: string | null = null
  for (let d = today; d >= windowFrom; d = addDaysISO(d, -1)) {
    if (!stored.has(d)) break
    runFrom = d
  }
  let pace: CapitalStatus['pace'] = null
  if (runFrom) {
    const days = daysBetweenISO(runFrom, today) + 1
    if (days >= PACE_MIN_DAYS) {
      const sum = eachDay(runFrom, today).reduce((s, d) => s + (stored.get(d)?.holdback_cents ?? 0), 0)
      if (sum > 0) pace = { perDayCents: Math.round(sum / days), days }
    }
  }
  const payoffDate = pace && estBalanceCents > 0 ? addDaysISO(today, Math.ceil(estBalanceCents / pace.perDayCents)) : null

  return {
    advance,
    pending: { from, to: today, days: pendingDays.length, holdbackCents, missing },
    estBalanceCents, pace, payoffDate,
  }
}
