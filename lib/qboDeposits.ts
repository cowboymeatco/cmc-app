// ──────────────────────────────────────────────────────────────────────────────
// Clover card deposit → QuickBooks Deposit, with the loan holdback and fees.
// SERVER-ONLY.
//
// How Clover pays out (every Clover deposit Jill booked, 2026-08-12 → 09-26):
//   - each shop day's card money (card payments less card refunds) arrives as
//     ONE bank deposit, usually two business days later — 9/23's $755.79 of
//     card is the 9/25 deposit, 9/24's $410.39 the 9/26 one;
//   - Clover keeps 25% of that gross toward the Clover loan, to the cent
//     (rounded half up), booked to Clover Loan Payable;
//   - and nets its fees out of the same deposit, booked to Clover POS
//     Processing Fee. Fees are NOT a rate: daily and monthly fee debits land on
//     whichever deposit is next (0% to more than the whole day — 9/3's $199.47
//     of fees took a $137.03 day negative). So the fee can only ever be what's
//     left: gross − holdback − what actually reached the bank.
//
// Neither API can see the bank deposit (Clover's token can't read deposits or
// funding; QuickBooks' API doesn't expose the bank feed), so a person types the
// amount the bank shows and the app works out the rest.
//
// The holdback isn't fixed forever: around 9/2 the loan paid off (Clover took
// the last $797.56, 11% of that day) and later resumed at 25% on a new loan.
// The Clover Loan Payable balance can't be used to predict a payoff — it sits
// at −$15,954.60 (more repaid than was ever booked as borrowed; the new loan's
// proceeds look unbooked). So 25% is the default, the person can change it,
// and a fee that doesn't look like a fee is flagged.
//
// The Deposit is built like Jill's (e.g. 9/11, #85253): the day's card
// payments and any card-bought gift-card journal entry out of Undeposited
// Funds, then −loan and −fee lines, into First State Bank Checking.
// ──────────────────────────────────────────────────────────────────────────────

import { qboFetch } from '@/lib/qbo'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { addDaysISO } from '@/lib/dates'
import type { DaySummary } from '@/lib/cloverSales'
import { entryMarker, postingFrom, PostRefused } from '@/lib/qboDailySales'

export const CLOVER_HOLDBACK_RATE = 0.25

export const DEPOSIT_ACCOUNTS = {
  bank: 'First State Bank Checking',
  undeposited: 'Undeposited Funds',
  loan: 'Clover Loan Payable',
  fee: 'Clover POS Processing Fee',
} as const

/** 25% of the day's card gross, rounded half up — matches every holdback Jill booked. */
export function defaultHoldbackCents(grossCents: number): number {
  return Math.round(grossCents * CLOVER_HOLDBACK_RATE)
}

/** The day's card money: what Clover batches and pays out as one deposit. */
export function cardGrossCents(s: DaySummary): number {
  const c = s.byTender.find(t => t.kind === 'card')
  return c ? c.collectedCents + c.tipsCents - c.refundsCents : 0
}

// ── What sits in Undeposited Funds for the day's card batch ─────────────────
interface QueryRes<T> { QueryResponse: Record<string, T[] | undefined> }
const q = (s: string) => `query?query=${encodeURIComponent(s)}`

interface QboPayment {
  Id: string; TxnDate: string; TotalAmt: number
  CustomerRef?: { value: string; name?: string }
  DepositToAccountRef?: { value: string }
  PaymentMethodRef?: { value: string }
  PrivateNote?: string
}
interface QboJournal {
  Id: string; TxnDate: string; DocNumber?: string; PrivateNote?: string
  Line: { Id?: string; Amount: number; JournalEntryLineDetail?: { PostingType: string; AccountRef: { value: string } } }[]
}
interface QboDeposit {
  Id: string; TxnDate: string; TotalAmt: number; PrivateNote?: string
  Line: { Amount: number; LinkedTxn?: { TxnId: string; TxnType: string }[]; DepositLineDetail?: { AccountRef?: { value: string; name?: string } } }[]
}

export interface DepositItem {
  txnId: string
  txnType: 'Payment' | 'JournalEntry'
  txnDate: string
  amountCents: number
  label: string
  paymentMethodId: string | null
  depositedIn: { id: string; date: string } | null
}

export interface HandDeposit {
  id: string; date: string; totalCents: number; loanCents: number; feeCents: number
}

