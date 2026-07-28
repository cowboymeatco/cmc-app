export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { CookProfile, matchProfile } from '@/lib/cookPredict'
import { observeLoad, observeYield, ObservedJob } from '@/lib/loadLearning'

// GET /api/cook-profile/observed
//
// What the work so far actually says about how many pounds go into a load, and
// what comes back out. Nothing here writes — a suggestion is applied through
// the normal PATCH on /api/cook-profile, so a learned number goes in the same
// way a hand-tuned one does and is marked 'manual' just the same.
export async function GET() {
  const { data: profileRows, error } = await supabase
    .from('cook_profile')
    .select('*')
    .eq('active', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const profiles = (profileRows ?? []) as CookProfile[]
  if (profiles.length === 0) return NextResponse.json({ observations: [] })

  // Completed jobs are the real evidence: pre-cook pounds, same basis the
  // scheduler divides on. A job with no profile is matched the same way the
  // board matches it, so jobs recorded before profiles existed still count.
  const { data: jobRows } = await supabase
    .from('value_add_jobs')
    .select('output_item_name, description, job_type, output_plu, profile_key, weight_in_lbs, weight_out_lbs, batch_count, completed_date, status')
    .eq('status', 'complete')

  const jobs: ObservedJob[] = []
  const yieldJobs: { profile_key: string; weight_in_lbs: number | null; weight_out_lbs: number | null }[] = []

  for (const j of jobRows ?? []) {
    const m = matchProfile(
      {
        output_item_name: (j.output_item_name as string) ?? '',
        description:      (j.description as string) ?? '',
        job_type:         (j.job_type as CookProfile['job_type']) as never,
        profile_key:      (j.profile_key as string) ?? null,
      },
      profiles
    )
    if (!m) continue
    const win = j.weight_in_lbs != null ? Number(j.weight_in_lbs) : null
    if (win != null && win > 0) {
      jobs.push({
        profile_key:    m.profile.profile_key,
        weight_in_lbs:  win,
        batch_count:    j.batch_count != null ? Number(j.batch_count) : null,
        completed_date: (j.completed_date as string) ?? null,
      })
    }
    yieldJobs.push({
      profile_key:    m.profile.profile_key,
      weight_in_lbs:  win,
      weight_out_lbs: j.weight_out_lbs != null ? Number(j.weight_out_lbs) : null,
    })
  }

  // Deliberately no box_scans pass here. Post-cook pounds are the wrong side
  // of the shrink to size a load, and grouping them by product NAME sweeps in
  // raw retail cuts — "BEEF BRISKET" in a customer's box is a fresh brisket,
  // not something off the house. Finished weight arrives instead through each
  // job's own weight_out_lbs, matched on exact PLU, and shows up as yield.
  const observations = profiles.map(p => ({
    ...observeLoad(p.profile_key, jobs),
    display_name:   p.display_name,
    current_lbs_per_batch: p.lbs_per_batch != null ? Number(p.lbs_per_batch) : null,
    yield:          observeYield(yieldJobs, p.profile_key),
  }))

  return NextResponse.json({ observations })
}
