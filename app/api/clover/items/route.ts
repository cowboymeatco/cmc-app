export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { getCloverItems } from '@/lib/clover'

// GET /api/clover/items?weighedOnly=true
// Read-only pull of the Clover catalog. weighedOnly=true returns just PER_UNIT
// ($/lb) items — the scale-relevant ones.
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const weighedOnly = searchParams.get('weighedOnly') === 'true'
    let items = await getCloverItems()
    if (weighedOnly) items = items.filter((i) => i.priceType === 'PER_UNIT')
    return NextResponse.json({ count: items.length, items })
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : String(e) }, { status: 500 })
  }
}
