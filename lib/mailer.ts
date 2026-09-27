// ──────────────────────────────────────────────────────────────────────────────
// Outgoing email. SERVER-ONLY (reads a client secret).
//
// Sends through Microsoft 365 (Graph sendMail) as a real cowboymeats.com
// mailbox, so reports arrive from the company's own domain and land in the
// inbox, not spam. The app authenticates as itself (client credentials) — it
// runs unattended from a cron, so no one is signed in to send "as".
//
// Setup (Charlie, Entra admin center — one time):
//   1. App registrations → New registration → "CMC App Mailer" (single tenant).
//   2. API permissions → Microsoft Graph → Application permissions → Mail.Send
//      → Grant admin consent.
//   3. Certificates & secrets → New client secret; copy the value.
//   4. Set MAIL_TENANT_ID, MAIL_CLIENT_ID, MAIL_CLIENT_SECRET and MAIL_SENDER
//      (the mailbox it sends from, e.g. charlie@cowboymeats.com) in Vercel.
//   Mail.Send as an application permission can send as ANY mailbox in the
//   tenant. Limiting it to MAIL_SENDER is an Exchange Online
//   ApplicationAccessPolicy (New-ApplicationAccessPolicy -AccessRight
//   RestrictAccess), worth doing before this goes live.
//
// Kept to one function on purpose: when the company moves to Google
// Workspace, only this file changes.
// ──────────────────────────────────────────────────────────────────────────────

export interface MailMessage {
  to: string[]
  subject: string
  html: string
}

export function mailConfigured(): boolean {
  return ['MAIL_TENANT_ID', 'MAIL_CLIENT_ID', 'MAIL_CLIENT_SECRET', 'MAIL_SENDER'].every(k => !!process.env[k])
}

async function graphToken(): Promise<string> {
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
  if (!res.ok) throw new Error(`Mail sign-in failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
  return ((await res.json()) as { access_token: string }).access_token
}

export async function sendMail(m: MailMessage): Promise<void> {
  if (!mailConfigured()) {
    throw new Error('Email is not set up (MAIL_TENANT_ID / MAIL_CLIENT_ID / MAIL_CLIENT_SECRET / MAIL_SENDER) — see lib/mailer.ts')
  }
  if (!m.to.length) throw new Error('No recipients')
  const sender = process.env.MAIL_SENDER!
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${await graphToken()}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject: m.subject,
        body: { contentType: 'HTML', content: m.html },
        toRecipients: m.to.map(address => ({ emailAddress: { address } })),
      },
      saveToSentItems: true,
    }),
  })
  // Graph answers 202 Accepted with no body.
  if (!res.ok) throw new Error(`Sending mail failed (${res.status}): ${(await res.text()).slice(0, 300)}`)
}
