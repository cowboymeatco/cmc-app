// Raw Hobart HT port-6000 client â€” speaks HCT's wire framing directly so a
// store-name change lands in ~Â¼ second instead of paying JVM startup.
// Wire format (captured from HCT's own CLI against a local listener, 2026-09-01):
//   send:  RT01âŸDT1âž  <records, US-fielded, RS-terminated>  RTFFâž
//   read:  RT01âŸDT1âž  RT7DâŸâž  RTFFâž   â†’ scale streams config records back
// The scale replies after a send; we wait for its reply (or idle) before
// declaring success, and log the bytes so the ACK format is on record.
import { createConnection } from 'node:net'

export const RS = '\x1e'
export const US = '\x1f'

const toBytes = (s) => Buffer.from(Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff))
const fromBytes = (b) => Array.from(b, (x) => String.fromCharCode(x)).join('')

// One request/response exchange: connect, write, collect reply until the scale
// goes idle (idleMs with no data) or closes. Resolves with whatever came back.
function exchange(ip, payload, { connectMs = 4000, idleMs = 1500, capMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const chunks = []
    const sock = createConnection({ host: ip, port: 6000 })
    let idleTimer = null
    const finish = () => { clearTimeout(idleTimer); sock.destroy(); resolve(fromBytes(Buffer.concat(chunks))) }
    const bumpIdle = () => { clearTimeout(idleTimer); idleTimer = setTimeout(finish, idleMs) }
    sock.setTimeout(connectMs)
    sock.once('timeout', () => { sock.destroy(); reject(new Error(`${ip}: connect timeout â€” scale asleep?`)) })
    sock.once('error', (e) => { clearTimeout(idleTimer); reject(new Error(`${ip}: ${e.message}`)) })
    sock.once('connect', () => {
      sock.setTimeout(0)
      sock.write(toBytes(payload))
      bumpIdle()
      setTimeout(finish, capMs) // hard cap
    })
    sock.on('data', (d) => { chunks.push(d); bumpIdle() })
    sock.once('close', finish)
  })
}

const frame = (records) => `RT01${US}DT1${RS}` + records + `RTFF${RS}`

export function parseRecords(raw) {
  return raw.split(RS).filter(Boolean).map((r) => {
    const parts = r.split(US)
    const fields = {}
    for (const f of parts.slice(1)) if (f.length >= 2) fields[f.slice(0, 2)] = f.slice(2)
    return { type: parts[0], fields, raw: r }
  })
}

// Read the scale's config (RTB9 carries the store fields sn/si/sG).
export async function readConfig(ip) {
  const raw = await exchange(ip, frame(`RT7D${US}${RS}`))
  const cfg = parseRecords(raw).find((r) => r.type === 'RTB9')
  if (!cfg) throw new Error(`${ip}: no RTB9 config record in reply (${raw.length} bytes)`)
  return cfg.fields
}

// Julian batch code YYDDD, the number the floor reads off a label. The crew
// types it into the scale's store-NUMBER field (si) â€” confirmed by the values
// found there (26243 = 2026 day 243 = Aug 31). Honours the scale's own day
// change (default 04:00): before then the pack day is still yesterday, so the
// code matches the scale's own printed pack date rather than jumping at midnight
// while nobody is packing. Mirrors julianYYDDD() in cmc-app/lib/label.ts.
export function julianYYDDD(date = new Date(), dayChangeHour = 4) {
  const d = new Date(date)
  if (d.getHours() < dayChangeHour) d.setDate(d.getDate() - 1)
  const start = new Date(d.getFullYear(), 0, 0)
  const day = Math.floor((d - start) / 86_400_000)
  return String(d.getFullYear()).slice(2) + String(day).padStart(3, '0')
}

// Read the store record, apply overrides, write it back. sG (logo) is always
// carried through untouched. Field order sn,si,sG mirrors the scale's own export.
async function writeStore(ip, { name, julian } = {}) {
  const cfg = await readConfig(ip)
  const sn = name   != null ? name   : (cfg.sn ?? '')
  const si = julian != null ? julian : (cfg.si ?? '')
  const rec = ['RT8A', `sn${sn}`, `si${si}`, `sG${cfg.sG ?? ''}`].join(US) + RS
  const reply = await exchange(ip, frame(rec))
  return { previousName: cfg.sn ?? '', previousSi: cfg.si ?? '', sn, si, reply: reply.replace(/[\x00-\x1f]/g, 'Â·') }
}

// Push a customer name â€” and stamp today's Julian into the store-number field
// at the same time, so the batch code is never stale after a name change.
export async function setStoreName(ip, name, dayChangeHour = 4) {
  return writeStore(ip, { name, julian: julianYYDDD(new Date(), dayChangeHour) })
}

// Roll ONLY the Julian; the store name is left exactly as it is (so a customer
// name up mid-run keeps printing, just with today's code). Used by the daily
// auto-roll and reachable from the CLI for testing.
export async function setJulian(ip, dayChangeHour = 4) {
  return writeStore(ip, { julian: julianYYDDD(new Date(), dayChangeHour) })
}

// CLI for testing:  node rawscale.mjs read <ip> | setname <ip> "<name>" | julian <ip>
const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())
if (isMain) {
  const [cmd, ip, ...rest] = process.argv.slice(2)
  if (cmd === 'read') {
    const cfg = await readConfig(ip)
    console.log({ sn: cfg.sn, si: cfg.si, sG: cfg.sG, fieldCount: Object.keys(cfg).length })
  } else if (cmd === 'setname') {
    const t0 = Date.now()
    const r = await setStoreName(ip, rest.join(' '))
    console.log(`done in ${Date.now() - t0}ms`, r)
  } else if (cmd === 'julian') {
    const t0 = Date.now()
    const r = await setJulian(ip)
    console.log(`done in ${Date.now() - t0}ms â†’ Julian ${r.si} (was ${r.previousSi})`)
  } else {
    console.log('usage: node rawscale.mjs read <ip> | setname <ip> "<name>" | julian <ip>')
  }
}
