export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { pbxUnauthorized, phoneDigits, samePhone, UNKNOWN_PREFIX } from '@/lib/pbx'

// GET /api/pbx/lookup?number=4065551234 — who is this phone number?
//
// 3CX calls this for every inbound and outbound call (scripts/3cx/cmc-app.xml,
// the lookup scenario). Whatever comes back is what the desk sees on the
// ringing phone, and it is also what decides whether 3CX bothers to journal
// the call afterwards: from V20 U6 the ReportCall scenario is skipped for a
// call whose lookup returned nothing.
//
// So this ALWAYS returns exactly one contact. A number on file comes back as
// that customer; a stranger comes back as "Unknown caller" with a placeholder
// id. The phone field echoes the number exactly as 3CX sent it, because 3CX
// only treats the record as a match if one phone output equals the number it
// searched for.
//
// Guarded by PBX_API_KEY and fails CLOSED (lib/pbx.ts).

interface CustomerRow { id: string; name: string | null; ranch_name: string | null; phone: string | null; email: string | null }

export async function GET(req: NextRequest) {
  const denied = pbxUnauthorized(req)
  if (denied) return denied

  const number = (req.nextUrl.searchParams.get('number') ?? '').trim()
  const digits = phoneDigits(number)
  if (digits.length < 7) return NextResponse.json({ error: 'number must have at least 7 digits' }, { status: 400 })

  // Candidates share the last 4 digits as a substring; the real test is
  // samePhone() on the normalised digits, because phones are stored however
  // the desk typed them ("406-555-1234", "(406) 555 1234", "4065551234").
  const { data, error } = await supabaseAdmin
    .from('customers')
    .select('id, name, ranch_name, phone, email')
    .ilike('phone', `%${digits.slice(-4)}%`)
    .limit(200)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const match = ((data ?? []) as CustomerRow[]).find(c => samePhone(phoneDigits(c.phone), digits))
  const origin = req.nextUrl.origin

  const contact = match
    ? {
        id:         match.id,
        url:        `${origin}/customers?id=${match.id}`,
        first_name: match.name?.trim() || match.ranch_name?.trim() || 'Customer',
        last_name:  '',
        company:    match.ranch_name?.trim() ?? '',
        email:      match.email?.trim() ?? '',
        phone:      number,
      }
    : {
        id:         `${UNKNOWN_PREFIX}${digits}`,
        url:        `${origin}/calls?phone=${digits}`,
        first_name: 'Unknown caller',
        last_name:  '',
        company:    '',
        email:      '',
        phone:      number,
      }

  return NextResponse.json({ contacts: [contact] })
}
