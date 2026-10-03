// ──────────────────────────────────────────────────────────────────────────────
// The register close report — one email per shop day, sent at 5:00 PM MT
// (Charlie, 2026-09-27) by /api/cron/register-report. SERVER-ONLY.
//
// It says what the register took in, where it went (retail vs invoice
// payments vs gift cards), the QuickBooks entry for the day, the deposits to
// expect, where the Clover Capital advance stands, and anything a person
// needs to look at. Read-only against Clover and QuickBooks: building it
// never writes to either. It does file the day's card batch in Supabase
// (clover_card_days) so the advance can be carried forward — lib/cloverCapital.
//
// 5:00 PM is also when a day can first be approved (lib/qboDailySales
// SHOP_CLOSE), so on a normal day the report says "ready to approve"; a day
// already approved shows what was posted.
// ──────────────────────────────────────────────────────────────────────────────

import { readCloverDay, type DaySummary } from '@/lib/cloverSales'
import { proposeDay, postingFrom, type DayProposal, type DayRow } from '@/lib/qboDailySales'
import { cardGrossCents, defaultHoldbackCents, expectedBankDate } from '@/lib/qboDeposits'
import { capitalStatus, closeAdvance, recordCardDay, type CapitalStatus } from '@/lib/cloverCapital'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { addDaysISO, dateLabel } from '@/lib/dates'

export interface DailyReport {
  date: string
  subject: string
  html: string
}

const $ = (c: number) => `${c < 0 ? '−' : ''}$${(Math.abs(c) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

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

const short = (iso: string) => dateLabel(iso, { month: 'short', day: 'numeric' })
const pct = (part: number, whole: number) => whole > 0 ? `${((part / whole) * 100).toFixed(1)}%` : '—'

// Where the Clover Capital advance stands — see lib/cloverCapital for how
// the dashboard figure is carried forward from the days' card batches.
function capitalSection(c: CapitalStatus): string[] {
  const a = c.advance
  const out: string[] = [H('Clover Capital advance')]
  // The day it pays off still shows the figures; from the next day on, just the note.
  if (a.closed_date && a.closed_date !== c.pending.to) {
    out.push(P(`<b>Paid off.</b> The card batches through ${short(a.closed_date)} covered the last of advance ${esc(a.advance_number)} (${$(a.advance_cents)}, ${$(a.payback_cents)} repaid). Nothing more comes off the card deposits. When Clover funds a new advance, enter it on the Billing page.`, '#2e7d32'))
    return out
  }
  const rows: [string, string, boolean?][] = [
    [`Balance due, per Clover (through its ${short(a.last_payment_date)} payout)`, $(a.balance_cents)],
    ['Paid so far', `${$(a.paid_cents)} of ${$(a.payback_cents)} (${pct(a.paid_cents, a.payback_cents)})`],
  ]
  if (c.pending.days) {
    const span = c.pending.from === c.pending.to ? short(c.pending.from) : `${short(c.pending.from)} – ${short(c.pending.to)}`
    rows.push([`Held back from card batches on the way (${span})`, $(-c.pending.holdbackCents)])
    rows.push(['Balance once those land', $(c.estBalanceCents), true])
  }
  if (c.estBalanceCents > 0) {
    rows.push([`Card sales still needed to clear it (at ${Math.round(a.holdback_rate * 100)}%)`, $(c.cardSalesNeededCents), true])
  }
  out.push(table(rows))
  if (c.pending.missing.length) {
    out.push(P(`Not counted yet: ${c.pending.missing.map(short).join(', ')} — the app hasn't read ${c.pending.missing.length === 1 ? 'that day' : 'those days'} from Clover; it will tomorrow.`, '#b26a00'))
  }
  if (c.paidOff) {
    out.push(P('<b>That covers it.</b> The batches on the way pay off the advance; nothing more comes off the card deposits after them — see Needs attention.', '#2e7d32'))
  } else if (c.pace && c.payoffDate) {
    out.push(P(`At the recent pace (${$(c.pace.perDayCents)} a day of holdback over the last ${c.pace.days} days) it pays off about <b>${dateLabel(c.payoffDate, { weekday: 'short', month: 'short', day: 'numeric' })}</b>, ${pct(a.payback_cents - c.estBalanceCents, a.payback_cents)} paid as of today.`))
  } else {
    out.push(P('A payoff date comes once a week of card days is on record.', '#777'))
  }
  out.push(P(`Advance ${esc(a.advance_number)}: ${$(a.advance_cents)}${a.funded_date ? ` funded ${dateLabel(a.funded_date, { month: 'short', day: 'numeric', year: 'numeric' })}` : ''}, repaid at ${Math.round(a.holdback_rate * 100)}% of each card batch. Clover's figures as entered on the Billing page${a.updated_by ? ` (${esc(a.updated_by)})` : ''} — re-enter them there when the dashboard moves.`, '#777'))
  return out
}

