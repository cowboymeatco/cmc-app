# Change of Procedure (COP) – app integration scoping

Read-only scoping, 2026-10-31. No code, migrations or deploys. Schema inspected live on
Supabase project eosafbzqitgqzhejilhf; paper form read from the COP artifact.

## 1. What exists today

**There is no SOP table.** Nothing in the schema carries an "SOP-###" id, a version number
or a procedure body. The paper form's "SOP affected (app SOP ID)" field has nothing to point at.
The closest things:

| Table | What it holds | Versioning | Identity | RLS |
|---|---|---|---|---|
| haccp_documents (149 rows) | Uploaded files: HACCP Plan 6, Blank Form 36, Supporting Document 107. SSOP and Prerequisite Program categories exist in code but hold 0 rows. | `version_date` + `active` flag only. No chain, no supersede link, no body text. Every plan rev is 2024-02-15. | `uploaded_by` free text | On, no policy, service role (good) |
| cleaning_steps (0 rows) | Teardown / clean / reassemble steps per asset. The only structured procedure entity in the app. | Edited in place, no history | none | On, permissive anon policy |
| cleaning_step_suggestions (0 rows) | Crew "this write-up is wrong" inbox: open / applied / declined, reviewed_by. A mini change-request flow already. | n/a | free text | On, permissive anon policy |
| cleaning_tasks (120 active) | Nightly checklist templates. Shift items snapshot the title at build time, so history is already immutable. | n/a | n/a | On, permissive anon policy |

The printed HACCP record headers hardcode "APPROVED BY HACCP Team / Current Version 02.15.24"
in `app/haccp/page.tsx`, `lib/haccpReceivingLog.ts` and `app/haccp/cold-storage/page.tsx`.

**Employees and auth: three unrelated identity systems, none of them Supabase Auth for staff.**

| System | Rows | How identity is proven | Used for |
|---|---|---|---|
| Supabase Auth + `customers.auth_user_id` | 108 users, 1 is_staff | Email login | Customer portal only. Not the crew. |
| `tk_employees` + `tk_kiosk_sessions` | 1 employee | Per-person 4-digit PIN (HMAC, salted by employee id), 10-minute kiosk token, lockouts | Time clock kiosk. The only real per-person authentication on the floor. |
| `cleaning_crew` | 14 (11 active) | Tap your name, remembered in localStorage. Attribution, not authentication (the route says so). | Cleaning sign-in |
| Free-text "who" | – | none | feedback.submitter, haccp uploaded_by, suggestion reviewed_by |

cleaning_crew has the real roster (Landon Lawrence, Landon Slade, Camron Reilly, Christopher
Ashley, AnnaLea Engle, Robert Fairfull, Tanner Sendt, Jill Lawrence, Mandy Hollenbeck, Mariann
Callen, Charles Hollenbeck). tk_employees has one row and shares no names with it. "Anthony" on
the paper Section F list is in neither.

