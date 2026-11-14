import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getEmployee, listEmployees } from '@/lib/timeclockServer'
import type { TkEmployee } from '@/lib/timeclock'
import type { HrAudience, HrDoc, HrDocSummary, HrManageDoc } from '@/lib/hrDocs'

// Server side of the handbook and role documents (/handbook). Everything goes
// through the service role: the hr_* tables are RLS-on with no policies.
//
// Two doors, the same two as the time clock:
//   • Employees. Tap your name, enter your time clock PIN. That mints an
//     hr_sessions row — its own table and its own header, so a handbook
//     sign-in on a phone is never good for punching the clock. Every read is
//     filtered here to what that one person may see: documents for everyone,
//     plus the ones assigned to them. Never the draft, only published copies.
//   • The manager. /api/handbook/manage/* sits behind requireExec.

export const HR_HEADER = 'x-handbook-token'
const HR_SESSION_MIN = 30   // renewed on every call; long enough to read a section between taps

const UUID = /^[0-9a-f-]{36}$/i
export const isUuid = (s: unknown): s is string => typeof s === 'string' && UUID.test(s)

// ── Employee sessions ───────────────────────────────────────────────────────

export async function startHrSession(employeeId: string): Promise<string> {
  // Sweep this person's dead sessions; live ones stay, so the iPad and a phone can both be signed in.
  await supabaseAdmin.from('hr_sessions').delete().eq('employee_id', employeeId).lt('expires_at', new Date().toISOString())
  const { data, error } = await supabaseAdmin.from('hr_sessions')
    .insert({ employee_id: employeeId, expires_at: new Date(Date.now() + HR_SESSION_MIN * 60_000).toISOString() })
    .select('token').single()
  if (error || !data) throw new Error(`Couldn't sign in: ${error?.message}`)
  return data.token as string
}

export async function endHrSession(token: string): Promise<void> {
  if (isUuid(token)) await supabaseAdmin.from('hr_sessions').delete().eq('token', token)
}

/** A reset PIN ends that person's handbook sessions too. */
export async function endHrSessionsFor(employeeId: string): Promise<void> {
  await supabaseAdmin.from('hr_sessions').delete().eq('employee_id', employeeId)
}

export type HrAuth = { ok: true; employee: TkEmployee; token: string } | { ok: false; response: NextResponse }

/** The employee behind this request's handbook token, or a 401. */
export async function requireHr(req: NextRequest): Promise<HrAuth> {
  const token = req.headers.get(HR_HEADER)
  const deny = { ok: false as const, response: NextResponse.json({ error: 'signed_out', message: 'Enter your PIN again.' }, { status: 401 }) }
  if (!isUuid(token)) return deny
  const { data } = await supabaseAdmin.from('hr_sessions').select('employee_id, expires_at').eq('token', token).maybeSingle()
  if (!data || new Date(data.expires_at as string) < new Date()) return deny
  const emp = await getEmployee(data.employee_id as string)
  if (!emp || !emp.active || !emp.hasPin) return deny
  await supabaseAdmin.from('hr_sessions')
    .update({ expires_at: new Date(Date.now() + HR_SESSION_MIN * 60_000).toISOString() }).eq('token', token)
  return { ok: true, employee: emp, token }
}

// ── What an employee may see ────────────────────────────────────────────────

interface DocRow {
  id: string; title: string; audience: HrAudience; body: string; published_version: number
  archived: boolean; created_at: string; updated_at: string
}
interface VersionRow { document_id: string; version: number; title: string; body: string; published_at: string }

async function assignedDocIds(employeeId: string): Promise<Set<string>> {
  const { data, error } = await supabaseAdmin.from('hr_document_assignments').select('document_id').eq('employee_id', employeeId)
  if (error) throw new Error(error.message)
  return new Set((data ?? []).map(r => r.document_id as string))
}

/** Published, not archived, and either for everyone or assigned to this person. */
async function visibleDocRows(employeeId: string): Promise<DocRow[]> {
  const [{ data, error }, mine] = await Promise.all([
    supabaseAdmin.from('hr_documents').select('id, title, audience, published_version, archived').eq('archived', false).gt('published_version', 0),
    assignedDocIds(employeeId),
  ])
  if (error) throw new Error(error.message)
  return ((data ?? []) as DocRow[]).filter(d => d.audience === 'everyone' || mine.has(d.id))
}

/** The handbook first, then role documents, each by title. */
const byShelf = (a: { audience: HrAudience; title: string }, b: { audience: HrAudience; title: string }) =>
  a.audience !== b.audience ? (a.audience === 'everyone' ? -1 : 1) : a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' })

export async function listVisibleDocs(employeeId: string): Promise<HrDocSummary[]> {
  const docs = await visibleDocRows(employeeId)
  if (!docs.length) return []
  const ids = docs.map(d => d.id)
  const [{ data: versions, error: vErr }, { data: acks, error: aErr }] = await Promise.all([
    supabaseAdmin.from('hr_document_versions').select('document_id, version, title, published_at').in('document_id', ids),
    supabaseAdmin.from('hr_acknowledgments').select('document_id, version, acknowledged_at').eq('employee_id', employeeId).in('document_id', ids),
  ])
  if (vErr) throw new Error(vErr.message)
  if (aErr) throw new Error(aErr.message)
  const out: HrDocSummary[] = []
  for (const d of docs) {
    const v = (versions ?? []).find(r => r.document_id === d.id && r.version === d.published_version)
    if (!v) continue
    const ack = (acks ?? []).find(r => r.document_id === d.id && r.version === d.published_version)
    out.push({
      id: d.id, title: v.title as string, audience: d.audience, version: d.published_version,
      publishedAt: v.published_at as string, acknowledgedAt: (ack?.acknowledged_at as string | undefined) ?? null,
    })
  }
  return out.sort(byShelf)
}

