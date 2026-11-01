export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { addDaysISO } from '@/lib/dates'
import { isOwnSession, OWN_PRODUCER } from '@/lib/ownership'
import {
  buildDemandLines, summarize, yieldRates, type OpenLine, type RoomCount, type SpeciesSupply,
} from '@/lib/demand'

// GET /api/demand — what the open orders need that the plant can't cover.
//
// Charlie, 2026-11-01: "make me a demand page in the app so I know what I need
// to procure." Meat only, every open order. The arithmetic is in lib/demand;
// this route only gathers the rows:
//
//   short    open retail_orders × their lines, less what the scanner packed
//            against them (the same keyed box→order join /api/orders uses)
//   on hand  the newest CLOSED inventory count per room, live lines only
//   coming   own carcasses hanging (no cut session has scanned them) and own
//            animals booked but not yet killed, turned into pounds per PLU by
//            the yield our own single-species sessions have actually made
//
// ?count=1 answers only the dashboard tile: how many items need buying.

// Supabase caps a select at 1000 rows and says nothing.
type Q<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>
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

/** How far back the yield rate and the average hanging weight look. */
const YIELD_DAYS = 180
/** A session younger than this may still be on the bench; its yield would read low. */
const SETTLE_DAYS = 7
/** Scan tracking began late June 2026; an older carcass never got its exit recorded. */
const HANGING_DAYS = 60
/** A booked kill that slipped a few days is still coming. */
const BOOKED_GRACE_DAYS = 7
/** Appointment states that still mean "animals on their way to our cooler". */
const BOOKED_STATUSES = new Set(['Tentative', 'Booked', 'Confirmed', 'InstructionsReceived', 'AnimalIn'])

interface HarvestRow {
  id: string; appointment_id: string | null; harvest_date: string; species: string | null
  status: string | null; producer: string | null
  hot_carcass_weight_lbs: number | null; half_1_weight_lbs: number | null; half_2_weight_lbs: number | null
}
const HARVEST_COLS = 'id, appointment_id, harvest_date, species, status, producer, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs'
const carcassLbs = (h: HarvestRow) =>
  h.hot_carcass_weight_lbs != null
    ? Number(h.hot_carcass_weight_lbs)
    : Number(h.half_1_weight_lbs ?? 0) + Number(h.half_2_weight_lbs ?? 0)
const speciesOf = (s: string | null | undefined) => (s ?? '').trim() || 'Other'

// ── Open orders, with what the scanner packed against each line ─────────────
async function openLines(): Promise<OpenLine[]> {
  type ItemRow = { id: string; plu_number: string | null; item_name: string; unit: string; qty_ordered: number; qty_filled: number }
  type OrderRow = { id: string; customer_name: string; due_date: string; status: string; retail_order_items: ItemRow[] | null }
  const { data: orders, error } = await supabaseAdmin
    .from('retail_orders')
    .select('id, customer_name, due_date, status, retail_order_items(id, plu_number, item_name, unit, qty_ordered, qty_filled)')
    .neq('status', 'fulfilled')
    .order('due_date', { ascending: true })
  if (error) throw new Error(error.message)
  const rows = (orders ?? []) as OrderRow[]
  if (!rows.length) return []

  // Only boxes linked to THIS order count, matched to a line by PLU.
  const { data: boxes } = await supabaseAdmin.from('boxes').select('id, order_id').in('order_id', rows.map(o => o.id))
  const orderOfBox = new Map((boxes ?? []).map(b => [b.id as string, b.order_id as string]))
  const lbs = new Map<string, number>(), pkgs = new Map<string, number>()
  if (orderOfBox.size) {
    for (const ids of chunk([...orderOfBox.keys()], 150)) {
      const scans = await all<{ box_id: string; plu_number: string | null; weight_lbs: number | null; quantity: number | null }>((a, b) =>
        supabaseAdmin.from('box_scans').select('box_id, plu_number, weight_lbs, quantity').in('box_id', ids).range(a, b))
      for (const s of scans) {
        const key = `${orderOfBox.get(s.box_id)}|${s.plu_number ?? ''}`
        lbs.set(key, (lbs.get(key) ?? 0) + (Number(s.weight_lbs) || 0))
        pkgs.set(key, (pkgs.get(key) ?? 0) + (Number(s.quantity) || 1))
      }
    }
  }

  const out: OpenLine[] = []
  for (const o of rows) {
    for (const i of o.retail_order_items ?? []) {
      const key = `${o.id}|${i.plu_number ?? ''}`
      const scanned = i.plu_number && pkgs.has(key)
        ? (String(i.unit).toUpperCase() === 'EA' ? pkgs.get(key)! : lbs.get(key)!)
        : null
      out.push({
        order_id: o.id, customer_name: o.customer_name, due_date: o.due_date, status: o.status,
        plu_number: i.plu_number, item_name: i.item_name, unit: i.unit,
        qty_ordered: Number(i.qty_ordered) || 0, qty_filled: Number(i.qty_filled) || 0, scanned_qty: scanned,
      })
    }
  }
  return out
}

