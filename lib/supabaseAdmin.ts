import { createClient, SupabaseClient } from '@supabase/supabase-js'

// Server-only Supabase client using the SERVICE ROLE key (bypasses RLS).
// Exists for tables the public anon key must never read — currently
// qbo_tokens (live OAuth credentials). Never import from client components.
let _client: SupabaseClient | null = null

function getClient(): SupabaseClient {
  if (!_client) {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY
    if (!url || !key) throw new Error('Supabase admin env vars missing (NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)')
    _client = createClient(url, key, { auth: { persistSession: false } })
  }
  return _client
}

export const supabaseAdmin = new Proxy({} as SupabaseClient, {
  get(_target, prop: string | symbol) {
    const client = getClient()
    const value = (client as unknown as Record<string | symbol, unknown>)[prop]
    return typeof value === 'function' ? value.bind(client) : value
  },
})
