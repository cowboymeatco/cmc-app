'use client'
// ──────────────────────────────────────────────────────────────────────────────
// Lightweight client telemetry for the Crew Feedback widget.
//
// Captures, IN-MEMORY ONLY (bounded ring buffers, reset on full page reload):
//   • recent console.error / window error events
//   • an action breadcrumb trail (clicks, route changes, mutating fetches)
//   • a page-supplied "app context" blob (selected date / tab / record, etc.)
//
// No network calls, no localStorage, no PII beyond what a user types into a
// button label. The point: snapshot the technical state at submit time so a bug
// report is self-diagnosing instead of needing reconstruction after the fact.
// ──────────────────────────────────────────────────────────────────────────────

type Breadcrumb = { t: string; kind: 'click' | 'nav' | 'fetch'; label: string }

const MAX_ERRORS = 8
const MAX_CRUMBS = 12

const errors: string[] = []
const crumbs: Breadcrumb[] = []
let context: Record<string, unknown> = {}
let installed = false

const nowISO = () => new Date().toISOString()

function pushError(msg: string) {
  errors.push(`${nowISO()}  ${msg}`.slice(0, 500))
  while (errors.length > MAX_ERRORS) errors.shift()
}

export function addBreadcrumb(kind: Breadcrumb['kind'], label: string) {
  const clean = (label || '').replace(/\s+/g, ' ').trim().slice(0, 80)
  if (!clean) return
  crumbs.push({ t: nowISO(), kind, label: clean })
  while (crumbs.length > MAX_CRUMBS) crumbs.shift()
}

// Pages call this (usually in a useEffect) to register what the user is looking
// at. Merges, so several keys can be set independently. clearFeedbackContext on
// unmount so stale state from another page doesn't leak into the next report.
export function setFeedbackContext(ctx: Record<string, unknown>) {
  context = { ...context, ...ctx }
}
export function clearFeedbackContext(keys?: string[]) {
  if (!keys) { context = {}; return }
  for (const k of keys) delete context[k]
}

// Snapshot everything the widget should attach to a submission.
export function getTelemetry() {
  const w = typeof window !== 'undefined' ? window : null
  return {
    full_url:       w ? w.location.href : null,
    viewport:       w ? `${w.innerWidth}x${w.innerHeight} @${w.devicePixelRatio || 1}x` : null,
    app_context:    Object.keys(context).length ? { ...context } : null,
    console_errors: errors.length ? errors.slice() : null,
    breadcrumbs:    crumbs.length ? crumbs.slice() : null,
  }
}

// Idempotent. Safe to call on every mount of the global feedback button.
export function installTelemetry() {
  if (installed || typeof window === 'undefined') return
  installed = true

  // ── console.error ──
  const origError = console.error.bind(console)
  console.error = (...args: unknown[]) => {
    try {
      pushError(args.map(a =>
        a instanceof Error ? (a.stack || a.message)
        : typeof a === 'object' ? JSON.stringify(a)
        : String(a),
      ).join(' '))
    } catch { /* never let telemetry break logging */ }
    origError(...args)
  }

  // ── uncaught errors / rejections ──
  window.addEventListener('error', e =>
    pushError(`window.onerror: ${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`))
  window.addEventListener('unhandledrejection', e =>
    pushError(`unhandledrejection: ${String((e as PromiseRejectionEvent).reason)}`))

  // ── click breadcrumbs (nearest button/link/role=button) ──
  document.addEventListener('click', e => {
    const el = (e.target as HTMLElement)?.closest?.('button, a, [role="button"]') as HTMLElement | null
    if (!el) return
    const label = el.getAttribute('aria-label') || el.textContent || el.getAttribute('title') || ''
    addBreadcrumb('click', label)
  }, true)

  // ── mutating-fetch breadcrumbs (POST/PATCH/PUT/DELETE) ──
  const origFetch = window.fetch.bind(window)
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase()
    const res = await origFetch(input as RequestInfo, init)
    if (method !== 'GET' && method !== 'HEAD') {
      try {
        const raw  = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
        const path = new URL(raw, window.location.origin).pathname
        addBreadcrumb('fetch', `${method} ${path} → ${res.status}`)
      } catch { /* ignore */ }
    }
    return res
  }
}
