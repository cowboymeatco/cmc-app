// Reading the Rice Lake indicator over its EDP port (Charlie, 2026-11-02).
//
// The rail-scale indicator (Rice Lake 85123 CPU board, Port 1 "EDP/RS-232",
// J3) is wired TxD/RxD/Gnd to a Tripp Lite Keyspan USB-serial adapter on the
// harvest laptop. Port 1 is set 9600 baud, 8 data bits, no parity, 1 stop,
// CR/LF line ends, INPUT = CMD. Chrome opens the COM port straight from the
// page through the Web Serial API, so there's no agent on the laptop.
//
// Two things come down the wire, both proven in PuTTY on 2026-11-02:
//
//   PRINT key on the indicator (a ticket, one line each):
//          0.0 lb GROSS
//          5.5 lb PT TARE
//         -5.5 lb NET
//
//   `XG` + CR sent by the computer (gross weight, one line):
//          0.0 lb
//
// We ask with XG. A carcass on a rail swings, so one reading isn't enough:
// readWeight() asks until two readings in a row agree, and reports motion if
// they never do within the time allowed.

export interface ScaleReading {
  lbs:     number
  /** `false` when consecutive reads kept disagreeing — the load was moving. */
  stable:  boolean
  /** The raw line the weight was parsed from, for the record. */
  raw:     string
}

export type ScaleStatus =
  | 'unsupported'   // not Chrome/Edge — no Web Serial
  | 'no-port'       // supported, but the user hasn't picked the Keyspan yet
  | 'ready'

// ── Parsing ───────────────────────────────────────────────────────────────────

const WEIGHT_RE = /(-?\d+(?:\.\d+)?)\s*(lb|kg)\b/i

/**
 * Pull a weight out of one indicator line. Accepts the bare XG reply and the
 * PRINT ticket's GROSS line; ignores TARE and NET lines so a ticket never
 * hands back the tared figure by mistake. Kilograms are converted.
 */
export function parseWeightLine(line: string): { lbs: number; raw: string } | null {
  const text = line.trim()
  if (!text) return null
  if (/\b(TARE|NET)\b/i.test(text)) return null
  const m = WEIGHT_RE.exec(text)
  if (!m) return null
  const n = parseFloat(m[1])
  if (!Number.isFinite(n)) return null
  const lbs = m[2].toLowerCase() === 'kg' ? Math.round(n * 2.20462 * 10) / 10 : n
  return { lbs, raw: text }
}

// ── Port management ───────────────────────────────────────────────────────────

const BAUD = 9600
let port: SerialPort | null = null

export function scaleStatus(): ScaleStatus {
  if (typeof navigator === 'undefined' || !navigator.serial) return 'unsupported'
  return port ? 'ready' : 'no-port'
}

/**
 * Reuse a port the user already granted on an earlier visit. Chrome remembers
 * the grant per origin, so after the first pick the button just works.
 */
export async function reconnectScale(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.serial) return false
  if (port) return true
  const ports = await navigator.serial.getPorts()
  if (ports.length === 0) return false
  port = ports[0]
  return true
}

/** Must be called from a click — Chrome only shows the port picker on a user gesture. */
export async function chooseScalePort(): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.serial) return false
  try {
    port = await navigator.serial.requestPort()
    return true
  } catch {
    return false   // user closed the picker
  }
}

async function ensureOpen(p: SerialPort): Promise<void> {
  if (p.readable && p.writable) return
  await p.open({ baudRate: BAUD, dataBits: 8, stopBits: 1, parity: 'none' })
}

/**
 * One XG round trip: send the command, read lines until one parses as a
 * weight or the deadline passes. Resolves null on timeout. The port stays open
 * between calls; only the reader/writer locks are taken and released.
 */
async function askOnce(p: SerialPort, timeoutMs: number): Promise<{ lbs: number; raw: string } | null> {
  if (!p.readable || !p.writable) throw new Error('Scale port is not open')

  const writer = p.writable.getWriter()
  try {
    await writer.write(new TextEncoder().encode('XG\r\n'))
  } finally {
    writer.releaseLock()
  }

  const reader  = p.readable.getReader()
  const decoder = new TextDecoder()
  let buffer    = ''
  const deadline = Date.now() + timeoutMs
  try {
    while (Date.now() < deadline) {
      const remaining = deadline - Date.now()
      const chunk = await Promise.race([
        reader.read(),
        new Promise<'timeout'>(res => setTimeout(() => res('timeout'), remaining)),
      ])
      if (chunk === 'timeout') break
      if (chunk.done) break
      buffer += decoder.decode(chunk.value, { stream: true })
      // The indicator ends lines with CR/LF; split on either so a lone CR works too.
      const lines = buffer.split(/\r\n|\r|\n/)
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        const w = parseWeightLine(line)
        if (w) return w
      }
    }
    return null
  } finally {
    // Cancel any pending read so the lock can be released without hanging.
    try { await reader.cancel() } catch { /* already closed */ }
    reader.releaseLock()
  }
}

/**
 * Read the gross weight off the scale. Asks repeatedly until two consecutive
 * answers match (a hanging carcass settling), up to `settleMs` in total. If
 * it never settles, returns the last answer flagged `stable: false` so the
 * caller can decide whether to take it.
 */
export async function readWeight(opts: { settleMs?: number } = {}): Promise<ScaleReading> {
  const settleMs = opts.settleMs ?? 2500
  if (!port) {
    const ok = await reconnectScale()
    if (!ok || !port) throw new Error('No scale port chosen')
  }
  await ensureOpen(port)

  const deadline = Date.now() + settleMs
  let last: { lbs: number; raw: string } | null = null
  while (Date.now() < deadline) {
    const w = await askOnce(port, 1200)
    if (!w) {
      if (last) break          // got something earlier; the scale went quiet
      continue                 // nothing yet — ask again
    }
    if (last && last.lbs === w.lbs) return { ...w, stable: true }
    last = w
    await new Promise(res => setTimeout(res, 300))
  }
  if (!last) throw new Error('No answer from the scale — is it on and set to INPUT CMD?')
  return { ...last, stable: false }
}
