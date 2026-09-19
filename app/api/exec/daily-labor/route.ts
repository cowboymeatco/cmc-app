export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { loadRevenueRecognition } from '@/lib/revenueLoad'
import { fetchHoursByDay } from '@/lib/qbTime'
import { addDaysISO } from '@/lib/dates'
import type { EnterpriseKey } from '@/lib/revenueRecognition'

// GET /api/exec/daily-labor?days=14 — each day's gross against its labor.
//
// The digital version of the old Production Report spreadsheet: what the plant
// earned that day against what it paid to be open. Daily gross totals only —
// no per-station split until the time data can support one (Charlie,
// 2026-09-18).
//   • Gross is the revenue-recognition section's EARNED money for the day
//     (kill fee on kill day, cut & wrap on cut day, the books for the rest),
//     so the two sections can't disagree.
//   • Labor is QuickBooks Time clocked hours × labor_pay_rates. Straight-time
//     wages only: no employer taxes, no overtime premium, no salaried staff.
//     Anyone clocked in without a rate on file is counted in hours and named,
//     never priced at a guess.

export interface DailyLaborDay {
  date: string
  gross: number
  grossBy: Record<EnterpriseKey, number>
  headHarvested: number
  headCut: number
  hours: number
  laborDollars: number
  people: { name: string; hours: number; rate: number | null }[]
  unratedHours: number
}

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const days = Math.min(60, Math.max(1, Number(req.nextUrl.searchParams.get('days')) || 14))
    const start = addDaysISO(today, -(days - 1))

    const [revenue, hoursByDay, ratesRes] = await Promise.all([
      loadRevenueRecognition(start, today, today),
      fetchHoursByDay(start, today),
      supabaseAdmin.from('labor_pay_rates').select('qbt_user_id, hourly_rate'),
    ])
    if (ratesRes.error) throw new Error(ratesRes.error.message)
    const rate = new Map((ratesRes.data ?? []).map(r => [Number(r.qbt_user_id), Number(r.hourly_rate)]))

    const out: DailyLaborDay[] = revenue.days
      .filter(d => d.date <= today)
      .map(d => {
        const crew = hoursByDay.get(d.date) ?? []
        let laborDollars = 0, unratedHours = 0
        const people = crew.map(p => {
          const r = rate.get(p.userId) ?? null
          if (r == null) unratedHours += p.hours
          else laborDollars += p.hours * r
          return { name: p.name, hours: p.hours, rate: r }
        })
        return {
          date: d.date,
          gross: Object.values(d.earned).reduce((a, b) => a + b, 0),
          grossBy: d.earned,
          headHarvested: d.headHarvested,
          headCut: d.headCut,
          hours: crew.reduce((a, p) => a + p.hours, 0),
          laborDollars,
          people,
          unratedHours,
        }
      })
      .reverse()

    return NextResponse.json({
      days: out,
      today,
      booksThrough: revenue.books?.through ?? null,
      booksError: revenue.booksError,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
