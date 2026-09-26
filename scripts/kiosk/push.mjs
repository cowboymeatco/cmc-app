// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Cowboy Meats scale push agent.
// Fetches priced PLUs from the app â†’ builds the .ht â†’ sends to each Hobart scale
// via HCT's own CLI (headless). Runs on a machine ON THE SHOP LAN (the kiosk).
//
//   node push.mjs                 â†’ push to all scales in config.json
//   node push.mjs 192.168.1.190   â†’ push to one scale (for testing)
//
// Requires: the HCT install (jre + HCT.exe + lib) referenced by config.hctDir,
// plus commons-cli (bundled here â€” HCT ships without it).
// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import { readFileSync, writeFileSync, mkdirSync, existsSync, copyFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'
import { buildHtFile } from './hobart.mjs'
import { setStoreName, setJulian, julianYYDDD } from './rawscale.mjs'

const execFileP = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'))

// hctDir / commonsCli may be relative to this folder (portable bundle) or absolute.
const here = (p) => (isAbsolute(p) ? p : join(HERE, p))
const HCT_DIR = here(cfg.hctDir)
const COMMONS_CLI = here(cfg.commonsCli)

const args = process.argv.slice(2)
const WATCH = args.includes('--watch')
const only = args.find((a) => !a.startsWith('--')) // optional single scale IP
const scales = only ? [only] : cfg.scales

