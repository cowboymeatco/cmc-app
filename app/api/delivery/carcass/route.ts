export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { resolveCarcasses } from '@/lib/carcassDelivery'
import { parseCarcassTag } from '@/lib/carcassTag'

export const dynamic = 'force-dynamic'

// GET /api/delivery/carcass?code=260514-001-R
// One scanned carcass tag → the animal behind it, so Load Out can say
// "Beef · Tag 001 R half · 312.5 lb · Heberle" the instant the gun beeps.
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const code = (searchParams.get('code') ?? '').trim()

  if (!code) return NextResponse.json({ error: 'code required' }, { status: 400 })
  if (!parseCarcassTag(code)) {
    return NextResponse.json({ error: 'not_a_carcass_tag', code }, { status: 422 })
  }

  const [carcass] = await resolveCarcasses([code])
  if (!carcass || !carcass.harvest_log_id) {
    return NextResponse.json({ error: 'carcass_not_found', code }, { status: 404 })
  }
  return NextResponse.json({ carcass })
}
