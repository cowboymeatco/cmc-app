'use client'

import { useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import JsBarcode from 'jsbarcode'

// Print-only barcode slips for register ring-up. Each slip carries a Code 128
// of the QBO invoice DocNumber — scanned into the Clover order search it types
// the number and lands on the synced order (titled "NAME — INV <DocNumber>").
// Slips are stapled to the order paperwork at invoicing time.
//
// Rendered through a portal straight under <body> so the print rules can hide
// the app with a sibling selector. Scanners need black-on-white regardless of
// app theme, so all slip colors are hard-coded.

export interface SlipInvoice {
  id: string
  docNumber: string
  customerName: string
  txnDate: string
}

function Barcode({ value }: { value: string }) {
  const ref = useRef<SVGSVGElement>(null)
  useEffect(() => {
    if (!ref.current) return
    JsBarcode(ref.current, value, {
      format: 'CODE128',
      displayValue: false,
      width: 2,
      height: 56,
      margin: 8,
      lineColor: '#000',
      background: '#fff',
    })
  }, [value])
  return <svg ref={ref} />
}

export default function InvoiceSlips({ invoices, onDone }: { invoices: SlipInvoice[]; onDone: () => void }) {
  // Barcodes draw in child effects, which run before this one — by the time
  // print() fires every slip is rendered. print() blocks until the dialog
  // closes, so onDone unmounts the sheet right after.
  useEffect(() => {
    window.print()
    onDone()
  }, [onDone])

  const printedOn = new Date().toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })

  return createPortal(
    <div className="invoice-slips">
      <style>{`
        .invoice-slips { display: none; }
        @media print {
          body { background: #fff !important; }
          body > *:not(.invoice-slips) { display: none !important; }
          .invoice-slips {
            display: grid !important;
            grid-template-columns: 1fr 1fr;
            gap: 8pt;
            background: #fff;
          }
          .invoice-slip {
            border: 1px dashed #999;
            padding: 12pt 8pt;
            text-align: center;
            break-inside: avoid;
            font-family: Georgia, serif;
            color: #000;
          }
          .invoice-slip .name { font-size: 13pt; font-weight: 700; letter-spacing: 0.03em; }
          .invoice-slip .doc { font-size: 11pt; font-family: monospace; margin: 2pt 0 4pt; }
          .invoice-slip .meta { font-size: 7pt; color: #555; margin-top: 2pt; }
          .invoice-slip svg { max-width: 100%; }
        }
      `}</style>
      {invoices.map(inv => (
        <div key={inv.id} className="invoice-slip">
          <div className="name">{inv.customerName}</div>
          <div className="doc">INV {inv.docNumber}</div>
          <Barcode value={inv.docNumber} />
          <div className="meta">invoiced {inv.txnDate} · printed {printedOn} · scan into Clover order search</div>
        </div>
      ))}
    </div>,
    document.body
  )
}
