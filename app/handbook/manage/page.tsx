'use client'
// /handbook/manage — the manager side of the handbook and role documents,
// behind the /exec passphrase.
//
// A document is a page of markdown. Editing saves a DRAFT that only this page
// can see; Publish freezes the draft as the next version, and that is what
// the crew reads at /handbook and acknowledges. So the handbook can be worked
// on for a week without anyone signing off on half-finished policy.
//
//   Everyone   — the handbook: every active employee reads it.
//   Assigned   — a Roles & Responsibilities page: only the people ticked here.
//
// Nothing is deleted — an acknowledgment is a record. Archive instead.

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { AUDIENCE_LABEL, HrAudience, HrManageDoc, buildPrintHTML, dayMT, docCss, openPrint, renderMarkdown, stampMT } from '@/lib/hrDocs'
import { C, Pill, api, btn, card, h2, td, th } from '../../timekeeping/shared'

interface Emp { id: string; name: string; role: string | null; hasPin: boolean }
interface Data { docs: HrManageDoc[]; employees: Emp[] }
interface Draft { title: string; audience: HrAudience; body: string; assignedTo: string[] }

const input: React.CSSProperties = { width: '100%', background: C.darkBrown, color: C.cream, border: `1px solid ${C.medBrown}`, borderRadius: 4, padding: '0.55rem 0.6rem', fontSize: '0.95rem', boxSizing: 'border-box' }
const label: React.CSSProperties = { display: 'block', fontSize: '0.7rem', color: C.lightBrown, textTransform: 'uppercase', letterSpacing: '0.08em', margin: '0 0 0.25rem' }
const ghost: React.CSSProperties = { ...btn('transparent'), border: `1px solid ${C.medBrown}`, color: C.tan }

const draftOf = (d: HrManageDoc): Draft => ({ title: d.title, audience: d.audience, body: d.body, assignedTo: [...d.assignedTo].sort() })
const sameDraft = (a: Draft, b: Draft) => a.title === b.title && a.audience === b.audience && a.body === b.body && a.assignedTo.join() === b.assignedTo.join()

