export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate, addDaysISO } from '@/lib/dates'
import {
  WASTE_KINDS, WEIGH_METHODS, DEFAULT_DESTINATION, netOf, sumWeights,
  type WasteKind, type WeighMethod, type PoundsIn, type CuttingDay,
} from '@/lib/waste'

// Waste hauling — see lib/waste and scripts/2026-10-09_waste_hauls.sql.
//
//   GET    /api/waste?from=&to=   → the hauls in the window, newest first,
//                                   plus what came in over the same days off
//                                   the harvest log (head, hanging lbs, live
//                                   lbs where recorded), plus the cutting
//                                   floor by day (carcass scanned in vs
//                                   packages out — waste_cutting_days())
//   POST   /api/waste             → log a haul
//   DELETE /api/waste?id=         → remove one (a fat-fingered gross is worse
//                                   than no row)
//
// Window defaults to the last 30 days on the shop clock. The page does the
// percentages; nothing derived is stored.

const num = (v: unknown): number | null => {
  if (v == null || v === '') return null
  const n = typeof v === 'number' ? v : parseFloat(String(v).replace(/[,\s]/g, ''))
  return Number.isFinite(n) ? n : null
}
const str = (v: unknown): string | null =>
  typeof v === 'string' && v.trim() ? v.trim() : null

const ISO = /^\d{4}-\d{2}-\d{2}$/

// Postgres numerics come back from supabase-js as strings. The page does
// arithmetic on these, so hand it numbers.
const NUMERIC = ['gross_lbs', 'tare_lbs', 'net_lbs', 'fee_dollars', 'odometer_out', 'odometer_in', 'container_count'] as const
function asNumbers(row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row }
  for (const k of NUMERIC) if (out[k] != null) out[k] = Number(out[k])
  if (Array.isArray(out.container_weights)) out.container_weights = out.container_weights.map(Number)
  return out
}

interface HarvestRow {
  species: string | null
  live_weight_lbs: number | null
  hot_carcass_weight_lbs: number | null
  half_1_weight_lbs: number | null
  half_2_weight_lbs: number | null
}

// Same rule as the cooler history: hot carcass weight when it was entered,
// otherwise the two halves added up.
function hangingLbs(h: HarvestRow): number {
  if (h.hot_carcass_weight_lbs != null) return Number(h.hot_carcass_weight_lbs)
  return Number(h.half_1_weight_lbs ?? 0) + Number(h.half_2_weight_lbs ?? 0)
}

async function poundsIn(from: string, to: string): Promise<PoundsIn> {
  const { data, error } = await supabaseAdmin
    .from('harvest_log')
    .select('species, live_weight_lbs, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
    .gte('harvest_date', from)
    .lte('harvest_date', to)
  if (error) throw new Error(error.message)

  const rows = (data ?? []) as HarvestRow[]
  const bySpecies = new Map<string, { head: number; hanging_lbs: number }>()
  let hanging = 0, live = 0, liveHead = 0
  for (const h of rows) {
    const lbs = hangingLbs(h)
    hanging += lbs
    if (h.live_weight_lbs != null && Number(h.live_weight_lbs) > 0) { live += Number(h.live_weight_lbs); liveHead += 1 }
    const sp = (h.species ?? '').trim() || 'Unknown'
    const s = bySpecies.get(sp) ?? { head: 0, hanging_lbs: 0 }
    s.head += 1
    s.hanging_lbs += lbs
    bySpecies.set(sp, s)
  }
  return {
    from, to,
    head: rows.length,
    hanging_lbs: Math.round(hanging),
    live_lbs: liveHead > 0 ? Math.round(live) : null,
    live_head: liveHead,
    by_species: [...bySpecies.entries()]
      .map(([species, v]) => ({ species, ...v }))
      .sort((a, b) => b.hanging_lbs - a.hanging_lbs),
  }
}

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const today = isoDate()
  const to   = ISO.test(q.get('to') ?? '')   ? q.get('to')!   : today
  const from = ISO.test(q.get('from') ?? '') ? q.get('from')! : addDaysISO(to, -29)
  if (from > to) return NextResponse.json({ error: 'from is after to' }, { status: 400 })

  try {
    const [hauls, pin, cutting] = await Promise.all([
      supabaseAdmin.from('waste_hauls').select('*')
        .gte('hauled_on', from).lte('hauled_on', to)
        .order('hauled_on', { ascending: false }).order('created_at', { ascending: false }),
      poundsIn(from, to),
      supabaseAdmin.rpc('waste_cutting_days', { p_start: from, p_end: to }),
    ])
    const err = hauls.error ?? cutting.error
    if (err) return NextResponse.json({ error: err.message }, { status: 500 })
    const days: CuttingDay[] = ((cutting.data ?? []) as Record<string, unknown>[]).map(r => ({
      day:         String(r.day),
      head:        Number(r.head ?? 0),
      sides:       Number(r.sides ?? 0),
      carcass_lbs: Number(r.carcass_lbs ?? 0),
      packages:    Number(r.packages ?? 0),
      packed_lbs:  Number(r.packed_lbs ?? 0),
    }))
    return NextResponse.json({ hauls: (hauls.data ?? []).map(asNumbers), pounds_in: pin, cutting: days })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  const b = await req.json() as Record<string, unknown>

  const hauledOn = ISO.test(String(b.hauled_on ?? '')) ? String(b.hauled_on) : isoDate()

  const weights = Array.isArray(b.container_weights)
    ? (b.container_weights as unknown[]).map(num).filter((w): w is number => w != null && w >= 0)
    : []
  const tare  = num(b.tare_lbs)
  // Container weights win over a typed gross: they are what was on the scale.
  const gross = weights.length ? sumWeights(weights) : num(b.gross_lbs)
  const net   = netOf(gross, tare, gross == null ? num(b.net_lbs) : null)
  if (net == null) return NextResponse.json({ error: 'Enter the weights: container by container, gross and tare, or a net off the ticket.' }, { status: 400 })
  if (gross != null && tare != null && tare > gross) {
    return NextResponse.json({ error: 'Tare is more than gross — check the two numbers.' }, { status: 400 })
  }

  const odoOut = num(b.odometer_out)
  const odoIn  = num(b.odometer_in)
  if (odoOut != null && odoIn != null && odoIn < odoOut) {
    return NextResponse.json({ error: 'Odometer back is less than odometer out.' }, { status: 400 })
  }

  const kind   = WASTE_KINDS.includes(b.kind as WasteKind) ? (b.kind as WasteKind) : 'mixed'
  const method = WEIGH_METHODS.includes(b.weigh_method as WeighMethod) ? (b.weigh_method as WeighMethod) : 'shop_scale'
  const count  = num(b.container_count)

  const { data, error } = await supabaseAdmin
    .from('waste_hauls')
    .insert([{
      hauled_on:         hauledOn,
      destination:       str(b.destination) ?? DEFAULT_DESTINATION,
      kind,
      gross_lbs:         gross,
      tare_lbs:          tare,
      net_lbs:           net,
      weigh_method:      method,
      container_count:   count != null ? Math.round(count) : (weights.length || null),
      container_weights: weights.length ? weights : null,
      ticket_no:         str(b.ticket_no),
      fee_dollars:       num(b.fee_dollars),
      odometer_out:      odoOut,
      odometer_in:       odoIn,
      hauled_by:         str(b.hauled_by),
      notes:             str(b.notes),
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(asNumbers(data))
}

export async function DELETE(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabaseAdmin.from('waste_hauls').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
