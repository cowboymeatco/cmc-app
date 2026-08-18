export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { unlinkInstruction } from '@/lib/cuttingLinks'

export const dynamic = 'force-dynamic'

// POST /api/cutting-instructions/unlink  { id, appointment_id? }
//
// Take a cut card back off an animal without destroying it. Deleting the card
// was the only thing that unlinked anything, which meant a mis-link could only
// be fixed by throwing away the customer's answers — and "Link to another
// animal" ADDS a link rather than moving it, so the wrong one just stayed
// (Charlie, 2026-08-18).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null)
  const id             = body?.id as string | undefined
  const appointment_id = (body?.appointment_id as string | undefined) || undefined
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error, remaining } = await unlinkInstruction(id, appointment_id)
  if (error) return NextResponse.json({ error }, { status: 500 })

  // With no animals left the card is back where it started, so it returns to
  // the "needs linking" pile instead of sitting on a green badge that points at
  // nothing. Only 'linked' rolls back: an archived or imported card keeps the
  // status someone deliberately gave it.
  //
  // customer_id is deliberately NOT cleared, matching the PATCH route — an
  // unlinked card still belongs to the same person and should stay in their
  // history on /customers.
  let status: string | null = null
  if (remaining === 0) {
    const { data: row } = await supabase
      .from('cutting_instructions')
      .select('status')
      .eq('id', id)
      .single()
    if (row?.status === 'linked') {
      const { error: upErr } = await supabase
        .from('cutting_instructions')
        .update({ status: 'pending' })
        .eq('id', id)
      if (upErr) return NextResponse.json({ error: upErr.message }, { status: 500 })
      status = 'pending'
    }
  }

  return NextResponse.json({ ok: true, remaining, status })
}
