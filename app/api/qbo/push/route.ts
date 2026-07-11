export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getAllQboItems, updateQboItem, refreshQboCache, type QboApiItem } from '@/lib/qboSync'

// App -> QuickBooks write-back, mirroring the Clover push flow:
// dry run by default, human selects changes, every write logged to
// qbo_push_log. Two kinds of changes:
//  - linked PLUs: price (retail_price -> UnitPrice) and name (app item_name,
//    already ALL CAPS, -> Item.Name)
//  - sweep: ALL-CAPS rename of every other active sellable item (no PLU),
//    so the whole QBO catalog meets Jill's standard
// Categories are never touched.

interface PluRow {
  id: string
  plu_number: string
  item_name: string
  retail_price: number | null
  quickbooks_item_id: string
}

export interface Change {
  key: string                    // `${qboId}:${field}`
  pluId: string | null
  pluNumber: string
  itemName: string               // app name, or QBO name for sweep rows
  qboItemId: string
  qboName: string
  field: 'price' | 'name'
  from: string
  to: string
  sweep: boolean
}

const SELLABLE = new Set(['Service', 'Inventory', 'NonInventory'])

function computeDiff(plus: PluRow[], qboItems: QboApiItem[]) {
  const byId = new Map(qboItems.map(i => [i.Id, i]))
  const changes: Change[] = []
  const skipped: string[] = []
  const claimed = new Set<string>()

  for (const p of plus) {
    if (!p.quickbooks_item_id) continue
    const q = byId.get(p.quickbooks_item_id)
    if (!q) { skipped.push(`${p.item_name}: linked QBO item ${p.quickbooks_item_id} not found`); continue }
    if (!q.Active) { skipped.push(`${p.item_name}: QBO item is inactive`); continue }
    if (claimed.has(q.Id)) { skipped.push(`${p.item_name}: another PLU already pushes to QBO item "${q.Name}"`); continue }
    claimed.add(q.Id)

    const appName = p.item_name.toUpperCase()
    if (q.Name !== appName) {
      changes.push({
        key: `${q.Id}:name`, pluId: p.id, pluNumber: p.plu_number, itemName: p.item_name,
        qboItemId: q.Id, qboName: q.Name, field: 'name', from: q.Name, to: appName, sweep: false,
      })
    }
    if (p.retail_price != null) {
      const current = q.UnitPrice ?? 0
      if (Math.round(current * 100) !== Math.round(p.retail_price * 100)) {
        changes.push({
          key: `${q.Id}:price`, pluId: p.id, pluNumber: p.plu_number, itemName: p.item_name,
          qboItemId: q.Id, qboName: q.Name, field: 'price',
          from: `$${current.toFixed(2)}`, to: `$${p.retail_price.toFixed(2)}`, sweep: false,
        })
      }
    }
  }

  // ALL-CAPS sweep over active sellable items no PLU claims
  for (const q of qboItems) {
    if (!q.Active || !SELLABLE.has(q.Type) || claimed.has(q.Id)) continue
    const caps = q.Name.toUpperCase()
    if (q.Name !== caps) {
      changes.push({
        key: `${q.Id}:name`, pluId: null, pluNumber: '—', itemName: q.Name,
        qboItemId: q.Id, qboName: q.Name, field: 'name', from: q.Name, to: caps, sweep: true,
      })
    }
  }

  return { changes, skipped }
}

export async function POST(req: NextRequest) {
  try {
    const { dryRun = true, keys = [], pushNames = false } = await req.json()

    const [{ data: plus, error }, qboItems] = await Promise.all([
      supabase
        .from('plu_items')
        .select('id, plu_number, item_name, retail_price, quickbooks_item_id')
        .eq('active', true)
        .neq('quickbooks_item_id', ''),
      getAllQboItems(),
    ])
    if (error) throw new Error(error.message)

    const { changes, skipped } = computeDiff((plus ?? []) as PluRow[], qboItems)
    if (dryRun) return NextResponse.json({ changes, skipped })

    // Live push: only selected keys; name changes additionally gated by pushNames
    const keySet = new Set(keys as string[])
    const selected = changes.filter(c => keySet.has(c.key) && (c.field !== 'name' || pushNames))

    // one API call per QBO item, fields combined
    const byItem = new Map<string, Change[]>()
    for (const c of selected) byItem.set(c.qboItemId, [...(byItem.get(c.qboItemId) ?? []), c])
    const itemById = new Map(qboItems.map(i => [i.Id, i]))

    let pushed = 0
    let failed = 0
    const logRows = []
    for (const [qboId, itemChanges] of byItem) {
      const item = itemById.get(qboId)
      if (!item) continue
      const payload: { Name?: string; UnitPrice?: number } = {}
      for (const c of itemChanges) {
        if (c.field === 'name') payload.Name = c.to
        if (c.field === 'price') payload.UnitPrice = parseFloat(c.to.replace('$', ''))
      }
      let status = 'ok'
      let errMsg: string | null = null
      try {
        await updateQboItem(item, payload)
        pushed += itemChanges.length
      } catch (e) {
        status = 'error'
        errMsg = e instanceof Error ? e.message : String(e)
        failed += itemChanges.length
      }
      for (const c of itemChanges) {
        logRows.push({
          plu_id: c.pluId, plu_number: c.pluNumber, item_name: c.itemName,
          qbo_item_id: c.qboItemId, field: c.field, old_value: c.from, new_value: c.to,
          status, error: errMsg,
        })
      }
    }

    let logWarning: string | null = null
    if (logRows.length > 0) {
      const { error: logErr } = await supabase.from('qbo_push_log').insert(logRows)
      if (logErr) logWarning = `push log write failed: ${logErr.message}`
    }

    // cache follows the live catalog so links/alignment reflect the push
    try { await refreshQboCache() } catch { logWarning = (logWarning ? logWarning + '; ' : '') + 'cache refresh failed — hit Refresh Catalog' }

    return NextResponse.json({ pushed, failed, logWarning })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
