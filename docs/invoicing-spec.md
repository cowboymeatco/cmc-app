# Invoicing: app → QuickBooks → Clover → cowboymeats.com

Spec for sign-off. Status 2026-11-11 (Mountain). Owner: Charlie. Branch `claude/sharp-euler-2qzphk`.

## Goal

The office stops typing processing invoices by hand. The app works out every
charge, builds the invoice, a person approves it, and it posts to QuickBooks
once. The Clover register picks it up for payment, the payment goes back to
QuickBooks on its own, and the website shows the same prices the invoice used.
**The app is the master price list.** Everything else follows it.

```
kill / cut / value-add / storage ──► charges (app)
                                        │  office reviews, edits, approves
                                        ▼
                       QBO invoice 26315-01 (posted once, emailed + slip printed)
                                        │  existing register sync
                                        ▼
                     Clover open order "NAME — INV 26315-01"  ── paid at counter
                                        │  NEW: payment recorded automatically
                                        ▼
                      QBO payment → Undeposited Funds → order swept off register
```

## Decisions (Charlie, 2026-11-11)

| # | Decision |
|---|---|
| Scope | Invoice creation **and** automatic Clover payment recording |
| Approval | Office reviews every invoice before it posts. Anyone with office access may approve |
| CMC animals sold | One all-in line at the advertised $/lb on the share's hanging weight. Value-add, curing, etc. on top |
| Price master | The app. QuickBooks, Clover and cowboymeats.com follow it. Customer-specific deals live in the app (not QBO price levels) |
| Retail meat | Can be added to the invoice on the preview |
| Wild game | In scope |
| Grouping | One invoice per order when it reaches Ready to Invoice. Kill-only producers: one invoice per producer per kill day |
| Deposits | None |
| Curing | Billed on cured weight (cure tags / box scans) |
| Smokehouse | Billed on raw lb **in** (value-add job weight) |
| Sausage / patties | Billed on finished lb **out** |
| Slicing $10 | Philly only |
| Off-list rate (e.g. lamb kill $75) | Changed on the invoice preview, not the cut card |
| Baker storage | $20 transfer when the order moves to Baker. The $28 monthly storage line is **hidden** (never billed in 12 months) until Charlie decides how Baker storage should work (2026-11-14) |
| Outdoor kill $150, rush $50 | Flagged at booking |
| Extra long hang | Not automatic. Office adds it |
| Late fee | Not automatic. **18% a year = 1.5% a month on the past-due balance** (Charlie, 2026-11-14), not a flat $2. Phase 2's preview gets an "Add late fee" button that works it out from the past-due balance and the days late; the office reviews it like any other line. The terms need to be printed on the invoice |
| Disposal | Included in the kill fee. Never a separate line |
| Kill-only beef | $0.53/lb is right. The three $0.38 invoices were mistakes |
| Lamb kill only | $75 |
| QBO-only items | Added to the website too |
| Delivery | QuickBooks emails the invoice **and** a barcode slip prints |
| Non-Clover payments | Checks and transfers stay manual in QuickBooks |
| Numbering | Julian `yyddd-##` (e.g. 26315-01). Daily Clover-sales invoice switches too |
| Margins | Later: alert Charlie when margins tighten (not this project) |

## The price book

Today's rates, reconciled across all three places. **Bold** = something has to change.

