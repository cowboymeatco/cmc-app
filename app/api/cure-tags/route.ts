export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { extractValueAdd } from '@/lib/valueAdd'
import { aliasMap, nameKeyWith, type CustomerNameAlias } from '@/lib/nameKey'
import { buildSheetCarcassIndex, sheetSlots, type AssignmentRow, type CarcassRow } from '@/lib/sheetCarcasses'
import { cureProductFitsSpecies, SHEET_PRODUCT } from '@/lib/cureLoad'
import { CureTag } from '@/lib/types'

export const dynamic = 'force-dynamic'

// GET /api/cure-tags?status=curing|done&instructions=1
//     /api/cure-tags?tag=0036013 — one tag by its printed number (or null), so
//     scanning a seal that's already in use identifies whose piece it is.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const status = searchParams.get('status')
  const wantInstructions = searchParams.get('instructions') === '1'

  const tagNumber = searchParams.get('tag')
  if (tagNumber) {
    const { data, error } = await supabase
      .from('cure_tags').select('*').eq('tag_number', tagNumber).maybeSingle()
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json(data)
  }

  let q = supabase.from('cure_tags').select('*').order('created_at', { ascending: false })
  if (status === 'curing' || status === 'done') q = q.eq('status', status)
  // ?customer= — one customer's tags, for the packout slip (case-insensitive)
  const customer = searchParams.get('customer')
  if (customer) q = q.ilike('customer_name', customer)
  const { data: tags, error } = await q
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  if (!wantInstructions || !tags?.length) return NextResponse.json(tags ?? [])

  // Latest live cut sheet per customer name — same source the value-add report
  // reads, so the tag list and the matrix always agree on what was ordered.
  const [{ data: cis }, { data: appts }] = await Promise.all([
    supabase.from('cutting_instructions')
      .select('id, customer_name, species, data, created_at')
      .neq('status', 'archived')
      .order('created_at', { ascending: true }),
    supabase.from('harvest_appointments').select('id, harvest_date, customers'),
  ])
  //
  // Keyed on nameKey(), not the raw string. The floor types the tag and the
  // office types the sheet, so the spellings rarely agree — "MVML KRISTIN" vs
  // "MT Veterans Meat Locker Kristin" — and an exact match silently found
  // nothing, which is indistinguishable on screen from a sheet that asked for
  // nothing (Charlie, 2026-08-27). `sheetFound` tells those two apart.
  const { data: aliasRows } = await supabase
    .from('customer_name_aliases').select('alias, expands_to')
  const aliases = aliasMap((aliasRows ?? []) as CustomerNameAlias[])
  const key = (raw: string | null | undefined) => nameKeyWith(raw, aliases)

  // ALL of a customer's sheets, not just their latest. Keeping one per name
  // meant a customer with a hog sheet and a lamb sheet had their hams looked up
  // against whichever was written last — Kristin has six sheets across four
  // species, and her hams came back "not on the sheet" from her lamb card.
  // Newest first, so the answer comes from the most recent sheet that actually
  // asks for the piece.
  const sheetsByName = new Map<string, { id: string; species: string | null; data: unknown }[]>()
  for (const ci of cis ?? []) {
    const k = key(ci.customer_name as string)
    if (!k) continue
    const list = sheetsByName.get(k) ?? []
    list.unshift({ id: String(ci.id), species: ci.species as string | null, data: ci.data })
    sheetsByName.set(k, list)
  }

  // The animals behind those sheets, so the tab can offer a customer with
  // several head a choice of which one a piece came off. Same resolution the
  // value-add report uses (lib/sheetCarcasses), so the two can't disagree
  // about whose hog is whose.
  const slots = sheetSlots(appts)
  const apptIds = slots.appointmentIds
  const [{ data: logs }, { data: asgs }] = apptIds.length
    ? await Promise.all([
        supabase.from('harvest_log')
          .select('id, appointment_id, species, carcass_tag, harvest_date, hot_carcass_weight_lbs, half_1_weight_lbs, half_2_weight_lbs')
          .in('appointment_id', apptIds),
        supabase.from('carcass_assignments')
          .select('harvest_log_id, appointment_id, appointment_customer_id, linked_cutting_instruction_id')
          .in('appointment_id', apptIds),
      ])
    : [{ data: [] as CarcassRow[] }, { data: [] as AssignmentRow[] }]
  const carcassIdx = buildSheetCarcassIndex(slots, asgs, logs)
  const logById = new Map((logs ?? []).map(l => [String(l.id), l as Record<string, unknown>]))

  const animalLabel = (id: string): string => {
    const l = logById.get(id)
    if (!l) return 'Animal off another check-in'
    const lbs = carcassIdx.weightOf(id)
    return [
      (l.species as string) ?? '',
      l.carcass_tag ? `#${l.carcass_tag as string}` : '',
      lbs != null ? `${lbs} lb` : '',
    ].filter(Boolean).join(' · ') || 'Animal'
  }

  const withInstructions = (tags as CureTag[]).map(tag => {
    const sheets = sheetsByName.get(key(tag.customer_name))
    const linked = tag.linked_harvest_id ? String(tag.linked_harvest_id) : null
    // Every animal on any of this customer's sheets, each once — what the
    // crew picks from when a name covers more than one head.
    // Only the animals that could have produced this piece: a ham off a lamb
    // is not a choice worth offering.
    const candidates = [...new Set((sheets ?? []).flatMap(sh => carcassIdx.carcassesFor(sh.id)))]
      .filter(id => cureProductFitsSpecies(tag.product, logById.get(id)?.species as string))
      .map(id => ({ id, label: animalLabel(id) }))
    const extra = {
      sheetFound: Boolean(sheets?.length),
      candidates,
      linkedAnimal: linked ? animalLabel(linked) : null,
    }
    if (!sheets?.length) return { ...tag, instruction: null, ...extra }
    const wanted = SHEET_PRODUCT[tag.product]
    if (!wanted) return { ...tag, instruction: null, ...extra }
    // A tag scanned in off a cut card knows its exact sheet — read that one
    // first. Failing that, a pinned tag reads the sheet its animal is on.
    const linkedCi = tag.linked_cutting_instruction_id ? String(tag.linked_cutting_instruction_id) : null
    const ordered = linkedCi
      ? [...sheets].sort((a, b) => (a.id === linkedCi ? 0 : 1) - (b.id === linkedCi ? 0 : 1))
      : linked
        ? [...sheets].sort((a, b) => {
            const am = carcassIdx.carcassesFor(a.id).includes(linked) ? 0 : 1
            const bm = carcassIdx.carcassesFor(b.id).includes(linked) ? 0 : 1
            return am - bm
          })
        : sheets
    for (const sheet of ordered) {
      const item = extractValueAdd(sheet.species, sheet.data).find(it => it.product === wanted)
      if (item) return { ...tag, instruction: item.detail ?? 'On sheet — no cut style given', ...extra }
    }
    return { ...tag, instruction: null, ...extra }
  })
  return NextResponse.json(withInstructions)
}

