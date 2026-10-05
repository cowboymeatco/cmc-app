// ──────────────────────────────────────────────────────────────────────────────
// Microsoft Graph, app-only. SERVER-ONLY (reads a client secret).
//
// One app registration ("CMC App Mailer", see lib/mailer.ts) signs the app in
// as itself with client credentials; what it may then do is whatever
// application permissions Charlie has granted it in Entra. Today that is
// Mail.Send (the register report) and, for the cut-sheet migration
// (/cutting-instructions/migrate), Files.Read.All and Sites.Read.All — see the
// setup note in lib/cutSheetFiles.ts.
//
// The env names stay MAIL_* because they are the same registration and the
// same secret; renaming them would mean a second copy of the secret in Vercel
// for no gain.
// ──────────────────────────────────────────────────────────────────────────────

export function graphConfigured(): boolean {
  return ['MAIL_TENANT_ID', 'MAIL_CLIENT_ID', 'MAIL_CLIENT_SECRET'].every(k => !!process.env[k])
}

// Tokens last an hour; cache one per isolate and refresh a minute early. The
// migration page lists a folder at a time, so without this every click would
// be a round trip to login.microsoftonline.com first.
let cached: { token: string; expires: number } | null = null

export async function graphToken(): Promise<string> {
  if (cached && cached.expires > Date.now()) return cached.token
  const tenant = process.env.MAIL_TENANT_ID!
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: process.env.MAIL_CLIENT_ID!,
      client_secret: process.env.MAIL_CLIENT_SECRET!,
      scope: 'https://graph.microsoft.com/.default',
    }),
  })
  if (!res.ok) throw new Error(`Microsoft sign-in failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  const body = (await res.json()) as { access_token: string; expires_in?: number }
  cached = { token: body.access_token, expires: Date.now() + (Number(body.expires_in) || 3600) * 1000 - 60_000 }
  return body.access_token
}

// GET a Graph JSON resource. `path` is relative to /v1.0 (or a full URL for
// @odata.nextLink continuation).
export async function graphGet<T>(path: string): Promise<T> {
  const url = path.startsWith('https://') ? path : `https://graph.microsoft.com/v1.0${path}`
  const res = await fetch(url, { headers: { Authorization: `Bearer ${await graphToken()}` } })
  if (!res.ok) {
    const text = (await res.text()).slice(0, 400)
    // 403 here almost always means the permission was never consented — say
    // so, because the raw Graph message ("Access denied") sends people to the
    // wrong place.
    if (res.status === 403) {
      throw new Error(`Microsoft says the app may not read files (403). In Entra, give the CMC App registration the Files.Read.All and Sites.Read.All application permissions and grant admin consent. Graph said: ${text}`)
    }
    throw new Error(`Microsoft Graph ${res.status}: ${text}`)
  }
  return (await res.json()) as T
}
