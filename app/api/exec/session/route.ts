export const runtime = 'edge'
export const dynamic = 'force-dynamic'
import { NextRequest, NextResponse } from 'next/server'
import { requireExec } from '@/lib/execGate'

// GET /api/exec/session — is this browser signed in to the exec suite?
export async function GET(req: NextRequest) {
  const gate = await requireExec(req)
  return NextResponse.json({ authed: gate.ok })
}
