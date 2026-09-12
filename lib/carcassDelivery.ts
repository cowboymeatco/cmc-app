// Carcass tags on a delivery — scanned code in, the animal out.
//
// Charlie, 2026-09-11: "I am delivering a carcass to a customer. Can we make
// sure the module can handle that transaction." A hanging carcass has no boxes
// and no packing session, so the only thing the truck can scan is the carcass
// tag. This resolves those codes to real animals for Load Out, the delivery
// record and the packing slip, so a carcass reads like everything else on the
// load: whose it is, what it is, what it weighs.

import { supabase } from './supabase'
import { parseCarcassTag, ParsedCarcassTag } from './carcassTag'

export interface DeliveredCarcass {
  code:            string
  harvest_log_id:  string | null
  species:         string | null
  carcass_tag:     string | null
  producer:        string | null
  harvest_date:    string | null
  kill_type:       string | null
  side:            'L' | 'R' | null
  /** Hanging weight — half the carcass when a side was scanned. */
  weight_lbs:      number | null
  /** The cut customer this carcass is assigned to, when the office set one. */
  owner:           string | null
  /** harvest_log.status as it stands right now. */
  status:          string | null
}

const HARVEST_COLS =
  'id, species, carcass_tag, producer, harvest_date, kill_type, status, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs'

interface HarvestRow {
  id: string
  species: string | null
  carcass_tag: string | null
  producer: string | null
  harvest_date: string | null
  kill_type: string | null
  status: string | null
  hot_carcass_weight_lbs: number | string | null
  half_1_weight_lbs: number | string | null
  half_2_weight_lbs: number | string | null
}

const num = (v: number | string | null) => (v == null || v === '' ? null : Number(v))

// Hanging weight for what actually left: the whole carcass, or one side of it.
// Halves are weighed individually when they're weighed at all, but nothing says
// which physical side is half 1, so a side tag takes half the total rather than
// claiming a precision the record doesn't have.
function hangingWeight(h: HarvestRow, side: 'L' | 'R' | null): number | null {
  const hcw = num(h.hot_carcass_weight_lbs)
    ?? ((num(h.half_1_weight_lbs) ?? 0) + (num(h.half_2_weight_lbs) ?? 0) || null)
  if (hcw == null) return null
  return side ? Math.round((hcw / 2) * 100) / 100 : hcw
}

function shell(p: ParsedCarcassTag): DeliveredCarcass {
  return {
    code: p.code, harvest_log_id: null, species: null, carcass_tag: p.tag,
    producer: null, harvest_date: p.harvestDate, kill_type: null, side: p.side,
    weight_lbs: null, owner: null, status: null,
  }
}

// Codes that don't parse as a carcass tag are simply skipped — a delivery's
// barcode list holds box serials and package EANs too, and this is called with
// all of them.
export async function resolveCarcasses(codes: string[]): Promise<DeliveredCarcass[]> {
  const parsed = [...new Set(codes.map(c => String(c ?? '').trim().toUpperCase()).filter(Boolean))]
    .map(parseCarcassTag)
    .filter((p): p is ParsedCarcassTag => p !== null)
  if (!parsed.length) return []

  const legacyIds = parsed.map(p => p.legacyId).filter((v): v is string => !!v)
  const tags      = [...new Set(parsed.map(p => p.tag).filter((v): v is string => !!v))]
  const dates     = [...new Set(parsed.map(p => p.harvestDate).filter((v): v is string => !!v))]

  const rows: HarvestRow[] = []
  if (legacyIds.length) {
    const { data } = await supabase.from('harvest_log').select(HARVEST_COLS).in('id', legacyIds)
    rows.push(...((data ?? []) as HarvestRow[]))
  }
  if (tags.length && dates.length) {
    // One query for every tag/date on the load; the exact pair is matched below.
    const { data } = await supabase.from('harvest_log').select(HARVEST_COLS)
      .in('carcass_tag', tags).in('harvest_date', dates)
    rows.push(...((data ?? []) as HarvestRow[]))
  }

  const byId   = new Map(rows.map(r => [String(r.id), r]))
  const byPair = new Map(rows.map(r => [`${r.harvest_date}|${r.carcass_tag}`, r]))

  const found = parsed.map(p => {
    const row = p.legacyId ? byId.get(p.legacyId) : byPair.get(`${p.harvestDate}|${p.tag}`)
    if (!row) return shell(p)
    return {
      code: p.code,
      harvest_log_id: String(row.id),
      species:        row.species,
      carcass_tag:    row.carcass_tag,
      producer:       row.producer,
      harvest_date:   row.harvest_date,
      kill_type:      row.kill_type,
      status:         row.status,
      side:           p.side,
      weight_lbs:     hangingWeight(row, p.side),
      owner:          null as string | null,
    }
  })

  // Whose it is, when the office assigned the carcass to a cut customer.
  const ids = found.map(c => c.harvest_log_id).filter((v): v is string => !!v)
  if (ids.length) {
    const { data: asg } = await supabase
      .from('carcass_assignments').select('harvest_log_id, customer_name').in('harvest_log_id', ids)
    const owners = new Map<string, string[]>()
    for (const a of asg ?? []) {
      const k = String(a.harvest_log_id)
      const list = owners.get(k) ?? []
      if (a.customer_name && !list.includes(a.customer_name)) list.push(a.customer_name)
      owners.set(k, list)
    }
    for (const c of found) {
      const list = c.harvest_log_id ? owners.get(c.harvest_log_id) ?? [] : []
      c.owner = list.length ? list.join(' / ') : null
    }
  }

  return found
}

// A carcass that drove off is out of the cooler. The rail lists and the cooler
// charts read status, so leaving it 'chilling' would keep an animal hanging on
// the board that isn't in the building — but a carcass that was already cut
// keeps its 'cut' history rather than being overwritten.
export async function markCarcassesDelivered(ids: string[]): Promise<number> {
  if (!ids.length) return 0
  const { data } = await supabase
    .from('harvest_log')
    .update({ status: 'delivered' })
    .in('id', ids)
    .in('status', ['chilling', 'complete'])
    .select('id')
  return (data ?? []).length
}
