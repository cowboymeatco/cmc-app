import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/availability
// Public endpoint — returns next 12 weeks with booking availability.
// Does NOT expose any customer names or appointment details.

const DEFAULTS = {
  hogs_per_beef:      4,
  lambs_per_beef:     6,
  goats_per_beef:     6,
  beef_eq_per_day:    3,
  max_cooler_days:    6,
  kill_days_per_week: 2,   // how many kill days per week (Mon + Thu typical)
}

function speciesEq(species: string, s: typeof DEFAULTS): number {
  switch (species) {
    case 'Beef': return 1
    case 'Hog':  return 1 / s.hogs_per_beef
    case 'Lamb': return 1 / s.lambs_per_beef
    case 'Goat': return 1 / s.goats_per_beef
    default:     return 1
  }
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

// Returns the Monday of the week containing `date`
function mondayOf(date: Date): Date {
  const d = new Date(date)
  d.setHours(12, 0, 0, 0)
  const dow = d.getDay()                  // 0=Sun … 6=Sat
  d.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1))
  return d
}

export async function GET() {
  const today = new Date()
  today.setHours(12, 0, 0, 0)

  const todayStr = isoDate(today)

  const [settingsRes, apptRes, coolerRes] = await Promise.all([
    supabase.from('capacity_settings').select('*').eq('id', 1).single(),
    supabase
      .from('harvest_appointments')
      .select('harvest_date,species,head_count,status')
      .not('status', 'in', '("Complete","NoShow","Declined")')
      .gte('harvest_date', todayStr)
      .order('harvest_date', { ascending: true }),
    supabase.from('harvest_log').select('species').eq('status', 'chilling'),
  ])

  const raw = settingsRes.data ?? {}
  const cfg = {
    hogs_per_beef:      Number(raw.hogs_per_beef)      || DEFAULTS.hogs_per_beef,
    lambs_per_beef:     Number(raw.lambs_per_beef)     || DEFAULTS.lambs_per_beef,
    goats_per_beef:     Number(raw.goats_per_beef)     || DEFAULTS.goats_per_beef,
    beef_eq_per_day:    Number(raw.beef_eq_per_day)    || DEFAULTS.beef_eq_per_day,
    max_cooler_days:    Number(raw.max_cooler_days)    || DEFAULTS.max_cooler_days,
    kill_days_per_week: DEFAULTS.kill_days_per_week,
  }

  // Current cooler load in beef equivalents
  const coolerEq = (coolerRes.data ?? []).reduce(
    (sum: number, h: { species: string }) => sum + speciesEq(h.species, cfg), 0,
  )

  // Max total the cooler can hold
  const maxEq = cfg.max_cooler_days * cfg.beef_eq_per_day

  // Per-week kill capacity (beef equivalents we can harvest in one week)
  const weeklyKillEq = cfg.beef_eq_per_day * cfg.kill_days_per_week

  // Group existing appointments by their Monday (week key)
  type ApptRow = { harvest_date: string; species: string; head_count: number; status: string }
  const byWeek: Record<string, number> = {}
  for (const a of (apptRes.data ?? []) as ApptRow[]) {
    const mon = isoDate(mondayOf(new Date(a.harvest_date + 'T12:00:00')))
    byWeek[mon] = (byWeek[mon] ?? 0) + a.head_count * speciesEq(a.species, cfg)
  }

  // Build 12-week rolling window starting from NEXT Monday
  const thisMonday = mondayOf(today)
  const startMonday = new Date(thisMonday)
  startMonday.setDate(startMonday.getDate() + 7)   // always start from next week

  // Running simulation of cooler load going forward
  let runningEq = coolerEq

  const weeks = []

  for (let i = 0; i < 12; i++) {
    const mon = new Date(startMonday)
    mon.setDate(mon.getDate() + i * 7)
    const fri = new Date(mon)
    fri.setDate(fri.getDate() + 4)

    const monStr = isoDate(mon)
    const friStr = isoDate(fri)
    const weekBooked = byWeek[monStr] ?? 0

    // How much room is left in the cooler when this week arrives?
    // Simulate: we process beef_eq_per_day * 5 working days per week
    const weeklyOutput = cfg.beef_eq_per_day * 5
    runningEq = Math.max(0, runningEq - weeklyOutput) + weekBooked

    const availableEq = Math.max(0, maxEq - runningEq)

    // Fill status for this week's kill days specifically
    const weekFill = weeklyKillEq > 0 ? weekBooked / weeklyKillEq : 0
    const killStatus: 'open' | 'limited' | 'full' =
      weekFill >= 0.9 || availableEq <= 0 ? 'full'
      : weekFill >= 0.5                   ? 'limited'
                                          : 'open'

    weeks.push({
      week_start:      monStr,
      week_end:        friStr,
      label:           mon.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      label_end:       fri.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      status:          killStatus,
      available_beef:  Math.max(0, Math.floor(availableEq)),
      available_hogs:  Math.max(0, Math.floor(availableEq * cfg.hogs_per_beef)),
      available_lambs: Math.max(0, Math.floor(availableEq * cfg.lambs_per_beef)),
      available_goats: Math.max(0, Math.floor(availableEq * cfg.goats_per_beef)),
    })
  }

  return NextResponse.json({
    weeks,
    equiv: {
      hogs_per_beef:  cfg.hogs_per_beef,
      lambs_per_beef: cfg.lambs_per_beef,
      goats_per_beef: cfg.goats_per_beef,
    },
  })
}
