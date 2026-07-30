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

// A drop-off booking is created with a blank customer slot (just a portion) —
// the buyer's name only arrives later, on the cut sheet they submit. When a slot
// is linked to a cut sheet but still has no name, copy the name off the sheet.
// The Cut Schedule and the producer/customer report both read the slot, not the
// sheet, so without this the buyer Jill just linked shows up blank on both
// (Jill/Charlie, 2026-07-29).
async function backfillLinkedNames(list: unknown): Promise<unknown> {
  if (!Array.isArray(list) || list.length === 0) return list ?? []
  const slots = list as ApptCustomer[]
  const needy = slots.filter(c =>
    !(c.customer_name ?? '').toString().trim() &&
    typeof c.linked_cutting_instruction_id === 'string' &&
    (c.linked_cutting_instruction_id as string).length > 0
  )
  if (needy.length === 0) return slots

  const ids = [...new Set(needy.map(c => c.linked_cutting_instruction_id as string))]
  const { data } = await supabase
    .from('cutting_instructions')
    .select('id, customer_name, data')
    .in('id', ids)

  const nameById = new Map<string, string>()
  for (const ci of data ?? []) {
    const nm = ((ci.customer_name as string) ?? (ci.data as { customerName?: string } | null)?.customerName ?? '').trim()
    if (nm) nameById.set(ci.id as string, nm)
  }

  return slots.map(c => {
    if ((c.customer_name ?? '').toString().trim()) return c
    const id = c.linked_cutting_instruction_id as string | undefined
    const nm = id ? nameById.get(id) : undefined
    return nm ? { ...c, customer_name: nm } : c
  })
}

// Resolve the source (ranch / producer name) to a customers-table row,
// creating one (role 'producer') when the name is new — same treatment the
// buying customers get. producer_id is what puts the record on the /customers
// Producers tab and the animal on that producer's portal dashboard. A match
// on an existing customer-role record upgrades it to 'both': same name typed
// as a source means they're producing too.
async function resolveProducerId(source: unknown): Promise<string | null> {
  const name = typeof source === 'string' ? source.trim() : ''
  if (!name) return null
  try {
    // ilike with no wildcards is a case-insensitive exact match.
    const { data } = await supabase.from('customers').select('id, role').ilike('name', name).limit(1)
    const found = data?.[0]
    if (found) {
      if (found.role === 'customer') {
        await supabase.from('customers').update({ role: 'both' }).eq('id', found.id)
      }
      return found.id as string
    }
    const { data: created } = await supabase
      .from('customers')
      .insert([{
        name,
        ranch_name: '',
        phone: '',
        email: '',
        preferred_contact: 'Phone Call',
        notes: 'Auto-created from schedule source',
        role: 'producer',
      }])
      .select('id')
      .single()
    return (created?.id as string | undefined) ?? null
  } catch {
    return null
  }
}

// POST /api/appointments â€” create a new appointment
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { data, error } = await supabase
    .from('harvest_appointments')
    .insert([{
      harvest_date:      body.harvest_date,
      // Null lets the DB trigger default it to the day before harvest.
      receive_date:      body.receive_date || null,
      species:           body.species,
      head_count:        body.head_count ?? 1,
      source:            body.source ?? '',
      notes:             body.notes ?? '',
      status:            body.status ?? 'Booked',
      linked_carcass_id: body.linked_carcass_id ?? '',
      customers:         await linkCustomers(body.customers),
      producer_id:       body.producer_id ?? await resolveProducerId(body.source),
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

  // An empty receive_date means "use the default" — coerce to null so the
  // trigger fills the day before harvest instead of erroring on ''.
  if ('receive_date' in updates && !updates.receive_date) updates.receive_date = null

  // Only touch `customers` when the edit actually carries it. Backfill any
  // just-linked-but-unnamed slot from its cut sheet FIRST, so linkCustomers
  // then resolves a customer_id for the newly filled name.
  if ('customers' in updates) {
    updates.customers = await backfillLinkedNames(updates.customers)
    updates.customers = await linkCustomers(updates.customers)
  }

  // Keep producer_id mirroring the source name (unless the caller — e.g. the
  // portal — set it explicitly). Re-resolving on every source edit means a
  // renamed source can't leave a stale link behind.
  if ('source' in updates && !('producer_id' in updates)) {
    updates.producer_id = await resolveProducerId(updates.source)
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
