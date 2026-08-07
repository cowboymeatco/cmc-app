export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { generateWIPLabel, wipDataFromJob, WIPJob } from '@/lib/labelWIP'

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

  // A job-created tag has no carcass behind it to resolve a kill type from, so
  // the inspection band stays unmarked unless the caller says otherwise.
  const sp = new URL(req.url).searchParams
  const flags = {
    usda_bug:      sp.get('usda') === '1',
    not_for_sale:  sp.get('nfs')  === '1',
    retail_exempt: sp.get('exempt') === '1',
    // A WIP tag never leaves the plant, so the animal-food statement has no
    // place on it — the finished box label is what carries it.
    not_for_human: false,
  }

  return new NextResponse(generateWIPLabel(wipDataFromJob(data as WIPJob), flags), {
    headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
