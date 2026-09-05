export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { INCOME_ACCOUNT_ENTERPRISE } from '@/lib/revenueRecognition'
import { dayColumns, fetchProfitAndLossByDay, leafAccountSeries } from '@/lib/qboReports'
import { addDaysISO, mondayOfISO } from '@/lib/dates'

// GET /api/exec/inventory?weeks=8 — what our OWN meat is worth at the price on
// the label (Charlie, 2026-09-04, filed on /exec: "Can we add an inventory
// valuation at sales price here?").
//
// Two honest numbers and one estimate, all restricted to animals Cowboy Meat
// owns. A producer's custom animal is their inventory, not ours — its value to
// us is the processing fee, which the receivables section already covers.
//
//   packed  — every scan into a CMC session's box, times the PLU's label price,
//             by the week it was packed. This is retail value CREATED, straight
//             off the scanner.
//   sold    — the retail income accounts in QuickBooks, by day, from the same
//             P&L pull the revenue-recognition section uses. Retail value that
//             LEFT.
//   hanging — own carcasses in the cooler that no cut session has scanned yet,
//             priced at the retail-per-hanging-pound the scanner has actually
//             measured on our own past sessions (by species).
//
// What this is NOT: a freezer balance. Nothing counts a package out of the
// case when it sells, so packed-minus-sold is a flow, not a level, until
// somebody counts the freezer once and anchors it. That is the next step and
// it is said on the page rather than faked here.

const OWN_PRODUCER = /cowboy\s*meat|^\s*cmc\b/i
// Session names the crew uses for our own product: "CMC", "CMC 2", "CMC Retail
// 659", "26188 CMC Retail", "Retail 26153", "Lamb CMC Retail". A customer whose
// surname happens to contain these letters ("Cmcarthy") does not match — the
// token has to stand alone.
const OWN_SESSION = /(^|\s)(cmc|retail)(\s|$|\d)/i

// Label price is what the package rings up at. `price` is the scale's price;
// a penny there is the placeholder for service-only PLUs (wild game), where the
// Clover retail price is the real one.
function labelPrice(p: { price: number | null; retail_price: number | null }): number {
  const scale = Number(p.price ?? 0)
  if (scale > 0.05) return scale
  return Number(p.retail_price ?? 0)
}

type Q<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>

