# Scale read requests — kiosk side

The app can now ask the kiosk to read every scale back: all PLU records and all
label formats. It shows the result at **/scale-check** and on **/producer-labels**.
Tables: `scripts/2026-09-26_scale_reads.sql`.

## Why a separate queue

`push.mjs --watch` treats any `scale_push_requests` row whose `kind` it doesn't
know as a **full price push to every scale**. So reads do **not** go through
`scale_push_requests`. They have their own table, `scale_read_requests`, which the
current watcher never looks at. Nothing happens until the watcher learns to poll
it.

## What the watcher needs to do

In `watchLoop`, after the existing `scale_push_requests` handling (same loop, so it
never runs at the same time as a push or store-name job):

1. Poll one request:
   `GET scale_read_requests?status=eq.pending&order=created_at.asc&limit=1`
2. `PATCH` it to `status: 'running'`.
3. For each IP in `req.scales ?? cfg.scales`:
   - `checkPort(ip)`. If it's asleep, insert a `scale_reads` row
     `{ request_id, scale_ip, what: 'plu', ok: false, error: 'asleep' }` and move on.
   - **PLU read.** Run `read-plus.js` (Nashorn, through HCT's `java.exe`, as its
     header shows) into `out/read_<ip>.ht`. Parse it with `parseRecords`, splitting on
     the 0x1E byte, **not** on lines (14 names contain a line break). Keep `RT89`.
     - Insert `scale_reads` `{ request_id, scale_ip, what: 'plu', ok: true, record_count }`
       with `Prefer: return=representation` to get its `id`.
     - Insert `scale_plu_records` in batches of about 200:
       `{ read_id, plu_number: fields['p#'], item_name: first line of fields.dt, label_format: fields.l1 ?? null, fields }`.
   - **Label read.** Run HCT's CLI with `-a READ_ALL_LABELS -i <ip> -f out/labels_<ip>.ht`.
     Keep `RT9C`.
     - Insert `scale_reads` `{ ..., what: 'label', record_count }`.
     - Insert `scale_label_formats` `{ read_id, format_number, internal_name (e.g. LT_422), texts, fields }`.
       `texts` holds the logo names and text lines in the format, the things that say
       whose label it is (e.g. `BLEGEN_GALLOWAYS_LOGO_230x222`, `Blegen Galloways LLC`).
   - If a read throws, insert its `scale_reads` row with `ok: false, error: <message>`.
4. `PATCH` the request to `done` (or `error` if any scale failed or was asleep), with
   `result: { scales: [{ ip, plu: <count>, labels: <count>, asleep?, error? }] }` and
   `completed_at`.

Use the same `HDRS` as the rest of the watcher. Everything above is a read: no
`SEND_HOBART_FILE`, no delete, and nothing written to a scale.

## Before changing the live watcher

- Back it up the way earlier updates were (`backup-<date>-<time>/`).
- Do it outside packing hours. Store names and Julian codes depend on this loop.
- Test one read by hand first (`node push.mjs` is the price push, so don't use it
  to test).
