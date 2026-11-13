// A PLU call-up: what the Pico wedge on a scale types to call a product up.
//
// The Pico pretends to be the scale's barcode scanner, so it types whatever a
// scanner would have read. Two candidates, and the bench test on the first
// scale decides which the Hobart accepts from its scanner port:
//
//   'plu'      the bare PLU number, e.g. 118
//   'barcode'  the 13-digit in-store barcode the scale itself prints for that
//              PLU, with a zero weight: 2 00118 0 00000 c (lib/hobartBarcode.ts
//              has the layout; c is the EAN-13 check digit)
//
// Pure, so the page and the route share it and it can be checked by hand.

export type CallupFormat = 'plu' | 'barcode'
export const CALLUP_FORMATS: CallupFormat[] = ['plu', 'barcode']

/** The crew's number for a scale: 1, 2, 3. One or two digits, nothing else. */
export const SCALE_NUMBER_RE = /^\d{1,2}$/
/** A PLU as the scale knows it: up to five digits, not zero. */
export const PLU_RE = /^\d{1,5}$/

export function ean13CheckDigit(twelve: string): string {
  let sum = 0
  for (let i = 0; i < 12; i++) {
    const d = twelve.charCodeAt(i) - 48
    sum += i % 2 === 0 ? d : d * 3
  }
  return String((10 - (sum % 10)) % 10)
}

/** The in-store barcode a Hobart prints for a PLU, at zero weight. */
export function hobartBarcodeForPlu(plu: string): string {
  const twelve = '2' + plu.padStart(5, '0') + '0' + '00000'
  return twelve + ean13CheckDigit(twelve)
}

/** What the wedge types, Enter not included — the Pico adds that itself. */
export function callupKeys(plu: string, format: CallupFormat): string {
  const n = String(parseInt(plu, 10))
  return format === 'barcode' ? hobartBarcodeForPlu(n) : n
}

/** A pending call-up nobody has typed within this long is stale: the packer
 *  has moved on, and typing it late would call up the wrong product under
 *  whatever is on the platter now. */
export const CALLUP_TTL_SECONDS = 90

/** A wedge polls every second while its station is working and every
 *  WEDGE_POLL_IDLE_SECONDS otherwise. Quiet for this long and it is off, off
 *  the wifi, or has not been given this scale number. */
export const WEDGE_ONLINE_SECONDS = 15
export interface Wedge {
  scale: string; first_seen_at: string; last_seen_at: string; check_ins: number
  /** When a /scanner or /scale-callup page last had this scale on screen. */
  scanner_seen_at?: string | null
}
export function wedgeOnline(w: Wedge | undefined, nowMs: number): boolean {
  return !!w && nowMs - new Date(w.last_seen_at).getTime() < WEDGE_ONLINE_SECONDS * 1000
}

// ── How often a wedge should ask ───────────────────────────────────────────
//
// Three boards asking every second, four Supabase requests a poll, was
// ~630,000 requests a day to deliver a handful of call-ups a week, and it
// blew the free-tier egress quota on 2026-11-08. The device route now tells
// each board how long to wait (next_in) and the firmware honors it. A board
// stays quick while anyone could tap a call-up for it, slow when nobody can.

/** While someone is working the station. One second is what the packer
 *  feels as "right away". */
export const WEDGE_POLL_BUSY_SECONDS = 1
/** Nights and Sundays. Kept under WEDGE_ONLINE_SECONDS so an idle board still
 *  shows as online; when a scanner page opens, its board is back to a second
 *  within one of these. */
export const WEDGE_POLL_IDLE_SECONDS = 10
/** A page that showed this scale within the last this-long means the station
 *  is in use, whatever the clock says. The pages re-stamp about once a minute
 *  while open (app/api/scale-callup GET). */
export const SCANNER_SEEN_WINDOW_SECONDS = 10 * 60
/** Shop hours on the Mountain clock: busy from `open` to `close`, Mon–Sat. */
export const SHOP_HOURS = { open: 6, close: 18 }

/** Is it shop hours in Forsyth? Mountain time, DST and all. */
export function shopIsOpen(now: Date): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', hour: '2-digit', hourCycle: 'h23', weekday: 'short',
  }).formatToParts(now)
  const hour = Number(parts.find(p => p.type === 'hour')?.value)
  const day = parts.find(p => p.type === 'weekday')?.value
  if (day === 'Sun' || Number.isNaN(hour)) return false
  return hour >= SHOP_HOURS.open && hour < SHOP_HOURS.close
}

/** Seconds a wedge should wait before its next poll. */
export function wedgePollSeconds(now: Date, scannerSeenAt: string | null | undefined): number {
  if (scannerSeenAt) {
    const age = now.getTime() - new Date(scannerSeenAt).getTime()
    if (age >= 0 && age < SCANNER_SEEN_WINDOW_SECONDS * 1000) return WEDGE_POLL_BUSY_SECONDS
  }
  return shopIsOpen(now) ? WEDGE_POLL_BUSY_SECONDS : WEDGE_POLL_IDLE_SECONDS
}
