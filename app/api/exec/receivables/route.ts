export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getOpenInvoices } from '@/lib/qboInvoices'

// GET /api/exec/receivables — open invoices split by whether the product is
// still in the building.
//
// While a customer's meat is in our cooler, the invoice is effectively
// secured: a processor's lien means we can hold the product until it's paid.
// Once the boxes leave, the same dollars are unsecured — nothing behind them
// but goodwill. QuickBooks can't tell those apart; we can, by matching the
// invoice's customer to processing_sessions.
//
// Matching is name-based (there is no customer id shared between QBO and the
// floor), so an invoice whose name matches no session at all is reported as
// 'unknown' rather than guessed into either bucket.

type Risk = 'held' | 'released' | 'unknown'

interface OnsiteRow {
  name_key: string
  display_name: string
  onsite_sessions: number
  released_sessions: number
  baker_sessions: number
  oldest_onsite: string | null
  latest_session: string | null
}

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    const [invoices, onsiteRes, coverageRes] = await Promise.all([
      getOpenInvoices(),
      supabaseAdmin.rpc('exec_onsite_by_customer'),
      supabaseAdmin.from('processing_sessions').select('session_date').order('session_date', { ascending: true }).limit(1).maybeSingle(),
    ])
    if (onsiteRes.error) throw new Error(onsiteRes.error.message)

    // Scanner sessions only go back so far. An invoice written before that
    // can never match a session, but its product is long gone — treating it
    // as "unknown" would hide the oldest, riskiest money on the books.
    const coverageStart = (coverageRes.data?.session_date as string | undefined) ?? null

    const onsite = new Map<string, OnsiteRow>(
      ((onsiteRes.data ?? []) as OnsiteRow[]).map(r => [r.name_key, r]),
    )

    // Same normalization as exec_name_key(): upper-case, drop the trailing
    // hanging weight or carcass tag ("Steve Rosh 78", "Kyle Barner 177B"),
    // strip punctuation, then sort the words so "LAST, FIRST" and "First
    // Last" land on the same key. Keep this in step with the SQL function.
    const nameKey = (raw: string): string =>
      (raw || '')
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .replace(/(\s+[0-9]+[A-Z]?)+\s*$/g, '')
        .trim()
        .split(' ')
        .filter(Boolean)
        .sort()
        .join(' ')

    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const daysOld = (d: string) =>
      Math.max(0, Math.round((Date.parse(today) - Date.parse(d)) / 86_400_000))

    const rows = invoices.map(inv => {
      const hit = onsite.get(nameKey(inv.customerName))
      const predatesScanner = Boolean(coverageStart && inv.txnDate < coverageStart)
      const risk: Risk = hit
        ? (hit.onsite_sessions > 0 ? 'held' : 'released')
        : predatesScanner ? 'released' : 'unknown'
      return {
        docNumber: inv.docNumber,
        customerName: inv.customerName,
        balance: inv.balance,
        txnDate: inv.txnDate,
        dueDate: inv.dueDate,
        ageDays: daysOld(inv.txnDate),
        risk,
        // True when nothing matched and we're calling it released purely
        // because the invoice predates the scanner — an inference, not a scan.
        inferred: !hit && predatesScanner,
        atBakerStorage: Boolean(hit && hit.onsite_sessions === 0 && hit.baker_sessions > 0),
        lastSession: hit?.latest_session ?? null,
      }
    })

    const bucket = (r: Risk) => {
      const list = rows.filter(x => x.risk === r)
      return { count: list.length, balance: list.reduce((s, x) => s + x.balance, 0) }
    }

    // The list Charlie acts on: unsecured money, biggest first.
    const atRisk = rows
      .filter(r => r.risk === 'released')
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 20)

    const unknown = rows
      .filter(r => r.risk === 'unknown')
      .sort((a, b) => b.balance - a.balance)
      .slice(0, 10)

    return NextResponse.json({
      asOf: today,
      coverageStart,
      total: { count: rows.length, balance: rows.reduce((s, r) => s + r.balance, 0) },
      held: bucket('held'),
      released: bucket('released'),
      unknown: bucket('unknown'),
      atRisk,
      unknownTop: unknown,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
