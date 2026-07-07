export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { getCloverItems, updateCloverItem, type CloverItem } from '@/lib/clover'

// App -> Clover push (app-as-master). POST body:
//   { dryRun: true }                       -> diff only, nothing written
//   { dryRun: false, keys: ["<cloverItemId>:<field>", ...], pushNames: bool }
//                                          -> push those changes, log to clover_push_log
// Fields: price (from retail_price), name (ALL CAPS, gated by pushNames), code
// (weight-embedded barcode lookup: '2' + 5-digit zero-padded PLU).
//
// Barcode rule: a Clover item may hold code 2PPPPP only if it is LINKED to
// active PLU P. Any other item holding such a code makes scale labels for P
// ring up the wrong product — those get a clear ('') change. Codes that decode
// to PLUs the scale no longer prints are left alone (old freezer stock still
// scans against them; they can't collide with new labels).

interface Change {
  key: string        // `${cloverItemId}:${field}` — selection handle
  pluId: string      // '' for clears on unlinked Clover items
  pluNumber: string
  itemName: string
  cloverItemId: string
  cloverName: string
  field: 'price' | 'name' | 'code'
  from: string
  to: string
  syncSku?: boolean  // code changes: also mirror into sku (store convention)
}

const codeForPlu = (plu: string) =>
  /^\d{1,5}$/.test(plu) ? '2' + plu.padStart(5, '0') : null

async function computeDiff(): Promise<{ changes: Change[]; skipped: string[] }> {
  const [{ data: plus, error }, cloverItems] = await Promise.all([
    supabase
      .from('plu_items')
      .select('id, plu_number, item_name, retail_price, clover_item_id, active')
      .eq('active', true),
    getCloverItems(),
  ])
  if (error) throw new Error(error.message)

  const cloverById = new Map(cloverItems.map(c => [c.id, c]))
  const linkedCloverIdByPlu = new Map<string, string>() // plu_number -> clover item id
  for (const p of plus ?? []) if (p.clover_item_id) linkedCloverIdByPlu.set(p.plu_number, p.clover_item_id)
  const activePluByNumber = new Map((plus ?? []).map(p => [p.plu_number, p]))

  const changes: Change[] = []
  const skipped: string[] = []
  const mkKey = (cloverItemId: string, field: string) => `${cloverItemId}:${field}`
  const skuMirror = (c: CloverItem) => !c.sku || c.sku === c.code

  // Linked items: price, name, code
  for (const p of plus ?? []) {
    if (!p.clover_item_id) continue
    const c = cloverById.get(p.clover_item_id)
    if (!c) { skipped.push(`${p.item_name}: linked Clover item no longer exists`); continue }

    if (p.retail_price == null || p.retail_price <= 0) {
      skipped.push(`${p.item_name}: no retail price in app`)
    } else {
      const targetCents = Math.round(p.retail_price * 100)
      if (targetCents !== c.price) {
        changes.push({
          key: mkKey(c.id, 'price'), pluId: p.id, pluNumber: p.plu_number, itemName: p.item_name,
          cloverItemId: c.id, cloverName: c.name, field: 'price',
          from: `$${(c.price / 100).toFixed(2)}`, to: `$${(targetCents / 100).toFixed(2)}`,
        })
      }
    }

    const targetName = p.item_name.toUpperCase()
    if (targetName !== c.name) {
      changes.push({
        key: mkKey(c.id, 'name'), pluId: p.id, pluNumber: p.plu_number, itemName: p.item_name,
        cloverItemId: c.id, cloverName: c.name, field: 'name',
        from: c.name, to: targetName,
      })
    }

    const targetCode = codeForPlu(p.plu_number)
    if (targetCode === null) {
      skipped.push(`${p.item_name}: PLU ${p.plu_number} too long for a weighed barcode code`)
    } else if ((c.code ?? '') !== targetCode) {
      changes.push({
        key: mkKey(c.id, 'code'), pluId: p.id, pluNumber: p.plu_number, itemName: p.item_name,
        cloverItemId: c.id, cloverName: c.name, field: 'code',
        from: c.code || '(none)', to: targetCode, syncSku: skuMirror(c),
      })
    }
  }

  // Unlinked Clover items holding a code that decodes to an ACTIVE PLU:
  // scale labels for that PLU would ring this (different) product — clear it.
  const linkedCloverIds = new Set(linkedCloverIdByPlu.values())
  for (const c of cloverItems) {
    if (linkedCloverIds.has(c.id)) continue               // linked items get their code corrected above
    const code = c.code ?? ''
    if (!/^2\d{5}$/.test(code)) continue
    const plu = String(parseInt(code.slice(1), 10))
    const owner = activePluByNumber.get(plu)
    if (!owner) continue                                  // decodes to nothing current — inert, leave
    changes.push({
      key: mkKey(c.id, 'code'), pluId: '', pluNumber: plu, itemName: `(misfires as: ${owner.item_name})`,
      cloverItemId: c.id, cloverName: c.name, field: 'code',
      from: code, to: '', syncSku: skuMirror(c),
    })
  }

  return { changes, skipped }
}

export async function POST(req: NextRequest) {
  try {
    const { dryRun, keys, pushNames } = await req.json()
    const { changes, skipped } = await computeDiff()

    if (dryRun !== false) {
      return NextResponse.json({ dryRun: true, changes, skipped })
    }

    const wanted = new Set<string>(keys ?? [])
    const toPush = changes.filter(ch => wanted.has(ch.key) && (ch.field !== 'name' || pushNames === true))
    if (toPush.length === 0) {
      return NextResponse.json({ error: 'Nothing selected to push' }, { status: 400 })
    }

    // Group by Clover item so multiple fields land in one API call
    const byItem = new Map<string, Change[]>()
    for (const ch of toPush) byItem.set(ch.cloverItemId, [...(byItem.get(ch.cloverItemId) ?? []), ch])

    const results = []
    const logWarnings: string[] = []
    for (const [cloverItemId, chs] of byItem) {
      const fields: { name?: string; price?: number; code?: string; syncSku?: boolean } = {}
      for (const ch of chs) {
        if (ch.field === 'price') fields.price = Math.round(parseFloat(ch.to.slice(1)) * 100)
        if (ch.field === 'name') fields.name = ch.to
        if (ch.field === 'code') { fields.code = ch.to; fields.syncSku = ch.syncSku }
      }
      let status = 'ok', errMsg = ''
      try {
        await updateCloverItem(cloverItemId, fields)
      } catch (e) {
        status = 'error'
        errMsg = e instanceof Error ? e.message : String(e)
      }
      for (const ch of chs) {
        results.push({ ...ch, status, error: errMsg })
      }
      const { error: logError } = await supabase.from('clover_push_log').insert(chs.map(ch => ({
        plu_id: ch.pluId || null,
        plu_number: ch.pluNumber,
        item_name: ch.itemName,
        clover_item_id: cloverItemId,
        field: ch.field,
        old_value: ch.from,
        new_value: ch.to,
        status,
        error: errMsg,
      })))
      if (logError) logWarnings.push(logError.message)
    }

    const failed = results.filter(r => r.status === 'error').length
    return NextResponse.json({
      dryRun: false,
      pushed: results.length - failed,
      failed,
      results,
      // Pushes succeeded but the audit trail didn't — surface it, don't hide it.
      logWarning: logWarnings.length ? `Push log write failed: ${[...new Set(logWarnings)].join('; ')}` : undefined,
    })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// GET /api/clover/push — recent push history
export async function GET() {
  const { data, error } = await supabase
    .from('clover_push_log')
    .select('*')
    .order('created_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}
