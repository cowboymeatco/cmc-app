export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { extractValueAdd } from '@/lib/valueAdd'
import { aliasMap, nameKeyWith, type CustomerNameAlias } from '@/lib/nameKey'
import { CureTag } from '@/lib/types'

export const dynamic = 'force-dynamic'

// A tag's product → the product name extractValueAdd emits, so the tag list can
// show what the customer's cut sheet says to do with the piece once it's cured.
const SHEET_PRODUCT: Record<string, string> = {
  'Ham':            'Cured & Smoked Ham',
  'Bacon':          'Bacon',
  'Shoulder Bacon': 'Shoulder Bacon',
  'Bone-In Loin':   'Smoked Chops',
  'Hocks':          'Cured & Smoked Hocks',
}

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
  const { data: cis } = await supabase
    .from('cutting_instructions')
    .select('customer_name, species, data, created_at')
    .neq('status', 'archived')
    .order('created_at', { ascending: true })
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
  const sheetsByName = new Map<string, { species: string | null; data: unknown }[]>()
  for (const ci of cis ?? []) {
    const k = key(ci.customer_name as string)
    if (!k) continue
    const list = sheetsByName.get(k) ?? []
    list.unshift({ species: ci.species as string | null, data: ci.data })
    sheetsByName.set(k, list)
  }

  const withInstructions = (tags as CureTag[]).map(tag => {
    const sheets = sheetsByName.get(key(tag.customer_name))
    if (!sheets?.length) return { ...tag, instruction: null, sheetFound: false }
    const wanted = SHEET_PRODUCT[tag.product]
    if (!wanted) return { ...tag, instruction: null, sheetFound: true }
    for (const sheet of sheets) {
      const item = extractValueAdd(sheet.species, sheet.data).find(it => it.product === wanted)
      if (item) return { ...tag, instruction: item.detail ?? 'On sheet — no cut style given', sheetFound: true }
    }
    return { ...tag, instruction: null, sheetFound: true }
  })
  return NextResponse.json(withInstructions)
}

// POST /api/cure-tags — tag a piece in from the scanner.
// A seal is single-use: if the number already exists the existing row comes
// back with 409 so the floor sees whose piece it is instead of double-tagging.
export async function POST(req: NextRequest) {
  const body = await req.json()
  const { tag_number, product, customer_name, session_date, weight_lbs } = body as {
    tag_number: string; product: string; customer_name: string
    session_date?: string; weight_lbs?: number | null
  }
  if (!tag_number || !product || !customer_name) {
    return NextResponse.json({ error: 'tag_number, product and customer_name required' }, { status: 400 })
  }

  const { data: existing } = await supabase
    .from('cure_tags').select('*').eq('tag_number', tag_number).maybeSingle()
  if (existing) return NextResponse.json(existing, { status: 409 })

  const { data, error } = await supabase
    .from('cure_tags')
    .insert([{
      tag_number,
      product,
      customer_name,
      session_date: session_date || null,
      weight_lbs:   weight_lbs ?? null,
    }])
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/cure-tags — status flip (done stamps completed_at) or field edits
export async function PATCH(req: NextRequest) {
  const body = await req.json()
  const { id, status, product, weight_lbs, notes } = body as {
    id: string; status?: 'curing' | 'done'; product?: string
    weight_lbs?: number | null; notes?: string | null
  }
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const updates: Record<string, unknown> = {}
  if (status)                    { updates.status = status; updates.completed_at = status === 'done' ? new Date().toISOString() : null }
  if (product !== undefined)     updates.product = product
  if (weight_lbs !== undefined)  updates.weight_lbs = weight_lbs
  if (notes !== undefined)       updates.notes = notes

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
