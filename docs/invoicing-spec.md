# Invoicing: nobody touches an invoice

Plan of record. Rewritten 2026-11-14 (Mountain) from first principles. Owner: Charlie.
Replaces the 2026-11-11 plan (office approves every invoice, QuickBooks bundles).

## Goal

**Nobody at the plant touches an invoice.** The crew does the work. The app
turns that work into invoices, sends them, collects the money and keeps the
books. People handle only the exceptions the app can't price, and they fix the
*source* (the booking, the cut card, the carcass assignment), never the invoice.

### The five rules

1. **Every charge comes from work the plant already records.** Hanging weight at
   kill, box scans at cutting, cure tags, scanner moves to Baker. Nobody enters
   anything "for billing."
2. **The price is settled before the work starts.** At booking: who pays, which
   share, which rate (price book, customer deal or cut-card rate). Nothing is
   negotiated after the fact.
3. **Invoices build and send themselves** when the order reaches *Ready to
   Invoice*. There's no approval step once a kind of order has proven itself in
   trial mode.
4. **Money comes in without chasing.** A pay link goes out with the invoice. The
   order can't leave the building unpaid, so anyone who hasn't paid by link pays
   at the Clover counter at pickup. Reminders and the late fee are automatic.
   Payments record themselves in QuickBooks.
5. **People handle exceptions only.** Anything the app can't price goes to a
   short "fix the source" list. Fixing the source rebuilds the invoice.

```
kill · cut · cure · value-add · Baker      (the crew's normal scans)
            │
            ▼
   charges priced from the price book        ── can't price? → Fix-the-source list
            │  order reaches Ready to Invoice
            ▼
   INVOICE in the app (itemized, yyddd-##)   ── the invoice of record
            │
            ├──► customer: email + text, itemized, pay link
            ├──► Clover: itemized open order for the counter
            └──► QuickBooks: summary invoice, 3–5 lines by part of the business
            │
            ▼
   paid by link or at the Clover counter      ── unpaid orders can't be released
            │
            ▼
   payment recorded in QuickBooks automatically; reminders + late fee if unpaid
```

## Decisions

| Topic | Decision |
|---|---|
| Who touches invoices | Nobody, after trial mode. Exceptions are fixed at the source (Charlie, 2026-11-14) |
| Approval | None in steady state. During trial mode invoices are built but not sent (see Rollout) |
| Price master | The app's price book. QuickBooks item prices, Clover and the website follow it or don't matter |
| Invoice of record | The app. Itemized, numbered Julian `yyddd-##` from the shop date (e.g. 26318-01) |
| What QuickBooks gets | A summary invoice, one line per part of the business (table below). No bundles, no item-level lines (2026-11-14) |
| What Clover gets | The itemized open order "NAME — INV 26318-01", so the counter can collect |
| Delivery | App emails and texts the itemized invoice with a pay link; the barcode slip prints for the order |
| Collecting | Clover pay link, or pay at the Clover counter at pickup (2026-11-14) |
| Pickup | **Nothing leaves unpaid.** The scanner won't release an order whose invoice has a balance (2026-11-14). Exemptions, if ever, are per customer and set in the app |
| Deposits | None (2026-11-14) |
| Checks / transfers | Entered in the app (one screen); the app records them in QuickBooks |
| Late fee | **18% a year = 1.5% a month** on the past-due balance, added automatically. Terms printed on every invoice (2026-11-14) |
| Reminders | Automatic, by email and text, at due date, +7 and +30 days |
| Grouping | One invoice per order at Ready to Invoice. Kill-only producers: one per producer per kill day |
| Billing start | Charges from **2026-11-13** on. Everything earlier was invoiced by hand and never comes back |
| CMC animals | One all-in price per share to the customer. Split behind the scenes into CMC harvest + CMC processing + CMC product (the carcass) |
| Own product vs custom service | Kept separate in QuickBooks (Charlie, 2026-11-14) |
| Kill vs processing | Kept separate in QuickBooks so each side of the business shows (Charlie, 2026-11-14) |
| Retail meat at pickup | Rung up separately at the Clover counter as a normal retail sale, not added to the processing invoice |
| CMC Retail, Western Meat Block | Never billed the CMC all-in price. WMB cattle are bought from Charlie's dad; harvest and freight settle against his account with his dad / Arrow Livestock |
| Curing | Billed on cured weight (box scans) |
| Smokehouse | Billed on raw lb in, from the cut sheet |
| Sausage / patties | Billed on finished lb out, from box scans |
| Off-list rates | Set on the cut card or as a customer deal **before** the work, never on the invoice |
| Extra long hang | $5/day past 14 days, automatic from kill date to first cut scan |
| Disposal | Inside the kill fee, never a line |
| Baker | $20 transfer when an order moves to Baker. The $28 monthly storage is hidden until Charlie decides how Baker should work |
| Margins | Later: alert Charlie when margins tighten (not this project) |

