export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { readCloverDay } from '@/lib/cloverSales'
import {
  proposeDay, postDay, noteRecheck, listDays, saveItemMapping, postingFrom, PostRefused, type DayRow,
} from '@/lib/qboDailySales'
import { requireExec } from '@/lib/execGate'
import { addDaysISO, isoDate } from '@/lib/dates'

// Clover register sales → QuickBooks, for the /billing screen.
//   GET                 -> the recent days and what the app has posted
//   GET ?date=YYYY-MM-DD -> one day read live from Clover, with the proposed
//                          QuickBooks entry (a dry run — nothing is written)
//   POST {action:'map'}  -> a person matches a Clover item to a QuickBooks item
//   POST {action:'post'} -> a person approves one day; posts it once
//
// Posting follows app/api/qbo/push: dry run by default, a person approves,
// every write logged. It is additionally behind the exec passphrase and the
// CLOVER_SALES_POSTING_FROM switch (off until the handoff from Jill).

const DAYS_SHOWN = 21

export async function GET(req: NextRequest) {
  const date = req.nextUrl.searchParams.get('date')
  try {
    if (!date) {
      const today = isoDate()
      let rows: DayRow[] = []
      let recordError: string | null = null
      try { rows = await listDays(addDaysISO(today, -DAYS_SHOWN), today) }
      catch (e) { recordError = e instanceof Error ? e.message : String(e) }
      const byDate = new Map(rows.map(r => [r.business_date, r]))
      // Today first: it can be posted from close of business (lib/qboDailySales dayClosed).
      const days = Array.from({ length: DAYS_SHOWN }, (_, i) => addDaysISO(today, -i)).map(d => {
        const r = byDate.get(d)
        return {
          date: d,
          status: r?.status ?? 'not_posted',
          changedAfterPost: r?.changed_after_post ?? false,
          invoiceDoc: r?.qbo_invoice_doc ?? null,
          approvedBy: r?.approved_by ?? null,
          postedAt: r?.posted_at ?? null,
          lastCheckedAt: r?.last_checked_at ?? null,
          error: r?.error ?? null,
          retailNetCents: r?.summary?.totals?.retailNetCents ?? null,
          netCents: r?.summary?.totals?.netCents ?? null,
        }
      })
      return NextResponse.json({ days, postingFrom: postingFrom(), recordError })
    }

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
    const summary = await readCloverDay(date)
    const [built, record] = await Promise.all([
      proposeDay(summary),
      noteRecheck(summary).catch(() => null),
    ])
    return NextResponse.json({ summary, ...built, record, postingFrom: postingFrom() })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}))

    if (body.action === 'map') {
      const { cloverItemId, cloverName, qboItemId, qboItemName, by } = body
      if (![cloverItemId, qboItemId, qboItemName].every(v => typeof v === 'string' && v)) {
        return NextResponse.json({ error: 'cloverItemId, qboItemId and qboItemName are required' }, { status: 400 })
      }
      await saveItemMapping({ cloverItemId, cloverName: cloverName ?? '', qboItemId, qboItemName, by: typeof by === 'string' && by ? by : 'billing page' })
      return NextResponse.json({ ok: true })
    }

    if (body.action === 'post') {
      const gate = await requireExec(req)
      if (!gate.ok) return gate.response
      const { date, fingerprint, approvedBy } = body
      if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
      if (typeof fingerprint !== 'string' || !fingerprint) return NextResponse.json({ error: 'fingerprint required — approve from the page' }, { status: 400 })
      if (typeof approvedBy !== 'string' || !approvedBy.trim()) return NextResponse.json({ error: 'Say who is approving' }, { status: 400 })
      if (!postingFrom()) {
        return NextResponse.json({ error: 'Posting to QuickBooks is switched off — register sales are still entered by hand.' }, { status: 409 })
      }

      // Re-read and re-propose server-side: what posts is what Clover says now,
      // and only if it is still exactly what the person looked at.
      const summary = await readCloverDay(date)
      const built = await proposeDay(summary)
      const row = await postDay({ summary, built, approvedFingerprint: fingerprint, approvedBy: approvedBy.trim() })
      return NextResponse.json({ ok: true, record: row })
    }

    return NextResponse.json({ error: 'unknown action' }, { status: 400 })
  } catch (e) {
    const status = e instanceof PostRefused ? 409 : 500
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status })
  }
}
