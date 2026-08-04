export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// POST /api/cutting-instructions/copy — { source_id, portion }
//
// One customer taking more than one share wants the same cuts on all of them:
// Rian Pinkerton's 1.5 beef was a Whole A|B|C|D plus a half he wanted cut the
// same way (Charlie, 2026-08-04). Linking the ONE card to both slots looks like
// it works, but the card then prints "Whole A|B|C|D" on a half carcass, and
// editing it later silently rewrites both animals. So copy it instead: same
// answers, own row, its own portion.
//
// Only the portion changes. Portions in the same size class produce identical
// cut output — the wizard hides primals too big for a quarter share from
// whole-abcd / half-ab / quarter alike, and the printed card's whole-animal
// roast counting applies only to 'whole' and 'whole-ab'. Copying ACROSS size
// classes is still allowed (the crew may genuinely want it) but the answers
// were given against the source's option set, so we flag it rather than
// silently reshape anything.

const BEEF_PORTIONS = ['whole', 'whole-ab', 'whole-abcd', 'half', 'half-ab', 'three-quarter', 'three-quarter-abc', 'quarter']
const PORK_PORTIONS = ['whole', 'whole-ab', 'half']

// Shares that come out to a quarter of an animal or less — the wizard treats
// these as one group when deciding which cuts to offer.
const QUARTER_CLASS = new Set(['whole-abcd', 'half-ab', 'quarter'])
const WHOLE_CLASS   = new Set(['whole', 'whole-ab'])

function sizeClass(p: string): string {
  if (QUARTER_CLASS.has(p)) return 'quarter'
  if (WHOLE_CLASS.has(p)) return 'whole'
  return p
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null) as { source_id?: string; portion?: string } | null
  const sourceId = body?.source_id
  const portion  = body?.portion
  if (!sourceId || !portion) {
    return NextResponse.json({ error: 'source_id and portion required' }, { status: 400 })
  }

  const { data: src, error: readErr } = await supabase
    .from('cutting_instructions')
    .select('*')
    .eq('id', sourceId)
    .single()
  if (readErr || !src) {
    return NextResponse.json({ error: readErr?.message ?? 'card not found' }, { status: 404 })
  }

  const data = { ...(src.data as Record<string, unknown> ?? {}) }
  const isPork = String(src.species ?? '').toLowerCase().startsWith('p')
  const allowed = isPork ? PORK_PORTIONS : BEEF_PORTIONS
  if (!allowed.includes(portion)) {
    return NextResponse.json({ error: `"${portion}" is not a portion for a ${src.species} card` }, { status: 400 })
  }

  const from = String(data.portion ?? '')
  data.portion = portion

  // A short line on the card itself, so the cutter can see at a glance that
  // this share is a copy and which one it came from.
  const note = `Copied from this customer's ${from || 'other'} card — same cuts, ${portion} share.`
  const existing = String(data.notes ?? '').trim()
  data.notes = existing ? `${existing}\n${note}` : note

  const { data: copy, error: insErr } = await supabase
    .from('cutting_instructions')
    .insert([{
      customer_name: src.customer_name,
      species:       src.species,
      // Unlinked until the caller puts it on a slot — same starting point as a
      // card that just came off the form.
      status:        'pending',
      customer_id:   src.customer_id,
      submitted_by:  src.submitted_by,
      data,
    }])
    .select()
    .single()

  if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 })

  return NextResponse.json({
    ...copy,
    // The UI warns on this rather than blocking: answers given for one size
    // class may not all make sense in another.
    size_class_changed: sizeClass(from) !== sizeClass(portion),
  })
}
