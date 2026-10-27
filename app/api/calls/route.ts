import { NextRequest, NextResponse } from 'next/server'
import { isCallCategory } from '@/lib/callCategories'
// Service role: call_log is staff-only data under RLS with no anon policy
// (scripts/2026-10-27_call_log.sql). Server-side only — the key never
// reaches a browser.
import { supabaseAdmin } from '@/lib/supabaseAdmin'

const SELECT = 'id, created_at, called_at, taken_by, caller_name, caller_phone, customer_id, category, question, answer, customers ( name, ranch_name )'

// Oldest call the list and the tally go back to, in days. Everything the page
// shows is computed from one fetch, so this bounds the payload rather than
// adding a second endpoint for the counts.
const DEFAULT_DAYS = 90
const MAX_DAYS     = 730

// GET /api/calls?days=90           — calls in the window, newest first
// GET /api/calls?days=90&q=text    — ...whose caller, question or answer matches
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const daysRaw = Number(searchParams.get('days'))
  const days = Number.isFinite(daysRaw) && daysRaw > 0 ? Math.min(Math.round(daysRaw), MAX_DAYS) : DEFAULT_DAYS
  const since = new Date(Date.now() - days * 86_400_000).toISOString()
  const q = searchParams.get('q')?.trim()

  let query = supabaseAdmin
    .from('call_log')
    .select(SELECT)
    .gte('called_at', since)
    .order('called_at', { ascending: false })
    .limit(2000)

  if (q) {
    // Double-quoted so commas and parens in the search can't be read as
    // filter syntax (same guard as /api/customers).
    const pattern = `"%${q.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}%"`
    query = query.or(
      `caller_name.ilike.${pattern},caller_phone.ilike.${pattern},question.ilike.${pattern},answer.ilike.${pattern}`
    )
  }

  const { data, error } = await query
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data ?? [])
}

function clean(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null
  const s = v.trim().slice(0, max)
  return s || null
}

// POST /api/calls — log one call
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body) return NextResponse.json({ error: 'bad JSON' }, { status: 400 })

  const taken_by = clean(body.taken_by, 80)
  const question = clean(body.question, 4000)
  if (!taken_by) return NextResponse.json({ error: 'your name is required' }, { status: 400 })
  if (!isCallCategory(body.category)) return NextResponse.json({ error: 'pick what the call was about' }, { status: 400 })
  if (!question) return NextResponse.json({ error: 'what did they ask?' }, { status: 400 })

  // called_at arrives as the shop-clock datetime-local string already
  // converted to an ISO instant by the browser; default to now if absent.
  const calledAt = body.called_at ? Date.parse(body.called_at) : NaN
  const called_at = Number.isFinite(calledAt) ? new Date(calledAt).toISOString() : new Date().toISOString()

  const { data, error } = await supabaseAdmin
    .from('call_log')
    .insert([{
      called_at,
      taken_by,
      caller_name:  clean(body.caller_name, 200),
      caller_phone: clean(body.caller_phone, 40),
      customer_id:  typeof body.customer_id === 'string' && body.customer_id ? body.customer_id : null,
      category:     body.category,
      question,
      answer:       clean(body.answer, 4000),
    }])
    .select(SELECT)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// PATCH /api/calls — fix a logged call (wrong category, typo, add the answer)
export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null)
  if (!body?.id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  // Only the fields the form edits, each validated the same as on insert.
  const updates: Record<string, unknown> = {}
  if ('category' in body) {
    if (!isCallCategory(body.category)) return NextResponse.json({ error: 'bad category' }, { status: 400 })
    updates.category = body.category
  }
  if ('question' in body) {
    const q = clean(body.question, 4000)
    if (!q) return NextResponse.json({ error: 'question cannot be blank' }, { status: 400 })
    updates.question = q
  }
  if ('answer' in body)       updates.answer       = clean(body.answer, 4000)
  if ('caller_name' in body)  updates.caller_name  = clean(body.caller_name, 200)
  if ('caller_phone' in body) updates.caller_phone = clean(body.caller_phone, 40)
  if ('customer_id' in body)  updates.customer_id  = typeof body.customer_id === 'string' && body.customer_id ? body.customer_id : null
  if ('called_at' in body) {
    const t = Date.parse(body.called_at)
    if (!Number.isFinite(t)) return NextResponse.json({ error: 'bad called_at' }, { status: 400 })
    updates.called_at = new Date(t).toISOString()
  }
  if (Object.keys(updates).length === 0) return NextResponse.json({ error: 'nothing to update' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('call_log')
    .update(updates)
    .eq('id', body.id)
    .select(SELECT)
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/calls?id=UUID — a duplicate or a test entry
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  const { error } = await supabaseAdmin.from('call_log').delete().eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
