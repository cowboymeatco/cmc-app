export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// ── Smokehouse alarm feed ──────────────────────────────────────────────────────
// The controller's alarm log, imported by scripts/smokehouse/alarm_import.py on
// the packaging kiosk. Reads smokehouse_alarm_v, which resolves each alarm to
// the cook it fell inside (alarms raised while the house is idle keep a null
// cook — those are real and worth seeing, so they are not filtered out).
//
// The channel rollup is the point: it answers "is one sensor generating all of
// this?", which is what a drifting wet bulb looks like from the outside.

interface AlarmRow {
  id: string
  raised_at: string
  cleared_at: string | null
  code: string | null
  message: string | null
  severity: string | null
  channel: string | null
  value_f: number | null
  setpoint_f: number | null
  cook_id: string | null
  cook_file: string | null
}

// GET /api/smokehouse-alarms?days=60[&channel=wet_bulb]
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const days = Math.min(Math.max(parseInt(searchParams.get('days') ?? '60', 10) || 60, 1), 365)
  const channel = searchParams.get('channel')
  const cutoff = new Date(Date.now() - days * 86_400_000).toISOString()

  let q = supabase
    .from('smokehouse_alarm_v')
    .select('id, raised_at, cleared_at, code, message, severity, channel, value_f, setpoint_f, cook_id, cook_file')
    .gte('raised_at', cutoff)
    .order('raised_at', { ascending: false })
    .limit(1000)

  if (channel) q = q.eq('channel', channel)

  // All-time row count, separate from the window. Without it "0 alarms in the
  // last 60 days" is indistinguishable from "the importer has never run", and
  // a quiet zero on a page about alarms is worse than saying nothing.
  const [{ data, error }, { count: everImportedCount }] = await Promise.all([
    q,
    supabase.from('smokehouse_alarm').select('id', { count: 'exact', head: true }),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const alarms = (data ?? []) as unknown as AlarmRow[]

  // Rollup by channel, alarms/warnings only — routine start/stop events would
  // swamp the counts and tell us nothing about a sick sensor.
  //
  // 'comms' (FTP, network ping, email) is counted separately, never in
  // byChannel. It is ~85% of the log by volume, so leaving it in buries every
  // real sensor fault under plumbing noise and makes the rollup useless.
  const faults = alarms.filter(a => a.severity === 'alarm' || a.severity === 'warning')
  const byChannel: Record<string, number> = {}
  const byCook: Record<string, number> = {}
  let comms = 0
  for (const a of faults) {
    const ch = a.channel ?? 'other'
    if (ch === 'comms') { comms++; continue }
    byChannel[ch] = (byChannel[ch] ?? 0) + 1
    if (a.cook_id) byCook[a.cook_id] = (byCook[a.cook_id] ?? 0) + 1
  }
  const sensorFaults = faults.length - comms

  return NextResponse.json({
    days,
    everImported: (everImportedCount ?? 0) > 0,
    total: alarms.length,
    faults: sensorFaults,
    comms,
    byChannel,
    byCook,
    alarms,
  })
}
