// ─────────────────────────────────────────────────────────────────────────────
// Cowboy Meats — read every LABEL FORMAT and every GRAPHIC off one Hobart scale.
// Read only: nothing is sent to the scale. Runs on the kiosk (shop LAN) through
// HCT's own CLI, the same way push.mjs sends prices.
//
//   node read-labels.mjs                 → first scale in config.json
//   node read-labels.mjs 192.168.1.191   → one scale
//
// Writes out\labels_<ip>.ht and out\graphics_<ip>.ht. Those two files are the
// capture the label-format push project needs (phase 0): send them on as-is.
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, mkdirSync, existsSync, statSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, join, isAbsolute } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConnection } from 'node:net'

const execFileP = promisify(execFile)
const HERE = dirname(fileURLToPath(import.meta.url))
const cfg = JSON.parse(readFileSync(join(HERE, 'config.json'), 'utf8'))
const here = (p) => (isAbsolute(p) ? p : join(HERE, p))
const HCT_DIR = here(cfg.hctDir)
const COMMONS_CLI = here(cfg.commonsCli)

const ip = process.argv.slice(2).find((a) => !a.startsWith('--')) || cfg.scales?.[0] || '192.168.1.190'
if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
  console.error(`Not a scale IP: ${ip}`)
  process.exit(1)
}

// Scales that are asleep answer ping but drop port 6000 — check before HCT hangs.
function checkPort(host, port = 6000, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const sock = createConnection({ host, port })
    const done = (ok) => { sock.destroy(); resolve(ok) }
    sock.setTimeout(timeoutMs)
    sock.once('connect', () => done(true))
    sock.once('timeout', () => done(false))
    sock.once('error', () => done(false))
  })
}

// One HCT CLI read. HCT exits 1 even on success, so success = the output file
// exists and is not empty.
async function hctRead(action, outPath) {
  const cp = `${HCT_DIR}\\HCT.exe;${HCT_DIR}\\lib\\*;${COMMONS_CLI}`
  const java = `${HCT_DIR}\\jre\\bin\\java.exe`
  const args = ['-cp', cp, 'com.hobart.hct.MainFrm', '-a', action, '-i', ip, '-f', outPath]
  let out = ''
  try {
    const r = await execFileP(java, args, { timeout: 180000, windowsHide: true })
    out = (r.stdout || '') + (r.stderr || '')
  } catch (e) {
    out = (e.stdout || '') + (e.stderr || '')
  }
  const ok = existsSync(outPath) && statSync(outPath).size > 0
  return { ok, raw: out.trim() }
}

// Records are RS-terminated (0x1E); the first 4 bytes of each are its type (RT..).
function summarize(path) {
  const bytes = readFileSync(path)
  const text = Array.from(bytes, (b) => String.fromCharCode(b)).join('')
  const recs = text.split('\x1e').filter((r) => r.length > 0)
  const counts = {}
  for (const r of recs) counts[r.slice(0, 4)] = (counts[r.slice(0, 4)] || 0) + 1
  return { kb: Math.round(bytes.length / 1024), records: recs.length, counts }
}

async function main() {
  console.log(`\n=== Cowboy Meats · read label formats + graphics · ${new Date().toLocaleString()} ===`)
  console.log(`Scale: ${ip}   (read only — nothing is sent)`)
  if (!(await checkPort(ip))) {
    console.log(`⚠️  ${ip} is asleep/off (port 6000 closed). Wake it (weigh something) and re-run.`)
    process.exit(1)
  }
  const outDir = join(HERE, 'out')
  mkdirSync(outDir, { recursive: true })
  const last = ip.split('.').pop()
  const jobs = [
    ['READ_ALL_LABELS', join(outDir, `labels_${last}.ht`)],
    ['READ_ALL_GRAPHICS', join(outDir, `graphics_${last}.ht`)],
  ]
  let allOk = true
  for (const [action, outPath] of jobs) {
    process.stdout.write(`${action} → ${outPath} … `)
    const r = await hctRead(action, outPath)
    if (!r.ok) {
      allOk = false
      console.log(`❌ FAILED\n${r.raw.split('\n').slice(-5).join('\n')}`)
      continue
    }
    const s = summarize(outPath)
    const types = Object.entries(s.counts).map(([t, n]) => `${t}×${n}`).join(', ')
    console.log(`✅ ${s.records} records, ${s.kb} KB  [${types}]`)
  }
  console.log(allOk
    ? `\nDone. Send both files from the out\\ folder on for decoding (phase 0 of the label-format push).`
    : `\nOne or both reads failed — see above. The scale may have gone to sleep mid-read; re-run.`)
  process.exit(allOk ? 0 : 1)
}

main().catch((e) => {
  console.error('ERROR:', e.message)
  process.exit(1)
})
