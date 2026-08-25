'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { installTelemetry, addBreadcrumb, getTelemetry } from '@/lib/feedbackTelemetry'
import { PhotoButton } from '@/app/cleaning/ui'

const C = {
  dark:       '#1A0A04',
  darkBrown:  '#351E0E',
  medBrown:   '#75471B',
  lightBrown: '#A6785A',
  tan:        '#C9A882',
  cream:      '#F2E8D9',
  green:      '#4CAF50',
  red:        '#EF4444',
  amber:      '#F59E0B',
}

// Three destinations behind one button.
//
// 'bug' and 'idea' are about the software and go to Charlie's punch list.
// 'cleaning' is about the plant — buildup on a machine, something the night
// crew missed — and goes to the cleaning issue inbox instead. Same button
// because the day crew spots these while they're on /processing or the
// scanner, not while browsing a cleaning menu, and a second floating button
// would be clutter competing with this one.
type ReportType = 'bug' | 'idea' | 'cleaning'

export default function FeedbackButton() {
  const pathname = usePathname()
  const [open, setOpen]             = useState(false)
  const [type, setType]             = useState<ReportType>('bug')
  const [description, setDescription] = useState('')
  const [submitter, setSubmitter]   = useState('')
  const [sending, setSending]       = useState(false)
  const [sent, setSent]             = useState(false)
  const [error, setError]           = useState<string | null>(null)
  // Only meaningful for a cleaning report: is this a heads-up for tonight, or
  // something last night's crew missed?
  const [intent, setIntent]         = useState<'heads_up' | 'miss'>('heads_up')
  const [urgent, setUrgent]         = useState(false)
  // A photo of the actual buildup, taken where it is. cleaning_issues has
  // carried a photo_url since the inbox was built and the inbox renders it —
  // but this widget is the only way an issue is ever filed, so until now the
  // column was always null and that <img> was dead code (Charlie, 2026-08-25:
  // "Can the cleaning module have a photo addition to it also?").
  const [photoUrl, setPhotoUrl]     = useState<string | null>(null)

  // Install client telemetry once (console errors, click/fetch/nav breadcrumbs).
  useEffect(() => { installTelemetry() }, [])

  // Staff tool — it stays off the inspector portal, which is a visitor-facing
  // read-only surface and not somewhere to file into Charlie's punch list.
  const hidden = pathname?.startsWith('/inspector') ?? false
  // Record route changes as breadcrumbs.
  useEffect(() => { addBreadcrumb('nav', `page → ${pathname}`) }, [pathname])

  // Name is required — a report you can't trace back to a person can't be
  // followed up on when it needs a question answered.
  const ready = Boolean(description.trim() && submitter.trim())

  async function submit() {
    if (!ready) return
    setSending(true)
    setError(null)

    // A plant problem is not an app bug. It goes to the crew who can actually
    // fix it, and carries none of the browser telemetry — that's diagnostic
    // context for software, and noise on a report about a dirty grinder.
    if (type === 'cleaning') {
      try {
        const res = await fetch('/api/cleaning/issues', {
          method:  'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            description: description.trim(),
            reported_by: submitter.trim(),
            intent,
            severity:    urgent ? 'urgent' : 'normal',
            photo_url:   photoUrl,
            page_url:    pathname,
          }),
        })
        if (!res.ok) {
          const body = await res.json().catch(() => null)
          setError(body?.error ?? `Didn't send (error ${res.status}) — try again.`)
          return
        }
        setSent(true)
        setTimeout(() => {
          setOpen(false)
          setSent(false)
          setDescription('')
          setSubmitter('')
          setType('bug')
          setIntent('heads_up')
          setUrgent(false)
          setPhotoUrl(null)
        }, 1500)
      } catch {
        setError("Didn't send — check your connection and try again.")
      } finally {
        setSending(false)
      }
      return
    }

    try {
      const telemetry = getTelemetry()
      const res = await fetch('/api/feedback', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type,
          description: description.trim(),
          submitter:   submitter.trim(),
          page_url:    pathname,
          ...telemetry,   // full_url, viewport, app_context, console_errors, breadcrumbs
        }),
      })
      // Only claim it sent if it actually did — never clear the box on a failure,
      // or the report is gone and nobody knows it went missing.
      if (!res.ok) {
        const body = await res.json().catch(() => null)
        setError(body?.error ?? `Didn't send (error ${res.status}) — try again.`)
        return
      }
      setSent(true)
      setTimeout(() => {
        setOpen(false)
        setSent(false)
        setDescription('')
        setSubmitter('')
        setType('bug')
      }, 1500)
    } catch {
      setError("Didn't send — check your connection and try again.")
    } finally {
      setSending(false)
    }
  }

  if (hidden) return null

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="Report a bug or idea"
        style={{
          position:        'fixed',
          bottom:          20,
          right:           20,
          width:           36,
          height:          36,
          borderRadius:    '50%',
          background:      C.darkBrown,
          border:          `1px solid ${C.medBrown}`,
          color:           C.tan,
          fontSize:        16,
          cursor:          'pointer',
          display:         'flex',
          alignItems:      'center',
          justifyContent:  'center',
          zIndex:          999,
          opacity:         0.45,
          transition:      'opacity 0.2s',
        } as React.CSSProperties}
        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
        onMouseLeave={e => (e.currentTarget.style.opacity = '0.45')}
      >
        💬
      </button>

      {open && (
        <div
          onClick={() => setOpen(false)}
          style={{
            position:       'fixed',
            inset:          0,
            background:     'rgba(0,0,0,0.55)',
            zIndex:         1000,
            display:        'flex',
            alignItems:     'flex-end',
            justifyContent: 'flex-end',
            padding:        20,
          } as React.CSSProperties}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              background:    C.darkBrown,
              border:        `1px solid ${C.medBrown}`,
              borderRadius:  12,
              padding:       20,
              width:         320,
              display:       'flex',
              flexDirection: 'column',
              gap:           14,
            } as React.CSSProperties}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span style={{ color: C.cream, fontWeight: 700, fontSize: 15 }}>
                {type === 'cleaning' ? 'Report a Cleaning Issue' : 'Send Feedback'}
              </span>
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: C.tan, cursor: 'pointer', fontSize: 18 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {(['bug', 'idea', 'cleaning'] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setType(t)}
                  style={{
                    flex:       1,
                    padding:    '6px 0',
                    borderRadius: 6,
                    border:     `1px solid ${type === t ? C.amber : C.medBrown}`,
                    background: type === t ? C.medBrown : 'transparent',
                    color:      type === t ? C.cream : C.tan,
                    cursor:     'pointer',
                    fontSize:   12,
                    fontWeight: type === t ? 700 : 400,
                  } as React.CSSProperties}
                >
                  {t === 'bug' ? '🐛 Bug' : t === 'idea' ? '💡 Idea' : '🧽 Cleaning'}
                </button>
              ))}
            </div>

            {type === 'cleaning' && (
              <>
                <div style={{ display: 'flex', gap: 6 }}>
                  {([
                    ['heads_up', 'For tonight'],
                    ['miss',     'Missed last night'],
                  ] as const).map(([val, label]) => (
                    <button
                      key={val}
                      onClick={() => setIntent(val)}
                      style={{
                        flex:       1,
                        padding:    '6px 0',
                        borderRadius: 6,
                        border:     `1px solid ${intent === val ? C.amber : C.medBrown}`,
                        background: intent === val ? C.medBrown : 'transparent',
                        color:      intent === val ? C.cream : C.tan,
                        cursor:     'pointer',
                        fontSize:   12,
                        fontWeight: intent === val ? 700 : 400,
                      } as React.CSSProperties}
                    >
                      {label}
                    </button>
                  ))}
                </div>

                {/* Urgent texts someone immediately, so it's a deliberate
                    toggle rather than a default anyone can leave switched on. */}
                <button
                  onClick={() => setUrgent(!urgent)}
                  style={{
                    padding:      '8px 0',
                    borderRadius: 6,
                    border:       `1px solid ${urgent ? C.red : C.medBrown}`,
                    background:   urgent ? `${C.red}33` : 'transparent',
                    color:        urgent ? C.cream : C.tan,
                    cursor:       'pointer',
                    fontSize:     12,
                    fontWeight:   urgent ? 700 : 400,
                  } as React.CSSProperties}
                >
                  {urgent ? '🚨 Urgent — texts right away' : 'Mark urgent'}
                </button>

                {/* On a phone this opens the camera. A photo of the buildup
                    settles in one look what a sentence has to argue about, and
                    the night crew reads these on a phone in a loud room.
                    kind=reference: the URL comes back for us to save on the
                    issue, rather than becoming a shift-documentation row that
                    belongs to a night nobody has worked yet. */}
                {photoUrl
                  ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={photoUrl} alt="Attached"
                        style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 6, border: `1px solid ${C.medBrown}` }}
                      />
                      <span style={{ color: C.tan, fontSize: 12, flex: 1 }}>Photo attached</span>
                      <button
                        onClick={() => setPhotoUrl(null)}
                        style={{
                          background: 'transparent', border: `1px solid ${C.medBrown}`,
                          borderRadius: 6, padding: '4px 10px', color: C.tan,
                          fontSize: 12, cursor: 'pointer',
                        } as React.CSSProperties}
                      >
                        Remove
                      </button>
                    </div>
                  )
                  : (
                    <PhotoButton
                      label="Add a photo"
                      extra={{ kind: 'reference' }}
                      onUploaded={url => setPhotoUrl(url)}
                    />
                  )}
              </>
            )}

            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={
                type === 'bug'      ? 'What went wrong?' :
                type === 'idea'     ? 'What would make this better?' :
                intent === 'miss'   ? "What wasn't clean?" :
                                      'What needs cleaning or fixing tonight?'
              }
              rows={4}
              style={{
                background:  C.dark,
                border:      `1px solid ${C.medBrown}`,
                borderRadius: 6,
                color:       C.cream,
                padding:     10,
                fontSize:    14,
                resize:      'vertical',
                outline:     'none',
                fontFamily:  'inherit',
              } as React.CSSProperties}
            />

            <input
              value={submitter}
              onChange={e => setSubmitter(e.target.value)}
              placeholder="Your name (required)"
              style={{
                background:  C.dark,
                border:      `1px solid ${C.medBrown}`,
                borderRadius: 6,
                color:       C.cream,
                padding:     '8px 10px',
                fontSize:    13,
                outline:     'none',
                fontFamily:  'inherit',
              } as React.CSSProperties}
            />

            <button
              onClick={submit}
              disabled={!ready || sending || sent}
              style={{
                background:   sent ? C.green : C.medBrown,
                border:       'none',
                borderRadius: 6,
                color:        C.cream,
                padding:      '10px 0',
                fontSize:     14,
                fontWeight:   700,
                cursor:       ready && !sending && !sent ? 'pointer' : 'default',
                opacity:      ready ? 1 : 0.5,
              } as React.CSSProperties}
            >
              {sent ? '✓ Sent!' : sending ? 'Sending…' : 'Send'}
            </button>

            {description.trim() && !submitter.trim() && (
              <div style={{ fontSize: 11, color: C.amber, textAlign: 'center', marginTop: -8 }}>
                Add your name so we can follow up.
              </div>
            )}

            {error && (
              <div style={{ fontSize: 12, color: C.red, textAlign: 'center', marginTop: -8 }}>
                {error}
              </div>
            )}

            <div style={{ fontSize: 11, color: C.lightBrown, textAlign: 'center' }}>
              {type === 'cleaning'
                ? 'Goes to the cleaning crew’s inbox'
                : `page: ${pathname}`}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
