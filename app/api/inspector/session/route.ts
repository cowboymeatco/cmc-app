import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getClientIp, isAllowedNetwork, getVisit, VISIT_COOKIE, VISIT_HOURS } from '@/lib/inspectorGate'

// GET /api/inspector/session — what the portal shell asks on load: are you on
// the plant network, and have you signed in yet?
export async function GET(req: NextRequest) {
  const ip = getClientIp(req)
  const onNetwork = await isAllowedNetwork(ip)
  if (!onNetwork) return NextResponse.json({ onNetwork: false, ip, visit: null })

  const visit = await getVisit(req)
  return NextResponse.json({ onNetwork: true, ip, visit })
}

// POST /api/inspector/session — sign in. Name is required; that is the whole
// point of the gate, so an unnamed visit is refused rather than defaulted.
export async function POST(req: NextRequest) {
  const ip = getClientIp(req)
  if (!(await isAllowedNetwork(ip))) {
    return NextResponse.json({ error: 'off_network', ip }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const inspector = String(body.inspector ?? '').trim()
  const agency    = String(body.agency ?? '').trim()
  if (inspector.length < 2) {
    return NextResponse.json({ error: 'Enter your name to continue' }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('inspector_visits')
    .insert([{
      inspector,
      agency:     agency || null,
      ip,
      user_agent: req.headers.get('user-agent'),
    }])
    .select('id, inspector, agency')
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const res = NextResponse.json({ onNetwork: true, ip, visit: data })
  res.cookies.set(VISIT_COOKIE, data.id as string, {
    httpOnly: true,
    sameSite: 'lax',
    secure:   process.env.NODE_ENV === 'production',
    path:     '/',
    maxAge:   VISIT_HOURS * 3600,
  })
  return res
}

// DELETE /api/inspector/session — sign out, so the next visitor at the same
// screen has to give their own name.
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(VISIT_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
