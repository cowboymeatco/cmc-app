export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { refreshQboCache } from '@/lib/qboSync'

// POST /api/qbo/refresh — re-pull the live QuickBooks catalog into the
// qbo_items cache. Self-serve replacement for the old export/import loop.
export async function POST() {
  try {
    const result = await refreshQboCache()
    return NextResponse.json({ ok: true, ...result })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
