// ──────────────────────────────────────────────────────────────────────────────
// Build the FULL scale export: every active PLU that has a real price (> $0.01),
// run through the same validated builder the app uses (lib/hobart). Placeholders
// ($0.01 — wild-game service, wholesale cut-codes, boxes, NFS) are excluded so
// the merge import only touches items with real prices.
//
//   node scripts/make-full-ht.ts
//   → writes C:\Users\charl\Downloads\PLU_full_export.ht
// ──────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from 'node:fs'
import { buildHtFile, type HobartPlu } from '../lib/hobart.ts'

const SUPABASE_URL = 'https://eosafbzqitgqzhejilhf.supabase.co'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvc2FmYnpxaXRncXpoZWppbGhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjgwNDksImV4cCI6MjA5MjA0NDA0OX0.v7MS81-tuhOzKITFstg08c7Tq2mtmlPeJrQXqFufzX8'

const url = `${SUPABASE_URL}/rest/v1/plu_items?active=eq.true&price=gt.0.01&select=*&order=plu_number.asc`
const res = await fetch(url, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
const rows = (await res.json()) as Record<string, unknown>[]

const items: HobartPlu[] = rows.map((r) => ({
  plu_number: String(r.plu_number),
  item_name: String(r.item_name ?? ''),
  price: r.price == null ? null : Number(r.price),
  tare_weight: r.tare_weight == null ? null : Number(r.tare_weight),
  upc: (r.upc as string) ?? '',
  unit: (r.unit as string) ?? '02',
  department: (r.department as string) ?? '0',
  label_message: (r.label_message as string) ?? '',
  ingredients: (r.ingredients as string) ?? '', // drives the Ec "Expanded text" reference
}))

const ht = buildHtFile(items)
const bytes = Buffer.from(Uint8Array.from(ht, (c) => c.charCodeAt(0) & 0xff))
const outPath = 'C:\\Users\\charl\\Downloads\\PLU_full_export.ht'
writeFileSync(outPath, bytes)

console.log(`Wrote ${outPath}`)
console.log(`${items.length} priced PLUs  •  ${bytes.length} bytes`)
// quick sanity: price range + a couple samples
const prices = items.map((i) => i.price ?? 0)
console.log(`price range: $${Math.min(...prices).toFixed(2)} – $${Math.max(...prices).toFixed(2)}`)
console.log('samples:', items.slice(0, 3).map((i) => `${i.plu_number} ${i.item_name} $${i.price}`).join(' | '))
