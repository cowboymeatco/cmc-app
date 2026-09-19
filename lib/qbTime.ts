// QuickBooks Time (the old TSheets) — the crew's actual clock-ins.
//
// QuickBooks Online only gets these hours when payroll is approved, a week
// late and with the start/end times stripped, so daily labor has to come
// straight from QuickBooks Time. Auth is a single access token Charlie made
// in QuickBooks Time (Feature Add-ons → API → "CMC App"), stored as
// QBT_ACCESS_TOKEN.
//
// Job codes don't say what the work was — nearly every entry sits on the
// default customer — so this only answers who was paid for how long, per day.

const API = 'https://rest.tsheets.com/api/v1'

interface Timesheet {
  user_id: number
  jobcode_id: number
  date: string          // the plant-local day QuickBooks Time files it under
  start: string
  duration: number      // seconds; still growing while on the clock
  on_the_clock: boolean
}

export interface PersonDay {
  userId: number
  name: string
  hours: number
}

// Paid work only. Breaks and lunches are their own entries with an
// 'unpaid_break' job code; PTO and holidays are paid but aren't a day on the
// floor. A timesheet with no job code (id 0) is plain clocked time.
const WORK_TYPES = new Set(['regular', 'paid_break'])

export function qbTimeConfigured(): boolean {
  return Boolean(process.env.QBT_ACCESS_TOKEN)
}

/** Paid hours per person per day, start..end inclusive (YYYY-MM-DD). */
export async function fetchHoursByDay(start: string, end: string): Promise<Map<string, PersonDay[]>> {
  const token = process.env.QBT_ACCESS_TOKEN
  if (!token) throw new Error('QuickBooks Time is not connected (QBT_ACCESS_TOKEN missing)')

  const sheets: Timesheet[] = []
  const users: Record<string, { first_name: string; last_name: string }> = {}
  const jobTypes: Record<string, string> = {}

  for (let page = 1; page <= 20; page++) {
    const res = await fetch(
      `${API}/timesheets?start_date=${start}&end_date=${end}&supplemental_data=yes&per_page=200&page=${page}`,
      { headers: { Authorization: `Bearer ${token}` }, cache: 'no-store' },
    )
    if (!res.ok) throw new Error(`QuickBooks Time ${res.status}: ${(await res.text()).slice(0, 200)}`)
    const j = await res.json()
    sheets.push(...(Object.values(j.results?.timesheets ?? {}) as Timesheet[]))
    Object.assign(users, j.supplemental_data?.users ?? {})
    for (const [id, c] of Object.entries(j.supplemental_data?.jobcodes ?? {})) jobTypes[id] = (c as { type: string }).type
    if (!j.more) break
  }

  const now = Date.now()
  const byDay = new Map<string, Map<number, number>>()
  for (const t of sheets) {
    if (t.jobcode_id && !WORK_TYPES.has(jobTypes[t.jobcode_id])) continue
    const secs = t.on_the_clock ? Math.max(0, (now - Date.parse(t.start)) / 1000) : t.duration
    if (!secs) continue
    const day = byDay.get(t.date) ?? new Map<number, number>()
    day.set(t.user_id, (day.get(t.user_id) ?? 0) + secs)
    byDay.set(t.date, day)
  }

  const out = new Map<string, PersonDay[]>()
  for (const [date, people] of byDay) {
    out.set(date, [...people].map(([userId, secs]) => {
      const u = users[userId]
      return { userId, name: u ? `${u.first_name} ${u.last_name}`.trim() : `User ${userId}`, hours: secs / 3600 }
    }).sort((a, b) => b.hours - a.hours))
  }
  return out
}
