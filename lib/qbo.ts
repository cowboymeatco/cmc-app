import { supabaseAdmin } from '@/lib/supabaseAdmin'

// QuickBooks Online OAuth2 + API client (server-only).
// Tokens live in the qbo_tokens table (RLS: service role only), one row per
// connection: id 1 is the original accounting connection, id 2 the payroll
// one. They are separate consents on purpose — payroll needs a restricted
// scope Intuit may refuse, and a refused consent must never disturb the
// accounting connection that the register sync and QuickBooks tab run on.
// Access tokens last 1 hour; refresh tokens ~100 days and ROTATE on every
// refresh, so the newest refresh_token must always be persisted.

const AUTHORIZE_URL = 'https://appcenter.intuit.com/connect/oauth2'
const TOKEN_URL = 'https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer'
const API_BASE = 'https://quickbooks.api.intuit.com/v3/company'
const GRAPHQL_URL = 'https://qb.api.intuit.com/graphql'
const MINOR_VERSION = '75'

export type QboConnection = 'accounting' | 'payroll'
export const QBO_CONNECTIONS: QboConnection[] = ['accounting', 'payroll']
const TOKEN_ROW: Record<QboConnection, number> = { accounting: 1, payroll: 2 }

export const QBO_SCOPE = 'com.intuit.quickbooks.accounting'
// The payroll connection carries the accounting scope too, so the one consent
// can answer both APIs. qb.payroll.compensation.read is the Workforce API's
// payslip scope; Intuit lists it under "Restricted scopes" and only enables it
// for an app on a paid partner tier (see lib/qboPayroll.ts).
export const QBO_SCOPES: Record<QboConnection, string> = {
  accounting: QBO_SCOPE,
  payroll: `${QBO_SCOPE} qb.payroll.compensation.read`,
}

const CONNECT_HINT: Record<QboConnection, string> = {
  accounting: 'use Connect QuickBooks on the /processing QuickBooks tab',
  payroll: 'use Connect QuickBooks Payroll on /exec',
}

function creds() {
  const clientId = process.env.QBO_CLIENT_ID
  const clientSecret = process.env.QBO_CLIENT_SECRET
  if (!clientId || !clientSecret) throw new Error('QuickBooks not configured (QBO_CLIENT_ID / QBO_CLIENT_SECRET missing)')
  return { clientId, clientSecret }
}

export function qboConfigured(): boolean {
  return Boolean(process.env.QBO_CLIENT_ID && process.env.QBO_CLIENT_SECRET && process.env.SUPABASE_SERVICE_ROLE_KEY)
}

export function authorizeUrl(redirectUri: string, state: string, connection: QboConnection = 'accounting'): string {
  const { clientId } = creds()
  const q = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: QBO_SCOPES[connection],
    state,
  })
  return `${AUTHORIZE_URL}?${q}`
}

interface TokenResponse {
  access_token: string
  refresh_token: string
  expires_in: number                 // seconds (access token, 3600)
  x_refresh_token_expires_in: number // seconds (~100 days)
}

async function tokenRequest(body: URLSearchParams): Promise<TokenResponse> {
  const { clientId, clientSecret } = creds()
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body,
  })
  if (!res.ok) {
    // intuit_tid identifies the request in Intuit's logs for support cases
    throw new Error(`QBO token request failed (${res.status}, intuit_tid=${res.headers.get('intuit_tid') ?? 'n/a'}): ${await res.text()}`)
  }
  return res.json()
}

async function saveTokens(realmId: string, t: TokenResponse, connection: QboConnection): Promise<void> {
  const now = Date.now()
  const { error } = await supabaseAdmin.from('qbo_tokens').upsert({
    id: TOKEN_ROW[connection],
    realm_id: realmId,
    access_token: t.access_token,
    refresh_token: t.refresh_token,
    access_expires_at: new Date(now + t.expires_in * 1000).toISOString(),
    refresh_expires_at: new Date(now + t.x_refresh_token_expires_in * 1000).toISOString(),
    updated_at: new Date(now).toISOString(),
  })
  if (error) throw new Error(`Failed to store QBO tokens: ${error.message}`)
}

// OAuth callback: exchange the authorization code and persist tokens.
export async function exchangeCode(
  code: string, redirectUri: string, realmId: string, connection: QboConnection = 'accounting',
): Promise<void> {
  const t = await tokenRequest(new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
  }))
  await saveTokens(realmId, t, connection)
}

