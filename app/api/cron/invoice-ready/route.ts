export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { sendMail } from '@/lib/mailer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { dateLabel, isoDate, isoDateTime } from '@/lib/dates'

// The 5:00 PM "ready to invoice" email — see vercel.json.
//
// Jill, 2026-10-20 (/scanner): "send me an email with the cards that are ready
// to invoice after the business day is over. Just so I get a notification."
//
// Lists every session sitting in Ready to Invoice on the scanner — the whole
// queue, not just today's arrivals, since anything still there is still
// waiting on her — with the ones that landed today marked. An empty queue
// sends nothing.
//
// Vercel cron is UTC-only, so vercel.json fires this at 23:00 and 00:00 UTC:
// 5 PM Mountain is 23:00 UTC in summer (MDT) and 00:00 UTC in winter (MST).
// Only the run that lands in the 5 PM hour on the shop clock sends; the other
// is a no-op, which is also what keeps it to one email a day. ?force=1 sends
// regardless of the hour, for testing.
//
// Guarded by CRON_SECRET and fails CLOSED.

const RECIPIENTS = (process.env.INVOICE_READY_TO ?? 'jill@cowboymeats.com,charlie@cowboymeats.com')
  .split(',').map(s => s.trim()).filter(Boolean)

type SessionRow = { customer_name: string; session_date: string; notes: string | null; updated_at: string | null }
type StatRow    = { customer_name: string; session_date: string; box_count: number | string; total_weight: number | string }

function esc(s: string): string {
  return s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string))
}

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured — refusing to run' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const force = req.nextUrl.searchParams.get('force') === '1'
  if (!force && isoDateTime().slice(11, 13) !== '17') {
    return NextResponse.json({ ok: true, skipped: `not 5 PM in Denver (${isoDateTime().slice(11)})` })
  }
  const today = isoDate()

  try {
    const { data: rows, error } = await supabaseAdmin
      .from('processing_sessions')
      .select('customer_name, session_date, notes, updated_at')
      .eq('status', 'ready_to_invoice')
      .order('session_date', { ascending: true })
    if (error) throw new Error(error.message)
    const queue = (rows ?? []) as SessionRow[]
    if (!queue.length) return NextResponse.json({ ok: true, skipped: 'nothing is waiting to be invoiced' })

    // Box count and weight per session, summed in the database (same view the
    // scanner's own list reads).
    const { data: statRows } = await supabaseAdmin
      .from('v_box_session_stats')
      .select('customer_name, session_date, box_count, total_weight')
      .in('customer_name', [...new Set(queue.map(q => q.customer_name))])
    const stats = new Map<string, StatRow>()
    for (const r of (statRows ?? []) as StatRow[]) stats.set(`${r.customer_name}|${r.session_date}`, r)

    // Landed in the queue today: status changes stamp updated_at, read on the
    // shop clock so an evening move isn't already "yesterday" in UTC.
    const landedToday = (s: SessionRow) => !!s.updated_at && isoDate(new Date(s.updated_at)) === today
    const newToday = queue.filter(landedToday).length

    const tr = (s: SessionRow) => {
      const st = stats.get(`${s.customer_name}|${s.session_date}`)
      const boxes = st ? Number(st.box_count) || 0 : 0
      const lbs   = st ? Number(st.total_weight) || 0 : 0
      const days  = Math.max(0, Math.floor((Date.now() - new Date(s.session_date + 'T12:00:00').getTime()) / 86400000))
      return `<tr>
        <td style="padding:6px 10px;border-bottom:1px solid #eee"><b>${esc(s.customer_name)}</b>${landedToday(s) ? ' <span style="color:#2e7d32;font-size:12px">· new today</span>' : ''}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;white-space:nowrap">${esc(dateLabel(s.session_date, { month: 'short', day: 'numeric' }))}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${boxes}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right">${lbs ? lbs.toFixed(1) : '—'}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;text-align:right;color:${days >= 14 ? '#c62828' : '#555'}">${days}</td>
        <td style="padding:6px 10px;border-bottom:1px solid #eee;color:#777;font-size:12px">${esc((s.notes ?? '').trim())}</td>
      </tr>`
    }

    const subject = `${queue.length} order${queue.length === 1 ? '' : 's'} ready to invoice${newToday ? ` (${newToday} new today)` : ''} — ${dateLabel(today, { weekday: 'short', month: 'short', day: 'numeric' })}`
    const html = `
      <div style="font-family:system-ui,sans-serif;color:#222;max-width:720px">
        <h2 style="margin:0 0 4px">Ready to invoice</h2>
        <p style="margin:0 0 14px;color:#555">Packed and in the freezer, waiting on an invoice before the customer is called.
          Once invoiced, press <b>Invoiced → Freezer / Call</b> on the scanner to move it on.</p>
        <table style="border-collapse:collapse;width:100%;font-size:14px">
          <thead><tr style="background:#f4efe6;text-align:left">
            <th style="padding:6px 10px">Customer</th><th style="padding:6px 10px">Packed</th>
            <th style="padding:6px 10px;text-align:right">Boxes</th><th style="padding:6px 10px;text-align:right">Lbs</th>
            <th style="padding:6px 10px;text-align:right">Days</th><th style="padding:6px 10px">Notes</th>
          </tr></thead>
          <tbody>${queue.map(tr).join('')}</tbody>
        </table>
        <p style="margin:14px 0 0;color:#999;font-size:12px">Sent at 5 PM from the CMC app · the Ready to Invoice tab on the scanner has the live list.</p>
      </div>`

    await sendMail({ to: RECIPIENTS, subject, html })
    return NextResponse.json({ ok: true, sent: today, to: RECIPIENTS, count: queue.length, newToday, subject })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
