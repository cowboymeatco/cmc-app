export const runtime = 'nodejs'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { qboFetch, qboConfigured } from '@/lib/qbo'
import { coverage, type QboAccountBalance, type Asset } from '@/lib/assets'

// GET   /api/assets            → the register, plus how much of the books it covers
// POST  /api/assets            → add one
// PATCH /api/assets            → edit one
//
// The coverage figure is the reason this endpoint reaches QuickBooks at all.
// A list of assets on its own can't tell you what it's missing; comparing it
// against the fixed-asset balances can, and "what we cannot name" is the number
// worth acting on.

interface QboAccount {
  Id: string
  Name: string
  CurrentBalance?: number
  AccountType?: string
  Active?: boolean
}

async function fixedAssetAccounts(): Promise<QboAccountBalance[] | null> {
  if (!qboConfigured()) return null
  try {
    const q = "select * from Account where AccountType = 'Fixed Asset' maxresults 200"
    const res = await qboFetch<{ QueryResponse?: { Account?: QboAccount[] } }>(
      `query?query=${encodeURIComponent(q)}`,
    )
    return (res.QueryResponse?.Account ?? []).map(a => ({
      id: a.Id, name: a.Name, balance: a.CurrentBalance ?? 0,
    }))
  } catch {
    // The register is still worth showing when the books are unreachable, so a
    // QuickBooks failure degrades the coverage panel rather than the page.
    return null
  }
}

export async function GET(req: NextRequest) {
  const includeInactive = new URL(req.url).searchParams.get('all') === '1'

  let q = supabase
    .from('assets')
    .select('*, cleaning_areas(id, name)')
    .order('purchase_cost', { ascending: false, nullsFirst: false })
  if (!includeInactive) q = q.eq('active', true)

  const [{ data, error }, accounts] = await Promise.all([q, fixedAssetAccounts()])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const assets = (data ?? []) as unknown as Asset[]

  return NextResponse.json({
    assets,
    accounts,
    coverage: accounts ? coverage(accounts, assets) : null,
    // Surfaced so the UI can say the books are unreachable rather than
    // silently implying the register covers everything.
    books_available: accounts !== null,
  })
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body?.name?.trim()) {
    return NextResponse.json({ error: 'Give it a name.' }, { status: 400 })
  }

  const { data, error } = await supabase
    .from('assets')
    .insert([{
      name:          body.name.trim(),
      make:          body.make?.trim()          || null,
      model:         body.model?.trim()         || null,
      serial_number: body.serial_number?.trim() || null,
      category:      body.category   ?? 'equipment',
      area_id:       body.area_id    ?? null,
      cleanable:     body.cleanable  ?? true,
      status:        body.status     ?? 'in_service',
      purchase_cost: body.purchase_cost ?? null,
      purchase_date: body.purchase_date || null,
      vendor:        body.vendor?.trim() || null,
      useful_life_years: body.useful_life_years ?? null,
      replacement_cost:  body.replacement_cost  ?? null,
      service_interval_days: body.service_interval_days ?? null,
      last_serviced_on:      body.last_serviced_on || null,
      photo_url:     body.photo_url ?? null,
      notes:         body.notes?.trim() || null,
    }])
    .select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  updates.updated_at = new Date().toISOString()
  const { data, error } = await supabase
    .from('assets').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Retired, not deleted — an asset's service history and the cleaning steps
// written against it stay meaningful after the machine leaves the floor.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('assets').update({ active: false, status: 'retired' }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
