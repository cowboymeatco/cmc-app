// Shared constants for the HACCP document library (private storage bucket +
// haccp_documents table). Used by the API routes and the /haccp/documents page.

export const HACCP_BUCKET = 'haccp-docs'

export const HACCP_CATEGORIES = [
  'HACCP Plan',
  'Hazard Analysis',
  'Prerequisite Program',
  'SSOP',
  'Blank Form',
  'Supporting Document',
] as const

export type HaccpCategory = typeof HACCP_CATEGORIES[number]

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

export function formatBytes(n: number | null): string {
  if (!n) return '—'
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}
