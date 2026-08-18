import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { qboFetch, qboConfigured } from '@/lib/qbo'

// Suggest roster names from the QuickBooks employee list.
//
// GET  → candidate names, newest hire first, each marked with whether they're
//        already on the roster. Nothing is written.
// POST → add the names the caller picked.
//
// ── What this is NOT ───────────────────────────────────────────────────
// It is not a payroll sync, and it cannot tell you who currently works here.
//
// The app's QuickBooks connection is the Accounting API (scope
// com.intuit.quickbooks.accounting). Its Employee.Active flag means "this
// record isn't archived in QuickBooks", NOT "this person is employed" —
// measured 2026-08-17, Active=true returned 72 people including staff
// terminated in 2025. Dropping anyone with a ReleasedDate gets that to 34.
// QuickBooks *Payroll* says the true figure is 16, so ~18 records look current
// only because nobody closed them out when the person left.
//
// Employment status lives in the Payroll API, which is a different scope this
// connection doesn't hold. So the honest design is propose-and-accept: show
// the candidates with their hire dates, say plainly that leavers may be among
// them, and let a person who knows the crew tick the right names. An automatic
// sync over this data would quietly put ex-employees on a food-safety sign-in
// list, which is precisely the outcome to avoid.

export const runtime = 'nodejs'

interface QboEmployee {
  Id: string
  GivenName?: string
  FamilyName?: string
  DisplayName?: string
  Active?: boolean
  HiredDate?: string
  ReleasedDate?: string
}

function displayName(e: QboEmployee): string {
  const full = [e.GivenName, e.FamilyName].filter(Boolean).join(' ').trim()
  return full || (e.DisplayName ?? '').trim()
}

// Case/punctuation-insensitive so "Bob  Smith" isn't offered next to the
// "Bob Smith" already on the roster.
const norm = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, ' ').trim()

export async function GET() {
  if (!qboConfigured()) {
    return NextResponse.json(
      { error: 'QuickBooks isn’t connected — link it on the Processing → QuickBooks tab first.' },
      { status: 503 },
    )
  }

  try {
    const q = 'select * from Employee where Active = true maxresults 500'
    const res = await qboFetch<{ QueryResponse?: { Employee?: QboEmployee[] } }>(
      `query?query=${encodeURIComponent(q)}`,
    )
    const all = res.QueryResponse?.Employee ?? []

    // A recorded ReleasedDate is the one reliable "gone" signal here. Its
    // absence proves nothing, which is what the UI warns about.
    const candidates = all.filter(e => !e.ReleasedDate)

    const { data: roster } = await supabase.from('cleaning_crew').select('name, active')
    // Deactivated people count as known, so a pull never re-offers someone who
    // was taken off the roster deliberately.
    const known = new Set((roster ?? []).map(r => norm(r.name as string)))

    const rows = candidates
      .map(e => ({ qbo_id: e.Id, name: displayName(e), hired: e.HiredDate ?? null }))
      .filter(r => r.name)
      .map(r => ({ ...r, on_roster: known.has(norm(r.name)) }))
      // Newest hire first: the everyday use of this button is "somebody
      // started, add them", and that person is at the top.
      .sort((a, b) => (b.hired ?? '').localeCompare(a.hired ?? '') || a.name.localeCompare(b.name))

    return NextResponse.json({
      employees:      rows,
      total:          rows.length,
      new_count:      rows.filter(r => !r.on_roster).length,
      released_count: all.length - candidates.length,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    // The realistic failure is an expired refresh token, and a raw
    // "QBO API failed" sends someone into Intuit's docs instead of Reconnect.
    const expired = /401|refresh|token/i.test(msg)
    return NextResponse.json(
      {
        error: expired
          ? 'The QuickBooks connection needs reconnecting — do that on the Processing → QuickBooks tab, then try again.'
          : `Couldn’t reach QuickBooks: ${msg}`,
      },
      { status: 502 },
    )
  }
}

export async function POST(req: NextRequest) {
  const body  = await req.json()
  const names = body?.names

  if (!Array.isArray(names) || names.length === 0) {
    return NextResponse.json({ error: 'Pick at least one name to add.' }, { status: 400 })
  }

  const clean = [...new Set(
    names.map((n: unknown) => String(n ?? '').trim()).filter(Boolean),
  )]
  if (clean.length === 0) {
    return NextResponse.json({ error: 'Pick at least one name to add.' }, { status: 400 })
  }

  // Everyone arrives as 'crew'. QuickBooks knows job titles, not who runs the
  // cleaning shift, so the lead is set by hand rather than guessed.
  const { data, error } = await supabase
    .from('cleaning_crew')
    .upsert(
      clean.map(name => ({ name, role: 'crew', sort_order: 100 })),
      // ignoreDuplicates so someone previously deactivated stays deactivated —
      // re-adding them is a deliberate act on the roster screen.
      { onConflict: 'name', ignoreDuplicates: true },
    )
    .select()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({ added: data?.length ?? 0, names: (data ?? []).map(r => r.name) })
}