// Supabase caps a select at 1000 rows and says nothing; eight weeks of retail
// scans is several times that.
async function all<T>(build: (from: number, to: number) => Q<T>): Promise<T[]> {
  const out: T[] = []
  const page = 1000
  for (let from = 0; ; from += page) {
    const { data, error } = await build(from, from + page - 1)
    if (error) throw new Error(error.message)
    out.push(...(data ?? []))
    if (!data || data.length < page) break
  }
  return out
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

const r0 = (n: number) => Math.round(n)
const r2 = (n: number) => Math.round(n * 100) / 100

interface HarvestRow {
  id: string; harvest_date: string; species: string | null; status: string | null; producer: string | null
  hot_carcass_weight_lbs: number | null; half_1_weight_lbs: number | null; half_2_weight_lbs: number | null
}
const carcassLbs = (h: HarvestRow) =>
  h.hot_carcass_weight_lbs != null
    ? Number(h.hot_carcass_weight_lbs)
    : Number(h.half_1_weight_lbs ?? 0) + Number(h.half_2_weight_lbs ?? 0)

export interface InventoryWeek {
  week: string
  packedLbs: number
  packedRetail: number
  /** null when QuickBooks could not be read; 0 is a real zero. */
  soldRetail: number | null
}

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    const weeks = Math.min(Math.max(Number(new URL(req.url).searchParams.get('weeks')) || 8, 4), 26)
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const thisWeek = mondayOfISO(today)
    const start = addDaysISO(thisWeek, -7 * (weeks - 1))
    // The $/hanging-lb rate wants more history than the chart shows.
    const rateStart = addDaysISO(today, -180)

    // ── Own sessions, and the boxes + scans inside them ───────────────────────
    const sessions = await all<{ customer_name: string; session_date: string; status: string }>((a, b) =>
      supabaseAdmin.from('processing_sessions').select('customer_name, session_date, status')
        .gte('session_date', rateStart).range(a, b))
    const own = sessions.filter(s => OWN_SESSION.test(s.customer_name ?? ''))
    const key = (name: string, date: string) => `${name}|${date}`
    const ownKeys = new Set(own.map(s => key(s.customer_name, s.session_date)))

    const boxes = (await all<{ id: string; customer_name: string; pack_date: string }>((a, b) =>
      supabaseAdmin.from('boxes').select('id, customer_name, pack_date')
        .gte('pack_date', rateStart).range(a, b)))
      .filter(bx => ownKeys.has(key(bx.customer_name, bx.pack_date)))
    const boxSession = new Map(boxes.map(bx => [bx.id, key(bx.customer_name, bx.pack_date)]))

    type Scan = { box_id: string; plu_number: string | null; item_name: string | null; weight_lbs: number | null }
    const scans: Scan[] = []
    for (const ids of chunk(boxes.map(bx => bx.id), 150)) {
      scans.push(...await all<Scan>((a, b) =>
        supabaseAdmin.from('box_scans').select('box_id, plu_number, item_name, weight_lbs').in('box_id', ids).range(a, b)))
    }

    const plus = await all<{ plu_number: string; price: number | null; retail_price: number | null }>((a, b) =>
      supabaseAdmin.from('plu_items').select('plu_number, price, retail_price').range(a, b))
    const priceOf = new Map(plus.map(p => [p.plu_number, labelPrice(p)]))

    // Retail value per session, plus the weekly packed series for the chart.
    const sessionRetail = new Map<string, number>()
    const weekMap = new Map<string, InventoryWeek>()
    for (let w = start; w <= thisWeek; w = addDaysISO(w, 7)) {
      weekMap.set(w, { week: w, packedLbs: 0, packedRetail: 0, soldRetail: null })
    }
    // A scan against a PLU with no real price counts as $0 and is named on the
    // page, because the fix is a price on the PLU, not a guess here. The first
    // pull found 1,186 patty-box scans on a deleted penny PLU.
    let unpricedScans = 0
    const unpricedBy = new Map<string, { plu: string; item: string; scans: number; lbs: number }>()
    for (const sc of scans) {
      const sKey = boxSession.get(sc.box_id)
      if (!sKey) continue
      const lbs = Number(sc.weight_lbs ?? 0)
      const price = priceOf.get(sc.plu_number ?? '') ?? 0
      if (price === 0) {
        unpricedScans++
        const plu = sc.plu_number ?? '?'
        const u = unpricedBy.get(plu) ?? { plu, item: sc.item_name ?? '', scans: 0, lbs: 0 }
        u.scans++; u.lbs += lbs
        unpricedBy.set(plu, u)
      }
      const value = lbs * price
      sessionRetail.set(sKey, (sessionRetail.get(sKey) ?? 0) + value)
      const packDate = sKey.slice(sKey.indexOf('|') + 1)
      const wk = weekMap.get(mondayOfISO(packDate))
      if (wk) { wk.packedLbs += lbs; wk.packedRetail += value }
    }

    // ── Retail $ per hanging lb, measured on our own finished sessions ───────
    // A session still being packed would read as a poor yield, so only sessions
    // at least a week old count; and a session that took in two species can't
    // say which pounds became which dollars, so it is left out of the rate.
    const inputs = (await all<{ customer_name: string; session_date: string; linked_harvest_id: string }>((a, b) =>
      supabaseAdmin.from('processing_inputs').select('customer_name, session_date, linked_harvest_id')
        .gte('session_date', rateStart).not('linked_harvest_id', 'is', null).range(a, b)))
      .filter(i => ownKeys.has(key(i.customer_name, i.session_date)))

    const HARVEST_COLS = 'id, harvest_date, species, status, producer, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs'
    const linkedIds = [...new Set(inputs.map(i => i.linked_harvest_id))]
    const linked = new Map<string, HarvestRow>()
    for (const ids of chunk(linkedIds, 200)) {
      for (const h of await all<HarvestRow>((a, b) => supabaseAdmin.from('harvest_log').select(HARVEST_COLS).in('id', ids).range(a, b))) {
        linked.set(h.id, h)
      }
    }

    const settledBefore = addDaysISO(today, -7)
    // A beef comes to the table as two halves, each scanned as its own input
    // row against the same carcass — count the carcass once or its weight
    // doubles and the rate halves.
    const bySession = new Map<string, { species: Set<string>; carcasses: Set<string>; hangLbs: number }>()
    for (const i of inputs) {
      const h = linked.get(i.linked_harvest_id)
      if (!h) continue
      const k = key(i.customer_name, i.session_date)
      const row = bySession.get(k) ?? { species: new Set<string>(), carcasses: new Set<string>(), hangLbs: 0 }
      if (row.carcasses.has(h.id)) continue
      row.carcasses.add(h.id)
      row.species.add((h.species ?? '').trim() || 'Other')
      row.hangLbs += carcassLbs(h)
      bySession.set(k, row)
    }
    const rateAcc = new Map<string, { sessions: number; head: number; hangLbs: number; retail: number }>()
    for (const [k, row] of bySession) {
      if (row.species.size !== 1 || row.hangLbs <= 0) continue
      if (k.slice(k.indexOf('|') + 1) > settledBefore) continue
      const retail = sessionRetail.get(k) ?? 0
      if (retail <= 0) continue
      const sp = [...row.species][0]
      const acc = rateAcc.get(sp) ?? { sessions: 0, head: 0, hangLbs: 0, retail: 0 }
      acc.sessions += 1; acc.head += row.carcasses.size; acc.hangLbs += row.hangLbs; acc.retail += retail
      rateAcc.set(sp, acc)
    }
    const rates = Object.fromEntries([...rateAcc].map(([sp, a]) => [sp, {
      sessions: a.sessions, head: a.head, hangLbs: r0(a.hangLbs), retail: r0(a.retail),
      retailPerHangLb: r2(a.retail / a.hangLbs),
    }]))

    // ── Hanging: our carcasses no cut session has scanned yet ─────────────────
    // Sixty days back is the guard against ghosts: scan tracking began in late
    // June, and a carcass cut before that never got its exit recorded.
    const recent = await all<HarvestRow>((a, b) =>
      supabaseAdmin.from('harvest_log').select(HARVEST_COLS).gte('harvest_date', addDaysISO(today, -60)).range(a, b))
    const candidates = recent.filter(h =>
      OWN_PRODUCER.test(h.producer ?? '') && h.status !== 'cut' && h.status !== 'complete')
    const scanned = new Set<string>()
    for (const ids of chunk(candidates.map(h => h.id), 200)) {
      for (const p of await all<{ linked_harvest_id: string }>((a, b) =>
        supabaseAdmin.from('processing_inputs').select('linked_harvest_id').in('linked_harvest_id', ids).range(a, b))) {
        scanned.add(p.linked_harvest_id)
      }
    }
    const hangingRows = candidates.filter(h => !scanned.has(h.id))
    const hangingBySpecies = new Map<string, { head: number; lbs: number }>()
    for (const h of hangingRows) {
      const sp = (h.species ?? '').trim() || 'Other'
      const row = hangingBySpecies.get(sp) ?? { head: 0, lbs: 0 }
      row.head += 1; row.lbs += carcassLbs(h)
      hangingBySpecies.set(sp, row)
    }
    let estRetail = 0
    let unratedLbs = 0
    const hangingSpecies = [...hangingBySpecies].map(([name, v]) => {
      const rate = rates[name]?.retailPerHangLb
      const est = rate != null ? v.lbs * rate : null
      if (est == null) unratedLbs += v.lbs; else estRetail += est
      return { name, head: v.head, lbs: r0(v.lbs), estRetail: est == null ? null : r0(est) }
    })

    // ── Sold: the retail income accounts, by day, off the books ──────────────
    let booksError: string | null = null
    if (start <= today) {
      try {
        const pnl = await fetchProfitAndLossByDay(start, today)
        const dates = dayColumns(pnl)
        for (const wk of weekMap.values()) wk.soldRetail = 0
        for (const acct of leafAccountSeries(pnl, 'Income', dates.length)) {
          if (INCOME_ACCOUNT_ENTERPRISE[acct.name] !== 'retail') continue
          acct.values.forEach((v, i) => {
            const d = dates[i]
            if (!d || !v) return
            const wk = weekMap.get(mondayOfISO(d))
            if (wk && wk.soldRetail != null) wk.soldRetail += v
          })
        }
      } catch (e) {
        booksError = e instanceof Error ? e.message : String(e)
      }
    }

    const series = [...weekMap.values()].map(w => ({
      week: w.week, packedLbs: r0(w.packedLbs), packedRetail: r0(w.packedRetail),
      soldRetail: w.soldRetail == null ? null : r0(w.soldRetail),
    }))
    // The running week is not a week yet — the headline reads the last four whole ones.
    const whole = series.slice(0, -1).slice(-4)
    const last4 = {
      weeks: whole.length,
      packedLbs: r0(whole.reduce((s, w) => s + w.packedLbs, 0)),
      packedRetail: r0(whole.reduce((s, w) => s + w.packedRetail, 0)),
      soldRetail: booksError ? null : r0(whole.reduce((s, w) => s + (w.soldRetail ?? 0), 0)),
    }

    return NextResponse.json({
      asOf: today,
      weeks,
      series,
      last4,
      hanging: {
        head: hangingRows.length,
        lbs: r0(hangingRows.reduce((s, h) => s + carcassLbs(h), 0)),
        estRetail: hangingRows.length ? r0(estRetail) : 0,
        unratedLbs: r0(unratedLbs),
        species: hangingSpecies,
      },
      rates,
      unpricedScans,
      unpriced: [...unpricedBy.values()].sort((a, b) => b.scans - a.scans).slice(0, 3)
        .map(u => ({ ...u, lbs: r0(u.lbs) })),
      booksError,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
