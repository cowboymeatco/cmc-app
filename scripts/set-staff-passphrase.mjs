// Set (or change) the shop passphrase that opens the office app.
//
//   node scripts/set-staff-passphrase.mjs "new passphrase here"
//
// Only the SHA-256 hash is stored, in exec_config (service role only) — the
// same place /exec's passphrase lives. Nothing is deployed and nothing
// restarts: the next sign-in checks the new hash. Devices already signed in
// stay signed in, because their cookie is signed by STAFF_SESSION_SECRET and
// has nothing to do with the passphrase. To cut every device off instead,
// rotate STAFF_SESSION_SECRET in Vercel and redeploy.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'

const pass = process.argv[2]
if (!pass || pass.trim().length < 8) {
  console.error('Usage: node scripts/set-staff-passphrase.mjs "<passphrase, 8+ chars>"')
  process.exit(1)
}

// Read .env.local directly rather than depending on a dotenv package.
const env = Object.fromEntries(
  readFileSync(new URL('../.env.local', import.meta.url), 'utf8')
    .split('\n')
    .filter(l => l.trim() && !l.trim().startsWith('#') && l.includes('='))
    .map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]),
)

const url = env.NEXT_PUBLIC_SUPABASE_URL
const key = env.SUPABASE_SERVICE_ROLE_KEY
if (!url || !key) {
  console.error('NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY missing from .env.local')
  process.exit(1)
}

const res = await fetch(`${url}/rest/v1/exec_config`, {
  method: 'POST',
  headers: {
    apikey:          key,
    Authorization:   `Bearer ${key}`,
    'Content-Type':  'application/json',
    Prefer:          'resolution=merge-duplicates',
  },
  body: JSON.stringify([{
    key:   'staff_pass_sha256',
    value: createHash('sha256').update(pass.trim()).digest('hex'),
  }]),
})

if (!res.ok) {
  console.error(`Failed (${res.status}): ${await res.text()}`)
  process.exit(1)
}
console.log('Staff passphrase updated. New sign-ins use it immediately.')