/** One document, as published — or null if this person may not see it. */
export async function getVisibleDoc(employeeId: string, docId: string): Promise<HrDoc | null> {
  const summary = (await listVisibleDocs(employeeId)).find(d => d.id === docId)
  if (!summary) return null
  const { data, error } = await supabaseAdmin.from('hr_document_versions').select('body')
    .eq('document_id', docId).eq('version', summary.version).maybeSingle()
  if (error) throw new Error(error.message)
  return data ? { ...summary, body: data.body as string } : null
}

/**
 * "I've read this." Records the version the person had open. If a newer one
 * was published while they were reading, refuse — they acknowledge what is
 * current, not what it used to say.
 */
export async function acknowledge(employeeId: string, docId: string, version: number): Promise<{ ok: true; acknowledgedAt: string } | { ok: false; message: string }> {
  const doc = (await listVisibleDocs(employeeId)).find(d => d.id === docId)
  if (!doc) return { ok: false, message: 'That document isn\'t available to you.' }
  if (doc.version !== version) return { ok: false, message: 'This document was updated while you were reading. Reload it and read the new version.' }
  if (doc.acknowledgedAt) return { ok: true, acknowledgedAt: doc.acknowledgedAt }
  const { data, error } = await supabaseAdmin.from('hr_acknowledgments')
    .upsert({ document_id: docId, version, employee_id: employeeId }, { onConflict: 'document_id,version,employee_id', ignoreDuplicates: true })
    .select('acknowledged_at').maybeSingle()
  if (error) throw new Error(error.message)
  if (data) return { ok: true, acknowledgedAt: data.acknowledged_at as string }
  // Two taps raced and the other one wrote the row; read it back.
  const { data: existing } = await supabaseAdmin.from('hr_acknowledgments').select('acknowledged_at')
    .eq('document_id', docId).eq('version', version).eq('employee_id', employeeId).single()
  return { ok: true, acknowledgedAt: (existing?.acknowledged_at as string) ?? new Date().toISOString() }
}

// ── Manager ─────────────────────────────────────────────────────────────────

const DOC_COLS = 'id, title, audience, body, published_version, archived, created_at, updated_at'

export async function listManageDocs(): Promise<{ docs: HrManageDoc[]; employees: { id: string; name: string; role: string | null; hasPin: boolean }[] }> {
  const [{ data: docs, error }, { data: versions, error: vErr }, { data: assigns, error: sErr }, { data: acks, error: aErr }, employees] = await Promise.all([
    supabaseAdmin.from('hr_documents').select(DOC_COLS),
    supabaseAdmin.from('hr_document_versions').select('document_id, version, title, body, published_at'),
    supabaseAdmin.from('hr_document_assignments').select('document_id, employee_id'),
    supabaseAdmin.from('hr_acknowledgments').select('document_id, version, employee_id, acknowledged_at'),
    listEmployees(),
  ])
  for (const e of [error, vErr, sErr, aErr]) if (e) throw new Error(e.message)

  const out = ((docs ?? []) as DocRow[]).map((d): HrManageDoc => {
    const v = ((versions ?? []) as VersionRow[]).find(r => r.document_id === d.id && r.version === d.published_version)
    const assignedTo = (assigns ?? []).filter(a => a.document_id === d.id).map(a => a.employee_id as string)
    const audience = employees.filter(e => d.audience === 'everyone' || assignedTo.includes(e.id))
    return {
      id: d.id, title: d.title, audience: d.audience, body: d.body,
      publishedVersion: d.published_version, publishedAt: v?.published_at ?? null,
      dirty: !v || v.title !== d.title || v.body !== d.body,
      archived: d.archived, updatedAt: d.updated_at, assignedTo,
      readers: d.published_version === 0 ? [] : audience.map(e => ({
        employeeId: e.id, name: e.name,
        acknowledgedAt: ((acks ?? []).find(a => a.document_id === d.id && a.version === d.published_version && a.employee_id === e.id)?.acknowledged_at as string | undefined) ?? null,
      })),
    }
  })
  out.sort((a, b) => (a.archived !== b.archived ? (a.archived ? 1 : -1) : byShelf(a, b)))
  return { docs: out, employees: employees.map(e => ({ id: e.id, name: e.name, role: e.role, hasPin: e.hasPin })) }
}

export const validAudience = (a: unknown): a is HrAudience => a === 'everyone' || a === 'assigned'

/** Replace who a document is assigned to. Unknown or inactive ids are dropped. */
export async function setAssignments(docId: string, employeeIds: string[]): Promise<void> {
  const active = new Set((await listEmployees()).map(e => e.id))
  const want = [...new Set(employeeIds.filter(id => isUuid(id) && active.has(id)))]
  const { data: have, error } = await supabaseAdmin.from('hr_document_assignments').select('employee_id').eq('document_id', docId)
  if (error) throw new Error(error.message)
  const current = (have ?? []).map(r => r.employee_id as string)
  const drop = current.filter(id => !want.includes(id))
  const add = want.filter(id => !current.includes(id))
  if (drop.length) {
    const { error: dErr } = await supabaseAdmin.from('hr_document_assignments').delete().eq('document_id', docId).in('employee_id', drop)
    if (dErr) throw new Error(dErr.message)
  }
  if (add.length) {
    const { error: iErr } = await supabaseAdmin.from('hr_document_assignments').insert(add.map(employee_id => ({ document_id: docId, employee_id })))
    if (iErr) throw new Error(iErr.message)
  }
}

export function jsonError(e: unknown, status = 500) {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status })
}
