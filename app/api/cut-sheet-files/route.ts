import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { graphConfigured, graphGet } from '@/lib/msGraph'
import {
  CARD_SPECIES, CUT_SHEET_BUCKET, CUT_SHEET_MAX_BYTES, type CutSheetFile,
  isLegacyFileCard, legacyCardData, storagePathFor,
} from '@/lib/cutSheetFiles'

// Old cutting instructions → files on producer records. See lib/cutSheetFiles.ts.
//
// Node runtime, not edge: the SharePoint import pulls a whole scan (≈800 KB,
// Office Lens photos a few MB) into memory and pushes it into the bucket, and
// a folder listing can mean a handful of Graph calls in a row.
//
// GET  ?drives=1                → the SharePoint sites / OneDrives the app can see
// GET  ?drive=ID&item=ID|root   → one folder: subfolders + files, flagged if imported
// GET  ?drive=ID&search=text    → files anywhere in that drive matching the text
// GET  ?card=ID                 → the files on one card, each with a 5-minute link
// POST {intent:'import', …}     → copy a drive item into the bucket + make the card
// POST {intent:'sign', …}       → signed slot for a browser upload (like /haccp/documents)
// POST {intent:'register', …}   → the card + file row once that upload landed
// DELETE ?card=ID               → undo: the card, its file rows, and the objects
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

interface DriveItem {
  id: string
  name: string
  size?: number
  webUrl?: string
  lastModifiedDateTime?: string
  file?: { mimeType?: string }
  folder?: { childCount?: number }
  parentReference?: { driveId?: string; id?: string; path?: string; name?: string }
  '@microsoft.graph.downloadUrl'?: string
}
interface Page<T> { value: T[]; '@odata.nextLink'?: string }

function bad(msg: string, status = 400) { return NextResponse.json({ error: msg }, { status }) }

