# Pico scale wedge

A Raspberry Pi Pico W (or Pico 2 W) on each Hobart HT scale's USB port. The scale
sees a USB keyboard, which is what a barcode scanner is. The board joins the shop
wifi, asks the app every second whether the packer has tapped a cut for its scale,
and types the digits plus Enter, the way a scanner would. The scale calls the
product up. Nothing on the scale changes; no HCT involved.

Parts list and the plan: the "Pico Scale Wedge Parts" page (2026-09-06).

**Flow:** app queues `scale 2, PLU 118` (`/scale-callup`, later the scanner page)
→ `scale_callup_requests` row → the Pico on scale 2 polls `/api/scale-callup/device`
→ types `118 ⏎` → reports done.

## Files

| | |
| --- | --- |
| `code.py` | the program: wifi, poll, type |
| `boot.py` | USB identity; keyboard-only mode if a scale needs it |
| `settings.toml.example` | copy to `settings.toml`, fill in |
| `certs.pem` | the Let's Encrypt roots the board trusts (the app's certificate chain is newer than the board's built-in list) |

## Flashing a board (first time, about ten minutes)

1. **Get CircuitPython.** From https://circuitpython.org/downloads pick the board,
   **Raspberry Pi Pico W** or **Raspberry Pi Pico 2 W** (they are different files),
   and download the latest stable `.uf2`. Note the major version (9 or 10): the
   library bundle has to match it.
2. **Put the board in bootloader mode.** Hold the white **BOOTSEL** button on the
   board, plug it into the laptop, let go. A drive appears: **RP2350** on a
   Pico 2 W, **RPI-RP2** on an original Pico W.
3. **Drag the `.uf2` onto that drive.** The board reboots on its own and comes back
   as a drive called **CIRCUITPY**.
4. **Libraries.** From https://circuitpython.org/libraries download the bundle whose
   version matches step 1 (`adafruit-circuitpython-bundle-9.x-mpy-…zip` or `10.x`).
   Unzip it and copy these from its `lib/` folder into `CIRCUITPY/lib/`:
   - `adafruit_hid/` (the whole folder)
   - `adafruit_requests.mpy`
   - `adafruit_connection_manager.mpy`
5. **Our files.** Copy `code.py`, `boot.py` and `certs.pem` from this folder onto
   CIRCUITPY (replacing the stock `code.py`). Copy `settings.toml.example` there as
   `settings.toml` and fill it in: the shop wifi (2.4 GHz name), the app URL,
   the token, and which scale this board is for.
6. **Token.** `CMC_WEDGE_TOKEN` must equal `SCALE_WEDGE_TOKEN` in the app's Vercel
   environment. Make one long random string, set it in Vercel (Production), redeploy,
   and put the same string on every board. Until it is set, the device route answers
   503 and the board's LED does the slow on/off.
7. **Unplug and plug back in.** The board reboots, the LED goes solid while it joins
   wifi, then gives one quick blink per second: it is checking in.

## The laptop test (do this before any scale)

With the board in the laptop and `settings.toml` filled in, open Notepad and click
in it so it has the cursor. In the app open **/scale-callup**, pick the board's scale
number, type a PLU, and send. Within a second or two the board types the digits and
Enter into Notepad, the LED flashes three times, and the page shows the row as done.

If the digits show up in Notepad, the wedge works. Everything after this is about the
scale, not the board.

## What the LED means

| LED | Meaning |
| --- | --- |
| nothing at all | `code.py` is not running: CircuitPython isn't on the board, or the stock `code.py` is still there, or it crashed before our first line. Check the CIRCUITPY drive, then the serial console. |
| two blinks, pause | a library is missing from `lib`, or the bundle doesn't match the CircuitPython version |
| slow, even on/off | `settings.toml` is missing one of the keys |
| solid | joining wifi |
| one quick blink a second | checked in with the app, nothing to type |
| three fast blinks | typed a call-up |
| long on, then off | can't reach wifi or the app; it keeps retrying. `error: (-12288, 'MBEDTLS_ERR_X509_FATAL_ERROR')` on the serial console means `certs.pem` is missing from the drive. |

## Serial console (when something is wrong)

The board prints what it is doing. The no-install way: in Chrome open
https://googlechromelabs.github.io/serial-terminal/, click Connect, pick the
"Pico 2 W - CircuitPython CDC control" port, and the output appears (Ctrl+C then
Ctrl+D in the black area restarts the program so it prints from the top). PuTTY at
115200 on the board's COM port works too. You will see
`wifi: joining`, `wedge for scale 2 polling …`, `call-up: 118 …`, and any error.

## Going on a scale

1. Flash and laptop-test as above, with `CMC_SCALE` set to that scale's number.
2. Plug it into the scale's USB port with the short data cable. Mount the case
   behind the scale housing, out of the spray.
3. On **/scale-callup** send a PLU to that scale with the format set to **PLU
   digits**. If the scale calls the product up, that is the format. If it does not,
   try **13-digit barcode**: it types the in-store barcode the scale itself prints
   for that PLU at zero weight (`2` + PLU + `0` + `00000` + check digit).
4. If neither works and the scale ignores the board altogether, it may want a plain
   keyboard rather than a keyboard-plus-drive-plus-console. Add
   `CMC_KEYBOARD_ONLY = 1` to `settings.toml` and power-cycle. The drive disappears
   on purpose; `boot.py` says how to get it back (GP15 to GND while plugging in).
5. If it still ignores it, plug a $20 USB barcode scanner into the same port and
   scan a code from the Barcode Book. If *that* does nothing either, the port is not
   a scanner port and the wedge plan stops here, which is what the parts page's
   "buy one thing first" was about.

## Settings

| Key | What |
| --- | --- |
| `CIRCUITPY_WIFI_SSID` / `_PASSWORD` | shop wifi, 2.4 GHz only |
| `CMC_API_URL` | `https://app.cowboymeats.com` |
| `CMC_WEDGE_TOKEN` | same as `SCALE_WEDGE_TOKEN` in Vercel |
| `CMC_SCALE` | `1`, `2` or `3` |
| `CMC_POLL_SECONDS` | default 1 |
| `CMC_KEY_DELAY_MS` | default 20; raise if the scale drops digits |
| `CMC_KEYBOARD_ONLY` | `1` to hide the drive and console (see above) |

## Gotchas

- **Charge-only cables** look identical and do nothing. The board must show up as a
  drive on the laptop; if it doesn't, the cable is the first suspect.
- **The shop's boards are Pico 2 W** (RP2350). Its firmware file is not the Pico W
  one; the two boards look alike, so check the name on the chip if unsure.
- **A call-up waits 90 seconds, then expires.** A board that was off wifi does not
  type a stale PLU under whatever is on the platter now. The page shows `expired`.
- **One per scale.** Two boards with the same `CMC_SCALE` would race for the same
  jobs; only one of them types each.
- **The app's `plu_items` price filter** decides what the `/scale-callup` page offers:
  only PLUs the price push sends (price above $0.01) are on the scales.