async function fetchPricedPlus() {
  const url = `${cfg.supabaseUrl}/rest/v1/plu_items?active=eq.true&price=gt.0.01&select=*&order=plu_number.asc`
  const res = await fetch(url, { headers: { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}` } })
  if (!res.ok) throw new Error(`Supabase ${res.status}: ${await res.text()}`)
  return res.json()
}

// ingredients drives the Ec pointer; ht_skeleton carries this item's own
// on-scale fields â€” above all l1, its label format. Both were missing here,
// so every push rewrote all 293 records with the PLU-100 defaults: processed
// items lost their label format and every ingredient link was cleared. The
// app's own .ht download has always sent them (cmc-app/lib/hobart.ts).
const toHobart = (r) => ({
  plu_number: String(r.plu_number),
  item_name: String(r.item_name ?? ''),
  price: r.price == null ? null : Number(r.price),
  tare_weight: r.tare_weight == null ? null : Number(r.tare_weight),
  upc: r.upc ?? '',
  unit: r.unit ?? '02',
  department: r.department ?? '0',
  label_message: r.label_message ?? '',
  ingredients: r.ingredients ?? '',
  skeleton: r.ht_skeleton ?? null,
})

// Pre-flight: is the scale's data port (6000) accepting? Scales that are
// asleep/standby answer ping but drop port 6000, so check before a 30s CLI hang.
function checkPort(ip, port = 6000, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = createConnection({ host: ip, port })
    const done = (ok) => { sock.destroy(); resolve(ok) }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

async function sendToScale(ip, htPath) {
  const cp = `${HCT_DIR}\\HCT.exe;${HCT_DIR}\\lib\\*;${COMMONS_CLI}`
  const java = `${HCT_DIR}\\jre\\bin\\java.exe`
  const args = ['-cp', cp, 'com.hobart.hct.MainFrm', '-a', 'SEND_HOBART_FILE', '-i', ip, '-f', htPath]
  let out = ''
  try {
    const r = await execFileP(java, args, { timeout: 120000, windowsHide: true })
    out = (r.stdout || '') + (r.stderr || '')
  } catch (e) {
    // HCT's CLI exits with code 1 even on success â€” rely on stdout, not exit code.
    out = (e.stdout || '') + (e.stderr || '')
  }
  const m = out.match(/(\d+)\s+records were sent successfully/i)
  return { ip, ok: !!m, records: m ? Number(m[1]) : 0, raw: out.trim() }
}

// Build the .ht from current prices and send to the given scales. Shared by
// one-shot mode and watch mode.
async function doPush(targetScales) {
  const rows = await fetchPricedPlus()
  const plus = rows.map(toHobart)
  const ht = buildHtFile(plus)
  const outDir = join(HERE, 'out')
  mkdirSync(outDir, { recursive: true })
  const htPath = join(outDir, 'PLU_push.ht')
  // latin-1: one byte per char, so the 0x1E/0x1F framing matches the scale format
  writeFileSync(htPath, Buffer.from(Uint8Array.from(ht, (c) => c.charCodeAt(0) & 0xff)))
  const results = []
  for (const ip of targetScales) {
    if (!(await checkPort(ip))) {
      results.push({ ip, ok: false, asleep: true })
      continue
    }
    results.push(await sendToScale(ip, htPath))
  }
  return { plusCount: plus.length, kb: Math.round(ht.length / 1024), results }
}

function printSummary({ plusCount, kb, results }, targetScales) {
  console.log(`Built ${plusCount} priced PLUs  (${kb} KB)`)
  for (const r of results) {
    if (r.asleep) console.log(`  â†’ ${r.ip} â€¦ âš ï¸  asleep/off â€” skipped`)
    else console.log(`  â†’ ${r.ip} â€¦ ${r.ok ? `âœ… ${r.records} records` : `âŒ FAILED â€” ${r.raw?.split('\n').pop()}`}`)
  }
  const ok = results.filter((r) => r.ok).length
  const asleep = results.filter((r) => r.asleep).length
  console.log(`Result: ${ok}/${targetScales.length} updated.` + (asleep ? `  (${asleep} asleep/off â€” wake and re-run)` : ''))
  return ok
}

// â”€â”€ watch mode: kiosk polls the app for button-triggered push requests â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const REST = (p) => `${cfg.supabaseUrl}/rest/v1/${p}`
const HDRS = { apikey: cfg.supabaseKey, Authorization: `Bearer ${cfg.supabaseKey}`, 'Content-Type': 'application/json' }

async function fetchPendingRequest() {
  const res = await fetch(REST('scale_push_requests?status=eq.pending&order=created_at.asc&limit=1'), { headers: HDRS })
  if (!res.ok) throw new Error(`poll ${res.status}`)
  return (await res.json())[0] || null
}
async function patchRequest(id, patch) {
  await fetch(REST(`scale_push_requests?id=eq.${id}`), {
    method: 'PATCH', headers: { ...HDRS, Prefer: 'return=minimal' }, body: JSON.stringify(patch),
  })
}

// Store-name request: rewrite the RT8A store record on one scale (or all, if the
// request names none) so its labels print the customer's name. setStoreName reads
// si/sG fresh off the scale first â€” the crew hand-edits the store number too.
async function doStoreName(req) {
  const p = req.payload || {}
  const name = String(p.store_name || '').replace(/[\x00-\x1f\x7f]/g, ' ').trim().slice(0, 40)
  const targets = p.ip ? [p.ip] : cfg.scales
  const results = []
  for (const ip of targets) {
    if (!name) { results.push({ ip, ok: false, error: 'empty store_name' }); continue }
    if (!(await checkPort(ip))) { results.push({ ip, ok: false, asleep: true }); continue }
    try {
      const t0 = Date.now()
      const r = await setStoreName(ip, name, cfg.dayChangeHour ?? 4)
      results.push({ ip, ok: true, previous: r.previousName, julian: r.si, ms: Date.now() - t0 })
      console.log(`  â†’ ${ip} store name "${r.previousName}" â†’ "${name}" Â· Julian ${r.si} (${Date.now() - t0}ms)`)
    } catch (e) {
      results.push({ ip, ok: false, error: e.message })
      console.log(`  â†’ ${ip} âŒ ${e.message}`)
    }
  }
  return results
}

// Keep the store-number field (the crew's Julian batch code) on today's date,
// hands-off. Runs on startup (fixes any stale scale immediately) and rolls over
// at the scale's day change. An asleep scale is simply retried next check, so it
// gets stamped the moment it's switched on for the day. Only si changes â€” a
// customer name up mid-run keeps printing, just with the right code.
const julianDone = {}   // ip â†’ the Julian we last wrote successfully
let lastJulianCheck = 0
async function rollJulians() {
  const now = Date.now()
  if (now - lastJulianCheck < 60_000) return   // at most once a minute
  lastJulianCheck = now
  const today = julianYYDDD(new Date(), cfg.dayChangeHour ?? 4)
  for (const ip of cfg.scales) {
    if (julianDone[ip] === today) continue
    if (!(await checkPort(ip))) continue        // asleep â€” try again next check
    try {
      await setJulian(ip, cfg.dayChangeHour ?? 4)
      julianDone[ip] = today
      console.log(`[${new Date().toLocaleString()}] Julian â†’ ${today} on ${ip}`)
    } catch (e) {
      console.error(`julian roll ${ip}: ${e.message}`)
    }
  }
}

async function watchLoop() {
  const every = (cfg.pollSeconds || 2) * 1000
  console.log(`Watching for scale requests every ${every / 1000}s â€¦ (leave this window open; Ctrl+C to stop)`)
  for (;;) {
    await rollJulians()
    try {
      const req = await fetchPendingRequest()
      if (req && req.kind === 'store_name') {
        console.log(`\n[${new Date().toLocaleString()}] store name requested â†’ running`)
        await patchRequest(req.id, { status: 'running' })
        const results = await doStoreName(req)
        await patchRequest(req.id, {
          status: results.every((r) => r.ok) ? 'done' : 'error',
          result: { scales: results },
          completed_at: new Date().toISOString(),
        })
      } else if (req) {
        console.log(`\n[${new Date().toLocaleString()}] push requested â†’ running`)
        await patchRequest(req.id, { status: 'running' })
        const summary = await doPush(cfg.scales)
        const ok = printSummary(summary, cfg.scales)
        await patchRequest(req.id, {
          status: ok === cfg.scales.length ? 'done' : 'error',
          result: { scales: summary.results, plus: summary.plusCount },
          completed_at: new Date().toISOString(),
        })
      }
    } catch (e) {
      console.error('watch error:', e.message)
    }
    await new Promise((r) => setTimeout(r, every))
  }
}

// HCT infinite-loops on startup if its settings folder is missing. A normal HCT
// install creates it; on a machine that never had HCT (e.g. the kiosk), we create
// it from the bundled copy so the agent is self-contained.
function ensureHctData() {
  const dir = 'C:\\Users\\Public\\Documents\\hct_data'
  const ini = join(dir, 'hct_properties.ini')
  if (existsSync(ini)) return
  const src = join(HERE, 'hct_properties.ini')
  if (!existsSync(src)) return // nothing to seed from; leave HCT to its default
  mkdirSync(dir, { recursive: true })
  copyFileSync(src, ini)
  console.log(`Created HCT settings folder: ${dir}`)
}

async function main() {
  console.log(`\n=== Cowboy Meats Â· scale push Â· ${new Date().toLocaleString()} ===`)
  ensureHctData()
  if (WATCH) return watchLoop()
  console.log(`Sending to ${scales.length} scale(s): ${scales.join(', ')}`)
  const summary = await doPush(scales)
  const ok = printSummary(summary, scales)
  process.exit(ok === scales.length ? 0 : 1)
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