// A folder's path as the office knows it: "Shared Documents/USB Drive/…", not
// "/drive/root:/USB Drive/…".
function folderPath(parent?: DriveItem['parentReference']): string {
  const raw = parent?.path ?? ''
  const i = raw.indexOf('root:')
  return i === -1 ? '' : decodeURIComponent(raw.slice(i + 5)).replace(/^\//, '')
}

function itemView(it: DriveItem, driveId: string) {
  return {
    id: it.id,
    drive_id: driveId,
    name: it.name,
    size: it.size ?? null,
    folder: !!it.folder,
    child_count: it.folder?.childCount ?? null,
    mime: it.file?.mimeType ?? null,
    modified: it.lastModifiedDateTime ?? null,
    web_url: it.webUrl ?? null,
    path: folderPath(it.parentReference),
  }
}

// Every drive item in a listing, following @odata.nextLink, capped so a
// 5,000-file dump can't pin the function.
async function allPages(first: string, cap = 2000): Promise<DriveItem[]> {
  const out: DriveItem[] = []
  let next: string | undefined = first
  while (next && out.length < cap) {
    const page: Page<DriveItem> = await graphGet<Page<DriveItem>>(next)
    out.push(...page.value)
    next = page['@odata.nextLink']
  }
  return out
}

// Which of these drive items already came in, by (drive, item).
async function importedMap(driveId: string, itemIds: string[]): Promise<Record<string, string>> {
  const out: Record<string, string> = {}
  for (let i = 0; i < itemIds.length; i += 200) {
    const { data } = await supabaseAdmin
      .from('cutting_instruction_files')
      .select('source_item_id, cutting_instruction_id')
      .eq('source_drive_id', driveId)
      .in('source_item_id', itemIds.slice(i, i + 200))
    for (const r of data ?? []) if (r.source_item_id) out[r.source_item_id] = r.cutting_instruction_id
  }
  return out
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams

  // ── the files on one card, with links ─────────────────────────────────────
  const card = sp.get('card')
  if (card) {
    const { data, error } = await supabaseAdmin
      .from('cutting_instruction_files')
      .select('*')
      .eq('cutting_instruction_id', card)
      .order('created_at')
    if (error) return bad(error.message, 500)
    const files = (data ?? []) as CutSheetFile[]
    const links = await Promise.all(files.map(f =>
      supabaseAdmin.storage.from(CUT_SHEET_BUCKET).createSignedUrl(f.storage_path, 300).then(r => r.data?.signedUrl ?? null)))
    return NextResponse.json(files.map((f, i) => ({ ...f, url: links[i] })))
  }

  // Everything below talks to Microsoft.
  if (!graphConfigured()) {
    return NextResponse.json({ configured: false, drives: [], items: [], imported: {} })
  }

  try {
    // ── which drives there are ──────────────────────────────────────────────
    if (sp.get('drives')) {
      const drives: { id: string; name: string; kind: 'onedrive' | 'site'; owner: string }[] = []
      const sender = process.env.MAIL_SENDER
      if (sender) {
        try {
          const d = await graphGet<{ id: string; name?: string; owner?: { user?: { displayName?: string } } }>(`/users/${encodeURIComponent(sender)}/drive`)
          drives.push({ id: d.id, name: 'OneDrive', kind: 'onedrive', owner: d.owner?.user?.displayName ?? sender })
        } catch { /* no OneDrive for that mailbox — the sites still list */ }
      }
      const sites = await graphGet<Page<{ id: string; displayName?: string; name?: string; webUrl?: string }>>(`/sites?search=*&$top=25`)
      for (const site of sites.value) {
        // Skip personal sites (OneDrives of other people) — the office keeps
        // the shared libraries on the team site.
        if (/-my\.sharepoint\.com\/personal\//.test(site.webUrl ?? '')) continue
        try {
          const libs = await graphGet<Page<{ id: string; name?: string; driveType?: string }>>(`/sites/${site.id}/drives?$select=id,name,driveType`)
          for (const lib of libs.value) {
            if (lib.driveType && lib.driveType !== 'documentLibrary') continue
            drives.push({ id: lib.id, name: lib.name ?? 'Documents', kind: 'site', owner: site.displayName ?? site.name ?? 'SharePoint' })
          }
        } catch { /* a site we can't read just doesn't list */ }
      }
      return NextResponse.json({ configured: true, drives })
    }

    const driveId = sp.get('drive')
    if (!driveId) return bad('drive required')

    // ── search a drive ─────────────────────────────────────────────────────
    const search = sp.get('search')?.trim()
    if (search) {
      const q = search.replace(/'/g, "''")
      const items = await allPages(`/drives/${encodeURIComponent(driveId)}/root/search(q='${encodeURIComponent(q)}')?$top=200&$select=id,name,size,file,folder,lastModifiedDateTime,webUrl,parentReference`, 400)
      const files = items.filter(i => i.file)
      const imported = await importedMap(driveId, files.map(f => f.id))
      return NextResponse.json({ configured: true, items: files.map(i => itemView(i, driveId)), imported })
    }

    // ── list a folder ──────────────────────────────────────────────────────
    const item = sp.get('item') || 'root'
    const base = item === 'root'
      ? `/drives/${encodeURIComponent(driveId)}/root`
      : `/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(item)}`
    const [folder, children] = await Promise.all([
      graphGet<DriveItem>(`${base}?$select=id,name,webUrl,parentReference,folder`),
      allPages(`${base}/children?$top=500&$orderby=name&$select=id,name,size,file,folder,lastModifiedDateTime,webUrl,parentReference`),
    ])
    const imported = await importedMap(driveId, children.filter(c => c.file).map(c => c.id))
    return NextResponse.json({
      configured: true,
      folder: { id: folder.id, name: item === 'root' ? '' : folder.name, path: folderPath(folder.parentReference), web_url: folder.webUrl ?? null },
      items: children.map(c => itemView(c, driveId)),
      imported,
    })
  } catch (e) {
    return bad(e instanceof Error ? e.message : 'Microsoft Graph failed', 502)
  }
}

// ── making the card ──────────────────────────────────────────────────────────

interface CardInput {
  customer_id: string
  customer_name: string
  species: string | null
  kill_date: string | null
  notes: string | null
  imported_by: string | null
}

// Common to both ways in: check the producer, pick the words for the card.
async function cardInput(body: Record<string, unknown>): Promise<CardInput | NextResponse> {
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')
  const customerId = str('customer_id')
  if (!UUID_RE.test(customerId)) return bad('Pick the producer this card belongs to first')
  const { data: cust, error } = await supabaseAdmin.from('customers').select('id, name, ranch_name').eq('id', customerId).maybeSingle()
  if (error) return bad(error.message, 500)
  if (!cust) return bad('That producer record no longer exists', 404)

  const speciesRaw = str('species')
  const species = (CARD_SPECIES as readonly string[]).includes(speciesRaw) ? speciesRaw : null
  if (speciesRaw && !species) return bad(`species must be one of ${CARD_SPECIES.join(', ')} or blank`)
  const killDate = str('kill_date')
  if (killDate && !/^\d{4}-\d{2}-\d{2}$/.test(killDate)) return bad('kill_date must be YYYY-MM-DD or blank')

  return {
    customer_id: cust.id,
    // The card names who the file says; the record it hangs on is the account.
    customer_name: str('customer_name') || cust.name,
    species,
    kill_date: killDate || null,
    notes: str('notes').slice(0, 2000) || null,
    imported_by: str('imported_by').slice(0, 80) || null,
  }
}

async function insertCardAndFile(
  input: CardInput,
  file: { filename: string; storage_path: string; mime_type: string | null; size_bytes: number | null },
  source: { source: 'sharepoint' | 'upload'; drive_id?: string | null; item_id?: string | null; url?: string | null; path?: string | null },
) {
  const data = legacyCardData({
    customerName: input.customer_name,
    species:      input.species,
    killDate:     input.kill_date,
    notes:        input.notes,
    sourceFile:   file.filename,
    sourceFolder: source.path ?? null,
    sourceUrl:    source.url ?? null,
    importedBy:   input.imported_by,
  })
  const { data: card, error: cardErr } = await supabaseAdmin
    .from('cutting_instructions')
    .insert([{
      status:        'imported',
      customer_id:   input.customer_id,
      customer_name: input.customer_name,
      species:       input.species,
      submitted_by:  'office-import',
      data,
    }])
    .select('id')
    .single()
  if (cardErr || !card) throw new Error(cardErr?.message ?? 'could not create the card')

  const { data: row, error: fileErr } = await supabaseAdmin
    .from('cutting_instruction_files')
    .insert([{
      cutting_instruction_id: card.id,
      filename:        file.filename,
      storage_path:    file.storage_path,
      mime_type:       file.mime_type,
      size_bytes:      file.size_bytes,
      source:          source.source,
      source_drive_id: source.drive_id ?? null,
      source_item_id:  source.item_id ?? null,
      source_url:      source.url ?? null,
      source_path:     source.path ?? null,
      imported_by:     input.imported_by,
    }])
    .select('*')
    .single()
  if (fileErr || !row) {
    // Don't leave a card with no file behind it.
    await supabaseAdmin.from('cutting_instructions').delete().eq('id', card.id)
    throw new Error(fileErr?.message ?? 'could not record the file')
  }
  return { card_id: card.id as string, file: row as CutSheetFile }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as Record<string, unknown> | null
  if (!body) return bad('JSON body required')
  const str = (k: string) => (typeof body[k] === 'string' ? (body[k] as string).trim() : '')

  // ── SharePoint → bucket ────────────────────────────────────────────────────
  if (body.intent === 'import') {
    if (!graphConfigured()) return bad('SharePoint is not connected on this server — see lib/cutSheetFiles.ts', 503)
    const driveId = str('drive_id'), itemId = str('item_id')
    if (!driveId || !itemId) return bad('drive_id and item_id required')

    const { data: dupe } = await supabaseAdmin
      .from('cutting_instruction_files')
      .select('cutting_instruction_id')
      .eq('source_drive_id', driveId).eq('source_item_id', itemId)
      .maybeSingle()
    if (dupe) return NextResponse.json({ error: 'already imported', card_id: dupe.cutting_instruction_id }, { status: 409 })

    const input = await cardInput(body)
    if (input instanceof NextResponse) return input

    let item: DriveItem
    try {
      item = await graphGet<DriveItem>(`/drives/${encodeURIComponent(driveId)}/items/${encodeURIComponent(itemId)}`)
    } catch (e) {
      return bad(e instanceof Error ? e.message : 'Microsoft Graph failed', 502)
    }
    if (!item.file) return bad('That is a folder, not a file')
    if ((item.size ?? 0) > CUT_SHEET_MAX_BYTES) return bad(`That file is larger than ${CUT_SHEET_MAX_BYTES / 1024 / 1024} MB`)
    const downloadUrl = item['@microsoft.graph.downloadUrl']
    if (!downloadUrl) return bad('Microsoft did not give a download link for that file', 502)

    // The download URL is pre-authenticated and short-lived; no bearer needed.
    const dl = await fetch(downloadUrl)
    if (!dl.ok) return bad(`Download failed (${dl.status})`, 502)
    const bytes = await dl.arrayBuffer()
    if (!bytes.byteLength) return bad('That file is empty')
    const mime = item.file.mimeType || dl.headers.get('content-type') || 'application/octet-stream'

    const path = storagePathFor(`sharepoint/${input.customer_id}`, item.name)
    const { error: upErr } = await supabaseAdmin.storage.from(CUT_SHEET_BUCKET)
      .upload(path, bytes, { contentType: mime, upsert: false })
    if (upErr) return bad(upErr.message, 500)

    try {
      const made = await insertCardAndFile(input,
        { filename: item.name, storage_path: path, mime_type: mime, size_bytes: bytes.byteLength },
        { source: 'sharepoint', drive_id: driveId, item_id: item.id, url: item.webUrl ?? null, path: folderPath(item.parentReference) || null })
      return NextResponse.json(made)
    } catch (e) {
      await supabaseAdmin.storage.from(CUT_SHEET_BUCKET).remove([path])
      const msg = e instanceof Error ? e.message : 'import failed'
      // The unique index on (drive, item) catches a double-click that got past
      // the check above.
      return bad(msg, /duplicate key/i.test(msg) ? 409 : 500)
    }
  }

  // ── browser upload, step 1: a slot ────────────────────────────────────────
  if (body.intent === 'sign') {
    const filename = str('filename')
    const size = Number(body.size)
    if (!filename) return bad('filename required')
    if (!(size > 0)) return bad('file is empty')
    if (size > CUT_SHEET_MAX_BYTES) return bad(`file is larger than ${CUT_SHEET_MAX_BYTES / 1024 / 1024} MB`)
    const customerId = str('customer_id')
    const path = storagePathFor(`upload/${UUID_RE.test(customerId) ? customerId : 'unassigned'}`, filename)
    const { data, error } = await supabaseAdmin.storage.from(CUT_SHEET_BUCKET).createSignedUploadUrl(path)
    if (error || !data) return bad(error?.message ?? 'could not sign upload', 500)
    return NextResponse.json({ path: data.path, token: data.token })
  }

  // ── browser upload, step 2: the card ──────────────────────────────────────
  if (body.intent === 'register') {
    const path = str('path')
    if (!path.startsWith('upload/')) return bad('path required')
    const input = await cardInput(body)
    if (input instanceof NextResponse) return input

    // Trust the bucket, not the browser, for what actually landed.
    const dir  = path.slice(0, path.lastIndexOf('/'))
    const base = path.slice(path.lastIndexOf('/') + 1)
    const { data: objs, error: listErr } = await supabaseAdmin.storage.from(CUT_SHEET_BUCKET).list(dir, { search: base, limit: 1 })
    if (listErr) return bad(listErr.message, 500)
    const obj = objs?.find(o => o.name === base)
    if (!obj) return bad('upload did not land in the bucket')
    const meta = (obj.metadata ?? {}) as { size?: number; mimetype?: string }

    try {
      const made = await insertCardAndFile(input,
        { filename: str('filename') || base, storage_path: path, mime_type: meta.mimetype || str('mime') || null, size_bytes: meta.size ?? (Number(body.size) || null) },
        { source: 'upload', path: str('source_path') || null })
      return NextResponse.json(made)
    } catch (e) {
      await supabaseAdmin.storage.from(CUT_SHEET_BUCKET).remove([path])
      return bad(e instanceof Error ? e.message : 'import failed', 500)
    }
  }

  return bad("intent must be 'import', 'sign' or 'register'")
}

// DELETE ?card=ID — undo an import. Only a migrated card: a real submitted
// card is archived or deleted on /cutting-instructions, never from here.
export async function DELETE(req: NextRequest) {
  const card = req.nextUrl.searchParams.get('card')
  if (!card) return bad('card required')
  const { data: ci, error } = await supabaseAdmin.from('cutting_instructions').select('id, data, appointment_id').eq('id', card).maybeSingle()
  if (error) return bad(error.message, 500)
  if (!ci) return NextResponse.json({ ok: true })
  if (!isLegacyFileCard(ci.data as Record<string, unknown>)) return bad('Only a migrated file card can be removed here', 400)
  if (ci.appointment_id) return bad('This card has been linked to an animal — unlink it on the cutting instructions page first', 409)

  const { data: files } = await supabaseAdmin.from('cutting_instruction_files').select('storage_path').eq('cutting_instruction_id', card)
  const paths = (files ?? []).map(f => f.storage_path)
  if (paths.length) {
    const { error: rmErr } = await supabaseAdmin.storage.from(CUT_SHEET_BUCKET).remove(paths)
    if (rmErr) return bad(rmErr.message, 500)
  }
  const { error: delErr } = await supabaseAdmin.from('cutting_instructions').delete().eq('id', card)
  if (delErr) return bad(delErr.message, 500)
  return NextResponse.json({ ok: true })
}
