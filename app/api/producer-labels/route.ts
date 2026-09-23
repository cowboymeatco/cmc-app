export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import {
  LABEL_FORMAT_RE, PRODUCER_BLOCK_LAST, PRODUCER_BLOCK_MIN, PRODUCER_BLOCK_SIZE,
  assignPluNumbers, labelKey, nextBlockStart, type ScannerProducerSet,
} from '@/lib/producerLabels'

// Producer label sets — see scripts/2026-09-23_producer_labels.sql.
//
// GET                → every set with its PLUs, and the cutting cards that name
//                      it (so the page can say whether it needs to be on the
//                      scale), plus card labels no set answers to yet.
// GET ?scanner=1     → the compact form the scanner translates scans with.
// POST {action, …}   → create_set | update_set | delete_set | add_items |
//                      remove_item | rename_item

interface SetRow {
  id: string; name: string; label_format: string | null; plu_block_start: number
  loaded_at: string | null; notes: string | null; created_at: string
}
interface ItemRow { id: string; producer_label_id: string; house_plu: string; plu_number: string; item_name: string }

async function loadSets() {
  const [sets, items] = await Promise.all([
    supabaseAdmin.from('producer_labels').select('*').order('name'),
    supabaseAdmin.from('producer_plu_items').select('id, producer_label_id, house_plu, plu_number, item_name'),
  ])
  if (sets.error) throw new Error(sets.error.message)
  if (items.error) throw new Error(items.error.message)
  return { sets: (sets.data ?? []) as SetRow[], items: (items.data ?? []) as ItemRow[] }
}

async function usedNumbers(): Promise<Set<number>> {
  const { data, error } = await supabaseAdmin.from('v_used_plu_numbers').select('plu_number')
  if (error) throw new Error(error.message)
  const out = new Set<number>()
  for (const r of data ?? []) {
    const n = Number(r.plu_number)
    if (Number.isInteger(n)) out.add(n)
  }
  return out
}

