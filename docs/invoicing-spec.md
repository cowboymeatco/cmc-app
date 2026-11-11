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
| Baker storage | $20 transfer when the order moves to Baker; $28 per customer per month while anything sits there, the month it arrives counting as a full month; monthly storage on its own invoice |
| Outdoor kill $150, rush $50 | Flagged at booking |
| Extra long hang | Not automatic. Office adds it |
| Late fee | Not automatic |
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

1. **Under-billing to decide on:** kill-only beef billed at $0.38 instead of $0.53 on 2878C, 2920C (Arrow Livestock) and 2940C (Ben Reilly). 8,125.29 lb × $0.15 = **$1,218.79**. Re-bill, credit, or let it go is Charlie's call. The app won't touch past invoices.
2. **Patty / sausage finished weight.** Value-add jobs carry weight out. Patties made on the cutting floor may not go through a value-add job; if not, the weight comes off box scans of the patty PLUs. Verify on real orders in Phase 1. The office can override on the preview either way.
3. **Cured weight.** Comes off cure tags / box scans. Same verification.
4. **Website deploy** needs a Cloudflare token (Charlie's account). Never committed.
5. **Who approves** = any office login. Revisit if staffing changes.
6. **Clover "sync"** for processing prices: Clover only ever sees invoices (as open orders) and retail PLUs. Processing services don't need Clover catalog items.
7. **Curing weight (found while building Phase 1).** On seven September–November hog orders, Jill billed curing on 418.08 lb; the cured box scans total 377.97 lb. That's 40.11 lb × $2 = $80.22 less, about $11.46 per hog. The app has no pre-smoke weight: only 20 of 517 cure tags carry a weight. **Decided 2026-11-11: box-scan cured weight.**
8. **Smoking fee.** Pulled pork, smoked brisket, smoked & pulled beef and smoked chops bill Custom Smoking Fee $5/lb on finished weight. **Confirmed by Charlie 2026-11-11.**
9. **Where order charges come from.** Value-add jobs barely carry weights (9 jobs in 120 days). So sausage, patties, curing, smoking and Philly come off the box scans. Sticks, summers, brats, hot dogs and jerky come off the cut sheet's raw lbs, which matches the round 25/50/100 lb lines on past invoices. Pork sausage matched past invoices to the pound on five of six orders checked.
10. **Order charges start 2026-11-01** (`ordersSince`), so orders already invoiced by hand don't come back as new charges.
11. **Charges on our own animals' buyers.** The extras on top (curing, sausage, etc.) only bill if the buyer's scanner session isn't flagged as ours (`cmc`). Check on the first sale.
