// ──────────────────────────────────────────────────────────────────────────────
// Build a TINY test .ht containing only the requested PLUs, fetched live from the
// plu_items table and run through the SAME builder the app uses (lib/hobart).
// This is the file we hand to HCT first to confirm import works before any bulk.
//
//   node scripts/make-test-ht.ts [plu...]        (defaults to 200 201)
//   → writes C:\Users\charl\Downloads\PLU_test_<plus>.ht
// ──────────────────────────────────────────────────────────────────────────────
import { writeFileSync } from 'node:fs'
import { buildHtFile, buildRT89, US, type HobartPlu } from '../lib/hobart.ts'

const SUPABASE_URL = 'https://eosafbzqitgqzhejilhf.supabase.co'
// Public anon key (per .env.local: "safe to commit/expose").
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImVvc2FmYnpxaXRncXpoZWppbGhmIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzY0NjgwNDksImV4cCI6MjA5MjA0NDA0OX0.v7MS81-tuhOzKITFstg08c7Tq2mtmlPeJrQXqFufzX8'

const plus = process.argv.slice(2).length ? process.argv.slice(2) : ['200', '201']

const url = `${SUPABASE_URL}/rest/v1/plu_items?plu_number=in.(${plus.join(',')})&select=*`
const res = await fetch(url, { headers: { apikey: ANON, Authorization: `Bearer ${ANON}` } })
const rows = (await res.json()) as Record<string, unknown>[]

// Keep the requested order, and fail loudly if any PLU is missing.
const byPlu = new Map(rows.map((r) => [String(r.plu_number), r]))
const items: HobartPlu[] = plus.map((p) => {
  const r = byPlu.get(p)
  if (!r) throw new Error(`PLU ${p} not found in plu_items`)
  return {
    plu_number: String(r.plu_number),
    item_name: String(r.item_name ?? ''),
    price: r.price == null ? null : Number(r.price),
    tare_weight: r.tare_weight == null ? null : Number(r.tare_weight),
    upc: (r.upc as string) ?? '',
    unit: (r.unit as string) ?? '02',
    department: (r.department as string) ?? '0',
    label_message: (r.label_message as string) ?? '',
  }
})

const ht = buildHtFile(items)

// Write the exact bytes (latin-1, one byte per char) so the 0x1E/0x1F framing
// matches the scale's native format — same encoding the app's download uses.
const bytes = Buffer.from(Uint8Array.from(ht, (c) => c.charCodeAt(0) & 0xff))
const outPath = `C:\\Users\\charl\\Downloads\\PLU_test_${plus.join('_')}.ht`
writeFileSync(outPath, bytes)

// Human-readable echo so we can eyeball it before importing.
console.log('Wrote', outPath, `(${bytes.length} bytes, ${items.length} PLUs)`)
console.log('Delimiters: 0x1F between fields, 0x1E terminating each record.\n')
for (const it of items) {
  console.log(`PLU ${it.plu_number}  "${it.item_name}"  $${it.price}/lb`)
  const rec = buildRT89(it)
  const f = (code: string) => rec.split(US).find((x) => x.startsWith(code))
  console.log('   ', ['p#', 'dt', 'u$', 'ta', 'up', 'u#', 'd#', 'rc', 'l1'].map(f).join('  '))
}
