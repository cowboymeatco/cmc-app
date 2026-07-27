import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { getClientIp, isAllowedNetwork, isValidNetwork } from '@/lib/inspectorGate'

// Staff-side management of the plant allowlist, driven from /haccp/documents.
// It reports the caller's own address so the list can be built by standing in
// the office and pressing a button, rather than hunting for the WAN IP.

// GET /api/inspector/network
export async function GET(req: NextRequest) {
  const ip = getClientIp(req)
  const { data, error } = await supabaseAdmin
    .from('inspector_allowed_networks')
    .select('*')
    .eq('active', true)
    .order('added_at', { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  return NextResponse.json({
    yourIp:    ip,
    yourIpAllowed: await isAllowedNetwork(ip),
    networks:  data,
  })
}

// POST /api/inspector/network — { network?, label? }; omit network to add
// whatever address this request came from.
export async function POST(req: NextRequest) {
  const body    = await req.json().catch(() => ({}))
  const network = String(body.network ?? '').trim() || getClientIp(req)
  const label   = String(body.label ?? '').trim()

  if (!isValidNetwork(network)) {
    return NextResponse.json({ error: `“${network}” is not a valid address or CIDR range` }, { status: 400 })
  }

  const { data, error } = await supabaseAdmin
    .from('inspector_allowed_networks')
    .upsert(
      { network, label: label || null, added_by: String(body.added_by ?? '').trim() || null, active: true },
      { onConflict: 'network' },
    )
    .select()
    .single()
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json(data)
}

// DELETE /api/inspector/network?id=…
export async function DELETE(req: NextRequest) {
  const id = new URL(req.url).searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })

  const { error } = await supabaseAdmin
    .from('inspector_allowed_networks')
    .update({ active: false })
    .eq('id', id)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })
  return NextResponse.json({ ok: true })
}
