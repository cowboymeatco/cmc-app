export const runtime = 'edge'
import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { jsonError } from '@/lib/timeclockServer'

// GET /api/timeclock/roster — the names on the kiosk's first screen. You tap
// yours, then enter your PIN. Kept to first name and last initial: this sits
// in front of the PIN, so it's readable by anyone who finds the kiosk page.
export async function GET() {
  try {
    const { data, error } = await supabaseAdmin.from('tk_employees').select('id, name, pin_hash').eq('active', true).order('name')
    if (error) return jsonError(error.message)
    const roster = (data ?? []).map(e => {
      const parts = String(e.name).trim().split(/\s+/)
      const short = parts.length > 1 ? `${parts[0]} ${parts[parts.length - 1][0]}.` : parts[0]
      return { id: e.id as string, name: short, needsSetup: !e.pin_hash }
    })
    // Two "Sam R."s would be ambiguous — give them their full names back.
    const seen = new Map<string, number>()
    roster.forEach(r => seen.set(r.name, (seen.get(r.name) ?? 0) + 1))
    for (const r of roster) if ((seen.get(r.name) ?? 0) > 1) r.name = String(data!.find(e => e.id === r.id)!.name)
    roster.sort((a, b) => a.name.localeCompare(b.name))
    return NextResponse.json({ roster }, { headers: { 'Cache-Control': 'no-store' } })
  } catch (e) {
    return jsonError(e)
  }
}
