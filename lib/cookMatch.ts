// Which Enviropak cook cycles a value-add job rode in.
//
// The controller logs every cycle (start, end, temps) but never what was in
// the house — Batch#/Truck# are always blank. The crew taps "into smokehouse"
// and "out of smokehouse" on the job (value_add_jobs.smoke_in_at/smoke_out_at),
// and a cook belongs to the job when most of the cycle ran inside that window
// (Charlie, 2026-09-13). Time overlap, not a key: nothing is written back to
// the controller.
//
// ⚖️ The Enviropak is the MASTER clock — its cycle times can't be edited, the
// taps can. Taps only decide WHICH cook; every time shown or measured comes off
// the matched cook. A missed tap is fixed by picking the cook, never by typing.

export interface CookSpan { id: string; started_at: string | null; ended_at: string | null }
export interface JobSpan  { smoke_in_at: string | null; smoke_out_at: string | null }

// Slack either side of the taps — the cycle is usually started a few minutes
// after loading, and "out" gets pressed once the trucks are already rolling.
export const MATCH_PAD_MINUTES = 30

/** True when at least half of the cook ran while the job was in the house. */
export function cookInJob(cook: CookSpan, job: JobSpan, now: number = Date.now()): boolean {
  if (!job.smoke_in_at || !cook.started_at) return false
  const pad    = MATCH_PAD_MINUTES * 60_000
  const winLo  = new Date(job.smoke_in_at).getTime() - pad
  const winHi  = (job.smoke_out_at ? new Date(job.smoke_out_at).getTime() : now) + pad
  const start  = new Date(cook.started_at).getTime()
  const end    = cook.ended_at ? new Date(cook.ended_at).getTime() : start
  if (end <= start) return start >= winLo && start <= winHi
  const overlap = Math.min(end, winHi) - Math.max(start, winLo)
  return overlap >= (end - start) / 2
}
