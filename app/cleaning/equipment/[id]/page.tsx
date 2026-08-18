'use client'
import { useEffect, useState, use } from 'react'
import Link from 'next/link'
import { PHASES, PHASE_LABEL, type CleaningStep, type Phase } from '@/lib/cleaning'
import {
  C, TAP, useCrewMember, CleaningHeader, Banner, BigButton,
  PhotoButton, inputStyle, cardStyle,
} from '../../ui'

// One machine's procedure: how it comes apart, gets cleaned, and goes back
// together.
//
// Reassembly is the half that actually costs money when it goes wrong, so the
// three phases are equal citizens here rather than teardown with an afterthought.
// Reference photos are shown large — a picture of how the auger seats is worth
// more than the sentence describing it.

interface Equipment {
  id: string
  name: string
  make_model: string | null
  notes: string | null
  cleaning_areas: { id: string; name: string } | { id: string; name: string }[] | null
  steps: CleaningStep[]
  documented: boolean
}

export default function ProcedurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const { member } = useCrewMember()

  const [equip,   setEquip]   = useState<Equipment | null>(null)
  const [loading, setLoading] = useState(true)
  const [phase,   setPhase]   = useState<Phase>('teardown')
  const [suggesting, setSuggesting] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/cleaning/equipment?id=${id}`)
      .then(r => r.json())
      .then(d => setEquip(d?.error ? null : d))
      .catch(() => setEquip(null))
      .finally(() => setLoading(false))
  }, [id])

  if (loading) return <div style={{ padding: 24, color: C.tan }}>Loading…</div>
  if (!equip)  return (
    <>
      <CleaningHeader title="Not found" back="/cleaning/equipment" />
      <div style={{ padding: 20, color: C.tan }}>That machine isn&apos;t in the list.</div>
    </>
  )

  const area = Array.isArray(equip.cleaning_areas) ? equip.cleaning_areas[0] : equip.cleaning_areas
  const steps = equip.steps.filter(s => s.phase === phase)

  return (
    <div style={{ paddingBottom: 60 }}>
      <CleaningHeader title={equip.name} back="/cleaning/equipment" member={member} />

      <div style={{ padding: 16, maxWidth: 720, margin: '0 auto' }}>
        <div style={{ color: C.tan, fontSize: 13, marginBottom: 14 }}>
          {area?.name}
          {equip.make_model && ` · ${equip.make_model}`}
        </div>

        {equip.notes && (
          <div style={{ ...cardStyle, marginBottom: 14, fontSize: 14, color: C.tan }}>
            {equip.notes}
          </div>
        )}

        {!equip.documented && (
          <div style={{ ...cardStyle, textAlign: 'center', marginBottom: 16 }}>
            <p style={{ color: C.cream, fontSize: 16, marginBottom: 8 }}>
              Nothing written up for this one yet
            </p>
            <p style={{ color: C.tan, fontSize: 14, lineHeight: 1.5, marginBottom: 14 }}>
              Next time someone tears it down, walk through it with the phone —
              a photo and a sentence per step is enough, and it beats the version
              that only lives in one person&apos;s head.
            </p>
            <Link
              href="/cleaning/admin"
              style={{
                display: 'inline-block', background: C.medBrown, color: C.cream,
                padding: '12px 20px', borderRadius: 8, textDecoration: 'none',
                fontSize: 15, fontWeight: 700,
              }}
            >
              Write it up
            </Link>
          </div>
        )}

        {equip.documented && (
          <>
            {/* Phase switcher */}
            <div style={{ display: 'flex', gap: 6, marginBottom: 16 }}>
              {PHASES.map(p => {
                const count  = equip.steps.filter(s => s.phase === p).length
                const active = phase === p
                return (
                  <button
                    key={p}
                    onClick={() => setPhase(p)}
                    style={{
                      flex: 1, minHeight: 52, borderRadius: 8,
                      background: active ? C.medBrown : C.dark,
                      border: `1px solid ${active ? C.amber : C.medBrown}`,
                      color: active ? C.cream : C.tan,
                      fontSize: 13, fontWeight: active ? 700 : 400,
                      cursor: 'pointer', padding: '6px 4px', lineHeight: 1.3,
                    }}
                  >
                    {PHASE_LABEL[p]}
                    <div style={{ fontSize: 11, opacity: 0.7 }}>{count} step{count === 1 ? '' : 's'}</div>
                  </button>
                )
              })}
            </div>

            {steps.length === 0 && (
              <div style={{ ...cardStyle, color: C.tan, fontSize: 14, textAlign: 'center' }}>
                No {PHASE_LABEL[phase].toLowerCase()} steps written yet.
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              {steps.map(step => (
                <div key={step.id} style={cardStyle}>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <div style={{
                      width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                      background: C.medBrown, color: C.cream,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: 15, fontWeight: 700,
                    }}>
                      {step.step_no}
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ color: C.cream, fontSize: 16, lineHeight: 1.45 }}>
                        {step.instruction}
                      </div>

                      {step.caution && (
                        <div style={{
                          marginTop: 10, background: `${C.red}22`,
                          border: `1px solid ${C.red}`, borderRadius: 6,
                          padding: '8px 10px', color: C.cream, fontSize: 14,
                        }}>
                          ⚠ {step.caution}
                        </div>
                      )}

                      {step.photo_url && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={step.photo_url} alt={`Step ${step.step_no}`}
                          style={{
                            width: '100%', marginTop: 10, borderRadius: 8,
                            border: `1px solid ${C.medBrown}`,
                          }}
                        />
                      )}

                      <button
                        onClick={() => setSuggesting(suggesting === step.id ? null : step.id)}
                        style={{
                          marginTop: 10, background: 'none', border: 'none',
                          color: C.lightBrown, fontSize: 13, cursor: 'pointer', padding: 0,
                        }}
                      >
                        {suggesting === step.id ? 'Cancel' : 'This step is wrong →'}
                      </button>

                      {suggesting === step.id && (
                        <SuggestBox
                          equipmentId={equip.id}
                          stepId={step.id}
                          by={member?.name}
                          onDone={() => setSuggesting(null)}
                        />
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div style={{ marginTop: 20 }}>
              <button
                onClick={() => setSuggesting(suggesting === 'whole' ? null : 'whole')}
                style={{
                  width: '100%', minHeight: TAP, background: C.dark,
                  border: `1px dashed ${C.medBrown}`, borderRadius: 10,
                  color: C.tan, fontSize: 15, cursor: 'pointer',
                }}
              >
                {suggesting === 'whole' ? 'Cancel' : '💡 Something missing from this procedure?'}
              </button>
              {suggesting === 'whole' && (
                <SuggestBox
                  equipmentId={equip.id}
                  by={member?.name}
                  onDone={() => setSuggesting(null)}
                />
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

// Crew corrections. Captured, not applied — the write-up stays owned by
// whoever maintains it, but the person who does the work nightly gets heard.
function SuggestBox({ equipmentId, stepId, by, onDone }: {
  equipmentId: string
  stepId?: string
  by?: string
  onDone: () => void
}) {
  const [text,  setText]  = useState('')
  const [photo, setPhoto] = useState<string | null>(null)
  const [name,  setName]  = useState(by ?? '')
  const [sent,  setSent]  = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    const res = await fetch('/api/cleaning/suggestions', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        equipment_id: equipmentId,
        step_id:      stepId,
        suggestion:   text,
        suggested_by: name,
        photo_url:    photo,
      }),
    })
    const body = await res.json()
    if (!res.ok) { setError(body?.error ?? "That didn't send."); return }
    setSent(true)
    setTimeout(onDone, 1400)
  }

  if (sent) return <Banner tone="ok">Thanks — passed along.</Banner>

  return (
    <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 10 }}>
      {error && <Banner tone="error">{error}</Banner>}
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="What's wrong, or what's missing?"
        rows={3}
        style={{ ...inputStyle, resize: 'vertical' }}
      />
      {!by && (
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder="Your name"
          style={inputStyle}
        />
      )}
      <PhotoButton
        label={photo ? 'Photo attached ✓' : 'Add a photo'}
        extra={{ kind: 'reference' }}
        onUploaded={url => setPhoto(url)}
      />
      <BigButton
        label="Send"
        onClick={submit}
        disabled={!text.trim() || !name.trim()}
      />
    </div>
  )
}