**Charlie-only gate exists:** `requireExec` (passphrase, 30-day cookie, `exec_sessions`). Used by
/api/exec/* and /api/timekeeping/*. Section D approval should sit behind it. Note it proves
"knows the passphrase", not identity; acceptable because that is its design.

**Migration convention:** no `supabase/migrations` folder in the repo. SQL lives in
`scripts/YYYY-MM-DD_name.sql` with a header comment, applied via the Supabase MCP migration
tool with the migration name recorded in the header (see `scripts/2026-10-27_call_log.sql`).
Latest RLS convention for staff-only data: RLS on, no anon policy, all access through an API
route on `supabaseAdmin`.

## 2. Gap analysis vs the proposed model

| Proposed | Verdict | Notes |
|---|---|---|
| cop_requests | New | Add `requested_by_id` FK (see roster decision) plus name snapshot. Status enum: open, approved, rejected, live, closed; add `trial`. |
| cop_impact | New, 1:1 | Explicit boolean columns (8 food-safety + 5 ops), not jsonb, so the "any yes" rule can be a DB constraint. Plus reassessment_result, plans_reassessed[], reassessed_by, reassessed_on, iic_notified_on, notes. |
| cop_approvals | New, append-only | A COP can be "approved with changes" then re-decided; keep history. decision: approved / approved_with_changes / rejected / trial; trial_end_date, conditions, go_live_date, rejection_reason. |
| sop registry | **Missing from the proposal** | `sops`: sop_number (SOP-###), title, area, owner, active, current_version_id, optional links to haccp_documents and to an asset (cleaning procedure). Seeded from your SOP list. |
| sop_versions | New | sop_id, version int, body (markdown), revision_note ("COP-2026-###: summary"), effective_date, cop_id, status draft / current / superseded, published_by, published_at, superseded_at. Unique (sop_id, version). |
| sop_acknowledgments | New | sop_version_id, employee_id, acknowledged_at, method (kiosk_pin / tablet / phone), trained_by, how_communicated. Unique (sop_version_id, employee_id). |
| cop_verifications | New | The four G checks as booleans + notes, verified_by, verified_at, result close / adjust (new_cop_id) / reverse, closed_by, closed_at. |
| cop_links | **Add** | Section E "related app items updated": cop_id, kind (cleaning_task / asset_procedure / haccp_document / customer_material / other), target_id, note, done_by, done_at. |
| COP numbering | Reuse pattern | `game_tag_counters` + `next_game_tag()` already do per-year counters. Same pattern for COP-YYYY-###. |
| Attachments (B) | Reuse pattern | haccp-docs private bucket + two-step signed upload already built in /api/haccp/documents. New `cop-attachments` bucket, same code shape. |
| Reassessment record | Reuse | Link the written reassessment to haccp_documents (new category "Reassessment") so the inspector portal can show it. |

Reuse of existing tables for the core COP record: none fit. haccp_documents is a file library,
not a procedure store; cleaning_steps is per-asset teardown only.

## 3. Phased plan

**Phase 0 – decisions and data, no code.** Pick the employee roster (recommend tk_employees,
see §4), you supply the SOP list to seed `sops` (number, title, area, owner, which HACCP
document or asset it maps to), confirm numbering starts at COP-2026-001 (paper COPs already
filed get back-entered).

**Phase 1 – COP record and SOP versions (sections A–E, G). Paper still used for F.**
- Migration 1: `sops`, `sop_versions`, `cop_requests`, `cop_impact`, `cop_approvals`, `cop_verifications`, `cop_links`, `cop_counters` + next_cop_number(). All RLS on, no anon policies, service role only. Trigger: a COP cannot move to live/trial while any Section C food-safety answer is yes and reassessment fields are null.
- API: /api/cop (list, create, impact, links, verify), /api/cop/approve behind requireExec, /api/sops (registry, versions, publish). Publish = insert new version, mark old superseded, stamp cop_id, set sops.current_version_id. One transaction via a Postgres function.
- UI: /cop list with status filter; /cop/new (A, B, C on one scrolling form, phone-friendly); /cop/[id] detail with approval panel (exec passphrase prompt, same as /exec), E checklist, G verification; /sops library and /sops/[id] with version history and diff of body text.
- Roster rollout: add the crew to tk_employees (data entry, exec UI already exists).
- Size: 3 PRs. Largest piece is the detail page.

**Phase 2 – Crew acknowledgment (section F).**
- Migration 2: `sop_acknowledgments`.
- Kiosk flow: on the floor tablet, tap name, PIN, see "You have 2 SOPs to sign", read the version body, tap "I read it, I was shown how, I can do it" (the form's wording), stamped on the shop clock. Reuses /api/timeclock PIN session code.
- Manager board on /cop/[id]: who is affected (pick from roster at approval time), who has signed, who is outstanding. "Anyone absent signs on first shift back" falls out of this for free.
- Blocking rule per §4.
- Size: 2 PRs.

**Phase 3 – Wire the rest of the app to it.**
- HACCP printed headers read "Approved by / Current Version" from sop_versions instead of the hardcoded 02.15.24.
- Inspector portal: SOP versions, effective dates and acknowledgment records (read-only).
- Cleaning procedure edits (cleaning_steps) require an open COP once that asset is mapped to an SOP; cleaning admin writes move to service role (see §5).
- Cron: 14 days after go-live, email you "verify COP-2026-0xx" via lib/mailer (vercel.json cron pattern exists).
- Size: 2–3 PRs.

## 4. Recommendations

**Tablet vs phones: shared floor tablet with PIN, phones read-only.** The time clock kiosk
already has per-person PIN auth, lockouts and shop-clock stamping; that is a signature, where
the cleaning name-tap is not. A record you may hand to FSIS should be PIN-backed. Phones are fine
for reading the SOP body (public read of current versions through an API route), not for signing.
Downside: a tablet is one more device to keep charged at the entrance; the time clock iPad is
the obvious host.

**Section C "yes" should hard-block going live, not approval.** You can still approve, with the
reassessment as a condition. The transition to live (publishing the SOP version with an
effective date) is refused by the API and by a DB trigger until reassessed_by, reassessed_on
and result are filled. Trial runs count as live. No override switch: 9 CFR 417.4(a)(3) does not
have one either, and a same-day reassessment is always possible.

**Unacknowledged version blocking tasks: hard block only where the app knows who is working.**
Push-back on the artifact note "blocks the employee from that SOP's tasks until signed": the
scanner, harvest, processing and value-add screens have no per-person sign-in, so a block
there is unenforceable and would be hollow. Recommend: hard block on cleaning shift items for an
asset whose SOP version that crew member has not signed (prompt to read and sign right there),
a banner on the kiosk and shift-start screens elsewhere, and an outstanding-signatures report
for you. Extend the hard block as per-person sign-in reaches other modules.

## 5. RLS

All new tables ship RLS on with no anon policy; every read and write goes through an API route
on the service role. That matches tk_*, haccp_documents, call_log and the direction of the
pending lockdown scripts.

Flags:
- The advisor counts 36 tables with RLS off (critical). COP touches none of them.
- cleaning_steps, cleaning_tasks, cleaning_step_suggestions have RLS on with a permissive
  anon policy, so anyone with the anon key can edit a procedure from the browser and bypass
  COP. Phase 3 moves those writes to service role. Until then the COP gate is procedural.
- haccp_documents, tk_employees, tk_kiosk_sessions: already service-role only. Good.
- `scripts/2026-09-29_rls_1a/1b/1c_*.sql` are prepared lockdowns marked NOT YET APPLIED.
  Separate decision from COP, but Phase 1 is a natural time to run 1a.
- 49 tables have RLS on with no policy (intended; service role). 11 SECURITY DEFINER views and
  7 anon-executable SECURITY DEFINER functions are flagged; unrelated to COP.

## 6. Decisions needed before Phase 1

1. Roster: tk_employees (PIN, long-term HR record, needs 11 names added) or cleaning_crew (names only, no auth)?
2. SOP seed list: how many SOPs, and does each map to a HACCP document, a cleaning asset, or neither?
3. Numbering: COP-2026-001 forward, back-enter the paper COPs already filed?
