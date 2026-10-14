# Cutting instructions and the customer front door

Plan of record, 14 Oct 2026. Charlie + Claude, from a review of cmc-app, the
cutting tables, the feedback log and live counts. Nothing here is built yet.

## Decisions already made

| Question | Decision |
|---|---|
| Who connects a cut sheet to an animal | The customer. The system must make that the easy path. |
| What the intake must answer, in order | Who owns the animal → who each share is cut for → how to cut it → who pays → how and when it's picked up |
| How hard to push for the card | Hard. First message when the animal is scheduled, regular nudges, heat turned up once the animal is in the plant. |
| No card by cut day | Cut it the way we cut their last one. No last one: our standard cut. Stated on every message. |
| Channel | Whatever the customer picks: text, email or phone. Phone preferences become a daily call list so the office calls out instead of waiting. Texting is new infrastructure and we are adding it. |
| Payment | Questions only (who pays). Money moves through QuickBooks invoices and QuickBooks payment links, as today. |
| Pickup options | Pick up in Forsyth · delivered to Baker Storage (Billings) · home delivery |
| Unbooked animals | Never happen. Every animal has a booking before it arrives, so every animal has a slot the link can hang off. |
| The portal (portal.cowboymeats.com) | Stops being the front door. The per-animal link does its job without a login. The portal stays as an optional "all my animals in one place" view. |
| Office mailbox | info@cowboymeats.com replaces jill@ everywhere it appears. |

## Where we are (so we know what changed)

- Since the online form went live (mid-July): 324 cards through the public form, 15 through the portal, the rest typed by the office.
- 237 of 300 dated cards were submitted after the kill date. Only 8 came in more than three days before. The office reconciles backward.
- 134 upcoming booked buyer slots, none with a cut sheet linked, 74 with no buyer name, 115 with no phone or email.
- 436 of 591 customer records have neither phone nor email.
- No reminder, confirmation or text has ever been sent by the system. The slot's reminder fields exist in the schema and nothing writes to them.
- Matching a card to an animal is done by a person, by name and hanging weight, one kill day at a time. That person is Jill.

## The model

**One link per share.** The moment a slot exists on a booking, it gets a long random token. Everything the customer does happens at that link: see the animal, name the buyers, fill the card, answer pickup and payment, see the hanging weight, see the invoice and pay it. A card that comes in through a link is born attached to its slot. Nobody matches it.

**The producer is the router.** The first message goes to whoever booked the animal: "Your beef is scheduled for the week of Nov 3. Who is taking it?" They add names and a phone or email for each share and say who pays for each. Each buyer then gets their own link. This is how we get contacts we don't have today; the producer knows their buyers and we don't.

**Pressure is automatic and the consequence is stated.** Every message ends with the same line: *If we don't have your instructions by [cut date], we'll cut it the way we did your last animal, or our standard cut if this is your first.*

**The office works a queue, not a pile.** Instead of "every card", the office page shows only what needs a human: slots past a threshold with no card, people who asked for a phone call, messages that bounced, cards that arrived with no link, cards edited after they were printed.

## Phases

### Phase 0 · Before Jill leaves (start now, mostly not code)

This is knowledge capture. It has a hard date and it is the part only Jill can do.

