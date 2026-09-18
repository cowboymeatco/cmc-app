export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export const dynamic = 'force-dynamic'

// GET /api/processing/used-numbers — every PLU number that's spoken for (in
// the book or ever scanned), for New PLU's "Next open" button (lib/nextPlu.ts).
export async function GET() {
  const { data, error } = await supabase
    .from('v_used_plu_numbers')
    .select('plu_number')
    .range(0, 9999)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  const numbers = (data ?? [])
    .map(r => parseInt(String(r.plu_number), 10))
    .filter(n => !isNaN(n))
  return NextResponse.json({ numbers })
}
