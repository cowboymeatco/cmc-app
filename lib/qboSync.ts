import { qboFetch } from '@/lib/qbo'
import { supabase } from '@/lib/supabase'

// Live QuickBooks Item catalog: fetch, update, and mirror into the
// qbo_items cache (which the linking + alignment views read).

export interface QboApiItem {
  Id: string
  SyncToken: string
  Name: string                  // leaf name (unique across items)
  FullyQualifiedName: string    // 'RETAIL SALES:RETAIL CUTS:Beef Trim'
  Type: string                  // Service | Inventory | NonInventory | Category | Group
  UnitPrice?: number
  PurchaseCost?: number
  QtyOnHand?: number
  Taxable?: boolean
  Active: boolean
  Description?: string
}

interface ItemQueryResponse {
  QueryResponse: { Item?: QboApiItem[]; maxResults?: number }
}

// All items, active and inactive, paginated. Categories/bundles included —
// callers filter by Type as needed.
export async function getAllQboItems(): Promise<QboApiItem[]> {
  const items: QboApiItem[] = []
  const pageSize = 1000
  for (let start = 1; ; start += pageSize) {
    const q = `select * from Item where Active in (true, false) startposition ${start} maxresults ${pageSize}`
    const res = await qboFetch<ItemQueryResponse>(`query?query=${encodeURIComponent(q)}`)
    const page = res.QueryResponse.Item ?? []
    items.push(...page)
    if (page.length < pageSize) break
  }
  return items
}

// Sparse update — only the provided fields change. QBO requires the item's
// current SyncToken; stale tokens are rejected (safe against lost updates).
export async function updateQboItem(item: QboApiItem, changes: { Name?: string; UnitPrice?: number }): Promise<QboApiItem> {
  const res = await qboFetch<{ Item: QboApiItem }>('item', {
    method: 'POST',
    body: JSON.stringify({ Id: item.Id, SyncToken: item.SyncToken, sparse: true, ...changes }),
  })
  return res.Item
}

// Rewrite the qbo_items cache from the live catalog (replace-all; links are
// unaffected — they live on plu_items.quickbooks_item_id). Categories are
// excluded: they're folder nodes, not invoiceable items.
export async function refreshQboCache(): Promise<{ total: number; active: number }> {
  const items = (await getAllQboItems()).filter(i => i.Type !== 'Category')
  const now = new Date().toISOString()
  const rows = items.map(i => ({
    qbo_id: i.Id,
    full_name: i.FullyQualifiedName,
    name: i.Name,
    type: i.Type,
    description: i.Description ?? null,
    sales_price: i.UnitPrice ?? null,
    purchase_price: i.PurchaseCost ?? null,
    qty_on_hand: i.QtyOnHand ?? null,
    taxable: i.Taxable ?? null,
    active: i.Active,
    synced_at: now,
  }))

  const { error: delErr } = await supabase.from('qbo_items').delete().not('id', 'is', null)
  if (delErr) throw new Error(`cache clear failed: ${delErr.message}`)
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await supabase.from('qbo_items').insert(rows.slice(i, i + 500))
    if (error) throw new Error(`cache insert failed at ${i}: ${error.message}`)
  }
  return { total: rows.length, active: rows.filter(r => r.active).length }
}
