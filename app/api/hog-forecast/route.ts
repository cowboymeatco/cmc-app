export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { forecastRun, learnHogRate, type ApptRow, type SheetRow } from '@/lib/hogForecast'
import type { CookProfile } from '@/lib/cookPredict'

export const dynamic = 'force-dynamic'

// GET /api/hog-forecast?days=90 — how many smokehouse loads the booked hogs on
// the harvest schedule are going to take.
//
// The rate is learned from EVERY pork cut sheet on file, not just the ones in
// the window: what a hog puts in the house doesn't change because the kill date
// is further out.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = Math.min(400, Math.max(1, parseInt(searchParams.get('days') ?? '90', 10) || 90))

  const today = new Date().toISOString().slice(0, 10)
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

  const [{ data: appts, error }, { data: sheets }, { data: profiles }] = await Promise.all([
    supabase.from('harvest_appointments')
      .select('id, harvest_date, species, head_count, status, customers')
      .eq('species', 'Hog')
      .gte('harvest_date', today)
      .lte('harvest_date', until),
    supabase.from('cutting_instructions')
      .select('id, species, data, appointment_id')
      .neq('status', 'archived'),
    supabase.from('cook_profile').select('*'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sheetRows   = (sheets ?? []) as SheetRow[]
  const profileRows = (profiles ?? []) as unknown as CookProfile[]

  // Cancelled bookings aren't a run. Everything else on the schedule is —
  // including hogs already in Processing, which still have to be smoked.
  const booked = ((appts ?? []) as ApptRow[])
    .filter(a => !/cancel/i.test(a.status ?? ''))

  const forecast = forecastRun(booked, sheetRows, profileRows, learnHogRate(sheetRows))
  // NOT `days` — the forecast's own `days` array is the kill-day breakdown.
  return NextResponse.json({ ...forecast, windowDays: days })
}
