import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { STAFF_COOKIE, SESSION_DAYS, mintStaffToken, sha256Hex, sameSecret, isStaff, gateConfigured } from '@/lib/staffSession'

// The door proxy.ts sends everyone to. Open by necessity — it is the only way
// in — so it does the least it can: check one passphrase, hand back one cookie.
//
// The passphrase lives in exec_config as a SHA-256 hash (service role only,
// same as /exec's), not in an env var, so changing it is one SQL update and
// does not need a redeploy of the app the crew is standing in front of.
const PASS_KEY = 'staff_pass_sha256'

// GET — what the sign-in page asks on load, so a device that is already signed
// in doesn't show a form it doesn't need.
export async function GET(req: NextRequest) {
  return NextResponse.json({ signedIn: await isStaff(req), configured: gateConfigured() })
}

export async function POST(req: NextRequest) {
  if (!gateConfigured()) {
    return NextResponse.json(
      { error: 'STAFF_SESSION_SECRET is not configured — sign-in is unavailable.' },
      { status: 503 },
    )
  }

  const { pass } = await req.json().catch(() => ({ pass: '' }))
  if (typeof pass !== 'string' || !pass.trim()) {
    return NextResponse.json({ error: 'Enter the passphrase' }, { status: 400 })
  }

  const { data } = await supabaseAdmin
    .from('exec_config')
    .select('value')
    .eq('key', PASS_KEY)
    .maybeSingle()

  // No passphrase set is a refusal, not a free pass.
  if (!data?.value) {
    return NextResponse.json({ error: 'No staff passphrase is set yet.' }, { status: 503 })
  }

  if (!sameSecret(await sha256Hex(pass.trim()), String(data.value))) {
    // Flat delay, matching /exec: slows a guessing loop without a lockout table
    // that could shut the crew out of the app mid-shift.
    await new Promise(r => setTimeout(r, 750))
    return NextResponse.json({ error: 'Wrong passphrase' }, { status: 401 })
  }

  const res = NextResponse.json({ ok: true })
  res.cookies.set(STAFF_COOKIE, await mintStaffToken(), {
    httpOnly: true,
    secure:   process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path:     '/',
    maxAge:   SESSION_DAYS * 86_400,
  })
  return res
}

// DELETE — sign this device out. Nothing to revoke server-side: the token is
// signed, not stored. To cut every device off at once, rotate
// STAFF_SESSION_SECRET, which invalidates every signature ever issued.
export async function DELETE() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set(STAFF_COOKIE, '', { path: '/', maxAge: 0 })
  return res
}
