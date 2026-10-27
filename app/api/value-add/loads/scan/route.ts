export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { attachCureSeal, detachCureSeal } from '@/lib/valueAddLoads'

export const dynamic = 'force-dynamic'

// Cure seals at the house door — see lib/valueAddLoads.ts.
//
// POST   /api/value-add/loads/scan   { load_id, seal }
//        The ham or bacon wearing this seal goes into the load. The load's
//        job for that customer and product is made or updated: pieces
//        counted, pounds only when every piece was weighed.
// DELETE /api/value-add/loads/scan?seal=0036013
//        A mis-scan: the piece comes back out of its load (only while the
//        load has not gone into the house).
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({})) as { load_id?: string; seal?: string }
  const loadId = String(body.load_id ?? '').trim()
  const seal   = String(body.seal ?? '').trim()
  if (!loadId || !seal) return NextResponse.json({ error: 'load_id and seal required' }, { status: 400 })
  try {
    const r = await attachCureSeal(loadId, seal)
    if (r.kind === 'refused') return NextResponse.json({ error: r.error }, { status: r.status })
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}

export async function DELETE(req: NextRequest) {
  const seal = String(new URL(req.url).searchParams.get('seal') ?? '').trim()
  if (!seal) return NextResponse.json({ error: 'seal required' }, { status: 400 })
  try {
    const r = await detachCureSeal(seal)
    if (r.error) return NextResponse.json({ error: r.error }, { status: 409 })
    return NextResponse.json(r)
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'failed' }, { status: 500 })
  }
}