export interface DepositProposal {
  date: string                   // the shop day whose card batch this is
  grossCents: number             // card payments − card refunds (+ tips)
  items: DepositItem[]           // what the deposit pulls out of Undeposited Funds
  itemsCents: number
  holdbackCents: number          // Clover Loan Payable line (entered or default)
  holdbackDefaultCents: number
  depositCents: number | null    // what the bank shows — typed by a person
  feeCents: number | null        // gross − holdback − deposit
  bankDate: string | null
  accounts: { bankId: string; loanId: string; feeId: string; cardMethodId: string | null }
  alreadyDeposited: HandDeposit | null
  blockers: string[]
  warnings: string[]
}

async function accountIds(): Promise<DepositProposal['accounts'] & { undepositedId: string }> {
  const names = Object.values(DEPOSIT_ACCOUNTS).map(n => `'${n}'`).join(', ')
  const [acct, pm] = await Promise.all([
    qboFetch<QueryRes<{ Id: string; FullyQualifiedName: string; Active: boolean }>>(q(`select Id, FullyQualifiedName, Active from Account where Name in (${names})`)),
    qboFetch<QueryRes<{ Id: string; Name: string; Active: boolean }>>(q(`select Id, Name, Active from PaymentMethod where Name = 'Credit Card'`)),
  ])
  const id = (name: string) => {
    const hits = (acct.QueryResponse.Account ?? []).filter(a => a.Active && a.FullyQualifiedName === name)
    if (hits.length !== 1) throw new Error(`Expected one active QuickBooks account "${name}", found ${hits.length}`)
    return hits[0].Id
  }
  return {
    bankId: id(DEPOSIT_ACCOUNTS.bank),
    undepositedId: id(DEPOSIT_ACCOUNTS.undeposited),
    loanId: id(DEPOSIT_ACCOUNTS.loan),
    feeId: id(DEPOSIT_ACCOUNTS.fee),
    cardMethodId: (pm.QueryResponse.PaymentMethod ?? []).find(m => m.Active)?.Id ?? null,
  }
}

// Every card payment and gift-card journal entry that could belong to the
// day's batch: recorded from the day before (Jill dated hers the morning
// after, sometimes Monday for a Friday) up to ten days on, sitting in
// Undeposited Funds — deposited or not, so a deposit Jill already made is
// recognised instead of offered again.
async function candidates(date: string, undepositedId: string, cardMethodId: string | null): Promise<DepositItem[]> {
  const from = addDaysISO(date, -1), to = addDaysISO(date, 10)
  const [pays, jes, deps] = await Promise.all([
    qboFetch<QueryRes<QboPayment>>(q(`select * from Payment where TxnDate >= '${from}' and TxnDate <= '${to}' maxresults 1000`)),
    qboFetch<QueryRes<QboJournal>>(q(`select * from JournalEntry where TxnDate >= '${from}' and TxnDate <= '${to}' maxresults 200`)),
    qboFetch<QueryRes<QboDeposit>>(q(`select * from Deposit where TxnDate >= '${from}' and TxnDate <= '${addDaysISO(to, 10)}' maxresults 500`)),
  ])
  const depositedIn = new Map<string, { id: string; date: string }>()
  for (const d of deps.QueryResponse.Deposit ?? []) {
    for (const l of d.Line) for (const t of l.LinkedTxn ?? []) depositedIn.set(`${t.TxnType}:${t.TxnId}`, { id: d.Id, date: d.TxnDate })
  }
  const out: DepositItem[] = []
  for (const p of pays.QueryResponse.Payment ?? []) {
    if (p.DepositToAccountRef?.value !== undepositedId) continue
    // Card batches carry card payments only (Jill's are all Credit Card).
    if (cardMethodId && p.PaymentMethodRef?.value !== cardMethodId) continue
    out.push({
      txnId: p.Id, txnType: 'Payment', txnDate: p.TxnDate, amountCents: Math.round(p.TotalAmt * 100),
      label: p.CustomerRef?.name ?? p.CustomerRef?.value ?? 'Payment',
      paymentMethodId: p.PaymentMethodRef?.value ?? null,
      depositedIn: depositedIn.get(`Payment:${p.Id}`) ?? null,
    })
  }
  for (const j of jes.QueryResponse.JournalEntry ?? []) {
    const uf = j.Line.filter(l => l.JournalEntryLineDetail?.PostingType === 'Debit' && l.JournalEntryLineDetail.AccountRef.value === undepositedId)
    if (uf.length !== 1) continue
    out.push({
      txnId: j.Id, txnType: 'JournalEntry', txnDate: j.TxnDate, amountCents: Math.round(uf[0].Amount * 100),
      label: `Journal ${j.DocNumber ?? j.Id}${j.PrivateNote ? ` — ${j.PrivateNote.slice(0, 40)}` : ''}`,
      paymentMethodId: null,
      depositedIn: depositedIn.get(`JournalEntry:${j.Id}`) ?? null,
    })
  }
  return out
}