interface TokenRow {
  realm_id: string
  access_token: string
  refresh_token: string
  access_expires_at: string
  refresh_expires_at: string
}

export interface QboStatus {
  configured: boolean
  connected: boolean
  realmId: string | null
  refreshExpiresAt: string | null
}

export async function qboStatus(connection: QboConnection = 'accounting'): Promise<QboStatus> {
  if (!qboConfigured()) return { configured: false, connected: false, realmId: null, refreshExpiresAt: null }
  const { data } = await supabaseAdmin
    .from('qbo_tokens')
    .select('realm_id, refresh_expires_at')
    .eq('id', TOKEN_ROW[connection])
    .maybeSingle()
  if (!data || new Date(data.refresh_expires_at) < new Date()) {
    return { configured: true, connected: false, realmId: null, refreshExpiresAt: null }
  }
  return { configured: true, connected: true, realmId: data.realm_id, refreshExpiresAt: data.refresh_expires_at }
}

// Valid access token + realm, refreshing (and persisting the rotated
// refresh token) when the access token is within 5 minutes of expiry.
export async function getQboAccess(connection: QboConnection = 'accounting'): Promise<{ accessToken: string; realmId: string }> {
  const { data, error } = await supabaseAdmin.from('qbo_tokens').select('*').eq('id', TOKEN_ROW[connection]).maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as TokenRow | null
  const label = connection === 'payroll' ? 'QuickBooks Payroll' : 'QuickBooks'
  if (!row) throw new Error(`${label} is not connected — ${CONNECT_HINT[connection]}`)
  if (new Date(row.refresh_expires_at) < new Date()) {
    throw new Error(`${label} connection expired — reconnect: ${CONNECT_HINT[connection]}`)
  }
  if (new Date(row.access_expires_at).getTime() - Date.now() > 5 * 60_000) {
    return { accessToken: row.access_token, realmId: row.realm_id }
  }
  const t = await tokenRequest(new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: row.refresh_token,
  }))
  await saveTokens(row.realm_id, t, connection)
  return { accessToken: t.access_token, realmId: row.realm_id }
}

// Authenticated QBO API call. `path` is relative to the company root,
// e.g. qboFetch('query?query=' + encodeURIComponent('select * from Item'))
export async function qboFetch<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const { accessToken, realmId } = await getQboAccess()
  const sep = path.includes('?') ? '&' : '?'
  const res = await fetch(`${API_BASE}/${realmId}/${path}${sep}minorversion=${MINOR_VERSION}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
      ...init?.headers,
    },
  })
  if (!res.ok) {
    const tid = res.headers.get('intuit_tid') ?? 'n/a'
    const body = await res.text()
    console.error(`QBO API error: ${path} status=${res.status} intuit_tid=${tid} body=${body}`)
    throw new Error(`QBO API ${path} failed (${res.status}, intuit_tid=${tid}): ${body}`)
  }
  return res.json()
}

// Intuit's GraphQL API (the "Workforce" API that carries payroll). One
// endpoint for every entity; the realm is implied by the token. GraphQL
// reports most failures as 200 + `errors`, so those are raised too.
export async function qboGraphql<T = unknown>(
  query: string, variables: Record<string, unknown> = {}, connection: QboConnection = 'payroll',
): Promise<T> {
  const { accessToken } = await getQboAccess(connection)
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ query, variables }),
  })
  const tid = res.headers.get('intuit_tid') ?? 'n/a'
  const text = await res.text()
  if (!res.ok) {
    console.error(`QBO GraphQL error: status=${res.status} intuit_tid=${tid} body=${text}`)
    throw new Error(`QBO GraphQL failed (${res.status}, intuit_tid=${tid}): ${text.slice(0, 300)}`)
  }
  const body = JSON.parse(text) as { data?: T; errors?: { message?: string }[] }
  if (body.errors?.length) {
    const msg = body.errors.map(e => e.message ?? 'unknown error').join('; ')
    console.error(`QBO GraphQL errors (intuit_tid=${tid}): ${msg}`)
    throw new Error(`QBO GraphQL: ${msg}`)
  }
  if (body.data === undefined) throw new Error('QBO GraphQL returned no data')
  return body.data
}
