export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export interface CapacitySettings {
  hogs_per_beef:    number   // how many hogs equal 1 beef (e.g. 4)
  lambs_per_beef:   number   // how many lambs equal 1 beef (e.g. 6)
  goats_per_beef:   number   // how many goats equal 1 beef (e.g. 6)
  beef_eq_per_day:  number   // beef equivalents your team cuts per working day (e.g. 3)
  max_cooler_days:  number   // target max days of work in cooler (e.g. 6)
}

export interface CoolerCarcass {
  id:           string
  carcass_tag:  string
  species:      string
  producer:     string
  harvest_date: string
  days_in_cooler: number
  beef_eq:      number
}

export interface CapacityResponse {
  settings:      CapacitySettings
  cooler:        CoolerCarcass[]   // currently chilling
  upcoming:      { id: string; harvest_date: string; species: string; head_count: number; source: string; beef_eq: number }[]
  cooler_eq:     number    // total beef equivalents in cooler right now
  upcoming_eq:   number    // total beef equivalents from booked (not yet harvested)
  total_eq:      number    // cooler + upcoming
  days_on_hand:  number    // total_eq / beef_eq_per_day
  available_eq:  number    // (max_cooler_days Ã— beef_eq_per_day) - total_eq (can be negative)
}

const DEFAULTS: CapacitySettings = {
  hogs_per_beef:   4,
  lambs_per_beef:  6,
  goats_per_beef:  6,
  beef_eq_per_day: 3,
  max_cooler_days: 6,
}

function speciesEq(species: string, settings: CapacitySettings): number {
  switch (species) {
    case 'Beef': return 1
    case 'Hog':  return 1 / settings.hogs_per_beef
    case 'Lamb': return 1 / settings.lambs_per_beef
    case 'Goat': return 1 / settings.goats_per_beef
    default:     return 1
  }
}

function daysBetween(dateStr: string): number {
  const harvest = new Date(dateStr + 'T12:00:00')
  const today   = new Date()
  today.setHours(12, 0, 0, 0)
  return Math.max(0, Math.round((today.getTime() - harvest.getTime()) / 86400000))
}

// GET /api/capacity
export async function GET() {
  const today = new Date().toISOString().slice(0, 10)

  // Fetch settings, chill log, and upcoming appointments in parallel
  const [settingsRes, coolerRes, upcomingRes] = await Promise.all([
    supabase.from('capacity_settings').select('*').eq('id', 1).single(),
    supabase.from('harvest_log').select('id,carcass_tag,species,producer,harvest_date').eq('status', 'chilling').order('harvest_date', { ascending: true }),
    supabase.from('harvest_appointments').select('id,harvest_date,species,head_count,source').neq('status', 'Complete').gte('harvest_date', today).order('harvest_date', { ascending: true }),
  ])

  const settings: CapacitySettings = settingsRes.data
    ? {
        hogs_per_beef:   settingsRes.data.hogs_per_beef   ?? DEFAULTS.hogs_per_beef,
        lambs_per_beef:  settingsRes.data.lambs_per_beef  ?? DEFAULTS.lambs_per_beef,
        goats_per_beef:  settingsRes.data.goats_per_beef  ?? DEFAULTS.goats_per_beef,
        beef_eq_per_day: settingsRes.data.beef_eq_per_day ?? DEFAULTS.beef_eq_per_day,
        max_cooler_days: settingsRes.data.max_cooler_days ?? DEFAULTS.max_cooler_days,
      }
    : DEFAULTS

  const cooler: CoolerCarcass[] = (coolerRes.data ?? []).map(h => ({
    id:             h.id,
    carcass_tag:    h.carcass_tag,
    species:        h.species,
    producer:       h.producer,
    harvest_date:   h.harvest_date,
    days_in_cooler: daysBetween(h.harvest_date),
    beef_eq:        speciesEq(h.species, settings),
  }))

  const upcoming = (upcomingRes.data ?? []).map(a => ({
    id:           a.id,
    harvest_date: a.harvest_date,
    species:      a.species,
    head_count:   a.head_count,
    source:       a.source,
    beef_eq:      a.head_count * speciesEq(a.species, settings),
  }))

  const cooler_eq   = cooler.reduce((s, c) => s + c.beef_eq, 0)
  const upcoming_eq = upcoming.reduce((s, u) => s + u.beef_eq, 0)
  const total_eq    = cooler_eq + upcoming_eq
  const days_on_hand = settings.beef_eq_per_day > 0 ? cooler_eq / settings.beef_eq_per_day : 0
  const available_eq = (settings.max_cooler_days * settings.beef_eq_per_day) - cooler_eq

  const resp: CapacityResponse = {
    settings, cooler, upcoming,
    cooler_eq, upcoming_eq, total_eq,
    days_on_hand, available_eq,
  }
  return NextResponse.json(resp)
}

// POST /api/capacity â€” upsert settings
export async function POST(req: NextRequest) {
  const body: Partial<CapacitySettings> = await req.json()
  const { data, error } = await supabase
    .from('capacity_settings')
    .upsert([{ id: 1, ...body, updated_at: new Date().toISOString() }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
