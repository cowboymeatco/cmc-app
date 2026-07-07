// ──────────────────────────────────────────────────────────────────────────────
// Round-trip validator for the Hobart .ht exporter (lib/hobart.ts).
//
// Proves fidelity BEFORE anything touches the production scale: it regenerates a
// PLU's RT89 record from plu_items-shaped data and byte-diffs it against the
// SAME PLU's record in the real scale export (backup.ht). Any diff is printed
// field-by-field so we can confirm it is intentional and harmless.
//
// Run (Node ≥ 23.6 strips the TS types automatically):
//   node scripts/validate-ht.ts [path-to-backup.ht]
// ──────────────────────────────────────────────────────────────────────────────
import { readFileSync } from 'node:fs'
import { buildRT89, RS, US } from '../lib/hobart.ts'

const BACKUP = process.argv[2] ?? 'C:\\Users\\charl\\Downloads\\backup.ht'

// plu_items row for PLU 100, exactly as returned by the live Supabase table.
const PLU_100 = {
  plu_number: '100',
  item_name: 'GROUND BEEF',
  price: 5.69,
  tare_weight: 0,
  department: '0',
  unit: '02',
  upc: '',          // empty in DB → builder falls back to plu_number ('100')
  label_message: '',
}

function fieldsOf(record: string): Map<string, string> {
  const m = new Map<string, string>()
  for (const f of record.split(US).slice(1)) {
    if (f) m.set(f.slice(0, 2), f.slice(2))
  }
  return m
}

const raw = readFileSync(BACKUP, 'latin1')
const original = raw
  .split(RS)
  .find((r) => r.startsWith('RT89') && r.split(US).some((f) => f === 'p#100'))

if (!original) {
  console.error('Could not find PLU 100 (p#100) in', BACKUP)
  process.exit(1)
}

const generated = buildRT89(PLU_100)

const oFields = fieldsOf(original)
const gFields = fieldsOf(generated)

console.log('=== RT89 round-trip: PLU 100 (GROUND BEEF) ===')
console.log('original  fields:', oFields.size, ' generated fields:', gFields.size)

const codes = [...new Set([...oFields.keys(), ...gFields.keys()])]
const diffs: { code: string; original: string; generated: string }[] = []
for (const code of codes) {
  const o = oFields.get(code) ?? '«missing»'
  const g = gFields.get(code) ?? '«missing»'
  if (o !== g) diffs.push({ code, original: o, generated: g })
}

if (diffs.length === 0) {
  console.log('\n✅ BYTE-IDENTICAL — generated record matches the scale export exactly.')
} else {
  console.log(`\n⚠️  ${diffs.length} field diff(s):`)
  for (const d of diffs) {
    console.log(`  ${JSON.stringify(d.code)}: scale=${JSON.stringify(d.original)}  generated=${JSON.stringify(d.generated)}`)
  }
}

// Also confirm the mapped fields landed correctly (the ones that matter to the scale).
console.log('\n--- key mapped fields (generated) ---')
for (const code of ['p#', 'dt', 'u$', 'ta', 'up', 'u#', 'd#', 'rc', 'l1']) {
  console.log(`  ${code} = ${JSON.stringify(gFields.get(code))}`)
}
