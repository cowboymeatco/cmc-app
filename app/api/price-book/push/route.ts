export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { qboFetch } from '@/lib/qbo'
import { getAllQboItems, updateQboItem, refreshQboCache, type QboApiItem } from '@/lib/qboSync'
import { loadPriceRows, type PriceRow } from '@/lib/priceBook'

// Price list → QuickBooks. Same shape as the PLU push (/api/qbo/push): a dry
// run lists every difference, a person ticks the ones to send and says who is
// approving, and only those are written. Everything is logged.
//
// Three kinds of change:
//   link   — the row names a QuickBooks item that already exists; store its id.
//            Nothing is written to QuickBooks.
//   create — no such item; create it as a Service under the SAME parent and
//            income account as an item already linked in its category (or
//            Custom Beef Kill), so the revenue lands where the rest of that
//            category does. Charlie, 2026-11-11: never on a default account.
//   price  — the item's sales price differs from the price list. Only pushed
//            when exactly one price-list row owns the item: CMC BEEF carries
//            whole, half and quarter at three rates, so its item price can't
//            mean any one of them — the invoice line sets the rate instead.
//
// POST { dryRun: true }                                   → { changes, notes }
// POST { dryRun: false, keys: [...], approvedBy }          → { done, failed, results }

interface Change {
  key: string                 // `${priceKey}:${kind}`
  priceKey: string
  label: string
  kind: 'link' | 'create' | 'price'
  qboItemId: string | null
  qboName: string
  from: string
  to: string
  template?: { id: string; name: string }   // create: whose parent / income account it copies
}

const leafKey = (s: string) => s.trim().toUpperCase()
const FALLBACK_TEMPLATE = '1215' // CUSTOM BEEF KILL — SERVICE INCOME:CUSTOM KILL & PROCESSING

function computeDiff(rows: PriceRow[], items: QboApiItem[]) {
  const byId = new Map(items.map(i => [i.Id, i]))
  const byName = new Map<string, QboApiItem[]>()
  for (const i of items) if (i.Active && i.Type !== 'Category') byName.set(leafKey(i.Name), [...(byName.get(leafKey(i.Name)) ?? []), i])

  const changes: Change[] = []
  const notes: string[] = []
  const itemFor = new Map<string, string>()   // price key → QBO id after linking

  for (const r of rows.filter(r => r.active)) {
    if (r.qbo_item_id) {
      const it = byId.get(r.qbo_item_id)
      if (!it) { notes.push(`${r.label}: linked QuickBooks item ${r.qbo_item_id} no longer exists`); continue }
      if (!it.Active) { notes.push(`${r.label}: QuickBooks item "${it.Name}" is inactive`); continue }
      itemFor.set(r.key, it.Id)
      continue
    }
    const name = (r.qbo_item_name ?? r.label).trim().toUpperCase()
    const hits = byName.get(leafKey(name)) ?? []
    if (hits.length > 1) { notes.push(`${r.label}: ${hits.length} QuickBooks items are named "${name}" — link it by hand`); continue }
    if (hits.length === 1) {
      itemFor.set(r.key, hits[0].Id)
      changes.push({ key: `${r.key}:link`, priceKey: r.key, label: r.label, kind: 'link', qboItemId: hits[0].Id, qboName: hits[0].Name, from: '(not linked)', to: `${hits[0].FullyQualifiedName} (#${hits[0].Id})` })
      continue
    }
    changes.push({ key: `${r.key}:create`, priceKey: r.key, label: r.label, kind: 'create', qboItemId: null, qboName: name, from: '(not in QuickBooks)', to: `new Service "${name}" at $${r.rate}` })
  }

  // Templates for creates: an item already linked in the same category.
  for (const c of changes.filter(c => c.kind === 'create')) {
    const row = rows.find(r => r.key === c.priceKey)!
    const sibling = rows.find(r => r.category === row.category && itemFor.has(r.key))
    const id = sibling ? itemFor.get(sibling.key)! : FALLBACK_TEMPLATE
    const t = byId.get(id)
    c.template = { id, name: t?.FullyQualifiedName ?? `item ${id}` }
    c.to += ` under ${t?.FullyQualifiedName?.split(':').slice(0, -1).join(':') || 'the same parent as ' + (t?.Name ?? id)}`
  }

  // Prices, for items exactly one row owns.
  const owners = new Map<string, PriceRow[]>()
  for (const r of rows.filter(r => r.active && itemFor.has(r.key))) {
    const id = itemFor.get(r.key)!
    owners.set(id, [...(owners.get(id) ?? []), r])
  }
  for (const [id, rs] of owners) {
    const it = byId.get(id)!
    if (rs.length > 1) {
      if (new Set(rs.map(r => r.rate)).size > 1) notes.push(`"${it.Name}" carries ${rs.map(r => `${r.label} $${r.rate}`).join(', ')} — price set per invoice line, item price left alone`)
      continue
    }
    const r = rs[0]
    const cur = it.UnitPrice ?? 0
    if (Math.round(cur * 10000) !== Math.round(r.rate * 10000)) {
      changes.push({ key: `${r.key}:price`, priceKey: r.key, label: r.label, kind: 'price', qboItemId: id, qboName: it.Name, from: `$${cur}`, to: `$${r.rate}` })
    }
  }
  return { changes, notes, byId }
}

