export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/haccp?date=YYYY-MM-DD
// Returns all kill-day data needed for HACCP reports 2, 5, and 6b
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  if (!date) return NextResponse.json({ error: 'date required' }, { status: 400 })

  // Fetch appointments, harvest log, and all chill logs in parallel
  const [apptRes, harvestRes, chillRes] = await Promise.all([
    supabase
      .from('harvest_appointments')
      .select('*')
      .eq('harvest_date', date),
    supabase
      .from('harvest_log')
      .select('*')
      .eq('harvest_date', date)
      .order('carcass_tag', { ascending: true }),
    supabase
      .from('chill_log')
      .select('*')
      .order('checked_at', { ascending: true }),
  ])

  const appointments = apptRes.data  ?? []
  const harvestLogs  = harvestRes.data ?? []
  const allChillLogs = chillRes.data  ?? []

  // Animal receiving logs for each appointment on this date
  const apptIds = appointments.map((a: Record<string, string>) => a.id)
  let animalLogs: Record<string, unknown>[] = []
  if (apptIds.length > 0) {
    const { data } = await supabase
      .from('animal_receiving_log')
      .select('*')
      .in('appointment_id', apptIds)
      // Animals taken off the day keep their row to hold a carcass number; they
      // were never harvested, so they are not HACCP records.
      .neq('status', 'removed')
      .order('animal_index', { ascending: true })
    animalLogs = data ?? []
  }

  // Restrict chill logs to carcasses that were harvested on this date
  const harvestIds = new Set(harvestLogs.map((h: Record<string, string>) => h.id))
  const chillLogs  = allChillLogs.filter((c: Record<string, string>) => harvestIds.has(c.harvest_log_id))

  return NextResponse.json({ appointments, animalLogs, harvestLogs, chillLogs })
}
