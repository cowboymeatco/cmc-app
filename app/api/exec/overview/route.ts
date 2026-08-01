export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'
import { fetchBalanceSheetAsOf, sectionValues } from '@/lib/qboReports'
import { getOpenInvoices } from '@/lib/qboInvoices'

// GET /api/exec/overview — cash + receivables as of today, open invoice book.

export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  if (!gate.ok) return gate.response

  try {
    // Plant-local date, not UTC — late evenings in Montana are still "today".
    const today = new Date().toLocaleDateString('en-CA', { timeZone: 'America/Denver' })
    const [sheet, invoices] = await Promise.all([
      fetchBalanceSheetAsOf(today),
      getOpenInvoices(),
    ])

    const cash = sectionValues(sheet, 'BankAccounts')[0] ?? 0
    const ar = sectionValues(sheet, 'AR')[0] ?? 0
    const openBalance = invoices.reduce((a, i) => a + i.balance, 0)
    const top = [...invoices].sort((a, b) => b.balance - a.balance).slice(0, 5)
      .map(i => ({ docNumber: i.docNumber, customerName: i.customerName, balance: i.balance, txnDate: i.txnDate }))

    return NextResponse.json({
      asOf: today,
      cash,
      accountsReceivable: ar,
      openInvoices: { count: invoices.length, balance: openBalance, top },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
