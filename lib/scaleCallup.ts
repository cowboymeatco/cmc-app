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