| Charge | Rate | Unit | QBO item | Website | Billed from |
|---|---|---|---|---|---|
| Beef kill (processed) | 0.38 | lb HCW | Custom Beef Kill 1215 | inside $1.55 | harvest weight |
| Beef cut & wrap whole/half | 1.17 | lb HCW | Processing-Whole, Half 1214 | inside $1.55 | harvest weight |
| Beef cut & wrap quarter | 1.22 | lb HCW | Processing-Quarters 1216 | inside $1.60 | harvest weight |
| **Beef kill & chill only** | **0.53** | lb HCW | **none — create** | $0.53 | kill-only booking |
| Hog kill | 0.58 | lb HCW | Custom Hog Kill 1247 | $0.58 | harvest weight |
| Hog processing | 1.17 | lb HCW | Custom Hog Processing 138 | inside $1.75 | harvest weight |
| **Lamb kill only** | **75** | head | Lamb Kill Only 1298 (**$50 → $75**) | **add** | kill-only booking |
| Lamb / goat processing | 180 | head | 105 / 134 | $180 | harvest |
| Hog curing | 2.00 | cured lb | Custom Hog Curing 122 | $2.00 | cure tags / box scans |
| Beef bacon / corned beef curing | 2.50 | cured lb | Beef Bacon Curing / Beef Curing | **add** | cure tags / box scans |
| Custom sausage (beef, pork) | 2.00 | finished lb | Custom Beef / Pork Sausage | $2.00 | value-add job, lb out |
| Pork sausage links | 3.60 | finished lb | Custom Pork Sausage Links | **add** | value-add job, lb out |
| Ground beef patty fee | 1.00 | finished lb | Ground Beef Patty Fee | **add** | value-add job, lb out |
| Sausage / lamb curry patties | 2.50 | finished lb | Sausage Patties / Lamb Curry | **add** | value-add job, lb out |
| Sticks / summers / brats (plain) | 4.25 | raw lb in | Beef/Pork Custom … | sticks, summers ✓ / **brats add** | value-add job, lb in |
| Sticks / summers / brats w/ cheese | 5.00 | raw lb in | … W/CHEESE | ✓ / **brats add** | value-add job, lb in |
| Lamb brats / w/ cheese | 4.75 / 5.50 | raw lb in | Lamb Custom Brotwurst | **add** | value-add job, lb in |
| Hot dogs / w/ cheese | 5.00 / 5.75 | raw lb in | Beef Custom Hot Dogs | **add** | value-add job, lb in |
| Jerky (beef, pork) | 11.00 | raw lb in | Custom Beef / Pork Jerky | $11.00 | value-add job, lb in |
| Smoking / seasoning / pulling | 5.00 | lb | Custom Smoking Fee | **add** | value-add job |
| Philly slicing | 10 | flat | Beef Slicing Fee | **add** | value-add job "Philly" |
| Baker transfer | 20 | flat | Fulfillment Fee – Baker | **add** | order moved to Baker |
| Baker storage | 28 | customer / month | Monthly Storage – Baker | **add** | orders at Baker, monthly |
| Outdoor kill | 150 | flat | Outdoor Kill Fee | **add** | booking flag (new) |
| Rush order | 50 | flat | Rush Order Fee | **add** | booking flag (new) |
| Extra long hang | 5 | day > 14 | **none — create** | $5/day | office adds on preview |
| CMC whole / half / quarter beef | 5.39 / 5.49 / 5.59 | lb HCW share | CMC BEEF | ✓ | booking on a CMC animal |
| CMC whole / half hog | 700 / 400 | flat | CMC HOG | ✓ | booking on a CMC animal |
| CMC whole lamb | 600 | flat | CMC LAMB | ✓ | booking on a CMC animal |
| Wild game (grinding, bulk sausage, sticks, …) | per website | lb | Wild Game … | ✓ | value-add job |

## Phases

Each phase ships, gets checked against real orders, then the next one starts.

### Phase 1 — Charges are right (in progress)
- ✅ **Done (on branch, not deployed).** Kill and cut & wrap priced from QuickBooks live. Negotiated cut-card rates applied, conflicting cards held back. Pending charges re-priced. Booking's QuickBooks customer used.
- **Price book in the app.** One table holding every row above. Editing a price shows the push to QuickBooks (item price), Clover (where an item exists) and the website, and each push is approved and logged. Same pattern as the existing PLU → Clover / QBO push.
- **Customer prices.** A per-customer override table (the "price levels" idea), applied before the standard rate and shown as such on the preview.
- **New charge rules:** kill-only beef / lamb, CMC animal all-in, curing, value-add (in vs out per the table), Philly slicing, Baker transfer + monthly storage, outdoor / rush flags on the booking.
- Charges on CMC animals start appearing (today the app skips our animals entirely).

