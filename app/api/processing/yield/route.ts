export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/processing/yield?customer_name=X&session_date=YYYY-MM-DD
//
// Quarter-aware yield: when the same carcass half (same box_identifier, e.g.
// 26169-06-L) is scanned into more than one session — two customers each taking
// a quarter — judging each session against the full half weight double-counts
// the input. This returns the pool of sessions sharing any of this session's
// identifiers so the client can show a combined yield: every session's output
// against the deduped input weight.
//
// Response:
//   { shared: false }                                  — nothing shared
//   { shared: true,
//     partners:        [{ customer_name, session_date, output_lbs }],
//     pool_input_lbs:  number,   // unique identifiers once + everyone's manual inputs
//     other_output_lbs: number,  // partners' output (caller adds its own live output)
//     shared_identifiers: { [identifier]: string[] } }  // identifier → other customers
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const customer_name = searchParams.get('customer_name')
  const session_date  = searchParams.get('session_date')
  if (!customer_name || !session_date) {
    return NextResponse.json({ error: 'customer_name and session_date required' }, { status: 400 })
  }

  type InputRow = {
    customer_name: string | null
    session_date:  string
    box_identifier: string | null
    weight_lbs: number | null
  }

  const myKey = `${customer_name}|${session_date}`

  // Grow the pool of sessions connected through shared identifiers. Almost
  // always one hop (two quarters of one half), but a session holding two
  // shared halves can chain — cap the walk to stay bounded.
  const groupKeys   = new Set<string>([myKey])
  const identifiers = new Set<string>()
  let   frontier    = [{ customer_name, session_date }]
  const allRows: InputRow[] = []

  for (let hop = 0; hop < 4 && frontier.length > 0; hop++) {
    const newIds = new Set<string>()
    for (const sess of frontier) {
      const { data } = await supabase
        .from('processing_inputs')
        .select('customer_name, session_date, box_identifier, weight_lbs')
        .eq('customer_name', sess.customer_name)
        .eq('session_date', sess.session_date)
      for (const r of (data ?? []) as InputRow[]) {
        allRows.push(r)
        if (r.box_identifier && !identifiers.has(r.box_identifier)) {
          identifiers.add(r.box_identifier)
          newIds.add(r.box_identifier)
        }
      }
    }
    if (newIds.size === 0) break
    const { data: sharers } = await supabase
      .from('processing_inputs')
      .select('customer_name, session_date, box_identifier, weight_lbs')
      .in('box_identifier', Array.from(newIds))
    frontier = []
    for (const r of (sharers ?? []) as InputRow[]) {
      if (!r.customer_name) continue
      const key = `${r.customer_name}|${r.session_date}`
      if (!groupKeys.has(key)) {
        groupKeys.add(key)
        frontier.push({ customer_name: r.customer_name, session_date: r.session_date })
      }
    }
  }

  if (groupKeys.size <= 1) return NextResponse.json({ shared: false })

  // A shared-identifier row can appear twice in allRows (once from its
  // session's fetch, once from the sharer fetch); identifier weights go
  // through a Map so the duplicate is absorbed. Manual rows are only ever
  // fetched with their session, so they stay single.
  const rowsByKey = new Map<string, InputRow[]>()
  for (const r of allRows) {
    const key = `${r.customer_name}|${r.session_date}`
    if (!rowsByKey.has(key)) rowsByKey.set(key, [])
    rowsByKey.get(key)!.push(r)
  }

  // Pooled input: each unique identifier counts once; manual (identifier-less)
  // inputs count per row for every session in the group.
  let poolInput = 0
  const idWeights = new Map<string, number>()
  const idSessions = new Map<string, Set<string>>()
  for (const [key, rows] of rowsByKey) {
    if (!groupKeys.has(key)) continue
    for (const r of rows) {
      if (r.box_identifier) {
        const w = Number(r.weight_lbs) || 0
        if (!idWeights.has(r.box_identifier) || w > idWeights.get(r.box_identifier)!) {
          idWeights.set(r.box_identifier, w)
        }
        if (!idSessions.has(r.box_identifier)) idSessions.set(r.box_identifier, new Set())
        idSessions.get(r.box_identifier)!.add(key)
      } else {
        poolInput += Number(r.weight_lbs) || 0
      }
    }
  }
  for (const w of idWeights.values()) poolInput += w

  // Identifiers shared with someone else, mapped to the OTHER customers on them
  const shared_identifiers: Record<string, string[]> = {}
  for (const [ident, keys] of idSessions) {
    if (keys.size > 1) {
      shared_identifiers[ident] = Array.from(keys)
        .filter(k => k !== myKey)
        .map(k => k.split('|')[0])
    }
  }

  // Partners' output: closed boxes carry total_weight_lbs; open boxes are
  // summed from their scans.
  const partnerKeys = Array.from(groupKeys).filter(k => k !== myKey)
  const partners: { customer_name: string; session_date: string; output_lbs: number }[] = []
  let otherOutput = 0
  for (const key of partnerKeys) {
    const [cust, dt] = key.split('|')
    const { data: boxes } = await supabase
      .from('boxes')
      .select('id, is_closed, total_weight_lbs')
      .eq('customer_name', cust)
      .eq('pack_date', dt)
    let out = 0
    const openIds: string[] = []
    for (const b of (boxes ?? []) as { id: string; is_closed: boolean; total_weight_lbs: number | null }[]) {
      if (b.is_closed) out += Number(b.total_weight_lbs) || 0
      else openIds.push(b.id)
    }
    if (openIds.length > 0) {
      const { data: scans } = await supabase
        .from('box_scans')
        .select('weight_lbs')
        .in('box_id', openIds)
      for (const s of (scans ?? []) as { weight_lbs: number | null }[]) out += Number(s.weight_lbs) || 0
    }
    partners.push({ customer_name: cust, session_date: dt, output_lbs: Math.round(out * 100) / 100 })
    otherOutput += out
  }

  return NextResponse.json({
    shared: true,
    partners,
    pool_input_lbs:     Math.round(poolInput * 100) / 100,
    other_output_lbs:   Math.round(otherOutput * 100) / 100,
    shared_identifiers,
  })
}