// Which of those make up the day's batch. The day tells us what to expect —
// the retail card payment, each card ring-up / hand-keyed payment, a gift card
// bought by card — so each expectation is matched to one recorded transaction
// of exactly that amount, closest date first. What's expected but not found
// is named, so a person knows which payment still has to be recorded.
function pickItems(s: DaySummary, pool: DepositItem[]): { items: DepositItem[]; missing: string[]; ties: number } {
  const card = s.byTender.find(t => t.kind === 'card')
  const expected: { label: string; cents: number; types: DepositItem['txnType'][] }[] = []
  if (card && card.retailCents > 0) expected.push({ label: `retail card sales to CMC`, cents: card.retailCents, types: ['Payment'] })
  // A ring-up / hand-keyed order is recorded as one payment for what the card
  // actually took for it — its card share if the order was split, the short
  // amount if the invoice was paid short. Gift cards on the same order ride on
  // the journal entry instead.
  const giftByOrder = new Map<string, number>()
  for (const l of s.giftCardsSold) giftByOrder.set(l.orderId, (giftByOrder.get(l.orderId) ?? 0) + l.amountCents)
  const labels = new Map<string, string>()
  for (const l of [...s.invoicePayments, ...s.handKeyed]) labels.set(l.orderId, labels.has(l.orderId) ? `${labels.get(l.orderId)} + ${l.name}` : l.name)
  let giftOnCard = 0
  for (const [orderId, byTender] of Object.entries(s.orderNonSale ?? {})) {
    const cardShare = byTender.card ?? 0
    if (!cardShare) continue
    const gift = Math.min(giftByOrder.get(orderId) ?? 0, cardShare)
    giftOnCard += gift
    if (cardShare - gift > 0 && labels.has(orderId)) expected.push({ label: labels.get(orderId)!, cents: cardShare - gift, types: ['Payment'] })
  }
  if (giftOnCard > 0) expected.push({ label: 'gift cards sold on card', cents: giftOnCard + s.totals.tipsCents, types: ['JournalEntry'] })

  const dist = (d: string) => Math.abs(new Date(d).getTime() - new Date(s.date).getTime())
  const depKey = (p: DepositItem) => p.depositedIn?.id ?? 'none'
  // Two passes: closest date first; then, if two recorded payments share an
  // amount (First State Bank paid $163.20 on both 8/14 and 8/15), prefer the
  // one that sits with the rest of the batch.
  const pick = (prefer: string | null) => {
    const used = new Set<string>()
    const items: DepositItem[] = []
    const missing: string[] = []
    let ties = 0
    for (const e of expected) {
      const hits = pool
        .filter(p => !used.has(p.txnId) && e.types.includes(p.txnType) && p.amountCents === e.cents)
        .sort((a, b) => (prefer ? Number(depKey(b) === prefer) - Number(depKey(a) === prefer) : 0) || dist(a.txnDate) - dist(b.txnDate))
      if (hits.length > 1) ties++
      if (hits[0]) { used.add(hits[0].txnId); items.push(hits[0]) }
      else missing.push(`${e.label} $${(e.cents / 100).toFixed(2)}`)
    }
    return { items, missing, ties }
  }
  const first = pick(null)
  const counts = new Map<string, number>()
  for (const i of first.items) counts.set(depKey(i), (counts.get(depKey(i)) ?? 0) + 1)
  const majority = [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return counts.size > 1 ? pick(majority) : first
}

export async function proposeDeposit(s: DaySummary, input: {
  depositCents?: number | null; holdbackCents?: number | null; bankDate?: string | null
}): Promise<DepositProposal> {
  const acc = await accountIds()
  const gross = cardGrossCents(s)
  const holdbackDefault = defaultHoldbackCents(gross)
  const holdback = input.holdbackCents ?? holdbackDefault
  const deposit = input.depositCents ?? null
  const fee = deposit == null ? null : gross - holdback - deposit
  const blockers: string[] = []
  const warnings: string[] = []

  const pool = gross > 0 ? await candidates(s.date, acc.undepositedId, acc.cardMethodId) : []
  const { items, missing, ties } = pickItems(s, pool)
  if (ties) warnings.push('More than one recorded payment has the same amount as one expected here — check the payments listed are this day’s')
  const itemsCents = items.reduce((x, i) => x + i.amountCents, 0)

  // Already deposited — by Jill, or by an earlier run of this.
  const depIds = [...new Set(items.map(i => i.depositedIn?.id).filter(Boolean) as string[])]
  let alreadyDeposited: HandDeposit | null = null
  if (depIds.length === 1 && items.every(i => i.depositedIn)) {
    const d = (await qboFetch<QueryRes<QboDeposit>>(q(`select * from Deposit where Id = '${depIds[0]}'`))).QueryResponse.Deposit?.[0]
    if (d) {
      const acctSum = (id: string) => -Math.round(d.Line.filter(l => l.DepositLineDetail?.AccountRef?.value === id).reduce((x, l) => x + l.Amount, 0) * 100)
      alreadyDeposited = { id: d.Id, date: d.TxnDate, totalCents: Math.round(d.TotalAmt * 100), loanCents: acctSum(acc.loanId), feeCents: acctSum(acc.feeId) }
      blockers.push(`Already deposited in QuickBooks on ${d.TxnDate} ($${d.TotalAmt.toFixed(2)})`)
    }
  } else if (items.some(i => i.depositedIn)) {
    blockers.push('Some of these payments are already in a deposit — sort it out in QuickBooks')
  }

  if (gross <= 0) blockers.push('No card sales this day — nothing for Clover to deposit')
  if (missing.length) blockers.push(`Record these in QuickBooks first (not found in Undeposited Funds): ${missing.join('; ')}`)
  if (!missing.length && itemsCents !== gross) blockers.push(`Payments found ($${(itemsCents / 100).toFixed(2)}) don't add up to Clover's card total ($${(gross / 100).toFixed(2)})`)
  if (deposit == null) blockers.push('Enter the amount the bank shows for this deposit')
  if (!input.bankDate) blockers.push('Enter the date the deposit reached the bank')
  if (holdback < 0 || holdback > gross) blockers.push('Loan holdback must be between $0 and the day\'s card total')
  if (fee != null && fee < 0) {
    blockers.push(`The bank got more than card total less holdback — fee would be −$${(-fee / 100).toFixed(2)}. Has the loan paid off? Change the holdback`)
  }
  if (fee != null && fee > 0 && gross > 0 && fee / gross > 0.1) {
    warnings.push(`Fees come to ${((fee / gross) * 100).toFixed(1)}% of the day — usually Clover's monthly fees landing on this deposit, but check Clover's deposit detail. If the loan holdback stopped, the "fee" is really the 25% (9/10 was booked that way).`)
  }
  if (holdback !== holdbackDefault) warnings.push(`Holdback set to $${(holdback / 100).toFixed(2)} instead of the usual 25% ($${(holdbackDefault / 100).toFixed(2)})`)

  return {
    date: s.date, grossCents: gross, items, itemsCents,
    holdbackCents: holdback, holdbackDefaultCents: holdbackDefault,
    depositCents: deposit, feeCents: fee, bankDate: input.bankDate ?? null,
    accounts: { bankId: acc.bankId, loanId: acc.loanId, feeId: acc.feeId, cardMethodId: acc.cardMethodId },
    alreadyDeposited, blockers, warnings,
  }
}

// ── Posting ─────────────────────────────────────────────────────────────────
// Same guards as the sales posting: off until CLOVER_SALES_POSTING_FROM, one
// row per shop day (a batch can't be deposited twice), every write logged.
export async function postDeposit(opts: { summary: DaySummary; proposal: DepositProposal; approvedFingerprint: string; approvedBy: string }) {
  const { summary: s, proposal: p, approvedFingerprint, approvedBy } = opts
  const from = postingFrom()
  if (!from) throw new PostRefused('Posting to QuickBooks is switched off (CLOVER_SALES_POSTING_FROM is not set).')
  if (s.date < from) throw new PostRefused(`${s.date} is before ${from} — deposits for earlier days are entered by hand.`)
  if (s.fingerprint !== approvedFingerprint) throw new PostRefused('Clover\'s numbers for this day changed since the page loaded. Reload and review again.')
  if (p.blockers.length) throw new PostRefused(`Not ready: ${p.blockers.join(' · ')}`)
  if (p.depositCents == null || p.feeCents == null || !p.bankDate) throw new PostRefused('Deposit amount and bank date are required')

  const { error: claimErr } = await supabaseAdmin.from('clover_card_deposits').insert({
    business_date: s.date, status: 'posting', bank_date: p.bankDate,
    gross_cents: p.grossCents, holdback_cents: p.holdbackCents, fee_cents: p.feeCents, deposit_cents: p.depositCents,
    items: p.items, approved_by: approvedBy,
  })
  if (claimErr) {
    // A failed attempt may be retried only if QuickBooks never accepted it.
    const { data: prior } = await supabaseAdmin.from('clover_card_deposits').select('status').eq('business_date', s.date).maybeSingle()
    const { data: wrote } = await supabaseAdmin.from('clover_daily_sales_log').select('id').eq('business_date', s.date).eq('step', 'deposit').eq('status', 'ok').limit(1)
    if (prior?.status !== 'error' || (wrote ?? []).length) {
      throw new PostRefused(`The ${s.date} deposit is already ${prior?.status ?? 'claimed'}${(wrote ?? []).length ? ' (QuickBooks accepted it — check there)' : ''}.`)
    }
    const { error: retryErr } = await supabaseAdmin.from('clover_card_deposits').update({
      status: 'posting', bank_date: p.bankDate, gross_cents: p.grossCents, holdback_cents: p.holdbackCents,
      fee_cents: p.feeCents, deposit_cents: p.depositCents, items: p.items, approved_by: approvedBy, error: null,
    }).eq('business_date', s.date).eq('status', 'error')
    if (retryErr) throw new PostRefused(`Could not claim the ${s.date} deposit: ${retryErr.message}`)
  }

  const dollars = (c: number) => Math.round(c) / 100
  const line = (accountId: string, cents: number, description: string) => ({
    DetailType: 'DepositLineDetail', Amount: -dollars(cents), Description: description,
    DepositLineDetail: { AccountRef: { value: accountId }, ...(p.accounts.cardMethodId ? { PaymentMethodRef: { value: p.accounts.cardMethodId } } : {}) },
  })
  const body = {
    DepositToAccountRef: { value: p.accounts.bankId },
    TxnDate: p.bankDate,
    PrivateNote: `${entryMarker(s.date)} Clover card deposit for ${s.date} sales: $${dollars(p.grossCents).toFixed(2)} less loan $${dollars(p.holdbackCents).toFixed(2)} and fees $${dollars(p.feeCents).toFixed(2)}. Approved by ${approvedBy}.`,
    Line: [
      ...p.items.map(i => ({ Amount: dollars(i.amountCents), LinkedTxn: [{ TxnId: i.txnId, TxnType: i.txnType, TxnLineId: '0' }] })),
      ...(p.holdbackCents ? [line(p.accounts.loanId, p.holdbackCents, 'Clover loan holdback')] : []),
      ...(p.feeCents ? [line(p.accounts.feeId, p.feeCents, 'Clover processing fees')] : []),
    ],
  }

  const log = (status: 'ok' | 'error', extra: { qboId?: string; error?: string }) =>
    supabaseAdmin.from('clover_daily_sales_log').insert({
      business_date: s.date, step: 'deposit', status, qbo_id: extra.qboId ?? null,
      amount_cents: p.depositCents, request: body, error: extra.error ?? null, actor: approvedBy,
    }).then(({ error }) => { if (error) console.error(`deposit log insert failed (${s.date}): ${error.message}`) })

  try {
    const res = await qboFetch<{ Deposit: { Id: string; TotalAmt: number } }>(
      `deposit?requestid=clv-${s.date}-deposit-${s.fingerprint.slice(0, 8)}`, { method: 'POST', body: JSON.stringify(body) },
    )
    await log('ok', { qboId: res.Deposit.Id })
    if (Math.round(res.Deposit.TotalAmt * 100) !== p.depositCents) {
      throw new Error(`QuickBooks recorded the deposit (#${res.Deposit.Id}) at $${res.Deposit.TotalAmt.toFixed(2)}, not $${dollars(p.depositCents).toFixed(2)} — check it in QuickBooks`)
    }
    const { data, error } = await supabaseAdmin.from('clover_card_deposits')
      .update({ status: 'posted', qbo_deposit_id: res.Deposit.Id, posted_at: new Date().toISOString() })
      .eq('business_date', s.date).select('*').single()
    if (error) throw new Error(`Deposit #${res.Deposit.Id} posted, but saving the record failed: ${error.message}. Do NOT post again.`)
    return data
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await log('error', { error: msg })
    await supabaseAdmin.from('clover_card_deposits').update({ status: 'error', error: msg }).eq('business_date', s.date)
    throw new Error(`Deposit for ${s.date}: ${msg}`)
  }
}

export async function depositRecord(date: string) {
  const { data } = await supabaseAdmin.from('clover_card_deposits').select('*').eq('business_date', date).maybeSingle()
  return data
}
