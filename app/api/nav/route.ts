import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'

// Page-view sink for lib/navLog.ts. Writes with the SERVICE ROLE key so
// nav_events can keep RLS on with no anon policy — this table should not widen
// the anon-writable surface the RLS lockdown is closing.
//
// Runs on Node (not edge) because supabaseAdmin is the server-only client.

// Arrives via navigator.sendBeacon during an unload, so it has to be cheap and
// it can never be allowed to throw back at the browser.
export async function POST(req: NextRequest) {
  try {
    const b = await req.json()

    // A beacon is unauthenticated by nature, so nothing here is trusted:
    // validate the shape, clamp the sizes, and stamp the rest server-side.
    const path = typeof b?.path === 'string' ? b.path.split('?')[0].slice(0, 200) : null
    const dwell = Number(b?.dwell_ms)
    if (!path || !path.startsWith('/') || !Number.isFinite(dwell)) {
      return NextResponse.json({ ok: false }, { status: 204 })
    }
    if (!['route', 'hidden', 'pagehide'].includes(b?.ended_by)) {
      return NextResponse.json({ ok: false }, { status: 204 })
    }

    // The inspector portal is a visitor-facing surface for USDA staff, not crew
    // workflow — it has its own inspector_visits log and stays out of this one.
    if (path.startsWith('/inspector')) return new NextResponse(null, { status: 204 })

    // Nor are the cut room wall screens navigation. A TV parked on one route
    // all shift would post a single ten-hour dwell and swamp every real page in
    // the averages — it is furniture, not somewhere the crew went.
    if (path.startsWith('/display/')) return new NextResponse(null, { status: 204 })

    const entered = Date.parse(b?.entered_at)

    await supabaseAdmin.from('nav_events').insert([{
      device_id:  String(b?.device_id  ?? '').slice(0, 64) || 'unknown',
      session_id: String(b?.session_id ?? '').slice(0, 64) || 'unknown',
      path,
      next_path:  typeof b?.next_path === 'string' ? b.next_path.split('?')[0].slice(0, 200) : null,
      entered_at: Number.isFinite(entered) ? new Date(entered).toISOString() : new Date().toISOString(),
      dwell_ms:   Math.max(0, Math.min(Math.round(dwell), 86_400_000)),
      ended_by:   b.ended_by,
      viewport:   typeof b?.viewport === 'string' ? b.viewport.slice(0, 32) : null,
      user_agent: req.headers.get('user-agent')?.slice(0, 300) ?? null,
      commit_sha: process.env.VERCEL_GIT_COMMIT_SHA ?? null,
    }])
  } catch {
    // Swallow everything. A failed page-view write is not worth a console error
    // on the bench — feedbackTelemetry would capture it and pollute real reports.
  }
  return new NextResponse(null, { status: 204 })
}
