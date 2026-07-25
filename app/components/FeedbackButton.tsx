'use client'
import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import { installTelemetry, addBreadcrumb, getTelemetry } from '@/lib/feedbackTelemetry'

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

export default function FeedbackButton() {
  const pathname = usePathname()
  const [open, setOpen]             = useState(false)
  const [type, setType]             = useState<'bug' | 'idea'>('bug')
  const [description, setDescription] = useState('')
  const [submitter, setSubmitter]   = useState('')
  const [sending, setSending]       = useState(false)
  const [sent, setSent]             = useState(false)
  const [error, setError]           = useState<string | null>(null)

  // Install client telemetry once (console errors, click/fetch/nav breadcrumbs).
  useEffect(() => { installTelemetry() }, [])
  // Record route changes as breadcrumbs.
  useEffect(() => { addBreadcrumb('nav', `page → ${pathname}`) }, [pathname])

  // Name is required — a report you can't trace back to a person can't be
  // followed up on when it needs a question answered.
  const ready = Boolean(description.trim() && submitter.trim())

  async function submit() {
    if (!ready) return
    setSending(true)
    setError(null)
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
              <span style={{ color: C.cream, fontWeight: 700, fontSize: 15 }}>Send Feedback</span>
              <button
                onClick={() => setOpen(false)}
                style={{ background: 'none', border: 'none', color: C.tan, cursor: 'pointer', fontSize: 18 }}
              >
                ✕
              </button>
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              {(['bug', 'idea'] as const).map(t => (
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
                    fontSize:   13,
                    fontWeight: type === t ? 700 : 400,
                  } as React.CSSProperties}
                >
                  {t === 'bug' ? '🐛 Bug' : '💡 Idea'}
                </button>
              ))}
            </div>

            <textarea
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder={type === 'bug' ? 'What went wrong?' : 'What would make this better?'}
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
              page: {pathname}
            </div>
          </div>
        </div>
      )}
    </>
  )
}
