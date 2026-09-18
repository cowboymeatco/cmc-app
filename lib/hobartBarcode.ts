// The 13-digit barcode a Hobart scale prints on a package.
//
//   [0]     = '2'  (in-store prefix)
//   [1-5]   = PLU number, zero padded
//   [6]     = flag digit, always '0' on our lb configuration
//   [7-11]  = weight in hundredths of a pound
//   [12]    = EAN-13 check digit, ignored
//
// Example: 2 00114 0 00069 9 → PLU 114, 0.69 lb
//
// ⚠️ This is a SECOND copy of the decoder that /scanner has had inline since
// long before this file (app/scanner/page.tsx). It is duplicated deliberately
// rather than extracted. /scanner is the bench tool the cut crew runs all day,
// feature branches are currently held against that same file awaiting
// Charlie's off-shift test, and a pure refactor there would collide with every
// one of them to save nine lines. Fold the scanner onto this module when those
// branches land, not before.

export interface DecodedLabel {
  plu: string
  /** Null when the label carries no weight — an each-priced item. */
  weightLbs: number | null
}

export const BARCODE_LENGTH = 13

export function decodeHobartLabel(barcode: string): DecodedLabel | null {
  if (barcode.length !== BARCODE_LENGTH) return null
  if (!/^\d{13}$/.test(barcode)) return null
  if (barcode[0] !== '2') return null
  const plu = parseInt(barcode.substring(1, 6), 10)
  if (plu <= 0) return null
  const hundredths = parseInt(barcode.substring(7, 12), 10)
  // A box or each-priced product prints a zero weight rather than omitting it.
  // That is a real scan of a real package, so it decodes — the caller counts it
  // by the piece instead of by the pound.
  return { plu: String(plu), weightLbs: hundredths > 0 ? hundredths / 100 : null }
}

/**
 * A produced box's own serial, off the box label we print: CMC + YYMMDD + four
 * characters, e.g. CMC26052600PI. No dashes, which is what separates it from
 * the inbound receiving identifier CMC-YYYYMMDD-NNN. Same pattern /scanner uses.
 */
export const BOX_SERIAL_RE = /^CMC\d{6}[A-Z0-9]{4}$/
export const BOX_SERIAL_LENGTH = 13

/** The inbound receiving identifier stamped on a box we bought: CMC-YYYYMMDD-NNN. */
const RECEIVING_ID_RE = /^CMC-\d{8}-\d{3}/

export type GunScan =
  | { kind: 'package'; code: string }
  | { kind: 'box'; serial: string }
  /** A label the gun read that is not something a count can use. */
  | { kind: 'other'; text: string }

/**
 * Pull complete scans out of however the gun's characters arrived.
 *
 * A USB scanner types faster than React re-renders and does not always land its
 * Enter, so characters pile up in the field and two labels can arrive as one
 * string. A package label is 13 digits starting 2; a box label is 13
 * characters starting CMC. Both are taken from the front of the buffer as they
 * complete, junk in front of a label is dropped, and whatever is still
 * arriving stays in the buffer for the next keystroke.
 *
 * Letters must survive this. An earlier version stripped every non-digit, which
 * is right for packages and silently destroys every box serial. Dashes must
 * survive too: with them stripped, the receiving label CMC-20260526-001 reads
 * as CMC2026052600 — a perfectly formed box serial that is not a box.
 */
export function drainScans(buffer: string): { scans: GunScan[]; rest: string } {
  let buf = buffer.toUpperCase().replace(/[^A-Z0-9-]/g, '')
  const scans: GunScan[] = []
  while (buf.length > 0) {
    if (buf.startsWith('CMC-')) {
      const m = buf.match(RECEIVING_ID_RE)
      if (m) {
        scans.push({ kind: 'other', text: m[0] })
        buf = buf.slice(m[0].length)
        continue
      }
      // Still arriving if everything so far fits the receiving shape.
      if (/^CMC-\d{0,8}(-\d{0,2})?$/.test(buf)) break
      buf = buf.slice(1)
      continue
    }
    if (buf.startsWith('-')) { buf = buf.slice(1); continue }
    if (buf.startsWith('CMC')) {
      if (buf.length < BOX_SERIAL_LENGTH) break
      const serial = buf.slice(0, BOX_SERIAL_LENGTH)
      if (BOX_SERIAL_RE.test(serial)) {
        scans.push({ kind: 'box', serial })
        buf = buf.slice(BOX_SERIAL_LENGTH)
      } else {
        buf = buf.slice(1)
      }
      continue
    }
    if (/^\d/.test(buf)) {
      const run = buf.match(/^\d+/)![0]
      if (run.length >= BARCODE_LENGTH) {
        scans.push({ kind: 'package', code: run.slice(0, BARCODE_LENGTH) })
        buf = buf.slice(BARCODE_LENGTH)
        continue
      }
      // Digits cut short by a letter were a partial read, not a label.
      if (run.length < buf.length) { buf = buf.slice(run.length); continue }
      break
    }
    // A lone C or CM may be the start of a box serial still arriving.
    if ('CMC'.startsWith(buf)) break
    buf = buf.slice(1)
  }
  return { scans, rest: buf }
}
