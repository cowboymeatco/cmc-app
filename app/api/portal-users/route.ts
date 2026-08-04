export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/portal-users — who has an account on portal.cowboymeats.com, and how
// far each one actually got.
//
// The account list lives in auth.users, which PostgREST doesn't expose, so this
// goes through the admin API on the service-role key — hence nodejs runtime,
// and hence server-only.
//
// The funnel is the point of this route. Signing up is not the same as showing
// up: an account with no sign-in never came back, and one with no customer
// record stopped at profile setup and never finished. Both were invisible.

interface PortalUser {
  id:          string
  email:       string
  signed_up:   string
  last_seen:   string | null
  name:        string | null
  role:        string | null
  // 'active' signed in within a fortnight · 'dormant' signed in, not lately ·
  // 'setup' signed in but never finished a profile · 'never' never signed in.
  stage:       'active' | 'dormant' | 'setup' | 'never'
  animals:     number
  cut_cards:   number
}

export async function GET() {
  try {
    const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page: 1, perPage: 1000 })
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    const users = list?.users ?? []

    const { data: custRows } = await supabaseAdmin
      .from('customers')
      .select('id, name, role, auth_user_id')
      .not('auth_user_id', 'is', null)
    const byAuth = new Map((custRows ?? []).map(c => [c.auth_user_id as string, c]))
    const custIds = (custRows ?? []).map(c => c.id as string)

    // What portal people have actually got in the system. Both counts are keyed
    // on the customer record, so an account still stuck at setup shows zeroes —
    // which is the honest answer for someone who never finished signing up.
    const [{ data: appts }, { data: cards }] = await Promise.all([
      custIds.length
        ? supabaseAdmin.from('harvest_appointments').select('producer_id').in('producer_id', custIds)
        : Promise.resolve({ data: [] as { producer_id: string }[] }),
      custIds.length
        ? supabaseAdmin.from('cutting_instructions').select('customer_id').in('customer_id', custIds)
        : Promise.resolve({ data: [] as { customer_id: string }[] }),
    ])
    const apptCount = new Map<string, number>()
    for (const a of appts ?? []) {
      const k = a.producer_id as string
      if (k) apptCount.set(k, (apptCount.get(k) ?? 0) + 1)
    }
    const cardCount = new Map<string, number>()
    for (const c of cards ?? []) {
      const k = c.customer_id as string
      if (k) cardCount.set(k, (cardCount.get(k) ?? 0) + 1)
    }

    const now = Date.now()
    const FORTNIGHT = 14 * 24 * 3600 * 1000

    const rows: PortalUser[] = users.map(u => {
      const cust = byAuth.get(u.id)
      const last = u.last_sign_in_at ?? null
      const stage: PortalUser['stage'] =
        !last                                          ? 'never'
        : !cust                                        ? 'setup'
        : now - Date.parse(last) <= FORTNIGHT          ? 'active'
        : 'dormant'
      return {
        id:        u.id,
        email:     u.email ?? '',
        signed_up: u.created_at,
        last_seen: last,
        name:      (cust?.name as string) ?? null,
        role:      (cust?.role as string) ?? null,
        stage,
        animals:   cust ? apptCount.get(cust.id as string) ?? 0 : 0,
        cut_cards: cust ? cardCount.get(cust.id as string) ?? 0 : 0,
      }
    })

    rows.sort((a, b) => (b.last_seen ?? '').localeCompare(a.last_seen ?? '') || b.signed_up.localeCompare(a.signed_up))

    // Signups per week, oldest first — the only trend worth drawing at this size.
    const weeks = new Map<string, number>()
    for (const u of users) {
      const d = new Date(u.created_at)
      d.setDate(d.getDate() - d.getDay())          // back to Sunday
      const k = d.toISOString().slice(0, 10)
      weeks.set(k, (weeks.get(k) ?? 0) + 1)
    }

    return NextResponse.json({
      users: rows,
      totals: {
        accounts:   rows.length,
        active:     rows.filter(r => r.stage === 'active').length,
        dormant:    rows.filter(r => r.stage === 'dormant').length,
        setup:      rows.filter(r => r.stage === 'setup').length,
        never:      rows.filter(r => r.stage === 'never').length,
        // Staff accounts are on the portal to test it, not to use it — they
        // flatter every number they're counted in.
        outside:    rows.filter(r => !r.email.endsWith('@cowboymeats.com')).length,
        animals:    rows.reduce((s, r) => s + r.animals, 0),
        cut_cards:  rows.reduce((s, r) => s + r.cut_cards, 0),
      },
      signups: [...weeks.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([week, n]) => ({ week, n })),
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
