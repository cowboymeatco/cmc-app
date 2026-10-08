import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { isoDate, isoDateTime, addDaysISO } from '@/lib/dates'
import type { Shift } from '@/lib/timekeeping'
import type { Schedule, TimeOffRequest, TkEmployee } from '@/lib/timeclock'
import { schedKey } from '@/lib/timeclock'

// Server side of the time clock (/timekeeping). Everything goes through the
// service role: the tk_* tables are RLS-on with no policies.
//
// Two doors:
//   • The kiosk (the iPad at the employee entrance). You tap your name on the
//     roster and enter your PIN; the PIN is checked against that one person,
//     so two people can share a PIN. A correct PIN mints a short-lived session;
//     every punch and request carries it, and acts only on that one employee.
//     Times are stamped here, on the shop clock — the iPad never says what
//     time it is. Someone not set up yet signs in once with the shared setup
//     PIN and picks their own before they can punch.
//   • Managers. The /api/timekeeping/* routes sit behind requireExec, the
//     same passphrase gate as /exec.

export const KIOSK_HEADER = 'x-timeclock-token'
const KIOSK_SESSION_MIN = 10          // renewed on every call
// The roster tells anyone whose PIN they're guessing at, so the lockout is per
// person, and long enough that walking a 4-digit PIN takes weeks, not minutes.
const LOCKOUT_FAILS = 5               // wrong PINs for one person…
const LOCKOUT_WINDOW_MIN = 15         // …within this many minutes locks that person out
const SPRAY_FAILS = 25                // wrong PINs across everyone in 5 min locks the keypad
export const PHOTO_BUCKET = 'timeclock-photos'

// ── Clock ───────────────────────────────────────────────────────────────────

/** Shop date and HH:MM right now. */
export function shopNow(): { date: string; time: string } {
  return { date: isoDate(), time: isoDateTime().slice(11) }
}

// ── PINs ────────────────────────────────────────────────────────────────────

let pepperCache: string | null = null
async function pepper(): Promise<string> {
  if (pepperCache) return pepperCache
  const { data, error } = await supabaseAdmin.from('tk_config').select('value').eq('key', 'pin_pepper').single()
  if (error || !data) throw new Error('Time clock not configured (tk_config.pin_pepper missing)')
  pepperCache = data.value as string
  return pepperCache
}

async function hmacHex(text: string): Promise<string> {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(await pepper()), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text))
  return Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('')
}

/** HMAC of the PIN under a server-held key, salted with the employee id — the same PIN hashes differently for two people. */
export const hashPin = (employeeId: string, pin: string) => hmacHex(`${employeeId}:${pin}`)
/** The first release hashed the bare PIN. Still accepted, and upgraded on use. */
const legacyHashPin = (pin: string) => hmacHex(pin)
const hashSetupPin = (pin: string) => hmacHex(`setup:${pin}`)

export const validPin = (pin: unknown): pin is string => typeof pin === 'string' && /^\d{4}$/.test(pin)

/** PINs anyone would guess first: 0000, 1111, 1234, 4321, 2468… */
export function weakPin(pin: string): boolean {
  const d = pin.split('').map(Number)
  const steps = d.slice(1).map((x, i) => x - d[i])
  return steps.every(x => x === steps[0]) && Math.abs(steps[0]) <= 2
}

/** Does `pin` open this employee? Upgrades a legacy hash in place when it matches. */
export async function checkEmployeePin(employeeId: string, storedHash: string | null, pin: string): Promise<boolean> {
  if (!storedHash) return false
  if (storedHash === await hashPin(employeeId, pin)) return true
  if (storedHash === await legacyHashPin(pin)) {
    await supabaseAdmin.from('tk_employees').update({ pin_hash: await hashPin(employeeId, pin) }).eq('id', employeeId)
    return true
  }
  return false
}

// The shared setup ("dummy") PIN: what someone not set up yet signs in with,
// once, to pick their own. Set by a manager on the Employees tab.
export async function setupPinIsSet(): Promise<boolean> {
  const { data } = await supabaseAdmin.from('tk_config').select('key').eq('key', 'setup_pin_hash').maybeSingle()
  return !!data
}
export async function checkSetupPin(pin: string): Promise<boolean> {
  const { data } = await supabaseAdmin.from('tk_config').select('value').eq('key', 'setup_pin_hash').maybeSingle()
  return !!data && data.value === await hashSetupPin(pin)
}
export async function saveSetupPin(pin: string): Promise<void> {
  const { error } = await supabaseAdmin.from('tk_config').upsert({ key: 'setup_pin_hash', value: await hashSetupPin(pin) })
  if (error) throw new Error(error.message)
}

