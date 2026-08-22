// Node runtime: the full-catalog customer sync pages through ~9k QBO
// customers and needs more than the edge time budget.
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
// producer_qbo_links is under RLS; the anon key can no longer write it and
// this route is staff-side QuickBooks linking. Server-side only.
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { qboFetch } from '@/lib/qbo'

// Floor name -> QuickBooks customer recognition, for BOTH sides of a split.
//
//   scope=producers  harvest_log.producer          -> producer_qbo_links
//   scope=customers  the appointment's customer    -> customer_qbo_links
//
// Billing resolves a QBO id for producers already; the cut customer — the
// person who actually bought the animal — always got an empty string, so no
// charge billed to one could reach QuickBooks (Charlie, 2026-08-22). Same
// machinery serves both: only the source of names and the link table differ.
//
// The QBO customer cache (qbo_customers, ~8.9k rows) refreshes over the app's
// live QuickBooks connection and is only ever queried narrowly (norm match,
// trigram candidates, or search) — never listed wholesale.

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

type Scope = 'producers' | 'customers'
const SCOPES = {
  producers: { table: 'producer_qbo_links', col: 'producer_name' },
  customers: { table: 'customer_qbo_links', col: 'customer_name' },
} as const
const scopeOf = (v: string | null): Scope => (v === 'customers' ? 'customers' : 'producers')

// Every distinct name the chosen scope bills, with how many carcasses sit
// behind it — the count is what tells someone whether a name is worth chasing.
async function namesForScope(scope: Scope): Promise<{ name: string; harvestCount: number }[]> {
  const counts = new Map<string, number>()
  if (scope === 'producers') {
    const { data, error } = await supabase
      .from('harvest_log').select('producer').not('producer', 'is', null).neq('producer', '')
    if (error) throw new Error(error.message)
    for (const h of data ?? []) counts.set(h.producer, (counts.get(h.producer) ?? 0) + 1)
  } else {
    // One row per carcass per customer slot on its appointment. A split animal
    // legitimately counts for each buyer on it.
    const { data, error } = await supabase.rpc('cut_customer_carcass_counts')
    if (error) throw new Error(error.message)
    for (const r of (data ?? []) as { customer_name: string; carcasses: number }[]) {
      if (r.customer_name) counts.set(r.customer_name, r.carcasses)
    }
  }
  return [...counts.entries()]
    .map(([name, harvestCount]) => ({ name, harvestCount }))
    .sort((a, b) => a.name.localeCompare(b.name))
}

interface QboCustomer {
  Id: string
  DisplayName: string
  CompanyName?: string
  PrimaryEmailAddr?: { Address?: string }
  PrimaryPhone?: { FreeFormNumber?: string }
  Active: boolean
  Balance?: number
}

