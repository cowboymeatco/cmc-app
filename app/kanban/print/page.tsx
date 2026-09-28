'use client'
import { use, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import {
  CARD_TYPE_LABEL, CATEGORIES, CATEGORY_COLOR, qtyText,
  type Item, type Vendor,
} from '@/lib/kanban'
import { C, Banner, BigButton, KanbanHeader, cardStyle, inputStyle } from '../ui'

// ══════════════════════════════════════════════════════════════════════════════
// KANBAN CARDS, PRINTED
//
// One physical card per card in the loop — a two-bin item prints "card 1 of 2"
// and "card 2 of 2", one for each bin — with a QR that opens the pull page for
// that exact card.
//
// Plain 3×5 index cards fed through the printer's bypass tray one at a time:
// each card is its own Letter page, drawn in the top-centre 3" × 5" where the
// tray puts the card (Charlie, 2026-09-28 — no Avery sheets, and his printer
// has no 3×5 paper size). See the print CSS below. Then
// they get laminated and zip-tied to the bin. A 3×5 only holds what the crew
// reads at the bin — name, where it's used, how much to order, who from — plus
// the QR and which card of the loop this is. The rest lives on
// the item's page. The colour band is the category, so a card on the wrong
// shelf stands out from across the room.
// ══════════════════════════════════════════════════════════════════════════════

const NUDGE_KEY = 'cmc.kanban.cardNudge'

// A labelled half-inch grid over the whole Letter page. Printed on one index
// card, the squares that land on the card say exactly which part of the page
// the printer puts there — so the card can be placed from evidence, not a guess.
function CalibrationPage() {
  const cells = []
  for (let y = 0; y < 22; y++) {
    for (let x = 0; x < 17; x++) {
      cells.push(
        <div key={`${x}:${y}`} className="kcell" style={{ left: `${x * 0.5}in`, top: `${y * 0.5}in` }}>
          {(x * 0.5).toFixed(1)},{(y * 0.5).toFixed(1)}
        </div>)
    }
  }
  return <div className="kpage kcal">{cells}</div>
}

export default function PrintCardsPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { ids } = use(searchParams)
  const [items, setItems] = useState<Item[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cat, setCat] = useState('')
  const [codes, setCodes] = useState<Record<string, string>>({})
  // Where the card lands on the sheet is the printer's call, not ours: a nudge
  // (inches, + is right/down on the Letter page) lines it up, and is kept per
  // machine so it's set once at the printer that makes the cards.
  const [nudge, setNudge] = useState<{ dx: number; dy: number }>({ dx: 0, dy: 0 })
  const [calibrate, setCalibrate] = useState(false)

  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(NUDGE_KEY) ?? 'null')
      // eslint-disable-next-line react-hooks/set-state-in-effect -- restoring a remembered nudge after mount; reading it during render would mismatch the server HTML
      if (saved && Number.isFinite(saved.dx) && Number.isFinite(saved.dy)) setNudge({ dx: saved.dx, dy: saved.dy })
    } catch { /* no saved nudge */ }
  }, [])
  const setNudgeAxis = (axis: 'dx' | 'dy', v: string) => {
    const n = Math.max(-5, Math.min(5, Number(v) || 0))
    setNudge(prev => {
      const next = { ...prev, [axis]: n }
      try { localStorage.setItem(NUDGE_KEY, JSON.stringify(next)) } catch { /* private window */ }
      return next
    })
  }

  useEffect(() => {
    let live = true
    fetch('/api/kanban', { cache: 'no-store' })
      .then(r => r.json())
      .then(d => {
        if (!live) return
        if (d?.error) setError(d.error)
        setItems(Array.isArray(d?.items) ? d.items : [])
        setVendors(Array.isArray(d?.vendors) ? d.vendors : [])
      })
      .catch(() => { if (live) setError('Could not load the cards.') })
      .finally(() => { if (live) setLoading(false) })
    return () => { live = false }
  }, [])

  const wanted = useMemo(() => {
    const only = ids ? new Set(ids.split(',')) : null
    return items
      .filter(i => (!only || only.has(i.id)) && (!cat || i.category === cat))
      .sort((a, b) => a.category.localeCompare(b.category) || a.name.localeCompare(b.name))
  }, [items, ids, cat])

  const cards = useMemo(() => wanted.flatMap(item =>
    Array.from({ length: item.cards_in_loop }, (_, k) => ({ item, seq: k + 1 }))), [wanted])

  // High error correction: these live on a bin in a wet plant.
  useEffect(() => {
    if (cards.length === 0) return
    let live = true
    const origin = window.location.origin
    Promise.all(cards.map(({ item, seq }) => {
      const key = `${item.id}:${seq}`
      return QRCode.toDataURL(`${origin}/kanban/scan/${item.id}?card=${seq}`, {
        errorCorrectionLevel: 'H', margin: 1, width: 300, color: { dark: '#000000', light: '#FFFFFF' },
      }).then(url => [key, url] as const).catch(() => [key, ''] as const)
    })).then(pairs => { if (live) setCodes(Object.fromEntries(pairs)) })
    return () => { live = false }
  }, [cards])

  const vendorById = new Map(vendors.map(v => [v.id, v]))

  return (
    <div className="kroot" style={{ paddingBottom: 60, ['--dx' as string]: `${nudge.dx}in`, ['--dy' as string]: `${nudge.dy}in` }}>
      <div className="no-print">
        <KanbanHeader title="Print kanban cards" back="/kanban" />
        <div style={{ padding: 16, maxWidth: 900, margin: '0 auto' }}>
          {error && <Banner tone="error">{error}</Banner>}
          {loading && <p style={{ color: C.tan }}>Loading…</p>}
          {!loading && (
            <>
              <div style={{ ...cardStyle, marginBottom: 12, color: C.tan, fontSize: 14, lineHeight: 1.5 }}>
                {cards.length} card{cards.length === 1 ? '' : 's'} for {wanted.length} item{wanted.length === 1 ? '' : 's'} — one per bin.
                Print, laminate, and zip-tie each to its bin. When a bin empties, scan its card with any phone
                camera and tap once — or drop the card in the kanban post and whoever orders pulls it on the board.
                <br /><b>Printing on 3×5 cards:</b> load the index cards in the printer&apos;s manual/bypass tray, then in the
                print dialog leave paper size on Letter, portrait, scale 100%, print on both sides off, and headers and
                footers off. Put one card in the bypass tray, short edge first, with the guides snug. Each card
                prints on its own page, in the top-centre 3 × 5 of the sheet — try one on plain paper first and lay a
                card over the dotted outline.
              </div>
              {!ids && (
                <select value={cat} onChange={e => setCat(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
                  <option value="">All categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {(cards.length > 0 || calibrate) && <BigButton label="🖨 Print" onClick={() => window.print()} />}
              <div style={{ ...cardStyle, marginTop: 12, color: C.tan, fontSize: 14, lineHeight: 1.5 }}>
                <b>Lining up on the card.</b> Cards printing blank or cut off? Tick the box, print the grid on one
                index card, and the numbers that land on it (inches across, down) show where the card sits.
                Then nudge: + moves the card right / down on the sheet.
                <label style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 8 }}>
                  <input type="checkbox" checked={calibrate} onChange={e => setCalibrate(e.target.checked)} />
                  Print the calibration grid instead of cards
                </label>
                <div style={{ display: 'flex', gap: 12, marginTop: 8, flexWrap: 'wrap' }}>
                  <label>Right/left (in){' '}
                    <input type="number" step={0.1} value={nudge.dx} onChange={e => setNudgeAxis('dx', e.target.value)} style={{ ...inputStyle, width: 90 }} />
                  </label>
                  <label>Down/up (in){' '}
                    <input type="number" step={0.1} value={nudge.dy} onChange={e => setNudgeAxis('dy', e.target.value)} style={{ ...inputStyle, width: 90 }} />
                  </label>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="ksheet">
        {calibrate ? <CalibrationPage /> : cards.map(({ item, seq }) => {
          const v = vendorById.get(item.vendor_id ?? '')
          const color = CATEGORY_COLOR[item.category] ?? '#999'
          const ou = item.order_unit ?? item.unit
          return (
            <div key={`${item.id}:${seq}`} className="kpage"><div className="kcard">
              <div className="band" style={{ background: color }}>
                <span>{item.category}</span>
                <span>{CARD_TYPE_LABEL[item.card_type]}</span>
              </div>
              <div className="top">
                <div className="left">
                  <div className="name">{item.name}</div>
                  <table className="facts">
                    <tbody>
                      <tr><th>ORDER QTY</th><td className="big">{qtyText(item.order_qty, ou)}</td></tr>
                      {/* A reorder-point card is useless without its trigger. */}
                      {item.card_type === 'reorder_point' && item.reorder_point != null && (
                        <tr><th>REORDER AT</th><td className="big">{qtyText(item.reorder_point, item.unit)}</td></tr>
                      )}
                      <tr><th>USE AT</th><td>{item.location ?? '—'}</td></tr>
                      <tr><th>VENDOR</th><td>{v?.name ?? '—'}</td></tr>
                    </tbody>
                  </table>
                </div>
                {codes[`${item.id}:${seq}`]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="qr" src={codes[`${item.id}:${seq}`]} alt="" />
                  : <div className="qr" />}
              </div>
              <div className="foot">
                <span>Card <b>{seq}</b> of {item.cards_in_loop}</span>
                <span>{item.card_type === 'two_bin' ? 'Bin empty? Scan or pull this card.' : 'At the line? Scan or pull this card.'}</span>
              </div>
            </div></div>
          )
        })}
      </div>

      <style jsx global>{`
        .ksheet { display: grid; grid-template-columns: repeat(auto-fill, 5in); justify-content: center; gap: 12px; padding: 0 16px; }
        .kpage { display: contents; }
        .kcal { display: none; }
        .kcard { width: 5in; height: 3in; box-sizing: border-box; background: #fff; color: #000; border: 1.5px solid #333;
                 border-radius: 6px; overflow: hidden; display: flex; flex-direction: column;
                 font-family: Arial, sans-serif; break-inside: avoid; page-break-inside: avoid; }
        .kcard .band { display: flex; justify-content: space-between; padding: 3px 10px; font-size: 8pt; font-weight: bold;
                       color: #000; text-transform: uppercase; letter-spacing: 0.04em;
                       -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .kcard .top { flex: 1; display: flex; gap: 10px; padding: 6px 10px 0; min-height: 0; }
        .kcard .left { flex: 1; min-width: 0; }
        .kcard .name { font-size: 18pt; font-weight: bold; line-height: 1.1; margin-bottom: 4px;
                       display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical; overflow: hidden; }
        .kcard .qr { width: 1.3in; height: 1.3in; flex-shrink: 0; background: #eee; }
        .kcard .facts { width: 100%; border-collapse: collapse; font-size: 13pt; }
        .kcard .facts th { text-align: left; font-size: 7.5pt; color: #555; padding: 5px 8px 5px 0; width: 0.8in; white-space: nowrap; font-weight: bold; }
        .kcard .facts td { padding: 5px 0; line-height: 1.15; }
        .kcard .facts td.big { font-size: 16pt; font-weight: bold; }
        .kcard .facts tr + tr { border-top: 1px solid #ddd; }
        .kcard .foot { display: flex; justify-content: space-between; border-top: 1.5px solid #333; padding: 3px 10px;
                       font-size: 8pt; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; }
          /* Trailing space would feed a blank card. */
          .kroot { padding: 0 !important; }
          /* One card per Letter page, drawn where a 3×5 card fed into the bypass
             tray actually lands: centred side to side, against the top edge.
             Charlie's HP (Color LaserJet Pro MFP 3301) has no 3×5 or custom
             paper size, and a 3×5 page left browser and driver to disagree on
             rotation. His first test on Letter showed the tray centres small
             stock and top-aligns it (Charlie, 2026-09-28). So: print on Letter,
             and the card is the top-centre 3in × 5in of the page, turned
             sideways, 0.25in in from the card's edges. A plain-paper test print
             shows exactly where the card will go. */
          @page { size: letter portrait; margin: 0; }
          .ksheet { display: block; padding: 0; }
          .kpage { display: block; position: relative; width: 8.5in; height: 11in; overflow: hidden;
                   break-after: page; page-break-after: always; }
          .kpage:last-child { break-after: auto; page-break-after: auto; }
          /* The card's 3in × 5in footprint, for lining up on a plain-paper test. */
          .kpage::before { content: ''; position: absolute; left: calc(2.75in + var(--dx, 0in)); top: var(--dy, 0in);
                           width: 3in; height: 5in; border: 0.5px dashed #bbb; box-sizing: border-box; }
          /* globals.css hides the last cell of every table in print (the kill
             sheet's action column), which blanked every value on the card. */
          .kcard .facts td:last-child { display: table-cell !important; }
          .kcal::before { display: none; }
          .kcell { position: absolute; width: 0.5in; height: 0.5in; box-sizing: border-box; border: 0.5px solid #000;
                   font: bold 7pt Arial, sans-serif; color: #000; padding: 2px; }
          .kcard { position: absolute; left: calc(4.25in + var(--dx, 0in)); top: calc(2.5in + var(--dy, 0in));
                   width: 4.5in; height: 2.5in; border-radius: 0;
                   transform: translate(-50%, -50%) rotate(90deg); }
        }
      `}</style>
    </div>
  )
}
