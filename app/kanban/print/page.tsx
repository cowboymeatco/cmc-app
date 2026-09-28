'use client'
import { use, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import {
  CARD_TYPE_LABEL, CATEGORIES, CATEGORY_COLOR, cardLabel, leadDays, money, qtyText,
  type Item, type Vendor,
} from '@/lib/kanban'
import { C, Banner, BigButton, KanbanHeader, cardStyle, inputStyle } from '../ui'

// ══════════════════════════════════════════════════════════════════════════════
// KANBAN CARDS, PRINTED
//
// One physical card per card in the loop — a two-bin item prints "card 1 of 2"
// and "card 2 of 2", one for each bin. Everything a standard kanban card
// carries: part name and number, where it lives (point of use + backstock),
// the quantity one card orders, the reorder signal, supplier and their item #,
// lead time, price, and a QR that opens the pull page for that exact card.
//
// Letter paper, four to a page, ink on white: they get laminated and zip-tied
// to the bin. The colour band is the category, so a card on the wrong shelf
// stands out from across the room.
// ══════════════════════════════════════════════════════════════════════════════

export default function PrintCardsPage({ searchParams }: { searchParams: Promise<{ ids?: string }> }) {
  const { ids } = use(searchParams)
  const [items, setItems] = useState<Item[]>([])
  const [vendors, setVendors] = useState<Vendor[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [cat, setCat] = useState('')
  const [codes, setCodes] = useState<Record<string, string>>({})

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
    <div style={{ paddingBottom: 60 }}>
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
              </div>
              {!ids && (
                <select value={cat} onChange={e => setCat(e.target.value)} style={{ ...inputStyle, marginBottom: 12 }}>
                  <option value="">All categories</option>
                  {CATEGORIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              )}
              {cards.length > 0 && <BigButton label="🖨 Print" onClick={() => window.print()} />}
            </>
          )}
        </div>
      </div>

      <div className="ksheet">
        {cards.map(({ item, seq }) => {
          const v = vendorById.get(item.vendor_id ?? '')
          const lead = leadDays(item, v).days
          const color = CATEGORY_COLOR[item.category] ?? '#999'
          const ou = item.order_unit ?? item.unit
          return (
            <div key={`${item.id}:${seq}`} className="kcard">
              <div className="band" style={{ background: color }}>
                <span>{item.category}</span>
                <span>{CARD_TYPE_LABEL[item.card_type]}</span>
              </div>
              <div className="top">
                <div className="left">
                  <div className="no">{cardLabel(item.card_no)}</div>
                  <div className="name">{item.name}</div>
                  {item.description && <div className="desc">{item.description}</div>}
                </div>
                {codes[`${item.id}:${seq}`]
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img className="qr" src={codes[`${item.id}:${seq}`]} alt="" />
                  : <div className="qr" />}
              </div>
              <table className="facts">
                <tbody>
                  <tr><th>ORDER QTY</th><td className="big">{qtyText(item.order_qty, ou)}</td></tr>
                  {item.card_type === 'reorder_point' && item.reorder_point != null && (
                    <tr><th>REORDER AT</th><td className="big">{qtyText(item.reorder_point, item.unit)}</td></tr>
                  )}
                  {item.bin_qty != null && <tr><th>BIN HOLDS</th><td>{qtyText(item.bin_qty, item.unit)}</td></tr>}
                  <tr><th>USE AT</th><td>{item.location ?? '—'}</td></tr>
                  {item.backstock_location && <tr><th>BACKSTOCK</th><td>{item.backstock_location}</td></tr>}
                  <tr><th>VENDOR</th><td>{v?.name ?? '—'}{item.vendor_sku ? ` · #${item.vendor_sku}` : ''}</td></tr>
                  <tr><th>LEAD / PRICE</th><td>{[lead != null ? `${lead} days` : null, item.price != null ? `${money(item.price)}${ou ? `/${ou}` : ''}` : null].filter(Boolean).join(' · ') || '—'}</td></tr>
                </tbody>
              </table>
              <div className="foot">
                <span>Card <b>{seq}</b> of {item.cards_in_loop}</span>
                <span>{item.card_type === 'two_bin' ? 'Bin empty? Scan or pull this card.' : 'At the line? Scan or pull this card.'}</span>
              </div>
            </div>
          )
        })}
      </div>

      <style jsx global>{`
        .ksheet { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; padding: 0 16px; max-width: 900px; margin: 0 auto; }
        .kcard { background: #fff; color: #000; border: 1.5px solid #333; border-radius: 6px; overflow: hidden;
                 font-family: Arial, sans-serif; break-inside: avoid; page-break-inside: avoid; }
        .kcard .band { display: flex; justify-content: space-between; padding: 4px 10px; font-size: 9pt; font-weight: bold;
                       color: #000; text-transform: uppercase; letter-spacing: 0.04em;
                       -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        .kcard .top { display: flex; gap: 8px; padding: 8px 10px 4px; }
        .kcard .left { flex: 1; min-width: 0; }
        .kcard .no { font-family: monospace; font-size: 11pt; color: #444; }
        .kcard .name { font-size: 15pt; font-weight: bold; line-height: 1.1; }
        .kcard .desc { font-size: 9pt; color: #444; margin-top: 2px; }
        .kcard .qr { width: 1.15in; height: 1.15in; flex-shrink: 0; background: #eee; }
        .kcard .facts { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
        .kcard .facts th { text-align: left; font-size: 7.5pt; color: #555; padding: 2px 10px; width: 1in; white-space: nowrap; font-weight: bold; }
        .kcard .facts td { padding: 2px 10px 2px 0; }
        .kcard .facts td.big { font-size: 13pt; font-weight: bold; }
        .kcard .facts tr + tr { border-top: 1px solid #ddd; }
        .kcard .foot { display: flex; justify-content: space-between; border-top: 1.5px solid #333; padding: 4px 10px;
                       font-size: 8pt; margin-top: 4px; }
        @media print {
          .no-print { display: none !important; }
          html, body { background: #fff !important; }
          @page { size: letter portrait; margin: 0.35in; }
          .ksheet { padding: 0; gap: 0.2in; max-width: none; }
        }
      `}</style>
    </div>
  )
}
