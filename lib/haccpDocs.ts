// Shared constants for the HACCP document library (private storage bucket +
// haccp_documents table). Used by the API routes and the /haccp/documents page.

export const HACCP_BUCKET = 'haccp-docs'

// Supabase's project-wide per-file ceiling (50 MB on this plan). Raise it in
// the Supabase dashboard first if a bigger document ever needs to go in.
export const HACCP_MAX_BYTES = 50 * 1024 * 1024

export const HACCP_CATEGORIES = [
  'HACCP Plan',
  'Hazard Analysis',
  'Prerequisite Program',
  'SSOP',
  'Blank Form',
  'Supporting Document',
] as const

export type HaccpCategory = typeof HACCP_CATEGORIES[number]

// What an inspector may see. Blank forms are staff working copies, not
// records — Charlie's rule (2026-09-04): they never show on the portal, and
// the open-file route refuses them even by id.
export const INSPECTOR_HIDDEN_CATEGORIES: readonly string[] = ['Blank Form']
export const inspectorMaySee = (category: string) => !INSPECTOR_HIDDEN_CATEGORIES.includes(category)

export interface HaccpDocument {
  id:           string
  title:        string
  category:     string
  filename:     string
  storage_path: string
  mime_type:    string | null
  size_bytes:   number | null
  version_date: string | null
  notes:        string | null
  uploaded_by:  string | null
  uploaded_at:  string
  active:       boolean
}

// Library order: the plan first, blank forms and supporting papers last (the
// HACCP_CATEGORIES order), and inside a category the forms count 1, 2, 3, 3a,
// 4 … 10 — plain text sort put Form 10 and 11 right after Form 1 (Charlie,
// 2026-09-04). Numeric collation reads the digits as a number.
export function compareDocs(a: { category: string; title: string }, b: { category: string; title: string }): number {
  const ca = HACCP_CATEGORIES.indexOf(a.category as HaccpCategory)
  const cb = HACCP_CATEGORIES.indexOf(b.category as HaccpCategory)
  if (ca !== cb) return (ca === -1 ? 99 : ca) - (cb === -1 ? 99 : cb)
  return a.title.localeCompare(b.title, 'en', { numeric: true, sensitivity: 'base' })
}

export function formatBytes(n: number | null): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
