export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { buildDailyReport } from '@/lib/dailyReport'
import { sendMail } from '@/lib/mailer'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate, isoDateTime } from '@/lib/dates'

// The 5:00 PM register close email — see lib/dailyReport.ts.
//
// Vercel cron is UTC-only, so vercel.json fires this at 23:00 and 00:00 UTC:
// 5 PM Mountain is 23:00 UTC in summer (MDT) and 00:00 UTC in winter (MST).
// Only the run that lands in the 5 PM hour on the shop clock sends; the other
// is a no-op. A day with no register sales (Sunday) sends nothing.
//
// Each sent day is recorded in clover_daily_report_log so a retry or a manual
// run can't email the same day twice (?resend=1 overrides, for testing).
// ?date=YYYY-MM-DD sends a past day's report on demand.
//
// Guarded by CRON_SECRET and fails CLOSED.

const RECIPIENTS = (process.env.DAILY_REPORT_TO ?? 'charlie@cowboymeats.com')
  .split(',').map(s => s.trim()).filter(Boolean)

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret) {
    return NextResponse.json({ error: 'CRON_SECRET is not configured — refusing to run' }, { status: 503 })
  }
  if (req.headers.get('authorization') !== `Bearer ${secret}`) {
    return new NextResponse('Unauthorized', { status: 401 })
  }

  const params = req.nextUrl.searchParams
  const asked = params.get('date')
  const resend = params.get('resend') === '1'
  if (asked && !/^\d{4}-\d{2}-\d{2}$/.test(asked)) {
    return NextResponse.json({ error: 'date must be YYYY-MM-DD' }, { status: 400 })
  }

  // Scheduled runs: only the one in the 5 PM hour, shop clock.
  if (!asked && isoDateTime().slice(11, 13) !== '17') {
    return NextResponse.json({ ok: true, skipped: `not 5 PM in Denver (${isoDateTime().slice(11)})` })
  }
  const date = asked ?? isoDate()

  try {
    if (!resend) {
      const { data } = await supabaseAdmin.from('clover_daily_report_log').select('sent_at').eq('business_date', date).maybeSingle()
      if (data) return NextResponse.json({ ok: true, skipped: `already sent for ${date} at ${data.sent_at}` })
    }

    const report = await buildDailyReport(date)
    if (!report) return NextResponse.json({ ok: true, skipped: `no register sales on ${date}` })

    await sendMail({ to: RECIPIENTS, subject: report.subject, html: report.html })

    const { error } = await supabaseAdmin.from('clover_daily_report_log').upsert({
      business_date: date, sent_at: new Date().toISOString(), recipients: RECIPIENTS, subject: report.subject,
    })
    return NextResponse.json({ ok: true, sent: date, to: RECIPIENTS, subject: report.subject, logWarning: error?.message ?? null })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
