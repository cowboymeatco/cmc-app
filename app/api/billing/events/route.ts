export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// Billable events ledger: list + skip/restore. Rows are created by
// /api/billing/detect and consumed by the invoice sync (next phase).

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get('status') ?? 'pending'
    const { data, error } = await supabase
      .from('billable_events')
      .select('*')
      .eq('status', status)
      .order('service_date', { ascending: false })
      .order('customer_name')
      .limit(500)
    if (error) throw new Error(error.message)

    const byDay = new Map<string, number>()
    const byCustomer = new Map<string, number>()
    for (const e of data ?? []) {
      byDay.set(e.service_date, (byDay.get(e.service_date) ?? 0) + Number(e.amount))
      byCustomer.set(e.customer_name, (byCustomer.get(e.customer_name) ?? 0) + Number(e.amount))
    }
    return NextResponse.json({
      events: data,
      totals: {
        amount: (data ?? []).reduce((s, e) => s + Number(e.amount), 0),
        byDay: [...byDay.entries()].sort().map(([day, amount]) => ({ day, amount })),
        byCustomer: [...byCustomer.entries()].sort((a, b) => b[1] - a[1]).map(([name, amount]) => ({ name, amount })),
      },
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// POST { action: 'skip' | 'restore', id }
export async function POST(req: NextRequest) {
  try {
    const { action, id } = await req.json()
    if (!id || !['skip', 'restore'].includes(action)) {
      return NextResponse.json({ error: 'action (skip|restore) and id required' }, { status: 400 })
    }
    const { error } = await supabase
      .from('billable_events')
      .update({ status: action === 'skip' ? 'skipped' : 'pending' })
      .eq('id', id)
      .in('status', ['pending', 'skipped']) // never touch pushed rows
    if (error) throw new Error(error.message)
    return NextResponse.json({ ok: true })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
