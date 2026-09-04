import { qboGraphql } from '@/lib/qbo'

// Payslips from QuickBooks Payroll, read through Intuit's GraphQL ("Workforce")
// API — the accounting REST API has no payroll entities at all.
//
// ⚠️ Access is the whole question here. The payrollPayslips query sits behind
// the qb.payroll.compensation.read scope, which Intuit calls a "restricted"
// scope: it only appears on the app's Permissions page once the developer
// account is on a paid partner tier (Silver or above), and has to be switched
// on there before a consent that asks for it will succeed. Until that is
// done, Connect QuickBooks Payroll will fail at Intuit's consent screen or
// this query will come back 403 — both surface on /exec as a sync error, and
// neither touches the accounting connection.
//
// Endpoint: https://qb.api.intuit.com/graphql (production only; no sandbox).

export interface PayslipCompensation {
  hours: number
  /** Where the hours came from — TIME_SHEET for clocked hours, DEFAULT for salary. */
  source: string | null
}

export interface Payslip {
  id: string
  /** Company pay-run id shared by every payslip in the same run. */
  sourceId: string | null
  type: string | null
  payDate: string | null
  periodStart: string | null
  periodEnd: string | null
  grossPay: number
  employeeId: string | null
  compensations: PayslipCompensation[]
}

interface PayslipNode {
  id: string
  sourceId: string | null
  type: string | null
  payDate: string | null
  payPeriod: { beginDate: string | null; endDate: string | null } | null
  grossPay: { currentAmount: string | number | null } | null
  employee: { id: string | null } | null
  compensations: { calculatedCompensationDetail: { hours: string | number | null; source: string | null } | null }[] | null
}

interface PayslipsData {
  payrollPayslips: {
    pageInfo: { hasNextPage: boolean; endCursor: string | null } | null
    edges: { node: PayslipNode | null }[] | null
  } | null
}

const PAYSLIPS_QUERY = `
query LaborPayslips($filter: Payroll_PayslipsFilter, $first: Int, $after: String) {
  payrollPayslips(filter: $filter, first: $first, after: $after) {
    pageInfo { hasNextPage endCursor }
    edges {
      node {
        id
        sourceId
        type
        payDate
        payPeriod { beginDate endDate }
        grossPay { currentAmount }
        employee { id }
        compensations {
          calculatedCompensationDetail { hours source }
        }
      }
    }
  }
}`

const PAGE_SIZE = 20
const MAX_PAGES = 40

function toPayslip(n: PayslipNode): Payslip {
  return {
    id: n.id,
    sourceId: n.sourceId ?? null,
    type: n.type ?? null,
    payDate: n.payDate ?? null,
    periodStart: n.payPeriod?.beginDate ?? null,
    periodEnd: n.payPeriod?.endDate ?? null,
    grossPay: Number(n.grossPay?.currentAmount) || 0,
    employeeId: n.employee?.id ?? null,
    compensations: (n.compensations ?? []).map(c => ({
      hours: Number(c.calculatedCompensationDetail?.hours) || 0,
      source: c.calculatedCompensationDetail?.source ?? null,
    })),
  }
}

/** Every payslip with a pay date on or after `sinceISO`, all pages. */
export async function fetchPayslipsSince(sinceISO: string): Promise<Payslip[]> {
  const out: Payslip[] = []
  let after: string | null = null
  for (let page = 0; page < MAX_PAGES; page++) {
    const data: PayslipsData = await qboGraphql<PayslipsData>(PAYSLIPS_QUERY, {
      filter: { payDate: { dateRange: { gte: sinceISO } } },
      first: PAGE_SIZE,
      after,
    })
    const conn = data.payrollPayslips
    for (const edge of conn?.edges ?? []) if (edge.node) out.push(toPayslip(edge.node))
    if (!conn?.pageInfo?.hasNextPage || !conn.pageInfo.endCursor) break
    after = conn.pageInfo.endCursor
  }
  return out
}
