// Freight — what the truck costs against what delivery brings in.
//
// Charlie asked (2026-09-20) whether the steps that earn a job's price should
// include a freight input: fuel, oil, tires, repairs. They should, and the
// books already carry the pool. What the app cannot do yet is divide it: runs
// only get logged sometimes, so the miles and the pounds behind the money are
// mostly missing. The panel therefore reports the pool honestly, shows what
// coverage it has, and only prints a per-mile or per-pound number when the
// logged runs can carry it.
//
// The accounts below are the ones Charlie named, checked against a year of
// vendors (2026-09-20): Vehicle Repairs & Expenses is tires and the Ford
// dealer, Car & Truck is Charlie's truck loan payment, Shipping and Handling
// in COGS is the fuel. Plant "Repairs & Maintenance" — ironworks, electricians,
// scale service — is deliberately NOT here.

export interface FreightAccount { name: string; group: 'COGS' | 'Expenses'; label: string }

export const FREIGHT_ACCOUNTS: FreightAccount[] = [
  { name: 'Shipping and Handling',      group: 'COGS',      label: 'Fuel and shipping' },
  { name: 'Vehicle Repairs & Expenses', group: 'Expenses',           label: 'Vehicle repairs, tires, parts' },
  // Charlie, 2026-09-20: Car & Truck is his truck loan payment. Strictly only
  // the interest is an expense and the principal is balance sheet, so counting
  // the whole payment overstates the cost of a mile a little. Left in because
  // it is money the truck takes out of the till every month either way, and
  // called what it is on the panel.
  { name: 'Car & Truck',                group: 'Expenses',           label: 'Truck loan payment' },
]

/** Delivery billed out. */
export const FREIGHT_INCOME_ACCOUNT = 'Shipping Income'

export interface RunMiles {
  id: string
  run_date: string
  route: string | null
  driver: string | null
  odometer_out: number | null
  odometer_in: number | null
}

/** Miles on a run, when both ends of the odometer were written down. */
export function runMiles(r: RunMiles): number | null {
  if (r.odometer_out == null || r.odometer_in == null) return null
  const miles = Number(r.odometer_in) - Number(r.odometer_out)
  return miles > 0 && miles < 3000 ? miles : null
}

/** The Shipping Income account id in QuickBooks (looked up once, 2026-09-20). */
export const SHIPPING_INCOME_ACCOUNT_ID = '84'

export interface FreightBilling {
  invoiceCount: number            // invoices written in the window
  chargedCount: number            // ...that carried a shipping charge
  chargedGross: number            // what those invoices were worth in total
  freightBilled: number           // the shipping charge on them
  freightPctOfGross: number | null
  topCustomers: { name: string; amount: number }[]
}