// POST /api/cure-tags — tag a piece in from the scanner.
// A seal is single-use: if the number already exists the existing row comes
// back with 409 so the floor sees whose piece it is instead of double-tagging.
//
// Carries linked_cutting_instruction_id when the session was opened off a cut
// card's CI barcode — one tag, one sheet, one animal portion. And it counts:
// a 3rd Bacon against a sheet that orders 2 comes back 422 with the numbers,
// for the scanner to put to the person holding the piece. Warn, never block —
// a split belly seals as two pieces and the sheet can lag the floor, so the
// crew's "tag anyway" (force) always wins (Charlie, 2026-09-01).
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { tag_number, product, customer_name, session_date, weight_lbs, linked_cutting_instruction_id, force } = body as {
    tag_number: string; product: string; customer_name: string
    session_date?: string; weight_lbs?: number | null
    linked_cutting_instruction_id?: string | null; force?: boolean
  }
  if (!tag_number || !product || !customer_name) {
    return NextResponse.json({ error: 'tag_number, product and customer_name required' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('cure_tags').select('*').eq('tag_number', tag_number).maybeSingle()
  if (existing) return NextResponse.json(existing, { status: 409 })

  const ciId = linked_cutting_instruction_id || null

  // The count check needs a single sheet to be the denominator. A scanned card
  // names it outright; a typed name gets one only when exactly one live sheet
  // matches its key — a customer with two hogs on two sheets has no per-animal
  // answer without the card, and a wrong warning teaches the floor to ignore
  // the right ones, so ambiguity skips the check rather than guessing.
  const wanted = SHEET_PRODUCT[product]
  if (!force && wanted) {
    const [{ data: cis }, { data: aliasRows }] = await Promise.all([
      supabase.from('cutting_instructions')
        .select('id, customer_name, species, data').neq('status', 'archived'),
      supabase.from('customer_name_aliases').select('alias, expands_to'),
    ])
    const aliases = aliasMap((aliasRows ?? []) as CustomerNameAlias[])
    const key = (raw: string | null | undefined) => nameKeyWith(raw, aliases)

    const k = key(customer_name)
    const keyMatches = (cis ?? []).filter(ci => key(ci.customer_name as string) === k)
    const sheet = ciId
      ? (cis ?? []).find(ci => String(ci.id) === ciId) ?? null
      : keyMatches.length === 1 ? keyMatches[0] : null

    if (sheet) {
      const expected = extractValueAdd(sheet.species as string, sheet.data)
        .filter(it => it.product === wanted)
        .reduce((n, it) => n + (it.qty ?? 1), 0)
      // Pieces already sealed against this sheet: tags carrying its id, plus —
      // only when this customer has just the one sheet, where there is nothing
      // to misattribute — legacy tags matched by name key.
      const { data: sameProduct } = await supabase
        .from('cure_tags')
        .select('customer_name, linked_cutting_instruction_id')
        .eq('product', product)
      const have = (sameProduct ?? []).filter(t =>
        t.linked_cutting_instruction_id
          ? String(t.linked_cutting_instruction_id) === String(sheet.id)
          : keyMatches.length === 1 && key(t.customer_name as string) === k,
      ).length
      if (have + 1 > expected) {
        return NextResponse.json({
          warn: expected === 0 ? 'not_ordered' : 'over_count',
          product, expected, have,
          sheet_customer: sheet.customer_name,
        }, { status: 422 })
      }
    }
  }

  // A sheet with exactly one animal behind it settles which carcass the piece
  // came off — that is arithmetic, not a guess, so the pin sets itself. More
  // than one stays null for a person to pick on Processing → In Cure.
  let linked_harvest_id: string | null = null
  if (ciId) {
    const { data: asg } = await supabase
      .from('carcass_assignments')
      .select('harvest_log_id')
      .eq('linked_cutting_instruction_id', ciId)
    const heads = [...new Set((asg ?? []).map(a => String(a.harvest_log_id ?? '')).filter(Boolean))]
    if (heads.length === 1) linked_harvest_id = heads[0]
  }

  const { data, error } = await supabase
    .from('cure_tags')
    .insert([{
      tag_number,
      product,
      customer_name,
      session_date: session_date || null,
      weight_lbs:   weight_lbs ?? null,
      linked_cutting_instruction_id: ciId,
      linked_harvest_id,
    }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/cure-tags — status flip (done stamps completed_at) or field edits
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, status, product, weight_lbs, notes, linked_harvest_id } = body as {
    id: string; status?: 'curing' | 'done'; product?: string
    weight_lbs?: number | null; notes?: string | null
    linked_harvest_id?: string | null
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (status)                    { updates.status = status; updates.completed_at = status === 'done' ? new Date().toISOString() : null }
  if (product !== undefined)     updates.product = product
  if (weight_lbs !== undefined)  updates.weight_lbs = weight_lbs
  if (notes !== undefined)       updates.notes = notes
  // null unpins — a wrong animal has to be as easy to take back as to set.
  if (linked_harvest_id !== undefined) updates.linked_harvest_id = linked_harvest_id || null

  const { data, error } = await supabase
    .from('cure_tags').update(updates).eq('id', id).select().single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/cure-tags?id=... — a mis-scan; real finished tags flip to done
export async function DELETE(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabase.from('cure_tags').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
