export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { buildBook, learnRates, type ApptRow, type SheetRow } from '@/lib/smokehouseBook'
import { DEFAULT_SETTINGS, type CookProfile } from '@/lib/cookPredict'

export const dynamic = 'force-dynamic'

// GET /api/smokehouse-book?days=90 — everything the house is committed to over
// the window: loads and hours where they can be counted, and the demand that
// nothing can size yet.
//
// Rates are learned from EVERY cut sheet on file, not just the ones in the
// window: what an animal puts in the house doesn't change with the kill date.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = Math.min(400, Math.max(1, parseInt(searchParams.get('days') ?? '90', 10) || 90))

  const today = new Date().toISOString().slice(0, 10)
  const until = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10)

  const [{ data: appts, error }, { data: sheets }, { data: profiles }, { data: settings }] = await Promise.all([
    supabase.from('harvest_appointments')
      .select('id, harvest_date, species, head_count, status')
      .gte('harvest_date', today)
      .lte('harvest_date', until),
    supabase.from('cutting_instructions')
      .select('id, species, data, appointment_id')
      .neq('status', 'archived'),
    supabase.from('cook_profile').select('*'),
    supabase.from('cook_settings').select('*').eq('id', 1).maybeSingle(),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const sheetRows   = (sheets ?? []) as SheetRow[]
  const profileRows = (profiles ?? []) as unknown as CookProfile[]

  // Cancelled bookings aren't work. Everything else on the schedule is.
  const booked = ((appts ?? []) as ApptRow[]).filter(a => !/cancel/i.test(a.status ?? ''))

  const book = buildBook(
    booked, sheetRows, profileRows, learnRates(sheetRows),
    settings ? { ...DEFAULT_SETTINGS, ...settings } : DEFAULT_SETTINGS,
  )
  // NOT `days` — the book's own `days` array is the kill-day breakdown.
  return NextResponse.json({ ...book, windowDays: days })
}
