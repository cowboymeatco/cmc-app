export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { qboStatus } from '@/lib/qbo'

// GET /api/qbo/status — is the app connected to QuickBooks?
export async function GET() {
  try {
    return NextResponse.json(await qboStatus())
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