## QuickBooks: summary items

Each app invoice posts to QuickBooks as one line per bucket it touches. The
detail lives in the app; the books show what each part of the business earned.
**The accountant decides the income account for each item before go-live.**

| Side | QuickBooks item | What rolls into it |
|---|---|---|
| Custom | Harvest Services | Beef, hog and lamb kill; kill & chill only |
| Custom | Processing Services | Cut & wrap; lamb and goat flat fees |
| Custom | Value-Add Services | Curing, sausage, patties, links, smokehouse, smoking, slicing |
| Custom | Wild Game Services | All wild game |
| Custom | Fees | Baker transfer, outdoor kill, rush, extra long hang, late fee |
| CMC | CMC Harvest | Kill on our own animals |
| CMC | CMC Processing | Cut & wrap on our own animals |
| CMC | CMC Product | The carcass: advertised price minus CMC harvest and processing |

Value-add done on a CMC buyer's order is service work and goes to Value-Add
Services, like anyone else's.

**CMC split, worked:**
- Beef, $/lb hanging on the share: whole 5.39 = 0.38 + 1.17 + **3.84**; half 5.49 =
  0.38 + 1.17 + **3.94**; quarter 5.59 = 0.38 + 1.22 + **3.99**.
  A 711 lb whole is $3,832.29 = 270.18 harvest + 831.87 processing + 2,730.24 product.
- Hog, per head: harvest 0.58 and processing 1.17 on the share's hanging lb, product is
  the rest. Whole $700 at 200 lb = 116 + 234 + **350**; half $400 at 100 lb = 58 + 117 + **225**.
- Lamb, whole $600 = processing 180 + product **420**.
- If harvest + processing ever exceed the advertised price (a very heavy hog), the
  invoice goes to the Fix-the-source list instead of posting a negative product line.

**Example, one custom beef order:** QuickBooks shows Harvest Services $270.18,
Processing Services $831.87, Value-Add Services $44.00. The customer's invoice from
the app shows every line.

## The price book

`/price-book` in the app, 62 active rows as of 2026-11-14. Every rate the app bills
lives there and nowhere else. Changes are logged with who and when. **Prices change
once a year, in the app only.**

- The 12-month QuickBooks sales report (2026-11-14) put $880,903 through the
  price-book services. Six items carry 85%: beef cut & wrap, CMC beef, beef kill, hog
  processing, hog kill, hog curing.
- Six items with no sales in 12 months are hidden (Italian ground beef, lamb curry
  patties, wild game curing, buffalo processing, buffalo receive/skin/split, Baker
  monthly storage). They can be switched back on.
- Each row gets a `bucket` (the summary item above) in place of its own QuickBooks
  item.

## Phases

Each phase ships, gets checked against real orders, then the next starts.

### Phase 1: charges are right (live)
- ✅ Price book in the app, linked to QuickBooks, with change log.
- ✅ Detector prices every charge from the work: kill, cut & wrap, CMC animals,
  curing, sausage and patties, smokehouse, Philly, Baker transfer, outdoor / rush.
- ✅ 2026-11-13 fix: one buyer per carcass (from carcass assignments), CMC Retail and
  WMB excluded, billing starts 2026-11-13. The 1,192 bad pending charges were
  deleted.
- Next: check the first real kill day after 11/13 line by line against what the
  office would bill.

### Phase 2: invoices build themselves (trial mode)
- At *Ready to Invoice* the app builds the itemized invoice from that order's
  charges, numbered `yyddd-##`, with the CMC split and the 1.5% terms.