// GET /api/qbo/customers — producer linking state.
// GET /api/qbo/customers?search=smith — search QBO customers for the manual picker.
export async function GET(req: NextRequest) {
  try {
    const search = req.nextUrl.searchParams.get('search')
    if (search != null) {
      const { data, error } = await supabase
        .from('qbo_customers')
        .select('qbo_id, display_name, company_name, phone, balance')
        .eq('active', true)
        .ilike('display_name', `%${search}%`)
        .order('display_name')
        .limit(20)
      if (error) throw new Error(error.message)
      return NextResponse.json({ results: data })
    }

    const scope = scopeOf(req.nextUrl.searchParams.get('scope'))
    const { table, col } = SCOPES[scope]

    const [producers, { data: links, error: lErr }] = await Promise.all([
      namesForScope(scope),
      supabaseAdmin.from(table).select(`${col}, qbo_customer_id`),
    ])
    if (lErr) throw new Error(lErr.message)

    const linkByName = new Map(
      (links ?? []).map(l => [(l as Record<string, string>)[col], l.qbo_customer_id]))
    const linkedQboIds = [...linkByName.values()]

    // Narrow cache queries: exact norm matches for suggestions + linked rows for display
    const norms = [...new Set(producers.map(p => norm(p.name)))]
    const [{ data: matches, error: mErr }, { data: linkedQbo, error: lqErr }] = await Promise.all([
      norms.length
        ? supabase.from('qbo_customers').select('qbo_id, display_name, norm_name, balance').eq('active', true).in('norm_name', norms)
        : Promise.resolve({ data: [], error: null }),
      linkedQboIds.length
        ? supabase.from('qbo_customers').select('qbo_id, display_name, balance').in('qbo_id', linkedQboIds)
        : Promise.resolve({ data: [], error: null }),
    ])
    if (mErr) throw new Error(mErr.message)
    if (lqErr) throw new Error(lqErr.message)

    const matchByNorm = new Map<string, { qbo_id: string; display_name: string; balance: number | null }[]>()
    for (const m of matches ?? []) {
      matchByNorm.set(m.norm_name, [...(matchByNorm.get(m.norm_name) ?? []), m])
    }
    const qboById = new Map((linkedQbo ?? []).map(q => [q.qbo_id, q]))

    const linked = []
    const suggestions = []
    const unmatched = []
    for (const p of producers) {
      const qboId = linkByName.get(p.name)
      if (qboId) {
        linked.push({ producer: p, qbo: qboById.get(qboId) ?? { qbo_id: qboId, display_name: '(missing from cache)', balance: null } })
        continue
      }
      // NOTE: intentionally NOT excluding already-linked QBO customers —
      // producer names are free text, so several variants ("Blegen Galloway",
      // "Blegen Galloways", " Blegen Galloway") legitimately map to ONE
      // QuickBooks customer.
      const candidates = matchByNorm.get(norm(p.name)) ?? []
      if (candidates.length > 0) suggestions.push({ producer: p, qbo: candidates[0], confidence: 'exact' })
      else unmatched.push(p)
    }

    // Trigram candidates for whatever the exact key missed — the real failure
    // mode is drift, not absence ("Wendi" vs "Wendy", "BELLS" vs "Belles",
    // "TEINI, JOE" vs "Joe Teini Resale"). These are NEVER auto-applied and are
    // returned with their score so a weak one looks weak: the top candidate for
    // "Wendy Racki" is a different Racki entirely.
    if (unmatched.length) {
      const { data: cands, error: cErr } = await supabase.rpc('qbo_customer_candidates', {
        names: unmatched.map(u => u.name),
      })
      if (cErr) throw new Error(cErr.message)
      const byName = new Map<string, { qbo_id: string; display_name: string; sim: number }[]>()
      for (const c of (cands ?? []) as { our_name: string; qbo_id: string; display_name: string; sim: number }[]) {
        byName.set(c.our_name, [...(byName.get(c.our_name) ?? []), c])
      }
      for (const u of unmatched) (u as Record<string, unknown>).candidates = byName.get(u.name) ?? []
    }

    const { data: syncRow } = await supabase.from('qbo_customers').select('synced_at').order('synced_at', { ascending: false }).limit(1)
    return NextResponse.json({ scope, linked, suggestions, unmatched, syncedAt: syncRow?.[0]?.synced_at ?? null })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// POST /api/qbo/customers — { action: 'sync' } refresh cache from QBO;
// { action: 'link', producerName, qboId } confirm; { action: 'unlink', producerName }.
export async function POST(req: NextRequest) {
  try {
    const body = await req.json()

    if (body.action === 'sync') {
      const all: QboCustomer[] = []
      let start = 1
      for (;;) {
        const q = `select * from Customer where Active in (true, false) startposition ${start} maxresults 1000`
        const res = await qboFetch<{ QueryResponse: { Customer?: QboCustomer[] } }>(`query?query=${encodeURIComponent(q)}`)
        const batch = res.QueryResponse.Customer ?? []
        all.push(...batch)
        if (batch.length < 1000) break
        start += 1000
      }
      const rows = all.map(c => ({
        qbo_id: c.Id,
        display_name: c.DisplayName,
        company_name: c.CompanyName ?? null,
        email: c.PrimaryEmailAddr?.Address ?? null,
        phone: c.PrimaryPhone?.FreeFormNumber ?? null,
        active: c.Active,
        balance: c.Balance ?? null,
        synced_at: new Date().toISOString(),
      }))
      for (let i = 0; i < rows.length; i += 500) {
        const { error } = await supabase.from('qbo_customers').upsert(rows.slice(i, i + 500), { onConflict: 'qbo_id' })
        if (error) throw new Error(error.message)
      }
      return NextResponse.json({ ok: true, count: rows.length, active: rows.filter(r => r.active).length })
    }

    // `name` is the scope-aware field; producerName stays accepted so an older
    // client (or a bookmarked call) keeps linking producers exactly as before.
    if (body.action === 'link' || body.action === 'unlink') {
      const scope = scopeOf(body.scope ?? null)
      const { table, col } = SCOPES[scope]
      const name = body.name ?? body.producerName
      if (!name) return NextResponse.json({ error: 'name required' }, { status: 400 })

      if (body.action === 'unlink') {
        const { error } = await supabaseAdmin.from(table).delete().eq(col, name)
        if (error) throw new Error(error.message)
        return NextResponse.json({ ok: true })
      }

      if (!body.qboId) return NextResponse.json({ error: 'qboId required' }, { status: 400 })
      const { error } = await supabaseAdmin
        .from(table)
        .upsert({ [col]: name, qbo_customer_id: String(body.qboId) }, { onConflict: col })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
