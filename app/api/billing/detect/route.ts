export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { killFeeCharge, cutWrapCharge, PORTION_FRACTION, type BillingCharge } from '@/lib/billingRules'
import type { AppointmentCustomer } from '@/lib/types'

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
}

// One share entry per payer: customer-pays portions individually, the
// producer picks up whatever fraction is left.
function payerShares(producer: string, appointmentCustomers: AppointmentCustomer[]): PayerShare[] {
  const byName = new Map<string, { fraction: number; allQuarters: boolean }>()
  let customerPaid = 0
  for (const c of appointmentCustomers) {
    if ((c.payment_responsibility ?? 'producer') !== 'customer') continue
    if (!c.customer_name.trim()) continue
    const frac = PORTION_FRACTION[c.portion] ?? 0
    if (frac <= 0) continue
    customerPaid += frac
    const prev = byName.get(c.customer_name.trim())
    byName.set(c.customer_name.trim(), {
      fraction: (prev?.fraction ?? 0) + frac,
      allQuarters: (prev?.allQuarters ?? true) && c.portion === 'Quarter',
    })
  }
  const shares: PayerShare[] = [...byName.entries()].map(([name, s]) => ({
    name, isProducer: false, fraction: Math.min(s.fraction, 1), allQuarters: s.allQuarters,
  }))
  const remainder = Math.max(0, 1 - customerPaid)
  if (remainder > 0.001) shares.push({ name: producer, isProducer: true, fraction: remainder, allQuarters: remainder === 0.25 })
  return shares
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))
    const since = typeof body.since === 'string' && body.since ? body.since : '2026-07-11'

    const [{ data: harvests, error: hErr }, { data: links, error: lErr }] = await Promise.all([
      supabase
        .from('harvest_log')
        .select('id, appointment_id, harvest_date, species, carcass_tag, hot_carcass_weight_lbs, status, producer')
        .gte('harvest_date', since)
        .not('producer', 'is', null)
        .neq('producer', ''),
      supabase.from('producer_qbo_links').select('producer_name, qbo_customer_id'),
    ])
    if (hErr) throw new Error(hErr.message)
    if (lErr) throw new Error(lErr.message)
    const rows = (harvests ?? []) as HarvestRow[]
    const linkByName = new Map((links ?? []).map(l => [l.producer_name, l.qbo_customer_id]))

    // Appointments for split/payer info + cut dates for service_date
    const apptIds = [...new Set(rows.map(r => r.appointment_id).filter(Boolean))] as string[]
    const [{ data: appts }, { data: cutDates }] = await Promise.all([
      apptIds.length
        ? supabase.from('harvest_appointments').select('id, customers').in('id', apptIds)
        : Promise.resolve({ data: [] }),
      apptIds.length
        ? supabase.from('cut_schedule_items').select('appointment_id, schedule_date').in('appointment_id', apptIds)
        : Promise.resolve({ data: [] }),
    ])
    const apptById = new Map((appts ?? []).map(a => [a.id, (a.customers ?? []) as AppointmentCustomer[]]))
    const cutDateByAppt = new Map<string, string>()
    for (const c of cutDates ?? []) {
      const prev = cutDateByAppt.get(c.appointment_id)
      if (!prev || c.schedule_date > prev) cutDateByAppt.set(c.appointment_id, c.schedule_date)
    }

    interface EventRow {
      service_date: string; rule_key: string; source_table: string; source_id: string
      customer_name: string; qbo_customer_id: string; qbo_item_id: string
      description: string; qty: number; unit: string; rate: number; amount: number; status: string
    }
    const events: EventRow[] = []
    const unbillable: string[] = []
    const today = new Date().toISOString().slice(0, 10)

    for (const h of rows) {
      const tag = h.carcass_tag || h.id.slice(0, 8)
      const shares = payerShares(h.producer!, h.appointment_id ? apptById.get(h.appointment_id) ?? [] : [])

      const pushCharge = (charge: BillingCharge | null, payer: PayerShare, serviceDate: string, why: string) => {
        if (!charge) { unbillable.push(`${tag} (${h.species}): ${why}`); return }
        events.push({
          service_date: serviceDate,
          rule_key: charge.ruleKey,
          source_table: 'harvest_log',
          source_id: h.id,
          customer_name: payer.name,
          qbo_customer_id: payer.isProducer ? linkByName.get(payer.name) ?? '' : '',
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
        const charge = killFeeCharge(h.species, h.hot_carcass_weight_lbs, p.fraction, tag)
        if (!charge && (h.species === 'Beef' || h.species === 'Hog') && !h.hot_carcass_weight_lbs) {
          unbillable.push(`${tag} (${h.species}): kill fee needs a carcass weight`)
        } else if (charge) {
          pushCharge(charge, p, h.harvest_date, 'kill fee rule missing')
        }
        // Goat: kill is inside the flat processing fee — intentionally no event
      }

      // cut & wrap — only once the carcass is cut
      if (h.status === 'cut') {
        const cutDate = (h.appointment_id && cutDateByAppt.get(h.appointment_id)) || today
        for (const p of shares) {
          // beef quarters bill at the quarters rate; a payer with mixed
          // portions (or the producer remainder) uses the whole/half rate
          const fractionForRate = p.allQuarters ? 0.25 : p.fraction
          const charge = cutWrapCharge(h.species, h.hot_carcass_weight_lbs, p.fraction, tag)
          if (charge && h.species === 'Beef' && p.allQuarters) {
            const quarterCharge = cutWrapCharge('Beef', h.hot_carcass_weight_lbs, fractionForRate, tag)
            if (quarterCharge) {
              // recompute at the quarters rate over the payer's full fraction
              charge.qboItemId = quarterCharge.qboItemId
              charge.qboItemName = quarterCharge.qboItemName
              charge.rate = quarterCharge.rate
              charge.qty = Math.round(h.hot_carcass_weight_lbs! * p.fraction * 100) / 100
              charge.amount = Math.round(charge.qty * charge.rate * 100) / 100
              charge.description = `${charge.qboItemName} — carcass ${tag}, ${charge.qty} lbs`
            }
          }
          pushCharge(charge, p, cutDate, 'cut & wrap needs a carcass weight')
        }
      }
    }

    let created = 0
    for (let i = 0; i < events.length; i += 200) {
      const batch = events.slice(i, i + 200)
      const { data, error } = await supabase
        .from('billable_events')
        .upsert(batch, { onConflict: 'rule_key,source_table,source_id,customer_name', ignoreDuplicates: true })
        .select('id')
      if (error) throw new Error(error.message)
      created += data?.length ?? 0
    }

    return NextResponse.json({
      ok: true,
      scanned: rows.length,
      candidates: events.length,
      created,
      alreadyDetected: events.length - created,
      unbillable: [...new Set(unbillable)],
      since,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
