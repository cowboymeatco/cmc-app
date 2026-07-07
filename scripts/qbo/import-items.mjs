// Refresh the qbo_items cache from a QuickBooks Products & Services export.
//
// The app has no QBO OAuth, so the catalog is cached in Supabase and refreshed
// by re-running the export in a Claude session (QuickBooks connector), then:
//   cd cmc-app
//   node --env-file=.env.local scripts/qbo/import-items.mjs scripts/qbo/qbo-items-YYYY-MM-DD.json
//
// Input: JSON array of { full_name, name, type, description, sales_price,
// purchase_price, qty_on_hand, active, qbo_id?, taxable? }. The cache is
// replaced wholesale — links are unaffected (they live on plu_items.quickbooks_item_id).

import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'node:fs'

const url = process.env.NEXT_PUBLIC_SUPABASE_URL
const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!url || !key) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY (use --env-file=.env.local)')
  process.exit(1)
}
const file = process.argv[2]
if (!file) {
  console.error('Usage: node --env-file=.env.local scripts/qbo/import-items.mjs <items.json>')
  process.exit(1)
}

const supabase = createClient(url, key)
const raw = JSON.parse(readFileSync(file, 'utf-8'))

// Dedupe by full_name (QBO reuses "(deleted)" names); keep the first occurrence.
const seen = new Set()
const num = v => (v == null || v === '' ? null : Number(v))
const rows = []
for (const i of raw) {
  if (seen.has(i.full_name)) continue
  seen.add(i.full_name)
  rows.push({
    qbo_id: i.qbo_id ?? null,
    full_name: i.full_name,
    name: i.name,
    type: i.type ?? null,
    description: i.description ?? null,
    sales_price: num(i.sales_price),
    purchase_price: num(i.purchase_price),
    qty_on_hand: num(i.qty_on_hand),
    taxable: i.taxable ?? null,
    active: i.active ?? true,
    synced_at: new Date().toISOString(),
  })
}

const { error: delErr } = await supabase.from('qbo_items').delete().not('id', 'is', null)
if (delErr) { console.error('Clear failed:', delErr.message); process.exit(1) }

let inserted = 0
for (let i = 0; i < rows.length; i += 500) {
  const batch = rows.slice(i, i + 500)
  const { error } = await supabase.from('qbo_items').insert(batch)
  if (error) { console.error(`Insert failed at ${i}:`, error.message); process.exit(1) }
  inserted += batch.length
}
const withId = rows.filter(r => r.qbo_id).length
console.log(`qbo_items refreshed: ${inserted} rows (${rows.filter(r => r.active).length} active, ${withId} with QBO ids)`)
