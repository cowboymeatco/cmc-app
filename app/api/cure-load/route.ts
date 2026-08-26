export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { summarizeCure } from '@/lib/cureLoad'
import type { CureTag } from '@/lib/types'
import type { CookProfile } from '@/lib/cookPredict'

export const dynamic = 'force-dynamic'

// GET /api/cure-load — everything hanging in the cure cooler right now, rolled
// up into house loads. Reads the same cure_tags the scanner writes, so the
// board is the seal scans and nothing else.
export async function GET() {
  const [{ data: tags, error }, { data: profiles }] = await Promise.all([
    supabase.from('cure_tags').select('*').eq('status', 'curing'),
    supabase.from('cook_profile').select('*'),
  ])
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const summary = summarizeCure(
    (tags ?? []) as CureTag[],
    (profiles ?? []) as unknown as CookProfile[],
  )
  return NextResponse.json(summary)
}
