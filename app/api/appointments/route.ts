export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

// GET /api/appointments â€” list appointments
//   ?date=YYYY-MM-DD  â€” only that harvest date
//   ?ids=a,b,c        â€” only those appointment ids (the cut schedule fetches
//                       just the appointments its cooler carcasses reference)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const date = searchParams.get('date')
  const idsParam = searchParams.get('ids')

  let query = supabase
    .from('harvest_appointments')
    .select('*')
    .order('harvest_date', { ascending: true })

  if (date) {
    query = query.eq('harvest_date', date)
  }
  if (idsParam !== null) {
    const ids = idsParam.split(',').map(s => s.trim()).filter(Boolean)
    if (ids.length === 0) return NextResponse.json([])
    query = query.in('id', ids)
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// Every customer name typed into an appointment used to live only inside this
// table's `customers` JSON column, so the `customers` table stayed empty and the
// schedule's name autocomplete had nothing to suggest. On save we now look each
// name up and, if it's new, create the customer record and link it back by id.
//
// This is a convenience layer: if anything here fails the appointment still
// saves, just unlinked. Never block an operator from booking an animal.
type ApptCustomer = { customer_name?: string; customer_id?: string | null; contact_value?: string; contact_preference?: string; [k: string]: unknown }

async function linkCustomers(list: unknown): Promise<unknown> {
  if (!Array.isArray(list) || list.length === 0) return list ?? []

  const seen = new Map<string, string>() // lowercased name -> customer id, for dupes within one appointment
  const out: ApptCustomer[] = []

  for (const entry of list as ApptCustomer[]) {
    const c = { ...entry }
    const name = (c.customer_name ?? '').trim()

    // Already linked, or nothing to link on.
    if (c.customer_id || !name) { out.push(c); continue }

    try {
      const key = name.toLowerCase()
      if (seen.has(key)) { c.customer_id = seen.get(key)!; out.push(c); continue }

      // ilike with no wildcards is a case-insensitive exact match.
      const { data: found } = await supabase
        .from('customers').select('id').ilike('name', name).limit(1)

      let id = found?.[0]?.id as string | undefined

      if (!id) {
        const contact = (c.contact_value ?? '').trim()
        const isEmail = contact.includes('@')
        const pref = c.contact_preference
        const { data: created } = await supabase
          .from('customers')
          .insert([{
            name,
            ranch_name: '',
            phone: isEmail ? '' : contact,
            email: isEmail ? contact : '',
            // The form defaults contact_preference to Email even when the value
            // is a phone number, so trust the value's shape over the default.
            preferred_contact: isEmail ? 'Email'
              : (pref === 'Phone Call' || pref === 'Text Message') ? pref
              : 'Phone Call',
            notes: 'Auto-created from schedule',
          }])
          .select('id')
          .single()
        id = created?.id as string | undefined
      }

      if (id) { c.customer_id = id; seen.set(key, id) }
    } catch {
      // Leave this one unlinked and keep going.
    }

    out.push(c)
  }

  return out
}

// POST /api/appointments â€” create a new appointment
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase
    .from('harvest_appointments')
    .insert([{
      harvest_date:      body.harvest_date,
      species:           body.species,
      head_count:        body.head_count ?? 1,
      source:            body.source ?? '',
      notes:             body.notes ?? '',
      status:            body.status ?? 'Booked',
      linked_carcass_id: body.linked_carcass_id ?? '',
      customers:         await linkCustomers(body.customers),
    }])
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/appointments â€” update an appointment
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, ...updates } = body

  // Only touch `customers` when the edit actually carries it.
  if ('customers' in updates) {
    updates.customers = await linkCustomers(updates.customers)
  }

  const { data, error } = await supabase
    .from('harvest_appointments')
    .update(updates)
    .eq('id', id)
    .select()
    .single()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/appointments â€” delete an appointment
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabase
    .from('harvest_appointments')
    .delete()
    .eq('id', id)

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
