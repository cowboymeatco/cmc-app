export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { addDaysISO } from '@/lib/dates'

// GET /api/exec/bench-time?days=90 — how long an animal takes at the scale.
//
// Charlie asked for a timestamp on the scanner marking a cut card finished, to
// get packing time per head. The scans already answer it, and the timestamp
// would have answered it WRONG: first scan to last is wall time, so an animal
// left half-packed overnight reads as a day of work. On 9/15 Miles City
// Insurance spans 3,192 minutes and Dalton Packard, a beef of the same size,
// spans 109. Counting only the gaps short enough to be work puts both near an
// hour, which is what the floor would tell you.
//
// ⚠️ TIME AT THE SCALE, not labour cost. The cutting and wrapping that happen
// before a package reaches the scale aren't in it, and it runs one clock no
// matter how many people are on the bench. It will look twenty times better
// than the ~18-23 lb per CREW hour on the throughput panel; they measure
// different things. For crew-minutes on a job, that's /exec/study.
//
// The useful part is the comparison, not the absolute: a beef costs about
// three hogs at the scale, and a session well off its species' median is worth
// asking about.

interface Session {
  customer: string
  date:     string
  species:  string | null
  head:     number
  scans:    number
  lbs:      number
  activeMin: number
  wallMin:   number
  minPerHead: number | null
}

interface SpeciesRow {
  species:      string
  sessions:     number
  head:         number
  medianMinPerHead: number
  lbsPerActiveHour: number | null
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2
}

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    const days  = Math.min(365, Math.max(7, Number(req.nextUrl.searchParams.get('days')) || 90))
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const start = addDaysISO(today, -days)

    const { data, error } = await supabaseAdmin.rpc('exec_bench_time', { p_start: start, p_end: today })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    type Row = {
      customer_name: string; pack_date: string; species: string | null
      head: number; scans: number; lbs: number; active_min: number; wall_min: number
    }
    const rows = (data ?? []) as Row[]

    const sessions: Session[] = rows.map(r => ({
      customer:  r.customer_name,
      date:      r.pack_date,
      species:   r.species,
      head:      r.head,
      scans:     r.scans,
      lbs:       Number(r.lbs) || 0,
      activeMin: Number(r.active_min) || 0,
      wallMin:   Number(r.wall_min) || 0,
      minPerHead: r.head > 0 ? Number((Number(r.active_min) / r.head).toFixed(1)) : null,
    }))

    // A handful of scans is a repack or a box someone fixed, not a packing job,
    // and a couple of those would swing a median built on ten real ones.
    const solid = sessions.filter(s => s.scans > 20 && s.species && s.head > 0)

    const bySpecies = new Map<string, Session[]>()
    for (const s of solid) {
      const k = s.species as string
      bySpecies.set(k, [...(bySpecies.get(k) ?? []), s])
    }

    const species: SpeciesRow[] = [...bySpecies.entries()].map(([name, list]) => {
      const activeHours = list.reduce((t, s) => t + s.activeMin, 0) / 60
      return {
        species:  name,
        sessions: list.length,
        head:     list.reduce((t, s) => t + s.head, 0),
        medianMinPerHead: Math.round(median(list.map(s => (s.minPerHead ?? 0)))),
        lbsPerActiveHour: activeHours > 0
          ? Math.round(list.reduce((t, s) => t + s.lbs, 0) / activeHours)
          : null,
      }
    }).sort((a, b) => b.head - a.head)

    return NextResponse.json({
      days,
      gapCapMinutes: 10,
      species,
      // Newest first, and only the ones with enough scans to mean something.
      sessions: solid.slice(0, 40),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