interface FullItem { Id: string; ParentRef?: { value: string }; IncomeAccountRef?: { value: string; name?: string }; SubItem?: boolean; Taxable?: boolean }

export async function POST(req: NextRequest) {
  try {
    const { dryRun = true, keys = [], approvedBy } = await req.json()
    const [rows, items] = await Promise.all([loadPriceRows(), getAllQboItems()])
    const { changes, notes, byId } = computeDiff(rows, items)
    if (dryRun) return NextResponse.json({ changes, notes })

    const who = typeof approvedBy === 'string' ? approvedBy.trim() : ''
    if (!who) return NextResponse.json({ error: 'Say who is approving' }, { status: 400 })
    const wanted = new Set<string>(keys)
    const selected = changes.filter(c => wanted.has(c.key))
    if (!selected.length) return NextResponse.json({ error: 'Nothing selected' }, { status: 400 })

    const results: (Change & { status: 'ok' | 'error'; error?: string })[] = []
    const logChange = (c: Change, status: string, extra: Record<string, unknown> = {}) =>
      supabaseAdmin.from('price_book_changes').insert({
        key: c.priceKey, field: `qbo_${c.kind}`, old_value: c.from, new_value: c.to, changed_by: who,
        pushed_qbo: status, ...extra,
      })

    for (const c of selected) {
      try {
        if (c.kind === 'link') {
          const { error } = await supabaseAdmin.from('price_book').update({ qbo_item_id: c.qboItemId, updated_by: who, updated_at: new Date().toISOString() }).eq('key', c.priceKey)
          if (error) throw new Error(error.message)
        } else if (c.kind === 'create') {
          const row = rows.find(r => r.key === c.priceKey)!
          const tpl = (await qboFetch<{ Item: FullItem }>(`item/${c.template!.id}`)).Item
          if (!tpl.IncomeAccountRef) throw new Error(`template item ${c.template!.id} has no income account`)
          const body = {
            Name: c.qboName, Type: 'Service', UnitPrice: row.rate, Description: row.label,
            IncomeAccountRef: tpl.IncomeAccountRef, Taxable: tpl.Taxable ?? false,
            ...(tpl.SubItem && tpl.ParentRef ? { SubItem: true, ParentRef: tpl.ParentRef } : {}),
          }
          // requestid makes a retried create return the first one, not a second item.
          const res = await qboFetch<{ Item: { Id: string } }>(`item?requestid=pricebook-create-${c.priceKey}`, { method: 'POST', body: JSON.stringify(body) })
          const { error } = await supabaseAdmin.from('price_book').update({ qbo_item_id: res.Item.Id, qbo_item_name: c.qboName, updated_by: who, updated_at: new Date().toISOString() }).eq('key', c.priceKey)
          if (error) throw new Error(`created QuickBooks item ${res.Item.Id} but couldn't save its id: ${error.message}`)
          await supabaseAdmin.from('invoice_log').insert({ kind: 'item', status: 'ok', request_id: `pricebook-create-${c.priceKey}`, qbo_id: res.Item.Id, approved_by: who, request: body, response: res })
          c.qboItemId = res.Item.Id
        } else {
          const it = byId.get(c.qboItemId!)!
          await updateQboItem(it, { UnitPrice: Number(c.to.slice(1)) })
        }
        results.push({ ...c, status: 'ok' })
        await logChange(c, 'ok')
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        results.push({ ...c, status: 'error', error: msg })
        await logChange(c, msg)
      }
    }

    let cacheWarning: string | undefined
    try { await refreshQboCache() } catch { cacheWarning = 'QuickBooks cache refresh failed — hit Refresh Catalog on /processing' }
    const failed = results.filter(r => r.status === 'error').length
    return NextResponse.json({ done: results.length - failed, failed, results, cacheWarning })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