// ── On hand: the newest closed count of each room ────────────────────────────
async function onHandFromCounts(): Promise<{ rooms: RoomCount[]; byPlu: Map<string, { lbs: number; pkgs: number }> | null }> {
  const { data: counts, error } = await supabaseAdmin
    .from('inventory_counts')
    .select('id, location, count_date, status, closed_at')
    .eq('status', 'closed')
    .order('count_date', { ascending: false })
    .order('closed_at', { ascending: false })
    .limit(200)
  if (error) throw new Error(error.message)

  const newest = new Map<string, { id: string; location: string; count_date: string; closed_at: string | null }>()
  for (const c of counts ?? []) if (!newest.has(c.location)) newest.set(c.location, c)
  if (!newest.size) return { rooms: [], byPlu: null }

  const byPlu = new Map<string, { lbs: number; pkgs: number }>()
  const lines = await all<{ count_id: string; plu_number: string; weight_lbs: number | null; quantity: number; voided_at: string | null }>((a, b) =>
    supabaseAdmin.from('inventory_count_lines')
      .select('count_id, plu_number, weight_lbs, quantity, voided_at')
      .in('count_id', [...newest.values()].map(c => c.id))
      .is('voided_at', null)
      .range(a, b))
  for (const l of lines) {
    const t = byPlu.get(l.plu_number) ?? { lbs: 0, pkgs: 0 }
    const q = Number(l.quantity) || 0
    t.pkgs += q
    if (l.weight_lbs != null) t.lbs += Number(l.weight_lbs) * q
    byPlu.set(l.plu_number, t)
  }
  const rooms = [...newest.values()]
    .map(c => ({ location: c.location, count_date: c.count_date, closed_at: c.closed_at }))
    .sort((a, b) => b.count_date.localeCompare(a.count_date))
  return { rooms, byPlu }
}

