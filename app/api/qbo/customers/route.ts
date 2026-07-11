// Node runtime: the full-catalog customer sync pages through ~9k QBO
// customers and needs more than the edge time budget.
export const maxDuration = 60
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { qboFetch } from '@/lib/qbo'

// Producer -> QuickBooks customer recognition. Billing keys off
// harvest_log.producer names; links live in producer_qbo_links. The QBO
// customer cache (qbo_customers, ~8.8k rows) refreshes over the app's live
// QuickBooks connection and is only ever queried narrowly (norm match or
// search) — never listed wholesale.

const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

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

    const [{ data: harvests, error: hErr }, { data: links, error: lErr }] = await Promise.all([
      supabase.from('harvest_log').select('producer').not('producer', 'is', null).neq('producer', ''),
      supabase.from('producer_qbo_links').select('producer_name, qbo_customer_id'),
    ])
    if (hErr) throw new Error(hErr.message)
    if (lErr) throw new Error(lErr.message)

    // Distinct producers with harvest counts
    const counts = new Map<string, number>()
    for (const h of harvests ?? []) counts.set(h.producer, (counts.get(h.producer) ?? 0) + 1)
    const producers = [...counts.entries()].map(([name, harvestCount]) => ({ name, harvestCount }))
      .sort((a, b) => a.name.localeCompare(b.name))

    const linkByName = new Map((links ?? []).map(l => [l.producer_name, l.qbo_customer_id]))
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

    const { data: syncRow } = await supabase.from('qbo_customers').select('synced_at').order('synced_at', { ascending: false }).limit(1)
    return NextResponse.json({ linked, suggestions, unmatched, syncedAt: syncRow?.[0]?.synced_at ?? null })
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

    if (body.action === 'link') {
      const { producerName, qboId } = body
      if (!producerName || !qboId) return NextResponse.json({ error: 'producerName and qboId required' }, { status: 400 })
      const { error } = await supabase
        .from('producer_qbo_links')
        .upsert({ producer_name: producerName, qbo_customer_id: String(qboId) }, { onConflict: 'producer_name' })
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'unlink') {
      const { producerName } = body
      if (!producerName) return NextResponse.json({ error: 'producerName required' }, { status: 400 })
      const { error } = await supabase.from('producer_qbo_links').delete().eq('producer_name', producerName)
      if (error) throw new Error(error.message)
      return NextResponse.json({ ok: true })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