1. **Standard cut sheets.** Jill fills out the house standard card for each species and portion we cut (beef whole/half/quarter, hog whole/half, lamb, goat) as real cards in the system, flagged as templates. These are the fallback for a first-time customer with no card.
2. **Producer defaults.** For every producer who gets a special scale label or a negotiated rate, record it once on the producer record, not card by card. Today `scale_label`, `kill_price_per_lb` and `processing_price_per_lb` live on each card and Jill re-enters them from memory.
3. **Contacts for what's already booked.** Jill works the 134 upcoming slots and fills in a name and a phone or email for each while she still knows who these people are. This is the seed list the first automated messages go to.
4. **Aliases and regulars.** Add the rest of the floor shorthand to `customer_name_aliases` (MVML and MT are the only two today). Note the producers who always split, always take the same cuts, or always go to Baker Storage.
5. **Phone intake script.** Write down how Jill takes a card over the phone, in the order the wizard asks it. It becomes the call-list script.
6. **Swap jill@ for info@.** In this app: `app/book/page.tsx`, the three HACCP printouts, `app/capacity/page.tsx`, `app/page.tsx`, and `MAIL_SENDER` in Vercel. Same sweep in the public form and portal repos. Make sure info@ is a real mailbox someone reads.
7. **Start texting registration.** Pick a provider (Twilio is the default choice; use the shop's phone provider instead only if it offers an API). Register the business for A2P 10DLC. Decide whether texts come from (406) 346-7660 (needs the carrier to text-enable it) or a new number. Registration takes days to weeks, so it starts in Phase 0 even though nothing sends until Phase 2.

### Phase 1 · The link and the intake (the biggest build)

Goal: a slot can be filled in by its customer with no office involvement, and a card that arrives this way is already linked.

1. **Slot tokens.** A `slot_links` table: slot id, appointment id, token, created, last opened, revoked. Tokens are long and random; the URL carries nothing else. cmc-app issues them.
2. **Share set-up page (producer).** At the link: the animal, its date, how many shares. The producer names each share, gives a contact and a channel preference, and says who pays (producer or that buyer, which is the existing `payment_responsibility` field). Saving creates or fills the slots and sends each buyer their own link. A producer who skips this keeps the whole animal on their own card.
3. **The card at the link.** The public form accepts a token. Species, portion, kill date, name and contact come pre-filled and are not re-asked. On submit, a new server route in cmc-app (the form has only the anon key, so this cannot be a direct table write) sets the card's `appointment_id` and `customer_id`, writes the slot's `linked_cutting_instruction_id`, and sets status to `linked`. The existing "linked" badge, carcass picker and cut schedule need no change.
4. **Pickup and payment questions.** Two new steps at the end of the wizard: pickup method (Forsyth / Baker Storage / home delivery, with address and best contact), and confirmation of who pays. These are stored on the slot as columns, not inside the card's `data` blob, because the wizard rewrites `data` wholesale on edit and the office and the delivery schedule read these fields.
5. **The status view.** The same link, after submission: card on file, animal status (booked / in / hanging with weight / cutting / ready), pickup plan, invoice with the QuickBooks payment link. Reuses `/api/portal/invoices`. This replaces the main reason anyone needed a portal login.
6. **Booking captures a contact properly.** `/book` and the schedule's new-booking form store phone and email as fields and create the producer record, instead of writing "Phone: …" into notes. Confirming a request (PendingRequest → Booked) is what triggers the first message in Phase 2.
7. **Cards with no link still work.** The public form stays open without a token, but asks first: "Did we send you a link?" Cards that arrive with none go to the office queue with suggested matches, using the name matcher already written for the SharePoint migration.

### Phase 2 · Messaging and the call list

Goal: nobody has to remember to chase anyone.

1. **Message log and templates.** An `outbound_messages` table (slot, channel, template, sent at, delivered/bounced, provider id). Templates per step with the consequence line baked in.
2. **The schedule.** A daily job on Vercel cron (alongside the register and cleaning jobs) walks every slot that has no card and picks the step by days to the kill date and the animal's status:
   - On booking confirmation: welcome, date, link, consequence.
   - 14 days out and 7 days out: reminder.
   - Day the animal is checked in (receiving): "your animal is here", firmer tone.
   - Every day after check-in until the card arrives.
   - Day before the cut: final notice, consequence restated.
   Nothing is sent to a slot that already has a card, and nothing is sent to a kill-only booking.
3. **Three channels, one preference.** Text through the provider from Phase 0, email through the existing Microsoft mailer as info@, and phone preference (or a bounced text/email) lands the slot on the call list. The slot's `contact_preference` field already exists.
4. **Call list page.** Who to call today, why (first contact / overdue / bounced), the number, the script, and the link to type the card into while on the phone. One tap to record the outcome: reached, left message, card taken, wrong number.
5. **Inbound.** Text replies forward to info@ and are logged against the slot. STOP is honored automatically. Email replies arrive at info@ as normal.

### Phase 3 · The office queue and the fallbacks

Goal: the office page stops being a matching tool and becomes an exceptions list.

1. **Needs-attention view** on /cutting-instructions: no card by threshold, no contact at all, bounced, homeless card, edited after print, head count declared vs cards on file.
2. **Apply the default.** For a slot with no card at cut time, one button: "Use last cut" (copies that customer's most recent card for the species and portion, using the existing copy route) or "Use standard" (copies the Phase 0 template). The printed card says in a band across the top that it was defaulted and why, so the cutter knows the customer never chose.
3. **Edits after print.** A card linked to an animal that has been checked in locks for the customer after the cut date is set; before that, an edit notifies the office and marks the card "changed since printed" on the cut schedule so a stale print is never cut from.
4. **Producer defaults flow onto cards.** Label and rates set in Phase 0 are applied to new cards for that producer automatically; the office can still override per card.
5. **Portal wind-down.** The portal's cut-sheet wizard redirects to the slot link. Signup is no longer promoted. The portal keeps the account view for anyone who wants it.

## What we are deliberately not doing

- Collecting money in the app. QuickBooks invoices and payment links do it.
- Rebuilding the wizard. The questions are good; the problem was what happens before and after them.
- Investing further in portal signup or the portal as a way in.
- Inferring links from names in the background. Name matching stays a suggestion the office confirms; the token is what links.

## Risks and how we handle them

- **Texting lead time.** Carrier registration can take weeks. It starts in Phase 0 so it is ready when Phase 2 lands. Until then Phase 2 runs on email and the call list.
- **Producers who won't name their buyers.** The whole animal stays on the producer's card and the pressure schedule targets the producer. The office can still split it later, as now.
- **A link in the wrong hands.** The token is long, carries no personal data in the URL, can be revoked, and the status view shows only that one animal. Nothing at the link can move money.
- **Customers editing after we've cut.** Phase 3 lock and the "changed since printed" flag.
- **Three codebases.** cmc-app owns tokens, slots, messaging, the queue and all server routes. The public form owns the wizard and the new pickup/payment steps and learns to accept a token. The portal only loses things. Each phase lists which repo each item touches when it is scheduled.

## What we watch

- Share of cards in hand before the kill date (today about 1 in 5).
- Slots with no contact at booking (today most).
- Slots reaching cut day with no card, and how many were defaulted.
- Size of the daily call list.
- Cards arriving with no link.

## Still to confirm

- Jill's last day, which sets the Phase 0 deadline.
- Who owns the daily queue and call list after Jill.
- Whether the standard cut is one card per species+portion or Jill wants variants (e.g. "mostly ground").
- Home delivery: any fee, radius, or days of the week to state on the pickup question.
- Which number texts come from.
