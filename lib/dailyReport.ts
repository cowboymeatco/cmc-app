// ──────────────────────────────────────────────────────────────────────────────
// The register close report — one email per shop day, sent at 5:00 PM MT
// (Charlie, 2026-09-27) by /api/cron/register-report. SERVER-ONLY.
//
// It says what the register took in, where it went (retail vs invoice
// payments vs gift cards), the QuickBooks entry for the day, the deposits to
// expect, and anything a person needs to look at. Read-only: building it never
// writes to Clover or QuickBooks.
//
// 5:00 PM is also when a day can first be approved (lib/qboDailySales
// SHOP_CLOSE), so on a normal day the report says "ready to approve"; a day
// already approved shows what was posted.
// ──────────────────────────────────────────────────────────────────────────────

import { readCloverDay, type DaySummary } from '@/lib/cloverSales'
import { proposeDay, postingFrom, type DayProposal, type DayRow } from '@/lib/qboDailySales'
import { cardGrossCents, defaultHoldbackCents } from '@/lib/qboDeposits'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { addDaysISO, dateLabel, dayOfWeekISO } from '@/lib/dates'

export interface DailyReport {
  date: string
  subject: string
  html: string
}

const $ = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/**
 * When a day's card batch usually reaches First State Bank, from every
 * Clover deposit Jill booked (Aug–Sep 2026): Mon–Wed sales two business days
 * later, Thu/Fri/Sat sales the following Monday. Holidays push it a day (Labor
 * Day did); this doesn't know about them, hence "about".
 */
export function expectedBankDate(date: string): string {
  const dow = dayOfWeekISO(date) // 0 Sun … 6 Sat
  if (dow >= 1 && dow <= 3) return addDaysISO(date, 2)
  if (dow === 4) return addDaysISO(date, 4)
  if (dow === 5) return addDaysISO(date, 3)
  if (dow === 6) return addDaysISO(date, 2)
  return addDaysISO(date, 1)
}

interface OpenItem { date: string; what: string }

// Earlier days a person still owes something: a posting that failed part-way,
// a day whose Clover numbers moved after it was posted, or a posted day whose
// card deposit hasn't been recorded. Only once the app is posting.
async function openItems(date: string): Promise<OpenItem[]> {
  const from = postingFrom()
  if (!from) return []
  const since = addDaysISO(date, -10) > from ? addDaysISO(date, -10) : from
  const [days, deps] = await Promise.all([
    supabaseAdmin.from('clover_daily_sales').select('business_date, status, changed_after_post, summary')
      .gte('business_date', since).lt('business_date', date),
    supabaseAdmin.from('clover_card_deposits').select('business_date, status')
      .gte('business_date', since).lt('business_date', date),
  ])
  if (days.error) return [{ date, what: `Couldn't read the posting records: ${days.error.message}` }]
  const deposited = new Map((deps.data ?? []).map(r => [r.business_date as string, r.status as string]))
  const out: OpenItem[] = []
  for (const r of (days.data ?? []) as Pick<DayRow, 'business_date' | 'status' | 'changed_after_post' | 'summary'>[]) {
    if (r.status === 'error') out.push({ date: r.business_date, what: 'posting stopped part-way — approve again to finish' })
    if (r.changed_after_post) out.push({ date: r.business_date, what: 'Clover changed after posting (late refund or edited ticket)' })
    const card = r.summary ? cardGrossCents(r.summary) : 0
    const dep = deposited.get(r.business_date)
    if (r.status === 'posted' && card > 0 && dep !== 'posted') {
      out.push({ date: r.business_date, what: `card deposit not recorded yet (${$(card)}, expected about ${dateLabel(expectedBankDate(r.business_date), { weekday: 'short', month: 'short', day: 'numeric' })})` })
    }
  }
  return out.sort((a, b) => a.date.localeCompare(b.date))
}

async function recordFor(date: string): Promise<DayRow | null> {
  const { data } = await supabaseAdmin.from('clover_daily_sales').select('*').eq('business_date', date).maybeSingle()
  return (data as DayRow | null) ?? null
}

