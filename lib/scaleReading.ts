// A live weight off a floor scale, as the app sees it.
//
// The Rice Lake indicator on the live-animal scale streams its display over
// RS-232 ten times a second. A Pico 2 W on that port (scripts/pico-scale)
// reads the stream and posts the latest weight to /api/scale-readings/device,
// which keeps ONE row per scale in scale_readings. The harvest page polls it
// and offers the number instead of asking somebody to read it off and type
// it. Pure helpers here so the parsing can be checked without a board.

export const SCALE_IDS = ['live_animal'] as const
export type ScaleId = typeof SCALE_IDS[number]

/** A reading older than this is not what is on the platform now. */
export const READING_STALE_SECONDS = 5

export interface ScaleReading {
  scale_id: string
  kiosk: string | null
  lb: number | null
  kg: number | null
  stable: boolean
  stale: boolean
  below_zero: boolean
  read_at: string
  updated_at: string
  raw: Record<string, unknown> | null
}

export function readingIsStale(r: Pick<ScaleReading, 'read_at' | 'stale'> | null | undefined, nowMs: number): boolean {
  if (!r) return true
  if (r.stale) return true
  return nowMs - new Date(r.read_at).getTime() > READING_STALE_SECONDS * 1000
}

/**
 * One frame of Rice Lake's stream format, the default continuous output on
 * the 480 / 420 / 880 family:
 *
 *   <STX><polarity><wwwwwww><unit><G/N><status><CR>[<LF>]
 *
 *   polarity  space or + is positive, - is negative
 *   wwwwwww   seven characters, right-justified, leading zeros sent as spaces,
 *             decimal point included when the indicator shows one
 *   unit      L lb, K kg, T ton, O oz
 *   G/N       G gross, N net
 *   status    space valid, M motion, I invalid, O overrange, Z center of zero
 *
 * Returns null for anything that isn't a frame. The STX and the terminator
 * may already be stripped by whoever split the stream into lines.
 */
export function parseRiceLakeFrame(frame: string): { lb: number | null; kg: number | null; stable: boolean; below_zero: boolean; unit: string; gross: boolean; status: string } | null {
  let f = frame.replace(/^\x02/, '').replace(/[\r\n]+$/, '')
  if (f.length < 10) return null
  // Some indicators put a space between the number and the unit; pull the
  // trailing three codes off the end and the sign off the front, whatever is
  // between is the number.
  const status = f.slice(-1)
  const gn     = f.slice(-2, -1)
  const unit   = f.slice(-3, -2)
  if (!'LKTO'.includes(unit) || !'GN'.includes(gn) || !' MIOZ'.includes(status)) return null
  f = f.slice(0, -3)
  const polarity = f[0]
  if (!' +-'.includes(polarity)) return null
  const num = parseFloat(f.slice(1).trim())
  if (!Number.isFinite(num)) return null
  const signed = polarity === '-' ? -num : num
  const lb = unit === 'L' ? signed : unit === 'K' ? signed * 2.20462 : unit === 'O' ? signed / 16 : signed * 2000
  const kg = unit === 'K' ? signed : lb / 2.20462
  return {
    lb: Math.round(lb * 100) / 100,
    kg: Math.round(kg * 1000) / 1000,
    stable: status === ' ' || status === 'Z',
    below_zero: signed < 0,
    unit, gross: gn === 'G', status,
  }
}