### Phase 2 — Build and post invoices
- "Build invoice" on Billing and on the scanner's Ready to Invoice card. Groups that order's pending charges by customer. Kill-only producers group per kill day. Baker storage runs as its own monthly invoice.
- **Kill + cut & wrap post as one QuickBooks bundle line (Charlie, 2026-11-14).** The customer sees one all-in line that matches the website. The bundle's two components still post revenue to the kill and processing items, so the P&L keeps both sides of the business separate. Bundles (made in QuickBooks by hand; the connector can't create them):
  - **Beef Harvest & Processing – Whole/Half** = Custom Beef Kill $0.38 + Custom Processing-Whole, Half $1.17 → $1.55/lb hanging
  - **Beef Harvest & Processing – Quarters** = Custom Beef Kill $0.38 + Custom Processing-Quarters $1.22 → $1.60/lb
  - **Hog Harvest & Processing** = Custom Hog Kill $0.58 + Custom Hog Processing $1.17 → $1.75/lb
  - Components are qty 1 each; the bundle qty is the hanging lb. A negotiated cut-card rate edits the matching component, so the customer still sees one line at the combined rate.
  - Kill-only (beef $0.53, lamb $75) and lamb and goat flat fees stay single items.
- **CMC animals post as a three-part bundle (Charlie, 2026-11-14):** kill + processing + carcass. The carcass part is the advertised price minus kill and processing, so it carries the animal plus the margin. The customer sees one line at the advertised price. The P&L shows what processing earned on our own animals and what the cattle side earned. One bundle per species (the existing "CMC Beef Whole" bundle becomes the beef one). The app sets every component's qty and rate on each invoice, so whole/half/quarter don't need separate items.
  - Beef, $/lb hanging on the share: whole 5.39 = 0.38 + 1.17 + **3.84**; half 5.49 = 0.38 + 1.17 + **3.94**; quarter 5.59 = 0.38 + 1.22 + **3.99**. Example: 711 lb whole = $3,832.29 = 270.18 kill + 831.87 processing + 2,730.24 carcass.
  - Hog, per head: kill 0.58 and processing 1.17 on the share's hanging lb; the carcass is the rest. Whole $700 at 200 lb = 116 + 234 + **350**; half $400 at 100 lb = 58 + 117 + **225**.
  - Lamb, whole $600 = lamb flat fee 180 + carcass **420**.
  - Guard: if kill + processing ever exceed the advertised price (a very heavy hog), the invoice is held for the office instead of posting a negative carcass line.
  - **Own product vs custom service stay separate (Charlie, 2026-11-14):** a CMC bundle never uses the Custom Kill / Custom Processing service items. It gets its own CMC harvest and CMC processing items, so custom-service revenue is only outside customers and the CMC side shows everything we own and sell. Added to the price book 2026-11-14: CMC Beef Harvest 0.38, CMC Beef Processing 1.17, CMC Beef Processing - Quarters 1.22, CMC Hog Harvest 0.58, CMC Hog Processing 1.17, CMC Lamb Processing 180. Check QuickBooks creates them as Services under RETAIL SALES:CARCASS on CMC BEEF's income account; the accountant can move them to their own income accounts.
  - Open, for the accountant: CMC BEEF / HOG / LAMB are **inventory** items with 0 on hand, so every sale would drive negative inventory and post COGS at QuickBooks' average cost. Switch them to non-inventory unless cattle are tracked as inventory.
  - Bundles in QuickBooks as of 2026-11-14: Beef H&P Whole/Half (1.55), Beef H&P Quarter (1.60), Hog H&P (1.75), CMC Beef Whole / Half / Quarter, CMC Lamb. **CMC Hog** still to make. The CMC ones get re-pointed at the CMC harvest/processing items once those exist.
  - The kill and cut & wrap charges can land on different days (kill day vs cut). The invoice builds once both are pending. A carcass that's killed but not yet cut stays out of the invoice until it is.
  - QuickBooks Sales setting "Display bundle components" off, so only the bundle line prints.
- Preview: edit qty / rate (reason required, logged), add retail items or any QBO item, add manual lines (extra long hang, off-list rates), drop lines.
- Approve → posts once (idempotent request id; duplicate check against QuickBooks). Number `yyddd-##` from the shop date. QuickBooks emails it, the barcode slip prints, the invoice is linked to the animal, and the scanner card moves to Freezer / Call.
- The daily Clover-sales invoice switches to the same numbering.

