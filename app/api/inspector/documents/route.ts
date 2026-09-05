import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabaseAdmin'
import { requireInspector, logActivity } from '@/lib/inspectorGate'
import { compareDocs, inspectorMaySee } from '@/lib/haccpDocs'

// GET /api/inspector/documents — the read-only view of the HACCP library.
// Deliberately narrower than the staff route: no storage paths go over the wire.
export async function GET(req: NextRequest) {
  const gate = await requireInspector(req)
  if (!gate.ok) return gate.response

  const { data, error } = await supabaseAdmin
    .from('haccp_documents')
    .select('id, title, category, filename, size_bytes, version_date, notes, uploaded_at')
    .eq('active', true)
  if (error) return NextResponse.json({ error: error.message }, { status: 500 })

  const visible = data.filter(d => inspectorMaySee(d.category)).sort(compareDocs)
  await logActivity(gate.visit.id, 'list_documents', `${visible.length} documents`)
  return NextResponse.json(visible)
}
