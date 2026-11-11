export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
// producer_qbo_links is under RLS; the anon key can no longer write it and
// this route is staff-side QuickBooks linking. Server-side only.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { killFeeCharge, cutWrapCharge, isExcludedProducer, PORTION_FRACTION, type BillingCharge, type RateOverride } from '@/lib/billingRules'
import { loadLiveRates } from '@/lib/billingRates'
import type { AppointmentCustomer } from '@/lib/types'
import { selectIn } from '@/lib/selectIn'
import { isoDate } from '@/lib/dates'

// Billing detector: scans operational records and writes pending rows into
// billable_events. Idempotent — the unique key (rule, source, customer) makes
// re-runs no-ops, so it can run on every page load or a schedule.
//
// Triggers today:
//   kill_fee  — harvest_log row exists (chilling/complete/cut all mean killed)
//   cut_wrap  — harvest_log.status = 'cut'
// Splits: charges divide across the appointment's portions; portions marked
// payment_responsibility='customer' bill to that customer, the remainder
// rolls to the producer. Quarter share = carcass weight / 4.
//
// Rates (2026-11-11): priced from QuickBooks live, never from the fallback
// numbers in lib/billingRules.ts — see lib/billingRates.ts. A negotiated
// kill / processing $/lb on the cut card linked to a portion replaces the
// standard rate for that portion. Pending charges are re-priced on every run
// so a rate change or a card priced late reaches them; anything already
// skipped, superseded or pushed to QuickBooks is never touched.

interface HarvestRow {
  id: string
  appointment_id: string | null
  harvest_date: string
  species: string
  carcass_tag: string | null
  hot_carcass_weight_lbs: number | null
  status: string
  producer: string | null
}

interface PayerShare {
  name: string
  isProducer: boolean
  fraction: number
  allQuarters: boolean
  /** The appointment slots this share covers — where its cut cards hang. */
  slots: AppointmentCustomer[]
}

// One share entry per payer: customer-pays portions individually, the
// producer picks up whatever fraction is left (and every slot not marked
// customer-pays, which is where the producer's cut cards hang).
function payerShares(producer: string, appointmentCustomers: AppointmentCustomer[]): PayerShare[] {
  const byName = new Map<string, { fraction: number; allQuarters: boolean; slots: AppointmentCustomer[] }>()
  const producerSlots: AppointmentCustomer[] = []
  let customerPaid = 0
  for (const c of appointmentCustomers) {
    const frac = PORTION_FRACTION[c.portion] ?? 0
    if ((c.payment_responsibility ?? 'producer') !== 'customer' || !c.customer_name.trim() || frac <= 0) {
      producerSlots.push(c)
      continue
    }
    customerPaid += frac
    const prev = byName.get(c.customer_name.trim())
    byName.set(c.customer_name.trim(), {
      fraction: (prev?.fraction ?? 0) + frac,
      allQuarters: (prev?.allQuarters ?? true) && c.portion === 'Quarter',
      slots: [...(prev?.slots ?? []), c],
    })
  }
  const shares: PayerShare[] = [...byName.entries()].map(([name, s]) => ({
    name, isProducer: false, fraction: Math.min(s.fraction, 1), allQuarters: s.allQuarters, slots: s.slots,
  }))
  const remainder = Math.max(0, 1 - customerPaid)
  if (remainder > 0.001) shares.push({ name: producer, isProducer: true, fraction: remainder, allQuarters: remainder === 0.25, slots: producerSlots })
  return shares
}

type CardRates = { kill: number | null; proc: number | null }

