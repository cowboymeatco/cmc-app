# Cowboy Meats — Scale Push Agent

Pushes current app prices to the shop's Hobart HT scales, hands-free.

**Flow:** fetch priced PLUs from the app → build the `.ht` → send to each scale via
HCT's own CLI (`SEND_HOBART_FILE`, headless). Runs on a machine **on the shop LAN**
(the kiosk). Proven end-to-end 2026-07-02.

## Run — two modes
**One-shot** (double-click **push.bat**): pushes current prices to all scales once.
```
node push.mjs                 # all scales in config.json
node push.mjs 192.168.1.190   # one scale (testing)
```
**Watch** (double-click **watch.bat**, leave running on the kiosk): waits for the
app's "Push to scales" button and pushes when clicked.
```
node push.mjs --watch
```
(The bundled Node is used automatically if `node\node.exe` is present.)

## The "Push to scales" button (remote trigger)
The app button (Processing → Export tab) inserts a row in the `scale_push_requests`
table. The kiosk's watcher polls that table (every `pollSeconds`), runs the push,
and writes the result back — which the app shows. So you can trigger from home/phone
while the kiosk does the on-site send. Requires the app deployed + `watch.bat` running.

## What it needs
- **HCT install** (jre + HCT.exe + lib) — path in `config.json` → `hctDir`.
- **commons-cli-1.9.0.jar** — bundled here. HCT ships without it (Hobart packaging
  bug: its manifest lists it but `lib/` omits it), which is why the raw `HCT.exe -a …`
  CLI crashes to the GUI. We supply it on the classpath; HCT's install is untouched.
- **Node.js** to run the agent. (Kiosk has only a browser — bundle portable Node,
  or compile to a standalone `.exe`, at deploy time.)

## Notes / gotchas
- HCT's CLI **exits with code 1 even on success** → success is detected from the
  stdout line `"N records were sent successfully"`, not the exit code.
- **Scales sleep after-hours**: they answer ping but drop port 6000 when idle. The
  agent pre-checks port 6000 and reports `asleep/off — wake and re-run` instead of
  hanging. Push while the scales are awake (business hours / in use).
- Only PLUs with a real price (> $0.01) are sent; placeholders (wild-game service,
  wholesale cut-codes, boxes, NFS) are excluded. Send is a **merge** — it adds/updates
  those PLUs and leaves everything else on the scale alone.

## Deploy to the kiosk
1. Copy this folder to the kiosk.
2. Ensure HCT is installed there (or copy `C:\Program Files (x86)\HCT`) and update
   `config.json` → `hctDir` if the path differs.
3. Put Node on the kiosk (portable node in this folder, or ship a compiled `.exe`).
4. Trigger: a desktop shortcut to `push.bat`, a Scheduled Task (e.g. each morning),
   and/or the app "Push to scales" button (agent polls the app for a pending push).

`hobart.mjs` mirrors `cmc-app/lib/hobart.ts` — keep the two in sync.
