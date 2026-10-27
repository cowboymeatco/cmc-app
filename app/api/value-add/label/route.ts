export const runtime = 'edge'
import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { generateWIPLabel, wipDataFromJob, WIPJob } from '@/lib/labelWIP'
import { parseRoll, type LabelFlags } from '@/lib/label'
import { carcassesForCard } from '@/lib/sessionLinks'
import { JOB_WITH_LOAD } from '@/lib/valueAddLoads'

export const dynamic = 'force-dynamic'

// GET /api/value-add/label?id=<job id> — the printable WIP tag.
//
//   &roll=62mm        Brother QL on the 2.4in roll (the value-add page remembers
//                     the station's printer the way the scanner does). Default
//                     is the 4in thermal. Charlie, 2026-10-26: the tag that goes
//                     into the house hangs on a 2.5in plastic tag.
//   &insp=usda|custom|exempt
//                     Inspection level picked by hand on the job card. Absent,
//                     it is read off the cut card's carcasses (below); a job
//                     nothing can resolve prints INSPECTION NOT MARKED with a
//                     note saying to pick one, never a guessed mark.
//   &usda=1 &nfs=1 &exempt=1
//                     The older per-print flags; they still win over everything.

const USDA:     LabelFlags = { usda_bug: true,  not_for_sale: false, retail_exempt: false, not_for_human: false }
const CUSTOM:   LabelFlags = { usda_bug: false, not_for_sale: true,  retail_exempt: false, not_for_human: false }
const EXEMPT:   LabelFlags = { usda_bug: false, not_for_sale: false, retail_exempt: true,  not_for_human: false }
const UNMARKED: LabelFlags = { usda_bug: false, not_for_sale: false, retail_exempt: false, not_for_human: false }

// What the job's animal was killed under. Custom anywhere is the legal floor —
// custom-exempt meat can't be sold — exactly as the box label reads it.
async function inspectionFromCard(cardId: string | null): Promise<{ flags: LabelFlags; note: string | null }> {
  if (!cardId) return { flags: UNMARKED, note: 'no cut card on this job — pick the inspection level on the job card when printing' }
  const { carcasses } = await carcassesForCard(cardId)
  if (!carcasses.length) return { flags: UNMARKED, note: 'no carcass assigned to the cut card yet — pick the inspection level on the job card when printing' }
  const { data } = await supabaseAdmin
    .from('harvest_log')
    .select('kill_type')
    .in('id', carcasses.map(c => c.harvest_log_id))
  const kinds = (data ?? []).map(r => r.kill_type as string | null).filter(Boolean)
  if (kinds.includes('Custom')) return { flags: CUSTOM, note: null }
  if (kinds.includes('USDA'))   return { flags: USDA,   note: null }
  return { flags: UNMARKED, note: 'the carcass carries no kill type — pick the inspection level on the job card when printing' }
}

export async function GET(req: NextRequest) {
  const sp = new URL(req.url).searchParams
  const id = sp.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { data, error } = await supabaseAdmin
    .from('value_add_jobs')
    .select(JOB_WITH_LOAD)
    .eq('id', id)
    .maybeSingle()

  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  if (!data)  return NextResponse.json({ error: 'job not found' }, { status: 404 })
  const job = data as unknown as WIPJob & { linked_cutting_instruction_id: string | null; load_id: string | null }

  // Who else is cooking in this load — one tag says what else is in the house.
  let loadMates: string[] = []
  if (job.load_id) {
    const { data: mates } = await supabaseAdmin
      .from('value_add_jobs')
      .select('customer_name, output_item_name, description')
      .eq('load_id', job.load_id)
      .neq('id', id)
      .order('created_at', { ascending: true })
    loadMates = (mates ?? []).map(m =>
      `${(m.customer_name as string | null) ?? 'CMC'}: ${(m.output_item_name as string) || (m.description as string) || 'job'}`)
  }

  let flags: LabelFlags
  let note: string | null = null
  const insp = sp.get('insp')
  if (sp.has('usda') || sp.has('nfs') || sp.has('exempt')) {
    flags = {
      usda_bug:      sp.get('usda') === '1',
      not_for_sale:  sp.get('nfs')  === '1',
      retail_exempt: sp.get('exempt') === '1',
      not_for_human: false,
    }
  } else if (insp === 'usda')   flags = USDA
  else if (insp === 'custom') flags = CUSTOM
  else if (insp === 'exempt') flags = EXEMPT
  else ({ flags, note } = await inspectionFromCard(job.linked_cutting_instruction_id))

  return new NextResponse(
    generateWIPLabel(wipDataFromJob(job, { loadMates, inspectionNote: note }), flags, parseRoll(sp.get('roll'))),
    { headers: { 'Content-Type': 'text/html;charset=utf-8', 'Cache-Control': 'no-store' } },
  )
}