// The negotiated rates that apply to one payer's share. Every cut card on the
// share's slots has to agree, a card with no rate counting as "standard": two
// cards on one bill at different prices (or one negotiated and one not) can't
// be folded into one line honestly, so that share is held back for a person.
function shareOverride(share: PayerShare, cardRates: Map<string, CardRates>): { override: RateOverride } | { conflict: string } {
  const cards = share.slots.map(s => s.linked_cutting_instruction_id).filter(Boolean)
  if (!cards.length) return { override: {} }
  const pick = (field: keyof CardRates) => {
    const seen = new Set(cards.map(id => {
      const v = cardRates.get(id)?.[field]
      return v != null && v > 0 ? v.toFixed(4) : 'standard'
    }))
    return seen
  }
  const kill = pick('kill'), proc = pick('proc')
  if (kill.size > 1 || proc.size > 1) {
    return { conflict: `cut cards on ${share.name}'s share disagree on rates (${[...kill].join(' / ')} kill, ${[...proc].join(' / ')} processing) — make them match on the cut card` }
  }
  const num = (set: Set<string>) => { const v = [...set][0]; return v === 'standard' ? null : Number(v) }
  return { override: { kill: num(kill), proc: num(proc) } }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const since = typeof body.since === 'string' && body.since ? body.since : '2026-07-11'

    // QuickBooks first: if its prices can't be read, nothing gets written.
    const live = await loadLiveRates()

    const [{ data: harvests, error: hErr }, { data: links, error: lErr }, { data: custLinks, error: cErr }] = await Promise.all([
      supabaseAdmin
        .from('harvest_log')
        .select('id, appointment_id, harvest_date, species, carcass_tag, hot_carcass_weight_lbs, status, producer')
        .gte('harvest_date', since)
        .not('producer', 'is', null)
        .neq('producer', ''),
      supabaseAdmin.from('producer_qbo_links').select('producer_name, qbo_customer_id'),
      supabaseAdmin.from('customer_qbo_links').select('customer_name, qbo_customer_id'),
    ]) as [
      { data: HarvestRow[] | null; error: { message: string } | null },
      { data: { producer_name: string; qbo_customer_id: string }[] | null; error: { message: string } | null },
      { data: { customer_name: string; qbo_customer_id: string }[] | null; error: { message: string } | null },
    ]
    if (hErr) throw new Error(hErr.message)
    if (lErr) throw new Error(lErr.message)
    if (cErr) throw new Error(cErr.message)
    const rows = (harvests ?? []) as HarvestRow[]
    const linkByName = new Map((links ?? []).map(l => [l.producer_name, l.qbo_customer_id]))
    // The cut customer's own QuickBooks identity. Before this table existed the
    // customer side of every split carried an empty id, so a charge billed to
    // the person who actually bought the animal could never reach QuickBooks
    // (Charlie, 2026-08-22). Linked on /billing -> Cut customers.
    const custLinkByName = new Map((custLinks ?? []).map(l => [l.customer_name, l.qbo_customer_id]))

    // Appointments for split/payer info + cut dates for service_date
    const apptIds = [...new Set(rows.map(r => r.appointment_id).filter(Boolean))] as string[]
    const logIds = rows.map(r => r.id)
    // The day the carcass was actually broken, which is the service date on a
    // cut & wrap line. It comes off the pack scan: cut_schedule_items is the
    // PLAN, and its `appointment_id` holds a harvest_log id rather than the
    // appointment id this route was matching it against — so before
    // 2026-08-27 that lookup never hit and every cut & wrap charge was dated
    // "today", whatever day the detector happened to run.
    // Both lists grow with every kill day and `since` above is a fixed date,
    // so they only ever get longer. A whole id list in one URL is what took
    // /api/exec/revenue down at 414 carcasses; this one was at 287 and
    // climbing (2026-09-21). See lib/selectIn.
    const [appts, packs] = await Promise.all([
      selectIn<{ id: string; customers: AppointmentCustomer[] | null }>(
        apptIds,
        batch => supabaseAdmin.from('harvest_appointments').select('id, customers').in('id', batch),
      ),
      selectIn<{ linked_harvest_id: string; pack_date: string }>(
        logIds,
        batch => supabaseAdmin.from('processing_inputs')
          .select('linked_harvest_id, pack_date')
          .in('linked_harvest_id', batch)
          .not('pack_date', 'is', null),
      ),
    ])
    const apptById = new Map((appts ?? []).map(a => [a.id, (a.customers ?? []) as AppointmentCustomer[]]))

    // Negotiated rates off every cut card linked to these appointments.
    const cardIds = [...new Set((appts ?? []).flatMap(a => (a.customers ?? []).map(c => c.linked_cutting_instruction_id).filter(Boolean)))]
    const cards = await selectIn<{ id: string; kill_price_per_lb: number | string | null; processing_price_per_lb: number | string | null }>(
      cardIds,
      batch => supabaseAdmin.from('cutting_instructions').select('id, kill_price_per_lb, processing_price_per_lb').in('id', batch),
    )
    const toNum = (v: number | string | null) => (v == null || v === '' ? null : Number(v))
    const cardRates = new Map(cards.map(c => [c.id, { kill: toNum(c.kill_price_per_lb), proc: toNum(c.processing_price_per_lb) }]))
    // First scan wins: a carcass packed over two days was cut on the first.
    const cutDateByLogId = new Map<string, string>()
    for (const p of packs ?? []) {
      const id = p.linked_harvest_id as string
      const d = p.pack_date as string
      const prev = cutDateByLogId.get(id)
      if (!prev || d < prev) cutDateByLogId.set(id, d)
    }

    interface EventRow {
      service_date: string; rule_key: string; source_table: string; source_id: string
      customer_name: string; qbo_customer_id: string; qbo_item_id: string
      description: string; qty: number; unit: string; rate: number; amount: number; status: string
    }
    const events: EventRow[] = []
    const unbillable: string[] = []
    // Shop clock, not UTC: an evening run is still today in Forsyth.
    const today = isoDate()

    let excluded = 0
    const supersededLambIds: string[] = []
    for (const h of rows) {
      // Own animals (producer CMC) are opportunity cost, never invoiced.
      if (isExcludedProducer(h.producer!)) { excluded++; continue }
      const tag = h.carcass_tag || h.id.slice(0, 8)
      const shares = payerShares(h.producer!, h.appointment_id ? apptById.get(h.appointment_id) ?? [] : [])

      // Who QuickBooks bills: a customer-pays share uses the QBO customer
      // picked on the booking slot when there is one, else the name link.
      const qboCustomerFor = (payer: PayerShare) => payer.isProducer
        ? linkByName.get(payer.name) ?? ''
        : payer.slots.map(s => s.qbo_customer_id).find(Boolean) ?? custLinkByName.get(payer.name) ?? ''

      const overrides = new Map<PayerShare, RateOverride | null>()
      for (const p of shares) {
        const o = shareOverride(p, cardRates)
        if ('conflict' in o) { unbillable.push(`${tag} (${h.species}): ${o.conflict}`); overrides.set(p, null) }
        else overrides.set(p, o.override)
      }

      const pushCharge = (charge: BillingCharge | null, payer: PayerShare, serviceDate: string, why: string) => {
        if (!charge) { unbillable.push(`${tag} (${h.species}): ${why}`); return }
        events.push({
          service_date: serviceDate,
          rule_key: charge.ruleKey,
          source_table: 'harvest_log',
          source_id: h.id,
          customer_name: payer.name,
          qbo_customer_id: qboCustomerFor(payer),
          qbo_item_id: charge.qboItemId,
          description: charge.description,
          qty: charge.qty,
          unit: charge.unit,
          rate: charge.rate,
          amount: charge.amount,
          status: 'pending',
        })
      }

      // kill fee — the row existing means the animal was harvested
      for (const p of shares) {
        const override = overrides.get(p)
        if (override === null) continue // rate conflict, reported above
        const charge = killFeeCharge(h.species, h.hot_carcass_weight_lbs, p.fraction, tag, live.rates, override)
        if (!charge && (h.species === 'Beef' || h.species === 'Hog') && !h.hot_carcass_weight_lbs) {
          unbillable.push(`${tag} (${h.species}): kill fee needs a carcass weight`)
        } else if (charge) {
          pushCharge(charge, p, h.harvest_date, 'kill fee rule missing')
        } else if (h.species !== 'Goat') {
          unbillable.push(`${tag} (${h.species}): no QuickBooks price for the kill fee`)
        }
        // Goat: kill is inside the flat processing fee — intentionally no event
      }

      // cut & wrap — only once the carcass is cut
      if (h.status === 'cut') {
        // fully processed lamb: the $180 all-in fee replaces the $50
        // kill-only fee, so retire any still-pending kill fee for it
        if (h.species === 'Lamb') supersededLambIds.push(h.id)
        const cutDate = cutDateByLogId.get(h.id) || today
        for (const p of shares) {
          const override = overrides.get(p)
          if (override === null) continue // rate conflict, reported above
          // beef quarters bill at the quarters rate over the payer's full
          // fraction; a payer with mixed portions (or the producer remainder)
          // uses the whole/half rate
          const rateFraction = h.species === 'Beef' && p.allQuarters ? 0.25 : p.fraction
          let charge = cutWrapCharge(h.species, h.hot_carcass_weight_lbs, rateFraction, tag, live.rates, override)
          if (charge && rateFraction !== p.fraction) {
            const qty = Math.round(h.hot_carcass_weight_lbs! * p.fraction * 100) / 100
            charge = { ...charge, qty, amount: Math.round(qty * charge.rate * 100) / 100,
              description: charge.description.replace(/, [\d.]+ lbs/, `, ${qty} lbs`) }
          }
          pushCharge(charge, p, cutDate,
            h.hot_carcass_weight_lbs ? 'no QuickBooks price for cut & wrap' : 'cut & wrap needs a carcass weight')
        }
      }
    }

    // Drop lamb kill-fee candidates for lambs that reached full processing,
    // and retire any previously detected pending ones.
    const supersededSet = new Set(supersededLambIds)
    const finalEvents = events.filter(e => !(e.rule_key === 'kill_fee' && supersededSet.has(e.source_id)))
    let superseded = 0
    if (supersededLambIds.length > 0) {
      const { data: sup, error: supErr } = await supabaseAdmin
        .from('billable_events')
        .update({ status: 'superseded' })
        .eq('rule_key', 'kill_fee')
        .in('source_id', supersededLambIds)
        .eq('status', 'pending')
        .select('id')
      if (supErr) throw new Error(supErr.message)
      superseded = sup?.length ?? 0
    }

    let created = 0
    for (let i = 0; i < finalEvents.length; i += 200) {
      const batch = finalEvents.slice(i, i + 200)
      const { data, error } = await supabaseAdmin
        .from('billable_events')
        .upsert(batch, { onConflict: 'rule_key,source_table,source_id,customer_name', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(error.message)
      created += data?.length ?? 0
    }

    // Re-price charges still pending: a QuickBooks price change, or a cut card
    // priced after its animal was detected, has to reach them before they're
    // invoiced. Only pending rows; the filter is repeated on the update itself.
    const keyOf = (e: { rule_key: string; source_id: string; customer_name: string }) => `${e.rule_key}|${e.source_id}|${e.customer_name}`
    const wanted = new Map(finalEvents.map(e => [keyOf(e), e]))
    const existing = await selectIn<{ id: string; rule_key: string; source_id: string; customer_name: string; qbo_item_id: string; qbo_customer_id: string; description: string; qty: number | string; rate: number | string; amount: number | string }>(
      [...new Set(finalEvents.map(e => e.source_id))],
      batch => supabaseAdmin.from('billable_events')
        .select('id, rule_key, source_id, customer_name, qbo_item_id, qbo_customer_id, description, qty, rate, amount')
        .eq('source_table', 'harvest_log').eq('status', 'pending').in('source_id', batch),
    )
    const cents = (n: number | string) => Math.round(Number(n) * 100)
    let repriced = 0
    for (const row of existing) {
      const e = wanted.get(keyOf(row))
      if (!e) continue
      const changed = row.qbo_item_id !== e.qbo_item_id || row.description !== e.description
        || Math.round(Number(row.qty) * 100) !== Math.round(e.qty * 100)
        || Math.round(Number(row.rate) * 10000) !== Math.round(e.rate * 10000)
        || cents(row.amount) !== cents(e.amount)
        || (!row.qbo_customer_id && !!e.qbo_customer_id)
      if (!changed) continue
      const { error } = await supabaseAdmin.from('billable_events')
        .update({
          qbo_item_id: e.qbo_item_id, description: e.description, qty: e.qty, rate: e.rate, amount: e.amount,
          // Fill a missing QuickBooks customer; never swap one a person already has.
          ...(row.qbo_customer_id ? {} : { qbo_customer_id: e.qbo_customer_id }),
        })
        .eq('id', row.id).eq('status', 'pending')
      if (error) throw new Error(error.message)
      repriced++
    }

    return NextResponse.json({
      ok: true,
      repriced,
      rateProblems: live.problems,
      rateDrift: live.drift,
      scanned: rows.length,
      excluded,                  // own animals (CMC)
      supersededLambKillFees: superseded,
      candidates: finalEvents.length,
      created,
      alreadyDetected: finalEvents.length - created,
      unbillable: [...new Set(unbillable)],
      since,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