export async function pinLocked(employeeId: string): Promise<boolean> {
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MIN * 60_000).toISOString()
  const spraySince = new Date(Date.now() - 5 * 60_000).toISOString()
  const [{ count: mine }, { count: all }] = await Promise.all([
    supabaseAdmin.from('tk_pin_failures').select('id', { count: 'exact', head: true }).eq('employee_id', employeeId).gte('at', since),
    supabaseAdmin.from('tk_pin_failures').select('id', { count: 'exact', head: true }).gte('at', spraySince),
  ])
  return (mine ?? 0) >= LOCKOUT_FAILS || (all ?? 0) >= SPRAY_FAILS
}

export const LOCKOUT_MESSAGE = `Too many wrong PINs. Try again in ${LOCKOUT_WINDOW_MIN} minutes, or ask a manager.`

export async function recordPinFailure(employeeId: string): Promise<void> {
  await supabaseAdmin.from('tk_pin_failures').insert({ employee_id: employeeId })
  // Keep the table from growing forever.
  await supabaseAdmin.from('tk_pin_failures').delete().lt('at', new Date(Date.now() - 86_400_000).toISOString())
}

/** A correct PIN wipes that person's strikes. */
export async function clearPinFailures(employeeId: string): Promise<void> {
  await supabaseAdmin.from('tk_pin_failures').delete().eq('employee_id', employeeId)
}

// ── Kiosk sessions ──────────────────────────────────────────────────────────

export async function startKioskSession(employeeId: string): Promise<string> {
  // One live session per person; signing in again replaces it.
  await supabaseAdmin.from('tk_kiosk_sessions').delete().eq('employee_id', employeeId)
  const { data, error } = await supabaseAdmin.from('tk_kiosk_sessions')
    .insert({ employee_id: employeeId, expires_at: new Date(Date.now() + KIOSK_SESSION_MIN * 60_000).toISOString() })
    .select('token').single()
  if (error || !data) throw new Error(`Couldn't start a kiosk session: ${error?.message}`)
  return data.token as string
}

export async function endKioskSession(token: string): Promise<void> {
  await supabaseAdmin.from('tk_kiosk_sessions').delete().eq('token', token)
}

export type KioskAuth = { ok: true; employee: TkEmployee; token: string } | { ok: false; response: NextResponse }

/**
 * The employee behind this request's kiosk token, or a 401. Someone who signed
 * in with the setup PIN can't do anything but pick their own PIN until they
 * have (`allowSetup` is for that one route).
 */
export async function requireKiosk(req: NextRequest, allowSetup = false): Promise<KioskAuth> {
  const token = req.headers.get(KIOSK_HEADER)
  const deny = { ok: false as const, response: NextResponse.json({ error: 'signed_out', message: 'Enter your PIN again.' }, { status: 401 }) }
  if (!token || !/^[0-9a-f-]{36}$/i.test(token)) return deny
  const { data } = await supabaseAdmin.from('tk_kiosk_sessions').select('employee_id, expires_at').eq('token', token).maybeSingle()
  if (!data || new Date(data.expires_at as string) < new Date()) return deny
  const emp = await getEmployee(data.employee_id as string)
  if (!emp || !emp.active) return deny
  if (!emp.hasPin && !allowSetup) {
    return { ok: false, response: NextResponse.json({ error: 'needs_pin', message: 'Pick your own PIN first.' }, { status: 403 }) }
  }
  await supabaseAdmin.from('tk_kiosk_sessions')
    .update({ expires_at: new Date(Date.now() + KIOSK_SESSION_MIN * 60_000).toISOString() }).eq('token', token)
  return { ok: true, employee: emp, token }
}

// ── Rows ↔ shapes ───────────────────────────────────────────────────────────

const PAGE = 1000
/**
 * PostgREST hands back at most 1000 rows per request, silently. A schedule for
 * the whole crew runs past that, so every list read pages until it's done.
 */
async function fetchAll<T>(page: (from: number, to: number) => PromiseLike<{ data: unknown; error: { message: string } | null }>): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1)
    if (error) throw new Error(error.message)
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < PAGE) return out
  }
}

export const EMP_COLS = 'id, name, role, hire_date, active, pin_hash, pin_set_at, qbo_employee_id, pto_opening_hours, pto_opening_as_of'

export interface EmpRow {
  id: string; name: string; role: string | null; hire_date: string; active: boolean; pin_hash: string | null; pin_set_at: string | null
  qbo_employee_id: string | null; pto_opening_hours: number | string; pto_opening_as_of: string
}
export function toEmployee(r: EmpRow): TkEmployee {
  return {
    id: r.id, name: r.name, role: r.role, hireDate: r.hire_date, active: r.active, hasPin: !!r.pin_hash, pinSetAt: r.pin_set_at,
    qboEmployeeId: r.qbo_employee_id, ptoOpeningHours: Number(r.pto_opening_hours), ptoOpeningAsOf: r.pto_opening_as_of,
  }
}

export async function getEmployee(id: string): Promise<TkEmployee | null> {
  const { data } = await supabaseAdmin.from('tk_employees').select(EMP_COLS).eq('id', id).maybeSingle()
  return data ? toEmployee(data as EmpRow) : null
}