export function renderReport(s: DaySummary, built: DayProposal | null, qboError: string | null, record: DayRow | null, open: OpenItem[], capital: CapitalStatus | null = null, capitalError: string | null = null): DailyReport {
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
  if (capitalError) attention.push(`Clover Capital couldn't be worked out: ${esc(capitalError)}`)
  if (capital?.paidOff && capital.advance.closed_date === s.date) attention.push(`The Clover Capital advance is paid off — the card batches through ${short(s.date)} cover what was left, so the app marked it closed. Confirm on the Clover dashboard that the holdback stops with the ${dateLabel(expectedBankDate(s.date), { weekday: 'short', month: 'short', day: 'numeric' })} deposit.`)

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
  parts.push(list(where))
  parts.push(P(`<b>By tender:</b> ${s.byTender.map(x => `${x.label} ${$(x.collectedCents - x.refundsCents)}`).join(' · ') || '—'}`))

  parts.push(H(posted ? `QuickBooks — posted${record?.approved_by ? ` by ${esc(record.approved_by)}` : ''}` : 'QuickBooks — to be posted'))
  if (p) {
    const q: string[] = []
    if (p.invoice) q.push(`Invoice${posted && record?.qbo_invoice_doc ? ` ${esc(record.qbo_invoice_doc)}` : ''} to CMC: ${$(p.invoice.totalCents)}`)
    if (p.payments.length) q.push(`Payments: ${p.payments.map(x => `${x.label} ${$(x.amountCents)}`).join(' · ')}`)
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
    // The Clover Capital holdback: the usual share while the advance is open,
    // only what's left of it on the batch that pays it off, nothing after.
    // Without an advance on record the old 25% assumption stands.
    const usual = defaultHoldbackCents(card)
    const hold = capital ? capital.todayHoldbackCents : usual
    const loan = !hold ? ''
      : hold < usual ? ` − ${$(hold)} loan (the last of the Clover Capital advance)`
      : ` − ${$(hold)} loan (${capital ? Math.round(capital.advance.holdback_rate * 100) : 25}%)`
    deps.push(`Card batch: ${$(card)}${loan} = ${$(card - hold)} before fees${!hold && capital ? ' — no Clover Capital holdback now' : ''}. Expected at First State Bank about <b>${dateLabel(expectedBankDate(s.date), { weekday: 'short', month: 'short', day: 'numeric' })}</b>; the fee is known once it lands.`)
  }
  parts.push(list(deps.length ? deps : ['No deposits for this day']))

  if (capital?.show) parts.push(...capitalSection(capital))

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
  // The day's card batch goes on record first so the advance counts it.
  let capital: CapitalStatus | null = null
  let capitalError: string | null = null
  try {
    await recordCardDay(s)
    capital = await capitalStatus(date)
    // The batches on the way cover the balance: the advance is done. Close
    // it so tomorrow's deposit line takes no holdback and the section winds
    // down (lib/cloverCapital). A person can reopen it by re-entering the
    // dashboard figures if Clover shows a balance after all.
    if (capital?.paidOff && !capital.advance.closed_date) {
      capital.advance = await closeAdvance(capital.advance, date, `the app — the card batches through ${date} covered it`)
    }
  } catch (e) { capitalError = e instanceof Error ? e.message : String(e) }
  return renderReport(s, built, qboError, record, open, capital, capitalError)
}