// ── HTML ────────────────────────────────────────────────────────────────────
// Plain tables and inline styles: Outlook's renderer ignores most CSS.
const H = (t: string) => `<h3 style="font-family:Segoe UI,Arial,sans-serif;font-size:15px;color:#75471B;margin:18px 0 6px">${t}</h3>`
const P = (t: string, color = '#222') => `<p style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;color:${color};margin:4px 0">${t}</p>`
function table(rows: [string, string, boolean?][]): string {
  return `<table cellpadding="4" cellspacing="0" style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;border-collapse:collapse;min-width:360px">${
    rows.map(([k, v, bold]) => `<tr><td style="padding:3px 16px 3px 0;color:#444${bold ? ';font-weight:bold' : ''}">${k}</td><td style="padding:3px 0;text-align:right;font-family:Consolas,monospace${bold ? ';font-weight:bold' : ''}">${v}</td></tr>`).join('')
  }</table>`
}
const list = (items: string[]) => `<ul style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;margin:4px 0;padding-left:20px">${items.map(i => `<li style="margin:2px 0">${i}</li>`).join('')}</ul>`

export function renderReport(s: DaySummary, built: DayProposal | null, qboError: string | null, record: DayRow | null, open: OpenItem[]): DailyReport {
  const t = s.totals
  const day = dateLabel(s.date, { weekday: 'short', month: 'short', day: 'numeric' })
  const p = built?.proposal
  const posted = record?.status === 'posted'
  const on = postingFrom()

  // What still needs a person, today.
  const attention: string[] = []
  if (qboError) attention.push(`QuickBooks couldn't be read: ${esc(qboError)}`)
  for (const b of p?.blockers ?? []) if (!/hasn't closed yet/.test(b)) attention.push(esc(b))
  for (const w of s.warnings) attention.push(esc(w))
  if (record?.changed_after_post) attention.push('Clover changed after this day was posted — adjust in QuickBooks')
  if (record?.status === 'error') attention.push(`Posting stopped part-way: ${esc(record.error ?? '')}`)

  const status = posted ? 'posted ✓'
    : !on ? 'preview (posting off)'
    : attention.length ? 'needs review'
    : 'ready to approve'
  const subject = `Register close — ${day}: ${$(t.retailNetCents)} retail · ${status}`

  const parts: string[] = []
  parts.push(P(`<b>${dateLabel(s.date)}</b> — ${s.orderCount} paid order${s.orderCount === 1 ? '' : 's'}. Status: <b>${status}</b>.`))
  if (!on) parts.push(P('Posting to QuickBooks is switched off until the handoff from Jill — this shows what the app <i>would</i> post.', '#777'))

  parts.push(H('Register (Clover)'))
  parts.push(table([
    ['Taken in', $(t.collectedCents)],
    ...(t.refundsCents ? [[`Refunded${s.refundedLines.length ? ` (${esc(s.refundedLines.map(l => l.name).join(', '))})` : ''}`, $(-t.refundsCents)] as [string, string]] : []),
    ...(t.tipsCents ? [['Tips', $(t.tipsCents)] as [string, string]] : []),
    ['Net', $(t.netCents), true],
  ]))

  parts.push(H('Where it went'))
  const where: string[] = []
  where.push(`<b>Retail sales: ${$(t.retailNetCents)}</b> (${s.retailItems.length} item${s.retailItems.length === 1 ? '' : 's'}${t.discountsCents ? `, after ${$(t.discountsCents)} discounts` : ''})` +
    (s.categories.length ? `<br><span style="color:#666">${s.categories.map(c => `${esc(c.name)} ${$(c.amountCents)}`).join(' · ')}</span>` : ''))
  if (t.giftCardsSoldCents) where.push(`Gift cards sold: ${$(t.giftCardsSoldCents)}`)
  const inv = built?.candidates ?? []
  if (inv.length) {
    where.push(`Invoice payments (not sales):${list(inv.map(c => {
      const m = c.matches[0]
      const target = m ? ` → ${esc(m.customer)} INV ${esc(m.docNumber)}${m.balance ? ` (open ${$(Math.round(m.balance * 100))})` : ' (already marked paid)'}` : ''
      return `${esc(c.label)}: ${$(c.amountCents)} ${c.tender}${target}`
    }))}`)
  } else if (t.invoicePaymentsCents + t.handKeyedCents) {
    where.push(`Invoice payments (not sales): ${$(t.invoicePaymentsCents + t.handKeyedCents)}`)
  }
  if (t.nonSaleDiffCents) where.push(`Invoice payments taken ${t.nonSaleDiffCents < 0 ? 'short' : 'over'} at the counter: ${$(t.nonSaleDiffCents)}`)
  const onAccount = s.onAccount ?? []
  if (onAccount.length) {
    where.push(`Charged on account (not taken in): ${$(t.onAccountCents)}${list(onAccount.map(o =>
      `${o.title ? `${esc(o.title)} — ` : ''}${$(o.amountCents)} at ${o.paidAt}<br><span style="color:#666">${o.lines.map(l => `${esc(l.name)} ${$(l.amountCents)}`).join(' · ')}</span>`))}`)
  }
  parts.push(list(where))
  parts.push(P(`<b>By tender:</b> ${s.byTender.map(x => `${x.label} ${$(x.collectedCents - x.refundsCents)}`).join(' · ') || '—'}`))

  parts.push(H(posted ? `QuickBooks — posted${record?.approved_by ? ` by ${esc(record.approved_by)}` : ''}` : 'QuickBooks — to be posted'))
  if (p) {
    const q: string[] = []
    if (p.invoice) q.push(`Invoice${posted && record?.qbo_invoice_doc ? ` ${esc(record.qbo_invoice_doc)}` : ''} to CMC: ${$(p.invoice.totalCents)}`)
    if (p.payments.length) q.push(`Payments: ${p.payments.map(x => `${x.label} ${$(x.amountCents)}`).join(' · ')}`)
    if (onAccount.length) q.push(`Not posted — invoice the customer by hand: ${$(t.onAccountCents)} charged on account`)
    if (p.journal) q.push(`Journal entry: ${$(p.journal.lines.filter(l => l.posting === 'Debit').reduce((x, l) => x + l.amountCents, 0))} to Clover Gift Cards Payable${t.tipsCents ? ' / Clover Tips' : ''}`)
    parts.push(list(q.length ? q : ['Nothing to post']))
  } else {
    parts.push(P('Not available — see Needs attention.', '#777'))
  }

  parts.push(H('Deposits'))
  const deps: string[] = []
  const checkCash = s.byTender.filter(x => x.kind === 'check' || x.kind === 'cash')
  for (const x of checkCash) {
    const net = x.collectedCents - x.refundsCents
    if (net) deps.push(`${x.label} at close: ${$(net)}${net !== x.retailCents ? ` (${$(x.retailCents)} retail + ${$(net - x.retailCents)} invoice payments)` : ''}`)
  }
  const card = cardGrossCents(s)
  if (card) {
    const hold = defaultHoldbackCents(card)
    deps.push(`Card batch: ${$(card)} − ${$(hold)} loan (25%) = ${$(card - hold)} before fees. Expected at First State Bank about <b>${dateLabel(expectedBankDate(s.date), { weekday: 'short', month: 'short', day: 'numeric' })}</b>; the fee is known once it lands.`)
  }
  parts.push(list(deps.length ? deps : ['No deposits for this day']))

  parts.push(H('Needs attention'))
  parts.push(attention.length ? list(attention) : P('Nothing.', '#2e7d32'))

  if (open.length) {
    parts.push(H('Still open from earlier days'))
    parts.push(list(open.map(o => `${dateLabel(o.date, { weekday: 'short', month: 'short', day: 'numeric' })}: ${esc(o.what)}`)))
  }

  parts.push(P('Open the day on the CMC app\'s Billing page to review and approve.', '#777'))

  return { date: s.date, subject, html: `<div>${parts.join('\n')}</div>` }
}

/** The report for one shop day, or null when the register had no sales. */
export async function buildDailyReport(date: string): Promise<DailyReport | null> {
  const s = await readCloverDay(date)
  if (s.orderCount === 0) return null
  let built: DayProposal | null = null
  let qboError: string | null = null
  try { built = await proposeDay(s) } catch (e) { qboError = e instanceof Error ? e.message : String(e) }
  const [record, open] = await Promise.all([
    recordFor(date).catch(() => null),
    openItems(date).catch(e => [{ date, what: `Couldn't check earlier days: ${e instanceof Error ? e.message : String(e)}` }]),
  ])
  return renderReport(s, built, qboError, record, open)
}