// ── Coming: own meat hanging or booked, and the yield that turns it into PLUs ─
async function ownSupply(today: string) {
  const since = addDaysISO(today, -YIELD_DAYS)
  const key = (name: string, date: string) => `${name}|${date}`

  // Own sessions and the packages scanned inside them.
  const sessions = await all<{ customer_name: string; session_date: string; cmc: boolean | null }>((a, b) =>
    supabaseAdmin.from('processing_sessions').select('customer_name, session_date, cmc').gte('session_date', since).range(a, b))
  const ownKeys = new Set(sessions.filter(isOwnSession).map(s => key(s.customer_name, s.session_date)))

  const boxes = (await all<{ id: string; customer_name: string; pack_date: string }>((a, b) =>
    supabaseAdmin.from('boxes').select('id, customer_name, pack_date').gte('pack_date', since).range(a, b)))
    .filter(bx => ownKeys.has(key(bx.customer_name, bx.pack_date)))
  const boxSession = new Map(boxes.map(bx => [bx.id, key(bx.customer_name, bx.pack_date)]))

  type Scan = { box_id: string; plu_number: string | null; weight_lbs: number | null; quantity: number | null }
  const scans: Scan[] = []
  for (const ids of chunk(boxes.map(bx => bx.id), 150)) {
    scans.push(...await all<Scan>((a, b) =>
      supabaseAdmin.from('box_scans').select('box_id, plu_number, weight_lbs, quantity').in('box_id', ids).range(a, b)))
  }

  // Which carcasses each own session took in. A beef is two halves scanned as
  // two inputs against one carcass — count the carcass once.
  const inputs = (await all<{ customer_name: string; session_date: string; linked_harvest_id: string }>((a, b) =>
    supabaseAdmin.from('processing_inputs').select('customer_name, session_date, linked_harvest_id')
      .gte('session_date', since).not('linked_harvest_id', 'is', null).range(a, b)))
    .filter(i => ownKeys.has(key(i.customer_name, i.session_date)))

  const linked = new Map<string, HarvestRow>()
  for (const ids of chunk([...new Set(inputs.map(i => i.linked_harvest_id))], 200)) {
    for (const h of await all<HarvestRow>((a, b) => supabaseAdmin.from('harvest_log').select(HARVEST_COLS).in('id', ids).range(a, b))) {
      linked.set(h.id, h)
    }
  }
  const bySession = new Map<string, { species: Set<string>; carcasses: Set<string>; hangLbs: number }>()
  for (const i of inputs) {
    const h = linked.get(i.linked_harvest_id)
    if (!h) continue
    const k = key(i.customer_name, i.session_date)
    const row = bySession.get(k) ?? { species: new Set<string>(), carcasses: new Set<string>(), hangLbs: 0 }
    if (row.carcasses.has(h.id)) continue
    row.carcasses.add(h.id)
    row.species.add(speciesOf(h.species))
    row.hangLbs += carcassLbs(h)
    bySession.set(k, row)
  }

  // A session still being packed reads as a poor yield, and a two-species
  // bench can't say which pounds became which packages — both left out.
  const settledBefore = addDaysISO(today, -SETTLE_DAYS)
  const sessionSpecies = new Map<string, string>()
  const hangLbs = new Map<string, number>()
  const yieldSessions = new Map<string, number>()
  for (const [k, row] of bySession) {
    if (row.species.size !== 1 || row.hangLbs <= 0) continue
    if (k.slice(k.indexOf('|') + 1) > settledBefore) continue
    const sp = [...row.species][0]
    sessionSpecies.set(k, sp)
    hangLbs.set(sp, (hangLbs.get(sp) ?? 0) + row.hangLbs)
    yieldSessions.set(sp, (yieldSessions.get(sp) ?? 0) + 1)
  }
  const ratedScans: { species: string; plu_number: string; lbs: number; pkgs: number }[] = []
  for (const sc of scans) {
    const sp = sessionSpecies.get(boxSession.get(sc.box_id) ?? '')
    if (!sp || !sc.plu_number) continue
    ratedScans.push({ species: sp, plu_number: sc.plu_number, lbs: Number(sc.weight_lbs) || 0, pkgs: Number(sc.quantity) || 1 })
  }
  const yields = yieldRates(ratedScans, hangLbs)

  // Hanging: own carcasses no cut session has scanned yet.
  const recent = await all<HarvestRow>((a, b) =>
    supabaseAdmin.from('harvest_log').select(HARVEST_COLS).gte('harvest_date', addDaysISO(today, -HANGING_DAYS)).range(a, b))
  const candidates = recent.filter(h => OWN_PRODUCER.test(h.producer ?? '') && h.status !== 'cut' && h.status !== 'complete')
  const scanned = new Set<string>()
  for (const ids of chunk(candidates.map(h => h.id), 200)) {
    for (const p of await all<{ linked_harvest_id: string }>((a, b) =>
      supabaseAdmin.from('processing_inputs').select('linked_harvest_id').in('linked_harvest_id', ids).range(a, b))) {
      scanned.add(p.linked_harvest_id)
    }
  }
  const hanging = candidates.filter(h => !scanned.has(h.id))

  // Average hanging weight per species, off every own carcass in the window,
  // for pricing a booked head that hasn't been weighed yet.
  const ownKilled = await all<HarvestRow>((a, b) =>
    supabaseAdmin.from('harvest_log').select(HARVEST_COLS).gte('harvest_date', since).range(a, b))
  const avgHang = new Map<string, { lbs: number; head: number }>()
  for (const h of ownKilled) {
    if (!OWN_PRODUCER.test(h.producer ?? '')) continue
    const w = carcassLbs(h)
    if (w <= 0) continue
    const a = avgHang.get(speciesOf(h.species)) ?? { lbs: 0, head: 0 }
    a.lbs += w; a.head += 1
    avgHang.set(speciesOf(h.species), a)
  }
  const killedAppts = new Set(ownKilled.map(h => h.appointment_id).filter(Boolean))

  // Booked: own animals on the schedule that have not reached the kill floor.
  type Appt = { id: string; harvest_date: string; species: string | null; head_count: number | null; source: string | null; status: string | null }
  const appts = await all<Appt>((a, b) =>
    supabaseAdmin.from('harvest_appointments').select('id, harvest_date, species, head_count, source, status')
      .gte('harvest_date', addDaysISO(today, -BOOKED_GRACE_DAYS)).range(a, b))
  const booked = appts.filter(a =>
    OWN_PRODUCER.test(a.source ?? '') && BOOKED_STATUSES.has(a.status ?? '') && !killedAppts.has(a.id))

  const supply = new Map<string, SpeciesSupply>()
  const row = (sp: string) => {
    const r = supply.get(sp) ?? {
      species: sp, hangingHead: 0, hangingLbs: 0, bookedHead: 0, bookedLbs: 0,
      yieldSessions: yieldSessions.get(sp) ?? 0, yieldHangLbs: Math.round(hangLbs.get(sp) ?? 0),
    }
    supply.set(sp, r)
    return r
  }
  for (const h of hanging) { const r = row(speciesOf(h.species)); r.hangingHead += 1; r.hangingLbs += carcassLbs(h) }
  for (const a of booked) {
    const sp = speciesOf(a.species)
    const avg = avgHang.get(sp)
    const r = row(sp)
    const head = Number(a.head_count) || 0
    r.bookedHead += head
    if (avg && avg.head > 0) r.bookedLbs += head * (avg.lbs / avg.head)
  }
  for (const r of supply.values()) { r.hangingLbs = Math.round(r.hangingLbs); r.bookedLbs = Math.round(r.bookedLbs) }

  return {
    supply: [...supply.values()].sort((a, b) => a.species.localeCompare(b.species)),
    yields,
    booked: booked
      .map(a => ({ id: a.id, harvest_date: a.harvest_date, species: speciesOf(a.species), head_count: Number(a.head_count) || 0, status: a.status }))
      .sort((a, b) => a.harvest_date.localeCompare(b.harvest_date)),
  }
}

export async function GET(req: NextRequest) {
  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })

    const [lines, counts, own, pluRows] = await Promise.all([
      openLines(),
      onHandFromCounts(),
      ownSupply(today),
      all<{ plu_number: string; item_name: string; species: string | null; sell_by_weight: boolean | null }>((a, b) =>
        supabaseAdmin.from('plu_items').select('plu_number, item_name, species, sell_by_weight').range(a, b)),
    ])
    const plu = new Map(pluRows.map(p => [p.plu_number, p]))

    const demand = buildDemandLines({ lines, plu, onHand: counts.byPlu, supply: own.supply, yields: own.yields })
    const summary = summarize(demand)

    if (new URL(req.url).searchParams.get('count') === '1') {
      return NextResponse.json({ count: summary.linesToBuy })
    }

    return NextResponse.json({
      asOf: new Date().toISOString(),
      today,
      summary,
      lines: demand,
      rooms: counts.rooms,
      supply: own.supply,
      booked: own.booked,
      basis: { yieldDays: YIELD_DAYS, settleDays: SETTLE_DAYS, hangingDays: HANGING_DAYS },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
