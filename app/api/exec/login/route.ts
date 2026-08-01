export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { checkPassphrase, startSession, EXEC_COOKIE } from '@/lib/execGate'

// POST /api/exec/login — passphrase in, session cookie out.
export async function POST(req: NextRequest) {
  try {
    const { pass } = await req.json().catch(() => ({}))
    if (typeof pass !== 'string' || !pass.trim()) {
      return NextResponse.json({ error: 'Passphrase required' }, { status: 400 })
    }
    if (!(await checkPassphrase(pass.trim()))) {
      // Flat delay keeps a guessing loop slow without a lockout table.
      await new Promise(r => setTimeout(r, 750))
      return NextResponse.json({ error: 'Wrong passphrase' }, { status: 401 })
    }
    return await startSession(NextResponse.json({ ok: true }))
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}

// DELETE /api/exec/login — sign out this session.
export async function DELETE(req: NextRequest) {
  const token = req.cookies.get(EXEC_COOKIE)?.value
  if (token) await supabaseAdmin.from('exec_sessions').delete().eq('token', token)
  const res = NextResponse.json({ ok: true })
  res.cookies.delete(EXEC_COOKIE)
  return res
}
