import { qboFetch } from '@/lib/qbo'

// Open (unpaid) QuickBooks invoices — the source list for the Clover ring-up.
// Only three fields actually reach the register: customer name, invoice number
// and balance due. Everything else here is for picking the right row in the UI.

export interface QboInvoice {
  Id: string
  DocNumber?: string
  CustomerRef: { value: string; name?: string }
  TotalAmt: number
  Balance: number
  TxnDate: string
  DueDate?: string
}

interface InvoiceQueryResponse {
  QueryResponse: { Invoice?: QboInvoice[] }
}

export interface OpenInvoice {
  id: string
  docNumber: string
  customerName: string
  balance: number      // dollars, as QBO reports it
  balanceCents: number // what Clover needs
  txnDate: string
  dueDate: string | null
}

// Every unpaid invoice, filtered server-side on Balance.
//
// This used to pull the 500 most recent invoices and filter in JS, on the
// belief that QBO compared Balance lexically. That was wrong on both counts:
// `where Balance > '0'` returns exactly the right set (verified against a full
// 10,604-invoice scan — same 75 invoices, no zero-balance leakage), and the
// 500-row window was silently hiding 31 open invoices older than the cutoff,
// some over a year old. Anything the window missed was invisible to the whole
// billing view, not just to the register sync.
//
// Paginated so the answer stays complete if receivables ever exceed one page.
// The JS balance check is kept as a cheap backstop, not as the mechanism.
export async function getOpenInvoices(): Promise<OpenInvoice[]> {
  const page = 1000
  const out: OpenInvoice[] = []

  for (let start = 1; ; start += page) {
    const q = `select * from Invoice where Balance > '0' orderby TxnDate desc startposition ${start} maxresults ${page}`
    const res = await qboFetch<InvoiceQueryResponse>(`query?query=${encodeURIComponent(q)}`)
    const batch = res.QueryResponse.Invoice ?? []
    out.push(...batch.filter(inv => (inv.Balance ?? 0) > 0).map(toOpenInvoice))
    if (batch.length < page) break
  }
  return out
}

function toOpenInvoice(inv: QboInvoice): OpenInvoice {
  return {
    id: inv.Id,
    docNumber: inv.DocNumber ?? inv.Id,
    customerName: inv.CustomerRef?.name ?? '(no customer)',
    balance: inv.Balance,
    balanceCents: Math.round(inv.Balance * 100),
    txnDate: inv.TxnDate,
    dueDate: inv.DueDate ?? null,
  }
}

// Look an invoice up by the number printed on it — the only handle the sweep
// has, since all it can read off a Clover order is the title.
//
// Returns null when nothing matches. Callers must treat null as "unknown", not
// as "paid": the sweep deletes things, and a lookup that quietly failed must
// never be read as permission to delete.
export async function getInvoiceByDocNumber(docNumber: string): Promise<OpenInvoice | null> {
  const safe = docNumber.replace(/['\\]/g, '')
  if (!safe) return null
  const q = `select * from Invoice where DocNumber = '${safe}'`
  const res = await qboFetch<InvoiceQueryResponse>(`query?query=${encodeURIComponent(q)}`)
  const matches = res.QueryResponse.Invoice ?? []
  // Ambiguity is also "unknown" — two invoices sharing a number means we
  // cannot say which one the register order belongs to.
  if (matches.length !== 1) return null
  return toOpenInvoice(matches[0])
}

// One invoice by id — re-read at ring-up time so the amount pushed to the
// register is the balance right now, not whatever the UI last rendered.
export async function getInvoice(id: string): Promise<OpenInvoice | null> {
  const q = `select * from Invoice where Id = '${id.replace(/'/g, "\\'")}'`
  const res = await qboFetch<InvoiceQueryResponse>(`query?query=${encodeURIComponent(q)}`)
  const inv = (res.QueryResponse.Invoice ?? [])[0]
  return inv ? toOpenInvoice(inv) : null
}
