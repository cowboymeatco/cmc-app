export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { hangTarget, estCarcassLbs, groupProjected, type ProjectedAppt } from '@/lib/cutSchedule'

export const dynamic = 'force-dynamic'

// ── Cut-schedule outlook ──────────────────────────────────────────────────────
// What is coming AT the cooler, projected onto the day it will most likely be
// cut. The cut schedule itself only knows about carcasses already hanging, so
// planning past the next few days meant reading the harvest calendar and doing
// the hang arithmetic by hand (Charlie, 2026-08-13).
//
// Nothing here is a record of anything — it is booked head times a species hang
// target. An animal leaves this feed the moment it is actually harvested, at
// which point the real carcass shows up in the schedule proper.
//
// GET /api/cut-schedule/outlook?weeks=12

const day = (v: unknown): string => (v ? String(v).slice(0, 10) : '')

// Plain YYYY-MM-DD arithmetic — no Date objects, so a timezone can't shift a
// projected cut day off by one.
function addDays(iso: string, n: number): string {
  const [y, m, d] = iso.split('-').map(Number)
  const dt = new Date(Date.UTC(y, (m ?? 1) - 1, (d ?? 1) + n))
  return dt.toISOString().slice(0, 10)
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const weeks = Math.min(Math.max(Number(searchParams.get('weeks')) || 12, 1), 52)

  const today = new Date().toISOString().slice(0, 10)
  const until = addDays(today, weeks * 7)

  const { data: appts, error } = await supabase
    .from('harvest_appointments')
    // `source` is the producer/booking name. NOT producer_contact — that field
    // is the scheduling phone or email, and putting it here printed a phone
    // number where a name belongs.
    .select('id, harvest_date, species, head_count, customers, source, status')
    .gte('harvest_date', today)
    .lte('harvest_date', until)
    .order('harvest_date', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (appts ?? []).map(a => a.id as string)
  // How many of each booking are already on the rail. A 12-head booking killed
  // four at a time must project the remaining eight, not vanish on the first
  // carcass or double-count the four already in the schedule.
  const harvested = new Map<string, number>()
  const producerOf = new Map<string, string>()
  if (ids.length) {
    const { data: logs } = await supabase
      .from('harvest_log')
      .select('appointment_id, producer')
      .in('appointment_id', ids)
    for (const l of logs ?? []) {
      const k = l.appointment_id as string
      harvested.set(k, (harvested.get(k) ?? 0) + 1)
      if (l.producer && !producerOf.has(k)) producerOf.set(k, l.producer as string)
    }
  }

  const projected: ProjectedAppt[] = []
  for (const a of appts ?? []) {
    const id = a.id as string
    const species = (a.species as string) || ''
    const booked = Number(a.head_count) || 0
    const head = booked - (harvested.get(id) ?? 0)
    if (head <= 0) continue
    const hd = day(a.harvest_date)
    if (!hd) continue
    const custs = Array.isArray(a.customers) ? a.customers : []
    projected.push({
      appointment_id: id,
      species,
      head,
      harvest_date: hd,
      cut_date: addDays(hd, hangTarget(species)),
      producer: producerOf.get(id) || (a.source as string) || '',
      customers: custs
        .map((c: Record<string, unknown>) => String(c?.customer_name ?? '').trim())
        .filter(Boolean),
      est_lbs: head * estCarcassLbs(species),
    })
  }

  return NextResponse.json({
    weeks,
    from: today,
    to: until,
    days: groupProjected(projected),
  })
}
