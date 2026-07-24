export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateWIPLabel, WIPJob } from '@/lib/labelWIP'

export const dynamic = 'force-dynamic'

// GET /api/value-add/label?id=<job id> — the printable WIP tag
export async function GET(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabase
    .from('value_add_jobs')
    .select('id, tag_code, customer_name, source_description, job_type, description, output_item_name, output_plu, weight_in_lbs, assigned_to, requested_date, notes')
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'job not found' }, { status: 404 })

  return new NextResponse(generateWIPLabel(data as WIPJob), {
    headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
