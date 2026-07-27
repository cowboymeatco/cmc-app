import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireInspector, logActivity } from '@/lib/inspectorGate'

// GET /api/inspector/documents — the read-only view of the HACCP library.
// Deliberately narrower than the staff route: no storage paths go over the wire.
export async function GET(req: NextRequest) {
  const gate = await requireInspector(req)
  if (!gate.ok) return gate.response

  const { data, error } = await supabaseAdmin
    .from('haccp_documents')
    .select('id, title, category, filename, size_bytes, version_date, notes, uploaded_at')
    .eq('active', true)
    .order('category', { ascending: true })
    .order('title',    { ascending: true })
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  await logActivity(gate.visit.id, 'list_documents', `${data.length} documents`)
  return NextResponse.json(data)
}