### Phase 3 — Payments come back on their own
- When a ring-up order is paid in Clover, post a QBO Payment against that invoice into Undeposited Funds, one per tender, the same way the daily sales entry books tenders. It's logged, and it never posts twice.
- The daily sales entry keeps excluding ring-up payments, so nothing is counted twice. The existing sweep then clears the order.
- Partial payments post as partial. Anything that doesn't match (amount ≠ balance, invoice not found) is listed for the office, not guessed.

### Phase 4 — Website follows the app
- The Processing tab on cowboymeats.com stops being typed HTML. It reads the price book live, the way `cuttinginstructions.cowboymeats.com/prices` already reads retail prices. No redeploy is needed when a price changes.
- One-time change in `cmc-platform/apps/website`. A Cloudflare deploy token is needed once.

## Database changes (each needs Charlie's OK before it runs)

- `price_book` — every chargeable rate (key, label, rate, unit, QBO item id, Clover item id, website label/section, active).
- `customer_prices` — customer, price-book key, rate, note.
- `billable_events` — add QBO invoice id, doc number, edited-by / edit reason, original rate.
- `invoice_log` — every invoice and payment post: request, response, who approved.
- `harvest_appointments` — add `outdoor_kill`, `rush` flags.
- Baker storage — start date per order (from the scanner move to `baker_storage`).
- RLS for all new tables matches the existing back-office tables.

## QuickBooks changes (each needs Charlie's OK)

- Create item **Beef Kill & Chill Only** $0.53/lb (Service Income: Custom Kill & Processing).
- Create item **Extra Long Hang** $5/day (the old one is deleted).
- Lamb Kill Only $50 → **$75**.
- Confirm custom transaction numbers stay on (they are, the `####C` series proves it).

## Open items / risks

1. **Under-billing (closed 2026-11-12):** kill-only beef billed at $0.38 instead of $0.53 on 2878C, 2920C (Arrow Livestock) and 2940C (Ben Reilly). 8,125.29 lb × $0.15 = $1,218.79. **Charlie: let it go.** No re-bill or credit; the app won't touch past invoices.
- **Wild game prices (decided 2026-11-12):** QuickBooks is right. Sticks, summer/salami and brats are $4.75/lb, $6.00/lb with cheese. The price book was corrected from the website's $4.50 / $5.25, and six rows were renamed to their existing QuickBooks items so Check QuickBooks links them instead of creating duplicates.
- **CMC LAMB item price:** leave unticked in Check QuickBooks. QuickBooks has $375; the invoice line carries the $600 whole-lamb rate.
2. **Patty / sausage finished weight.** Value-add jobs carry weight out. Patties made on the cutting floor may not go through a value-add job; if not, the weight comes off box scans of the patty PLUs. Verify on real orders in Phase 1. The office can override on the preview either way.
3. **Cured weight.** Comes off cure tags / box scans. Same verification.
4. **Website deploy** needs a Cloudflare token (Charlie's account). Never committed.
5. **Who approves** = any office login. Revisit if staffing changes.
6. **Clover "sync"** for processing prices: Clover only ever sees invoices (as open orders) and retail PLUs. Processing services don't need Clover catalog items.
7. **Curing weight (found while building Phase 1).** On seven September–November hog orders, Jill billed curing on 418.08 lb; the cured box scans total 377.97 lb. That's 40.11 lb × $2 = $80.22 less, about $11.46 per hog. The app has no pre-smoke weight: only 20 of 517 cure tags carry a weight. The detector bills on box scans (Charlie's 7a). If the old basis is wanted, weigh the pieces at the cure tag.
8. **Smoking fee (my call, reversible).** Pulled pork, smoked brisket, smoked & pulled beef and smoked chops bill Custom Smoking Fee $5/lb on finished weight.
9. **Where order charges come from.** Value-add jobs barely carry weights (9 jobs in 120 days). So sausage, patties, curing, smoking and Philly come off the box scans. Sticks, summers, brats, hot dogs and jerky come off the cut sheet's raw lbs, which matches the round 25/50/100 lb lines on past invoices. Pork sausage matched past invoices to the pound on five of six orders checked.
10. **Order charges start 2026-11-01** (`ordersSince`), so orders already invoiced by hand don't come back as new charges.
11. **Charges on our own animals' buyers.** The extras on top (curing, sausage, etc.) only bill if the buyer's scanner session isn't flagged as ours (`cmc`). Check on the first sale.
