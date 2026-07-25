// ──────────────────────────────────────────────────────────────────────────────
// Clover POS client (REST v3). SERVER-ONLY — reads CLOVER_API_TOKEN from the
// server env, so NEVER import this into a client component / 'use client' file.
//
// The CMC app is the master ([[reference-clover-integration]]): this is the read
// path used to seed real prices into plu_items, and the foundation for phase-B
// write-back (pushing app edits → Clover).
//
// Gotcha: the merchant id for the API is the ALPHANUMERIC id from the dashboard
// URL (e.g. AZQNJ4WYMDYP1), NOT the numeric payment "MID" (which returns 401).
// ──────────────────────────────────────────────────────────────────────────────

const BASE = 'https://api.clover.com/v3'

export interface CloverItem {
  id: string
  name: string
  price: number // in CENTS
  priceType: 'PER_UNIT' | 'FIXED' | 'VARIABLE' | string // PER_UNIT = weighed ($/lb)
  unitName?: string
  sku?: string
  code?: string
}

export function creds(): { mid: string; token: string } {
  const mid = process.env.CLOVER_MERCHANT_ID
  const token = process.env.CLOVER_API_TOKEN
  if (!mid || !token) {
    throw new Error('Clover env vars missing (CLOVER_MERCHANT_ID / CLOVER_API_TOKEN)')
  }
  return { mid, token }
}

// Clover rate-limits bursts with a 429. The register sweep makes several calls
// per order (payments, line items), so a handful of orders is enough to trip it
// — and a 429 there reads as "could not verify", which stalls the sweep. Back
// off and retry rather than surfacing a transient throttle as a hard failure.
// Only 429 and 5xx are retried; a 401/404 is a real answer, not a hiccup.
const RETRY_STATUSES = new Set([429, 500, 502, 503, 504])
const MAX_ATTEMPTS = 4

export async function cloverFetch(path: string, init: RequestInit = {}) {
  const { token } = creds()
  let lastStatus = 0
  let lastBody = ''

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const res = await fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        ...init.headers,
      },
    })
    if (res.ok) return res.json()

    lastStatus = res.status
    lastBody = await res.text()
    if (!RETRY_STATUSES.has(res.status) || attempt === MAX_ATTEMPTS) break

    // 250ms, 500ms, 1s — Clover's throttle window is short.
    await new Promise(r => setTimeout(r, 250 * 2 ** (attempt - 1)))
  }
  throw new Error(`Clover API ${lastStatus}: ${lastBody}`)
}

// Update one Clover item. Clover v3 updates via POST on the item endpoint.
// price is in CENTS. Names are uppercased on write (Jill's ALL CAPS standard).
// code is the barcode-lookup field the weight-embedded scan matches on:
// '2' + 5-digit zero-padded scale PLU (e.g. 200115 = PLU 115), or '' to clear
// a stale code. syncSku mirrors code into sku (existing store convention).
export async function updateCloverItem(
  itemId: string,
  fields: { name?: string; price?: number; code?: string; syncSku?: boolean }
): Promise<CloverItem> {
  const { mid } = creds()
  const body: Record<string, unknown> = {}
  if (fields.name !== undefined) body.name = fields.name.toUpperCase()
  if (fields.price !== undefined) {
    if (!Number.isInteger(fields.price) || fields.price <= 0) {
      throw new Error(`Refusing to push invalid price (${fields.price} cents) to Clover item ${itemId}`)
    }
    body.price = fields.price
  }
  if (fields.code !== undefined) {
    if (fields.code !== '' && !/^2\d{5}$/.test(fields.code)) {
      throw new Error(`Refusing to push malformed barcode code "${fields.code}" to Clover item ${itemId}`)
    }
    body.code = fields.code
    if (fields.syncSku) body.sku = fields.code
  }
  if (Object.keys(body).length === 0) throw new Error('updateCloverItem called with no fields')
  return cloverFetch(`/merchants/${mid}/items/${itemId}`, {
    method: 'POST',
    body: JSON.stringify(body),
  })
}

// Fetch the full item catalog, paging through Clover's per-request cap.
export async function getCloverItems(): Promise<CloverItem[]> {
  const { mid } = creds()
  const out: CloverItem[] = []
  const limit = 1000
  let offset = 0
  for (;;) {
    const data = await cloverFetch(`/merchants/${mid}/items?limit=${limit}&offset=${offset}`)
    const els: CloverItem[] = data.elements ?? []
    out.push(...els)
    if (els.length < limit) break
    offset += limit
  }
  return out
}