export async function GET(req: NextRequest) {
  try {
    const { sets, items } = await loadSets()
    const bySet = new Map<string, ItemRow[]>()
    for (const it of items) {
      const arr = bySet.get(it.producer_label_id) ?? []
      arr.push(it)
      bySet.set(it.producer_label_id, arr)
    }
    const byNum = (a: ItemRow, b: ItemRow) => Number(a.plu_number) - Number(b.plu_number)

    if (new URL(req.url).searchParams.get('scanner')) {
      const out: ScannerProducerSet[] = sets.map(s => ({
        name: s.name, key: labelKey(s.name), label_format: s.label_format, loaded_at: s.loaded_at,
        items: (bySet.get(s.id) ?? []).map(i => ({ plu_number: i.plu_number, house_plu: i.house_plu })),
      }))
      return NextResponse.json({ sets: out })
    }

    // House names beside each producer PLU, so a renamed or deleted house item
    // shows up here instead of at the scale.
    const housePlus = [...new Set(items.map(i => i.house_plu))]
    const house = housePlus.length
      ? await supabaseAdmin.from('plu_items').select('plu_number, item_name, active').in('plu_number', housePlus)
      : { data: [] as { plu_number: string; item_name: string; active: boolean }[] }
    const houseMap = new Map((house.data ?? []).map(h => [String(h.plu_number), h]))

    // Every live card that names a producer label, and how far its packing got.
    const cards = await supabaseAdmin
      .from('cutting_instructions')
      .select('id, customer_name, species, status, scale_label, data')
      .not('scale_label', 'is', null)
      .neq('status', 'archived')
    const cardRows = cards.data ?? []
    const sess = cardRows.length
      ? await supabaseAdmin.from('processing_sessions')
          .select('linked_cutting_instruction_id, status, session_date')
          .in('linked_cutting_instruction_id', cardRows.map(c => c.id))
      : { data: [] as { linked_cutting_instruction_id: string; status: string; session_date: string }[] }
    const sessByCard = new Map<string, { status: string; session_date: string }[]>()
    for (const s of sess.data ?? []) {
      const arr = sessByCard.get(s.linked_cutting_instruction_id) ?? []
      arr.push(s)
      sessByCard.set(s.linked_cutting_instruction_id, arr)
    }
    const cardView = (c: typeof cardRows[number]) => {
      const ss = sessByCard.get(c.id) ?? []
      return {
        id: c.id,
        customer: (c.data?.customerName as string) ?? c.customer_name ?? '—',
        species: c.species ?? (c.data?.species as string) ?? '',
        kill_date: (c.data?.killDate as string) ?? null,
        // A session that moved past scanning is an animal that's been packed.
        packing: ss.some(s => s.status === 'scanning'),
        packed:  ss.length > 0 && ss.every(s => s.status !== 'scanning'),
      }
    }
    const setKeys = new Set(sets.map(s => labelKey(s.name)))
    const unmatched = new Map<string, { label: string; cards: number }>()
    for (const c of cardRows) {
      const k = labelKey(c.scale_label)
      if (!k || setKeys.has(k)) continue
      const u = unmatched.get(k) ?? { label: String(c.scale_label).trim(), cards: 0 }
      u.cards += 1
      unmatched.set(k, u)
    }

    return NextResponse.json({
      sets: sets.map(s => ({
        ...s,
        items: (bySet.get(s.id) ?? []).sort(byNum).map(i => ({
          ...i,
          house_name: houseMap.get(i.house_plu)?.item_name ?? null,
          house_active: houseMap.get(i.house_plu)?.active ?? false,
        })),
        cards: cardRows.filter(c => labelKey(c.scale_label) === labelKey(s.name)).map(cardView),
      })),
      unmatched: [...unmatched.values()],
    })
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

const bad = (msg: string) => NextResponse.json({ error: msg }, { status: 400 })

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as Record<string, unknown>
  const action = String(body.action ?? '')
  try {
    if (action === 'create_set') {
      const name = String(body.name ?? '').trim()
      if (!name) return bad('A producer label needs a name')
      const fmt = String(body.label_format ?? '').trim()
      if (fmt && !LABEL_FORMAT_RE.test(fmt)) return bad('Label format is the number the scale uses, e.g. 510')
      const { sets } = await loadSets()
      if (sets.some(s => labelKey(s.name) === labelKey(name))) return bad(`There is already a set called ${name}`)
      let start = body.plu_block_start != null && String(body.plu_block_start).trim() !== ''
        ? Number(body.plu_block_start) : null
      const used = await usedNumbers()
      if (start == null) {
        start = nextBlockStart(sets.map(s => s.plu_block_start), used)
        if (start == null) return bad('No free block of PLU numbers left under 100000')
      } else if (!Number.isInteger(start) || start < PRODUCER_BLOCK_MIN || start > PRODUCER_BLOCK_LAST || start % PRODUCER_BLOCK_SIZE !== 0) {
        return bad(`A block starts on a thousand between ${PRODUCER_BLOCK_MIN} and ${PRODUCER_BLOCK_LAST}`)
      } else if (sets.some(s => s.plu_block_start === start)) {
        return bad(`${start} is already another producer's block`)
      }
      const { data, error } = await supabaseAdmin.from('producer_labels')
        .insert({ name, label_format: fmt || null, plu_block_start: start, notes: String(body.notes ?? '').trim() || null })
        .select().single()
      if (error) return bad(error.message)
      return NextResponse.json(data)
    }

    const id = String(body.id ?? '')

    if (action === 'update_set') {
      if (!id) return bad('id required')
      const patch: Record<string, unknown> = {}
      if (body.name !== undefined) {
        const name = String(body.name ?? '').trim()
        if (!name) return bad('A producer label needs a name')
        patch.name = name
      }
      if (body.label_format !== undefined) {
        const fmt = String(body.label_format ?? '').trim()
        if (fmt && !LABEL_FORMAT_RE.test(fmt)) return bad('Label format is the number the scale uses, e.g. 510')
        patch.label_format = fmt || null
      }
      if (body.notes !== undefined) patch.notes = String(body.notes ?? '').trim() || null
      // Someone confirming the set is on the scales (true), or has come off (false).
      if (body.loaded !== undefined) patch.loaded_at = body.loaded ? new Date().toISOString() : null
      if (!Object.keys(patch).length) return bad('nothing to update')
      const { data, error } = await supabaseAdmin.from('producer_labels').update(patch).eq('id', id).select().single()
      if (error) return bad(error.message)
      return NextResponse.json(data)
    }

    if (action === 'delete_set') {
      if (!id) return bad('id required')
      const { data: s } = await supabaseAdmin.from('producer_labels').select('loaded_at').eq('id', id).maybeSingle()
      // Its PLUs would still be on the scale with nothing in the app to read them.
      if (s?.loaded_at) return bad('This set is marked as on the scales — take it off and mark it removed first')
      const { error } = await supabaseAdmin.from('producer_labels').delete().eq('id', id)
      if (error) return bad(error.message)
      return NextResponse.json({ ok: true })
    }

    if (action === 'add_items') {
      if (!id) return bad('id required')
      const wanted = [...new Set((Array.isArray(body.house_plus) ? body.house_plus : []).map(String))]
      if (!wanted.length) return bad('Pick at least one house PLU')
      const { data: set } = await supabaseAdmin.from('producer_labels').select('*').eq('id', id).maybeSingle()
      if (!set) return bad('No such set')
      const { data: have } = await supabaseAdmin.from('producer_plu_items').select('house_plu').eq('producer_label_id', id)
      const already = new Set((have ?? []).map(h => h.house_plu))
      const { data: house } = await supabaseAdmin.from('plu_items')
        .select('plu_number, item_name, active').in('plu_number', wanted.filter(p => !already.has(p)))
      const fresh = (house ?? []).filter(h => h.active !== false)
        .sort((a, b) => Number(a.plu_number) - Number(b.plu_number))
      if (!fresh.length) return NextResponse.json({ added: 0 })
      const numbers = assignPluNumbers(set.plu_block_start, await usedNumbers(), fresh.length)
      if (numbers.length < fresh.length) return bad(`Only ${numbers.length} numbers left in this producer's block`)
      const rows = fresh.map((h, i) => ({
        producer_label_id: id, house_plu: String(h.plu_number),
        plu_number: String(numbers[i]), item_name: h.item_name,
      }))
      const { error } = await supabaseAdmin.from('producer_plu_items').insert(rows)
      if (error) return bad(error.message)
      return NextResponse.json({ added: rows.length })
    }

    if (action === 'remove_item') {
      const itemId = String(body.item_id ?? '')
      if (!itemId) return bad('item_id required')
      // Its number would free up while the scale still prints it.
      const { data: it } = await supabaseAdmin.from('producer_plu_items')
        .select('producer_labels(loaded_at)').eq('id', itemId).maybeSingle()
      const loaded = (it as { producer_labels?: { loaded_at: string | null } | null } | null)?.producer_labels?.loaded_at
      if (loaded) return bad('This set is marked as on the scales — take it off and mark it removed before dropping a PLU')
      const { error } = await supabaseAdmin.from('producer_plu_items').delete().eq('id', itemId)
      if (error) return bad(error.message)
      return NextResponse.json({ ok: true })
    }

    if (action === 'rename_item') {
      const itemId = String(body.item_id ?? '')
      const name = String(body.item_name ?? '').trim()
      if (!itemId || !name) return bad('item_id and item_name required')
      const { error } = await supabaseAdmin.from('producer_plu_items').update({ item_name: name }).eq('id', itemId)
      if (error) return bad(error.message)
      return NextResponse.json({ ok: true })
    }

    return bad(`unknown action ${action}`)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}
