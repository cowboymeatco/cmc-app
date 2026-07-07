// Shop-local date helpers.
//
// new Date().toISOString() is UTC: after 6pm Mountain it returns TOMORROW's
// date, and Vercel's servers run on UTC around the clock. Every business date
// (schedule_date, harvest_date, pack/received dates, "today" comparisons)
// must come from these helpers so the browser and the API agree on what day
// it is at the shop.
const SHOP_TZ = 'America/Denver'

/** YYYY-MM-DD for `d` (default: right now) on the shop clock. */
export function isoDate(d: Date = new Date()): string {
  return d.toLocaleDateString('en-CA', { timeZone: SHOP_TZ })
}

/** YYYY-MM-DDTHH:MM (what <input type="datetime-local"> wants) on the shop clock. */
export function isoDateTime(d: Date = new Date()): string {
  const time = d.toLocaleTimeString('en-GB', {
    timeZone: SHOP_TZ, hourCycle: 'h23', hour: '2-digit', minute: '2-digit',
  })
  return `${isoDate(d)}T${time}`
}

// The helpers below do calendar math on YYYY-MM-DD strings. Anchoring at noon
// UTC keeps the day arithmetic from ever crossing a midnight boundary.
function anchor(iso: string): Date {
  return new Date(iso + 'T12:00:00Z')
}

/** `iso` shifted by `days` (negative to go back), as YYYY-MM-DD. */
export function addDaysISO(iso: string, days: number): string {
  const d = anchor(iso)
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Day of week of `iso`: 0=Sun … 6=Sat. */
export function dayOfWeekISO(iso: string): number {
  return anchor(iso).getUTCDay()
}

/** Monday of the week containing `iso`, as YYYY-MM-DD. */
export function mondayOfISO(iso: string): string {
  const dow = dayOfWeekISO(iso)
  return addDaysISO(iso, dow === 0 ? -6 : 1 - dow)
}

/** Whole days from `fromISO` to `toISO` (negative if `toISO` is earlier). */
export function daysBetweenISO(fromISO: string, toISO: string): number {
  return Math.round((anchor(toISO).getTime() - anchor(fromISO).getTime()) / 86400000)
}

/** Human label for a YYYY-MM-DD business date (e.g. "Wednesday, Jul 8").
 * Noon-anchored so the rendered day can't shift in any timezone, browser
 * or server — use this instead of hand-rolling toLocaleDateString. */
export function dateLabel(
  iso: string,
  opts: Intl.DateTimeFormatOptions = { weekday: 'long', month: 'short', day: 'numeric' },
): string {
  return new Date(iso + 'T12:00:00').toLocaleDateString('en-US', opts)
}