- Nothing is sent and nothing posts. The office keeps invoicing by hand.
- **Match report:** each app invoice side by side with the office's hand invoice
  for the same order (looked up in QuickBooks by customer and date), with every
  difference listed. This is how trust gets earned.
- **Fix-the-source list:** every order the app can't price, with the reason and a
  link to the screen that fixes it (assign the carcass, add the weight, make the
  cut cards agree).
- Extra long hang added automatically.

### Phase 3: send and collect
- Turned on **one kind of order at a time**, once its match rate is 100% for two
  straight weeks: custom beef first, then hogs, lamb and goat, CMC, wild game.
- For each automatic order: email and text with the pay link; Clover open order;
  QuickBooks summary invoice; barcode slip.
- **Pickup gate:** the scanner won't release an order with a balance.
- **Payments record themselves:** pay link and Clover payments post to QuickBooks
  against the invoice, once each, logged. Partials post as partial. Anything that
  doesn't match goes to the Fix-the-source list.
- Checks and transfers: one screen in the app; the app records them in QuickBooks.
- Reminders at due date, +7 and +30 days; the 1.5% monthly late fee posts on its own.
- The daily Clover-sales entry keeps excluding invoice payments so nothing counts
  twice.

### Phase 4: website follows the price book
- The Processing and Wild Game tabs on cowboymeats.com read the price book live,
  the way `cuttinginstructions.cowboymeats.com/prices` reads retail prices.
- One change in `cmc-platform/apps/website`. Merging to `main` deploys it through
  Cloudflare Workers Builds; no token needed.

## What this retires
- The 9 QuickBooks bundles made 2026-11-14 (make inactive at go-live; nothing uses them).
- Item-level QuickBooks service items: inactive after cutover, not deleted, so past
  reports still work. Item-level reports ("lb of sausage billed this year") move to a
  *Sales by charge* report in the app.
- The planned approval / edit screen. Wrong invoices are fixed at the source.
- Office typing invoices.

## Changes that need Charlie's OK before they run
- **Database:** `invoices` and `invoice_lines` (the app is the invoice of record),
  `payments`, a `bucket` column on `price_book`, an auto-send switch per kind of
  order, a pickup-exemption flag per customer. RLS matches the existing back-office
  tables.
- **QuickBooks:** create the 8 summary items on the accountant's income accounts;
  make bundles and old service items inactive at cutover.
- **Clover:** the pay link and open orders use the existing Clover account.

## Open items
1. **Accountant:** income account for each summary item; whether CMC BEEF / HOG /
   LAMB stay inventory items (today every sale would drive negative inventory and
   post COGS at QuickBooks' average cost). Summary items replace them on invoices,
   but the inventory question still matters for how cattle are costed.
2. **Pay link provider: Clover** (decided 2026-11-14), the same processor as the
   counter, so link and counter payments land in one place.
3. **Late fee terms:** check with the accountant or attorney that 18% a year is fine
   in Montana for these accounts, and print the terms on every invoice.
4. **Patty / sausage and cured weight** come off box scans. Verify on the first real
   orders.
5. **Curing basis.** On seven Sept–Nov hog orders the office billed curing on
   418.08 lb; cured box scans total 377.97 lb, which is $80.22 less (about $11.46 per
   hog). The app bills on box scans. If the old basis is wanted, weigh at the cure tag.
6. **Smoking fee.** Pulled pork, smoked brisket, smoked & pulled beef and smoked chops
   bill $5/lb on finished weight.
7. **Value-add on CMC buyers' orders** bills only if the order's scanner session
   isn't flagged as ours (`cmc`). Check on the first CMC sale.
8. **Baker storage:** how it should work, then switch the $28 monthly line back on.
9. **Habits the plan depends on:** buyers assigned to carcasses on kill day, cut
   cards complete before cutting, special deals set before the work, one person in the
   office watching the Fix-the-source list.

## Closed
- **Kill-only under-billing (2026-11-12):** 2878C, 2920C, 2940C billed at $0.38
  instead of $0.53, $1,218.79 in all. Let go; past invoices are never touched.
- **Wild game prices (2026-11-12):** QuickBooks is right, $4.75 / $6.00 with cheese.
  Price book and website corrected.
- **12× CMC charges (2026-11-13):** fixed in PR #64; bad pending charges deleted.