export async function listEmployees(includeInactive = false): Promise<TkEmployee[]> {
  let q = supabaseAdmin.from('tk_employees').select(EMP_COLS).order('name')
  if (!includeInactive) q = q.eq('active', true)
  const { data, error } = await q
  if (error) throw new Error(error.message)
  return (data as EmpRow[]).map(toEmployee)
}

export const SHIFT_COLS = 'id, employee_id, shop_date, clock_in, clock_out, lunch_start, lunch_end, breaks, edited_at, edit_note'
interface ShiftRow {
  id: string; employee_id: string; shop_date: string; clock_in: string; clock_out: string | null
  lunch_start: string | null; lunch_end: string | null; breaks: { start: string; end: string | null }[]
  edited_at: string | null; edit_note: string | null
}
export type TkShift = Shift & { editedAt: string | null; editNote: string | null }
export function toShift(r: ShiftRow): TkShift {
  return {
    id: r.id, empId: r.employee_id, date: r.shop_date, clockIn: r.clock_in, clockOut: r.clock_out,
    lunchStart: r.lunch_start, lunchEnd: r.lunch_end, breaks: Array.isArray(r.breaks) ? r.breaks : [],
    editedAt: r.edited_at, editNote: r.edit_note,
  }
}

export async function listShifts(from: string, to: string, employeeId?: string): Promise<TkShift[]> {
  const rows = await fetchAll<ShiftRow>((a, b) => {
    let q = supabaseAdmin.from('tk_shifts').select(SHIFT_COLS).gte('shop_date', from).lte('shop_date', to)
      .order('shop_date').order('clock_in').order('id')
    if (employeeId) q = q.eq('employee_id', employeeId)
    return q.range(a, b)
  })
  return rows.map(toShift)
}

export async function listSchedule(from: string, to: string, employeeId?: string): Promise<Schedule> {
  const rows = await fetchAll<{ employee_id: string; shop_date: string; start_time: string; end_time: string }>((a, b) => {
    let q = supabaseAdmin.from('tk_schedule').select('employee_id, shop_date, start_time, end_time')
      .gte('shop_date', from).lte('shop_date', to).order('shop_date').order('employee_id')
    if (employeeId) q = q.eq('employee_id', employeeId)
    return q.range(a, b)
  })
  const s: Schedule = {}
  for (const r of rows) {
    s[schedKey(r.employee_id, r.shop_date)] = { start: r.start_time, end: r.end_time }
  }
  return s
}

interface ReqRow { id: string; employee_id: string; type: 'PTO' | 'Unpaid'; days: { date: string; hours: number }[]; note: string; status: TimeOffRequest['status']; submitted_on: string }
export async function listRequests(employeeId?: string): Promise<TimeOffRequest[]> {
  const rows = await fetchAll<ReqRow>((a, b) => {
    let q = supabaseAdmin.from('tk_time_off_requests').select('id, employee_id, type, days, note, status, submitted_on').order('created_at').order('id')
    if (employeeId) q = q.eq('employee_id', employeeId)
    return q.range(a, b)
  })
  return rows.map(r => ({
    id: r.id, empId: r.employee_id, type: r.type, days: (r.days ?? []).map(d => ({ date: d.date, hours: Number(d.hours) })),
    note: r.note, status: r.status, submitted: r.submitted_on,
  }))
}

/** Signed, short-lived URLs for punch photos, keyed `${shiftId}:${punch}`. */
export async function photoUrls(shiftIds: string[]): Promise<Record<string, string>> {
  if (!shiftIds.length) return {}
  const rows: { shift_id: string; punch: string; storage_path: string }[] = []
  // Chunked: a long list of ids would overflow the request URL.
  for (let i = 0; i < shiftIds.length; i += 100) {
    const { data } = await supabaseAdmin.from('tk_punch_photos').select('shift_id, punch, storage_path').in('shift_id', shiftIds.slice(i, i + 100))
    rows.push(...((data ?? []) as typeof rows))
  }
  if (!rows.length) return {}
  const { data: signed } = await supabaseAdmin.storage.from(PHOTO_BUCKET).createSignedUrls(rows.map(r => r.storage_path), 3600)
  const out: Record<string, string> = {}
  rows.forEach((r, i) => { const u = signed?.[i]?.signedUrl; if (u) out[`${r.shift_id}:${r.punch}`] = u })
  return out
}

/** Earliest date whose shifts a PTO balance needs: the go-live date, or two weeks back for the printout. */
export function shiftWindowStart(e: TkEmployee, today: string): string {
  const twoWeeks = addDaysISO(today, -14)
  return e.ptoOpeningAsOf < twoWeeks ? e.ptoOpeningAsOf : twoWeeks
}

export function jsonError(e: unknown, status = 500) {
  return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status })
}
