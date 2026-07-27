import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// GET /api/inspector/visits — staff-side visitor log: who signed in, when, and
// what they opened. The plant's own record of an inspection.
export async function GET() {
  const { data: visits, error } = await supabaseAdmin
    .from('inspector_visits')
    .select('*')
    .order('started_at', { ascending: false })
    .limit(50)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const ids = (visits ?? []).map(v => v.id as string)
  const { data: activity } = ids.length
    ? await supabaseAdmin
        .from('inspector_activity')
        .select('visit_id, action, detail, at')
        .in('visit_id', ids)
        .order('at', { ascending: true })
    : { data: [] as { visit_id: string; action: string; detail: string | null; at: string }[] }

  return NextResponse.json((visits ?? []).map(v => ({
    ...v,
    activity: (activity ?? []).filter(a => a.visit_id === v.id),
  })))
}
