export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// The sign-in roster.
//
// Named sign-in with no password: a crew member taps their name and the phone
// remembers it. This is attribution, not authentication — it answers "who
// checked this off", which is what a sanitation record needs. Keeping strangers
// out is the job of the network and passphrase gates, not this list.

export async function GET(req: NextRequest) {
  const all = new URL(req.url).searchParams.get('all') === '1'

  let q = supabase.from('cleaning_crew').select('*').order('sort_order', { ascending: true })
  if (!all) q = q.eq('active', true)

  const { data, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  // Secondary sort by name so an unset sort_order still reads alphabetically
  // rather than by insertion order.
  const rows = (data ?? []).sort(
    (a, b) => (a.sort_order as number) - (b.sort_order as number) ||
              String(a.name).localeCompare(String(b.name)),
  )
  return NextResponse.json(rows)
}

export async function POST(req: NextRequest) {
  const body = await req.json()
  if (!body.name?.trim()) return NextResponse.json({ error: 'name required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_crew')
    .insert([{
      name:       body.name.trim(),
      role:       body.role === 'lead' ? 'lead' : 'crew',
      sort_order: body.sort_order ?? 100,
    }])
    .select().single()
  if (error) {
    if (error.code === '23505') {
      return NextResponse.json({ error: 'That name is already on the roster.' }, { status: 409 })
    }
    return NextResponse.json({ error: error.message }, { status: 500 })
  }
  return NextResponse.json(data)
}

export async function PATCH(req: NextRequest) {
  const { id, ...updates } = await req.json()
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_crew').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Someone leaving is deactivated, not deleted — their name stays readable on
// every item they ever signed off.
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('cleaning_crew').update({ active: false }).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
