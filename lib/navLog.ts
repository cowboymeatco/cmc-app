'use client'
// ──────────────────────────────────────────────────────────────────────────────
// Page-view logging — the unbiased twin of lib/feedbackTelemetry.ts.
//
// feedbackTelemetry keeps the last 12 clicks IN MEMORY and only ever ships them
// when somebody files a report, so every click path we have is a path that
// ended in a complaint. This module logs every page view to `nav_events` so we
// can tell a destination from a hallway without guessing.
//
// One row per COMPLETED view, flushed when the view ends. Recording the exit
// rather than the arrival is the whole point: it's the only way to know how long
// someone stayed on the page they actually worked on.
//
// Rules this follows:
//   • Never throws. A telemetry bug must not take a page down with it.
//   • Fire-and-forget. sendBeacon where available so a flush survives the
//     navigation that triggered it.
//   • No PII. Two opaque random ids, no name, no login, no query strings —
//     those carry customer names and record ids (e.g. ?id=<cut card uuid>).
// ──────────────────────────────────────────────────────────────────────────────

const DEVICE_KEY  = 'cmc_device_id'
const SESSION_KEY = 'cmc_nav_session_id'

// NOT crypto.randomUUID(). That threw on Jill's crew's WebKit build and swallowed
// a whole feedback submission (Amanda Lautt, 2026-07-27) — an id for a telemetry
// row is not worth repeating that. Math.random is plenty for bucketing devices.
function randomId(): string {
  return (
    Date.now().toString(36) +
    Math.random().toString(36).slice(2, 10) +
    Math.random().toString(36).slice(2, 10)
  )
}

// Private mode / blocked storage throws on access, not just on write.
function stored(store: 'local' | 'session', key: string): string {
  try {
    const s = store === 'local' ? window.localStorage : window.sessionStorage
    let v = s.getItem(key)
    if (!v) { v = randomId(); s.setItem(key, v) }
    return v
  } catch {
    // Storage unavailable: fall back to a per-load id so the view still counts.
    return `eph_${randomId()}`
  }
}

// Query strings are stripped before anything leaves the browser — /cutting-
// instructions?id=<uuid> and customer-name params must not end up in a
// telemetry table.
function cleanPath(p: string): string {
  return (p || '/').split('?')[0].split('#')[0].slice(0, 200)
}

type View = { path: string; enteredAt: number }

let current: View | null = null
let installed = false

function flush(nextPath: string | null, endedBy: 'route' | 'hidden' | 'pagehide') {
  if (!current) return
  const view = current
  // Clear first: a flush must never be able to fire twice for the same view
  // (visibilitychange and pagehide both fire when a tab is closed).
  current = null

  const dwellMs = Date.now() - view.enteredAt
  // Sub-second blips are React remounts and redirect bounces, not visits.
  if (dwellMs < 250) return

  const payload = JSON.stringify({
    device_id:  stored('local', DEVICE_KEY),
    session_id: stored('session', SESSION_KEY),
    path:       view.path,
    next_path:  nextPath ? cleanPath(nextPath) : null,
    entered_at: new Date(view.enteredAt).toISOString(),
    dwell_ms:   Math.min(dwellMs, 86_400_000), // a tablet left open overnight is not a 14-hour read
    ended_by:   endedBy,
    viewport:   `${window.innerWidth}x${window.innerHeight}`,
  })

  try {
    // sendBeacon survives the unload that a route change or tab close causes;
    // fetch would be cancelled mid-flight. Falls back to keepalive fetch.
    const sent = navigator.sendBeacon?.(
      '/api/nav',
      new Blob([payload], { type: 'application/json' }),
    )
    if (!sent) {
      void fetch('/api/nav', {
        method:   'POST',
        keepalive: true,
        headers:  { 'Content-Type': 'application/json' },
        body:     payload,
      }).catch(() => {})
    }
  } catch { /* telemetry never breaks a page */ }
}

// Called on every route change. Ends the previous view, starts the new one.
export function recordNav(pathname: string) {
  if (typeof window === 'undefined') return
  try {
    const path = cleanPath(pathname)
    if (current?.path === path) return // same page re-render, not a navigation
    flush(path, 'route')
    current = { path, enteredAt: Date.now() }
  } catch { /* ignore */ }
}

// Idempotent. Ends the open view when the tab is backgrounded or closed —
// without this, the last page of every visit (usually the one they came to do
// work on) would never be recorded at all.
export function installNavLog() {
  if (installed || typeof window === 'undefined') return
  installed = true
  try {
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flush(null, 'hidden')
      } else if (!current) {
        // Back from a backgrounded tab: this is a fresh view of the same page.
        current = { path: cleanPath(window.location.pathname), enteredAt: Date.now() }
      }
    })
    window.addEventListener('pagehide', () => flush(null, 'pagehide'))
  } catch { /* ignore */ }
}
