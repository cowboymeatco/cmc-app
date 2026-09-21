export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { fetchHoursByDay } from '@/lib/qbTime'
import { addDaysISO, dayOfWeekISO } from '@/lib/dates'

// GET /api/exec/throughput?weeks=13 — pounds out the door per crew hour.
//
// Charlie, 2026-09-20, working through why a profitable-looking plant loses
// money: "I feel like we are back at a throughput issue all over." The weekly
// numbers say he's right — pounds packed track hours almost exactly while
// pounds per hour hold steady, so the plant isn't slow, it's under-fed. This
// puts the three facts side by side every week: what was killed, what was
// cut, what was packed, and the hours that did it.
//
// Weeks start Monday, the same week labor_reports uses, so the two labor
// numbers on this page line up.

interface Week {
  week: string
  killHead: number
  killLbs: number
  cutHead: number
  packedLbs: number
  hours: number
  lbsPerHour: number | null
  killDays: number
  packDays: number
}

const mondayOf = (iso: string) => addDaysISO(iso, -((dayOfWeekISO(iso) + 6) % 7))

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    const weeks = Math.min(52, Math.max(2, Number(req.nextUrl.searchParams.get('weeks')) || 13))
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const start = mondayOf(addDaysISO(today, -7 * (weeks - 1)))

    const [wkRes, hoursByDay] = await Promise.all([
      supabaseAdmin.rpc('exec_throughput_weeks', { p_start: start, p_end: today }),
      fetchHoursByDay(start, today).catch(() => new Map<string, { hours: number }[]>()),
    ])
    if (wkRes.error) throw new Error(wkRes.error.message)

    const hoursByWeek = new Map<string, number>()
    for (const [day, people] of hoursByDay) {
      if (day < start || day > today) continue
      const w = mondayOf(day)
      hoursByWeek.set(w, (hoursByWeek.get(w) ?? 0) + people.reduce((a, p) => a + p.hours, 0))
    }

    const out: Week[] = (wkRes.data ?? []).map((r: {
      week: string; kill_head: number; kill_lbs: number; kill_days: number
      cut_head: number; packed_lbs: number; pack_days: number
    }) => {
      const hours = hoursByWeek.get(r.week) ?? 0
      const packedLbs = Number(r.packed_lbs)
      return {
        week: r.week,
        killHead: r.kill_head,
        killLbs: Number(r.kill_lbs),
        killDays: r.kill_days,
        cutHead: r.cut_head,
        packedLbs,
        packDays: r.pack_days,
        hours,
        lbsPerHour: hours > 0 ? packedLbs / hours : null,
      }
    })

    return NextResponse.json({ weeks: out, start, today })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
