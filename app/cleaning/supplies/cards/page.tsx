'use client'
import { useEffect, useState } from 'react'
import QRCode from 'qrcode'
import { C, useCrewMember, CleaningHeader, Banner, BigButton, cardStyle } from '../../ui'

// ══════════════════════════════════════════════════════════════════════════════
// THE KANBAN CARDS, PRINTED
//
// One card per supply, to be laminated and taped to the shelf or zip-tied to
// the bin. The QR is the card you pull in two-bin kanban — scanning it opens
// the reorder page for that exact supply.
//
// Printed on plain letter paper from any printer, six to a page, because these
// go up once and get replaced when they get wet. Deliberately NOT the label
// printer: nothing here is a product label and the shop's 4in stock is for
// things that go on meat.
// ══════════════════════════════════════════════════════════════════════════════

interface Supply { id: string; name: string; unit: string | null; vendor: string | null }

export default function SupplyCardsPage() {
  const { member } = useCrewMember()
  const [supplies, setSupplies] = useState<Supply[]>([])
  const [codes, setCodes]       = useState<Record<string, string>>({})
  const [loading, setLoading]   = useState(true)

  useEffect(() => {
    let live = true
    fetch('/api/cleaning/supplies')
      .then(r => r.json())
      .then(d => { if (live) { setSupplies(Array.isArray(d) ? d : []); setLoading(false) } })
      .catch(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  // Rendered client-side to data URLs. High error correction because these live
  // on a shelf in a wet plant and will get splashed, scuffed and taped over —
  // 'H' keeps a code readable with about a third of it obliterated.
  useEffect(() => {
    if (supplies.length === 0) return
    let live = true
    // Read the origin here rather than holding it in state: this effect only
    // ever runs in the browser, so window is there, and the alternative was a
    // render pass whose only job was to learn what host we are on.
    const origin = window.location.origin
    Promise.all(supplies.map(s =>
      QRCode.toDataURL(`${origin}/cleaning/supplies/scan/${s.id}`, {
        errorCorrectionLevel: 'H',
        margin: 1,
        width: 320,
        color: { dark: '#000000', light: '#FFFFFF' },
      }).then(url => [s.id, url] as const).catch(() => [s.id, ''] as const),
    )).then(pairs => { if (live) setCodes(Object.fromEntries(pairs)) })
    return () => { live = false }
  }, [supplies])

  return (
    <div style={{ paddingBottom: 60 }}>
      <div className="no-print">
        <CleaningHeader title="Shelf cards" back="/cleaning/supplies" member={member} />
      </div>

      <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
        <div className="no-print" style={{ marginBottom: 16 }}>
          {!loading && supplies.length === 0 && (
            <Banner tone="warn">
              Nothing on the supply list yet, so there is nothing to print. Add supplies from
              the Supplies screen first — asking for something and ticking &ldquo;add to the
              supply list&rdquo; is the quickest way.
            </Banner>
          )}
          {supplies.length > 0 && (
            <>
              <div style={{ ...cardStyle, marginBottom: 12, color: C.tan, fontSize: 14, lineHeight: 1.5 }}>
                One card per supply. Print, cut, and put each one where the stock lives — on the
                shelf edge or the reserve bin. When the working bin runs out, scan the card with
                any phone camera and tap once. No app, no login, no typing.
              </div>
              <BigButton label="🖨 Print the cards" onClick={() => window.print()} />
            </>
          )}
        </div>

        <div className="sheet">
          {supplies.map(s => (
            <div key={s.id} className="card">
              {codes[s.id]
                // eslint-disable-next-line @next/next/no-img-element
                ? <img className="qr" src={codes[s.id]} alt="" />
                : <div className="qr placeholder" />}
              <div className="name">{s.name}</div>
              <div className="meta">
                {[s.unit, s.vendor].filter(Boolean).join(' · ') || ' '}
              </div>
              <div className="foot">Scan when this runs low · Cowboy Meat Co.</div>
            </div>
          ))}
        </div>
      </div>

      <style jsx global>{`
        .sheet {
          display: grid;
          grid-template-columns: repeat(2, 1fr);
          gap: 12px;
        }
        .card {
          border: 1.5px dashed #999;
          border-radius: 6px;
          padding: 12px;
          text-align: center;
          background: #fff;
          color: #000;
          break-inside: avoid;
          page-break-inside: avoid;
        }
        .qr { width: 100%; max-width: 190px; height: auto; display: block; margin: 0 auto 8px; }
        .qr.placeholder { aspect-ratio: 1; background: #eee; max-width: 190px; }
        .name { font-family: Arial, sans-serif; font-size: 17pt; font-weight: bold; line-height: 1.15; }
        .meta { font-family: Arial, sans-serif; font-size: 10pt; color: #444; margin-top: 2px; }
        .foot { font-family: Arial, sans-serif; font-size: 7.5pt; color: #666; margin-top: 8px; }

        @media print {
          /* The app's dark chrome is for a phone in a dark room; a sheet of
             shelf cards is ink on white paper and nothing else. */
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          @page { size: letter portrait; margin: 0.4in; }
          .sheet { grid-template-columns: repeat(2, 1fr); gap: 0.25in; }
          .card { border: 1.5px dashed #999; }
        }
      `}</style>
    </div>
  )
}