export default function HandbookManagePage() {
  const [data, setData] = useState<Data | null>(null)
  const [needLogin, setNeedLogin] = useState(false)
  const [error, setError] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [showArchived, setShowArchived] = useState(false)

  const reload = useCallback(async () => {
    try {
      setData(await api<Data>('/api/handbook/manage/docs'))
      setNeedLogin(false); setError('')
    } catch (e) {
      if ((e as { status?: number }).status === 401) setNeedLogin(true)
      else setError((e as Error).message)
    }
  }, [])
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- loading on mount; state is only set once the request resolves
    reload()
  }, [reload])

  const header = (
    <header style={{ background: C.dark, borderBottom: '1px solid rgba(166,120,90,0.3)', padding: '0 1.25rem', minHeight: 72, display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
      <Link href="/" style={{ color: C.lightBrown, textDecoration: 'none', fontSize: '0.82rem' }}>← Dashboard</Link>
      <span style={{ color: 'rgba(166,120,90,0.3)' }}>|</span>
      <div>
        <h1 style={{ fontFamily: 'Georgia, serif', fontSize: '1.1rem', fontWeight: 700, color: C.cream, textTransform: 'uppercase', letterSpacing: '0.08em', margin: 0 }}>Handbook &amp; Roles</h1>
        <p style={{ fontSize: '0.68rem', color: C.lightBrown, letterSpacing: '0.15em', textTransform: 'uppercase', margin: 0 }}>Write · publish · assign · sign-off</p>
      </div>
      <a href="/handbook" target="_blank" rel="noreferrer" style={{ marginLeft: 'auto', color: C.tan, fontSize: '0.8rem' }}>Open the crew view ↗</a>
    </header>
  )

  if (needLogin) return <div style={{ minHeight: '100vh', background: C.darkBrown }}>{header}<Login onDone={reload} /></div>
  if (!data) {
    return (
      <div style={{ minHeight: '100vh', background: C.darkBrown }}>
        {header}
        <div style={{ padding: '2rem', color: error ? C.red : C.tan, textAlign: 'center' }}>{error || 'Loading…'}</div>
      </div>
    )
  }

  const shown = data.docs.filter(d => showArchived || !d.archived)
  const current = data.docs.find(d => d.id === selected) ?? null

  return (
    <div style={{ minHeight: '100vh', background: C.darkBrown }}>
      {header}
      <main style={{ padding: '1rem 1.25rem 3rem', maxWidth: 1200, margin: '0 auto' }}>
        {error && <div style={{ color: C.red, marginBottom: '0.6rem' }}>{error}</div>}

        {!current && (
          <>
            <NewDoc employees={data.employees} onCreated={async id => { await reload(); setSelected(id) }} />
            <div style={card}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
                <h2 style={{ ...h2, margin: 0 }}>Documents</h2>
                {data.docs.some(d => d.archived) && (
                  <label style={{ color: C.tan, fontSize: '0.8rem', marginLeft: 'auto' }}>
                    <input type="checkbox" checked={showArchived} onChange={e => setShowArchived(e.target.checked)} /> Show archived
                  </label>
                )}
              </div>
              {shown.length === 0 && <p style={{ color: C.tan, fontSize: '0.9rem' }}>No documents yet. Start one above.</p>}
              {shown.length > 0 && (
                <div style={{ overflowX: 'auto' }}>
                  <table style={{ borderCollapse: 'collapse', width: '100%', marginTop: '0.6rem' }}>
                    <thead><tr><th style={th}>Document</th><th style={th}>For</th><th style={th}>Status</th><th style={th}>Acknowledged</th><th style={th} /></tr></thead>
                    <tbody>
                      {shown.map(d => {
                        const done = d.readers.filter(r => r.acknowledgedAt).length
                        return (
                          <tr key={d.id}>
                            <td style={td}><b>{d.title}</b></td>
                            <td style={td}>{d.audience === 'everyone' ? 'Everyone' : d.assignedTo.length ? d.assignedTo.map(id => data.employees.find(e => e.id === id)?.name ?? 'inactive').join(', ') : <span style={{ color: C.amber }}>nobody yet</span>}</td>
                            <td style={td}><StatusPills d={d} /></td>
                            <td style={td}>{d.publishedVersion === 0 ? '—' : <span style={{ color: done === d.readers.length && d.readers.length ? C.green : C.amber }}>{done} of {d.readers.length}</span>}</td>
                            <td style={{ ...td, textAlign: 'right' }}><button style={btn(C.medBrown)} onClick={() => setSelected(d.id)}>Open</button></td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
            {data.employees.some(e => !e.hasPin) && (
              <p style={{ color: C.tan, fontSize: '0.8rem' }}>
                No PIN yet, so they can&apos;t sign in to the handbook: {data.employees.filter(e => !e.hasPin).map(e => e.name).join(', ')}.
                They pick one at the time clock iPad. The crew list itself is <Link href="/timekeeping" style={{ color: C.cream }}>Timekeeping → Employees</Link>.
              </p>
            )}
          </>
        )}

        {current && <Editor key={current.id} doc={current} employees={data.employees} reload={reload} onBack={() => setSelected(null)} />}
      </main>
    </div>
  )
}

function StatusPills({ d }: { d: HrManageDoc }) {
  if (d.archived) return <Pill color={C.lightBrown}>Archived</Pill>
  if (d.publishedVersion === 0) return <Pill color={C.amber}>Draft — not published</Pill>
  return (
    <>
      <Pill color={C.green}>Published v{d.publishedVersion}</Pill>
      {d.dirty && <Pill color={C.amber}>Unpublished changes</Pill>}
    </>
  )
}

// ── New document ────────────────────────────────────────────────────────────

function NewDoc({ employees, onCreated }: { employees: Emp[]; onCreated: (id: string) => Promise<void> }) {
  const [title, setTitle] = useState('')
  const [audience, setAudience] = useState<HrAudience>('assigned')
  const [assignedTo, setAssignedTo] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const create = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try {
      const r = await api<{ id: string }>('/api/handbook/manage/docs', { method: 'POST', body: JSON.stringify({ title, audience, assignedTo }) })
      setTitle(''); setAssignedTo([])
      await onCreated(r.id)
    } catch (x) { setErr((x as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <form onSubmit={create} style={card}>
      <h2 style={h2}>New document</h2>
      <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'flex-end' }}>
        <div style={{ flex: '2 1 260px' }}>
          <label style={label}>Title</label>
          <input style={input} value={title} onChange={e => setTitle(e.target.value)} placeholder="Retail & Front Desk Associate — Roles and Responsibilities" />
        </div>
        <div style={{ flex: '1 1 220px' }}>
          <label style={label}>Who is it for</label>
          <select style={input} value={audience} onChange={e => setAudience(e.target.value as HrAudience)}>
            {(Object.keys(AUDIENCE_LABEL) as HrAudience[]).map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
          </select>
        </div>
        <button type="submit" style={btn(C.green)} disabled={busy || !title.trim()}>{busy ? 'Creating…' : 'Create draft'}</button>
      </div>
      {audience === 'assigned' && <AssignBoxes employees={employees} value={assignedTo} onChange={setAssignedTo} />}
      {err && <div style={{ color: C.red, fontSize: '0.85rem', marginTop: '0.5rem' }}>{err}</div>}
    </form>
  )
}

function AssignBoxes({ employees, value, onChange }: { employees: Emp[]; value: string[]; onChange: (v: string[]) => void }) {
  if (!employees.length) return <p style={{ color: C.amber, fontSize: '0.85rem', margin: '0.7rem 0 0' }}>Nobody is on the time clock yet. Add the crew under Timekeeping → Employees first.</p>
  return (
    <div style={{ marginTop: '0.7rem' }}>
      <span style={label}>Assigned to</span>
      <div style={{ display: 'flex', gap: '0.4rem 1rem', flexWrap: 'wrap' }}>
        {employees.map(e => (
          <label key={e.id} style={{ color: C.cream, fontSize: '0.9rem' }}>
            <input type="checkbox" checked={value.includes(e.id)}
              onChange={x => onChange(x.target.checked ? [...value, e.id].sort() : value.filter(id => id !== e.id))} /> {e.name}
            {e.role && <span style={{ color: C.lightBrown }}> · {e.role}</span>}
          </label>
        ))}
      </div>
    </div>
  )
}

// ── Editor ──────────────────────────────────────────────────────────────────

function Editor({ doc, employees, reload, onBack }: { doc: HrManageDoc; employees: Emp[]; reload: () => Promise<void>; onBack: () => void }) {
  const saved = useMemo(() => draftOf(doc), [doc])
  const [draft, setDraft] = useState<Draft>(saved)
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  const [msg, setMsg] = useState('')
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [preview, setPreview] = useState(false)
  const [signFor, setSignFor] = useState('')

  const unsaved = !sameDraft(draft, saved)
  // What Publish would change: the saved draft against the published copy, or edits not saved yet.
  const publishable = !doc.archived && draft.body.trim() !== '' && (doc.dirty || unsaved)
  // Safe to inject: renderMarkdown escapes the document and adds only its own tags.
  const html = useMemo(() => renderMarkdown(draft.body), [draft.body])

  const run = async (what: string, fn: () => Promise<void>) => {
    setBusy(what); setErr(''); setMsg('')
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy('') }
  }
  const patch = (body: object) => api(`/api/handbook/manage/docs/${doc.id}`, { method: 'PATCH', body: JSON.stringify(body) })

  const save = () => run('save', async () => { await patch(draft); await reload(); setMsg('Draft saved. The crew still sees the published version.') })
  const publish = () => run('publish', async () => {
    if (unsaved) await patch(draft)
    const r = await api<{ version: number }>(`/api/handbook/manage/docs/${doc.id}/publish`, { method: 'POST' })
    setConfirmPublish(false)
    await reload()
    setMsg(`Published as version ${r.version}.`)
  })
  const archive = (archived: boolean) => run('archive', async () => { await patch({ archived }); await reload() })

  const print = (withSign: boolean) => {
    // The page on screen is the published one only if nothing has changed since.
    const asPublished = doc.publishedVersion > 0 && !doc.dirty && !unsaved
    const done = doc.readers.filter(r => r.acknowledgedAt)
    const ok = openPrint(buildPrintHTML({
      title: draft.title, body: draft.body,
      versionLine: asPublished
        ? `Version ${doc.publishedVersion} · published ${doc.publishedAt ? dayMT(doc.publishedAt) : ''}`
        : `DRAFT — not the published version · printed ${dayMT(new Date().toISOString())}`,
      signFor: withSign ? signFor : undefined,
      // Sign-offs belong to the published text; never list them under a draft.
      acks: withSign || !asPublished ? undefined : done.map(r => ({ name: r.name, acknowledgedAt: r.acknowledgedAt! })),
    }))
    if (!ok) setErr('Your browser blocked the printout. Allow pop-ups for this site and try again.')
  }

  const leave = () => { if (!unsaved || window.confirm('You have changes that aren\'t saved. Leave anyway?')) onBack() }

  return (
    <>
      <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.8rem' }}>
        <button style={ghost} onClick={leave}>← All documents</button>
        <StatusPills d={doc} />
        {unsaved && <Pill color={C.red}>Not saved</Pill>}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap' }}>
          <div style={{ flex: '2 1 280px' }}>
            <label style={label}>Title</label>
            <input style={input} value={draft.title} onChange={e => setDraft({ ...draft, title: e.target.value })} />
          </div>
          <div style={{ flex: '1 1 220px' }}>
            <label style={label}>Who is it for</label>
            <select style={input} value={draft.audience} onChange={e => setDraft({ ...draft, audience: e.target.value as HrAudience })}>
              {(Object.keys(AUDIENCE_LABEL) as HrAudience[]).map(a => <option key={a} value={a}>{AUDIENCE_LABEL[a]}</option>)}
            </select>
          </div>
        </div>
        {draft.audience === 'assigned' && <AssignBoxes employees={employees} value={draft.assignedTo} onChange={v => setDraft({ ...draft, assignedTo: v })} />}
        {draft.audience === 'everyone' && doc.audience === 'assigned' && (
          <p style={{ color: C.amber, fontSize: '0.85rem', margin: '0.6rem 0 0' }}>Saving this makes the published version visible to the whole crew.</p>
        )}
      </div>

      <div style={card}>
        <style>{docCss('.hr-doc', C.cream, C.tan, 'rgba(166,120,90,0.4)')}</style>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap', marginBottom: '0.6rem' }}>
          <h2 style={{ ...h2, margin: 0 }}>Page</h2>
          <button style={preview ? ghost : btn(C.medBrown)} onClick={() => setPreview(false)}>Write</button>
          <button style={preview ? btn(C.medBrown) : ghost} onClick={() => setPreview(true)}>Preview</button>
          <span style={{ color: C.lightBrown, fontSize: '0.75rem', marginLeft: 'auto' }}>
            # Heading · ## Section · **bold** · - bullet · 1. numbered · | table | row | · --- line
          </span>
        </div>
        {preview
          ? <div className="hr-doc" style={{ minHeight: 300 }} dangerouslySetInnerHTML={{ __html: html || '<p><i>Nothing written yet.</i></p>' }} />
          : <textarea value={draft.body} onChange={e => setDraft({ ...draft, body: e.target.value })} spellCheck
              style={{ ...input, minHeight: '60vh', fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: '0.88rem', lineHeight: 1.5, resize: 'vertical' }} />}
      </div>

      <div style={card}>
        <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap', alignItems: 'center' }}>
          <button style={btn(C.medBrown)} disabled={!!busy || !unsaved || !draft.title.trim()} onClick={save}>{busy === 'save' ? 'Saving…' : 'Save draft'}</button>
          {!confirmPublish && <button style={btn(C.green)} disabled={!!busy || !publishable || !draft.title.trim()} onClick={() => setConfirmPublish(true)}>Publish…</button>}
          <button style={ghost} onClick={() => print(false)}>Print / PDF</button>
          <span style={{ display: 'inline-flex', gap: '0.4rem', alignItems: 'center' }}>
            <input style={{ ...input, width: 190 }} value={signFor} onChange={e => setSignFor(e.target.value)} placeholder="Name for signature line" />
            <button style={ghost} onClick={() => print(true)}>Print with signature block</button>
          </span>
          <button style={{ ...ghost, marginLeft: 'auto' }} disabled={!!busy} onClick={() => archive(!doc.archived)}>{doc.archived ? 'Restore from archive' : 'Archive'}</button>
        </div>
        {confirmPublish && (
          <div style={{ marginTop: '0.8rem', padding: '0.8rem', border: `1px solid ${C.amber}`, borderRadius: 4 }}>
            <p style={{ color: C.cream, fontSize: '0.9rem', margin: '0 0 0.6rem', lineHeight: 1.5 }}>
              This becomes <b>version {doc.publishedVersion + 1}</b> and is what {draft.audience === 'everyone' ? 'the whole crew' : draft.assignedTo.length ? `${draft.assignedTo.length} assigned ${draft.assignedTo.length === 1 ? 'person' : 'people'}` : 'nobody (no one is assigned yet)'} will read.
              {doc.publishedVersion > 0 && ' Everyone who acknowledged the old version is asked to acknowledge again; their old sign-off stays on record.'}
            </p>
            <button style={btn(C.green)} disabled={!!busy} onClick={publish}>{busy === 'publish' ? 'Publishing…' : `Publish version ${doc.publishedVersion + 1}`}</button>{' '}
            <button style={ghost} disabled={!!busy} onClick={() => setConfirmPublish(false)}>Cancel</button>
          </div>
        )}
        {err && <div style={{ color: C.red, fontSize: '0.85rem', marginTop: '0.6rem' }}>{err}</div>}
        {msg && <div style={{ color: C.green, fontSize: '0.85rem', marginTop: '0.6rem' }}>{msg}</div>}
      </div>

      <div style={card}>
        <h2 style={h2}>Sign-off{doc.publishedVersion > 0 ? ` — version ${doc.publishedVersion}` : ''}</h2>
        {doc.publishedVersion === 0 && <p style={{ color: C.tan, fontSize: '0.9rem', margin: 0 }}>Not published yet, so there is nothing for anyone to acknowledge.</p>}
        {doc.publishedVersion > 0 && doc.readers.length === 0 && <p style={{ color: C.amber, fontSize: '0.9rem', margin: 0 }}>Nobody is assigned to this document.</p>}
        {doc.readers.length > 0 && (
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr><th style={th}>Team member</th><th style={th}>Acknowledged</th></tr></thead>
            <tbody>
              {doc.readers.map(r => (
                <tr key={r.employeeId}>
                  <td style={td}>{r.name}</td>
                  <td style={{ ...td, color: r.acknowledgedAt ? C.green : C.amber }}>{r.acknowledgedAt ? `✓ ${stampMT(r.acknowledgedAt)}` : 'Not yet'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </>
  )
}

/** The /exec passphrase — same gate, same 30-day session. */
function Login({ onDone }: { onDone: () => Promise<void> }) {
  const [pass, setPass] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true); setErr('')
    try { await api('/api/exec/login', { method: 'POST', body: JSON.stringify({ pass }) }); await onDone() }
    catch (x) { setErr((x as Error).message) }
    finally { setBusy(false) }
  }
  return (
    <form onSubmit={submit} style={{ ...card, maxWidth: 380, margin: '3rem auto', textAlign: 'center' }}>
      <h2 style={h2}>Manager sign-in</h2>
      <p style={{ color: C.tan, fontSize: '0.85rem', margin: '0 0 0.8rem' }}>Same passphrase as the executive suite. The crew reads at /handbook instead.</p>
      <input type="password" value={pass} onChange={e => setPass(e.target.value)} autoFocus placeholder="Passphrase" style={{ ...input, marginBottom: '0.6rem' }} />
      {err && <div style={{ color: C.red, fontSize: '0.85rem', marginBottom: '0.6rem' }}>{err}</div>}
      <button type="submit" style={btn(C.green)} disabled={busy || !pass}>{busy ? 'Checking…' : 'Sign in'}</button>
    </form>
  )
}
