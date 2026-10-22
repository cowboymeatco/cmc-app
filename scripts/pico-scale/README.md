# Pico scale reader (Rice Lake)

A Raspberry Pi Pico 2 W wired to the RS-232 port of the Rice Lake indicator on
the live-animal scale. The indicator streams its display ten times a second; the
board reads it and posts the latest weight to the app, which keeps one row per
scale. The harvest page's Live Weight field shows the number live and takes it
with one tap. Nothing is typed, nothing is read off the display.

Sister project: `scripts/pico-wedge` (the boards on the Hobart scales). Same
flashing steps, same wifi, same token, same `certs.pem`.

**Flow:** indicator streams `<STX> 1245.LG <CR>` → Pico parses the frame →
`POST /api/scale-readings/device` → `scale_readings` row for `live_animal` →
harvest page polls `/api/scale-readings` once a second while a Part A row is
open → ⚖ 1,245 lb · USE.

## Parts

| Part | Qty | Est. | Why |
| --- | --- | --- | --- |
| Raspberry Pi Pico 2 W | 1 (+1 spare) | $7 | same board as the wedges |
| MAX3232 RS-232 to TTL breakout, 3.3 V, with DB9 | 1 | $5–8 | the indicator's port is ±12 V RS-232; the Pico's pins are 3.3 V. Wiring the two directly destroys the Pico. The breakout converts both ways. Search "MAX3232 DB9 breakout 3.3V". |
| DB9 serial cable or a DB9 breakout terminal block | 1 | $6 | whatever the indicator's port needs; a 480 has a DB9, an 880 or 420 may have a terminal strip, in which case three wires straight to the MAX3232 board's terminals |
| USB wall adapter, 5 V 1 A, and a micro-USB **data** cable | 1 | $8 | the board is powered from the wall here, there is no host |
| Jumper wires, female-female, 4 | 1 pack | $3 | breakout to Pico |
| Small enclosure or the C4Labs Zebra case plus zip ties | 1 | $8 | behind the indicator, out of the wash-down |

About $45 with a spare board.

## Wiring

MAX3232 breakout to Pico. Four wires.

| Breakout pin | Pico pin | Note |
| --- | --- | --- |
| VCC | 3V3 (pin 36) | the 3.3 V version of the breakout, not 5 V |
| GND | GND (pin 38) | |
| TXD (TTL out of the breakout) | GP1 (pin 2, UART0 RX) | the indicator's data arrives here |
| RXD (TTL into the breakout) | GP0 (pin 1, UART0 TX) | wired for later; the program never sends |

Indicator to breakout, on the DB9 side. The breakout's DB9 is wired as a PC
would be, so a **straight** serial cable to a Rice Lake indicator is usually
right; if nothing arrives, try a **null-modem** cable or swap TX and RX at the
terminals. Only three lines matter: the indicator's TXD, RXD and ground.

## Indicator setup (480 Legend; 420 and 880 are the same idea)

In the indicator's configuration menu, serial port (the one you wired):

| Setting | Value |
| --- | --- |
| Input / mode | Stream (continuous), not Command or Print |
| Format | the Rice Lake stream format (the default: STX, polarity, 7-char weight, unit, G/N, status, CR) |
| Baud | 9600 (set `CMC_BAUD` to match if you pick another) |
| Bits / parity / stop | 8, none, 1 |
| Stream rate | the display update rate is fine |

Write the settings down somewhere; a factory reset of the indicator loses them.

## Flashing the board

Exactly the wedge's steps (`scripts/pico-wedge/README.md`) with this folder's
files: CircuitPython for Pico 2 W, the three libraries into `lib`, then `code.py`,
`boot.py`, `certs.pem` and a filled-in `settings.toml` from `settings.toml.example`.
The libraries are `adafruit_requests.mpy` and `adafruit_connection_manager.mpy`;
`adafruit_hid` is not used here but does no harm.

## The bench test, before the indicator

With the board on the laptop and `settings.toml` filled in, the LED does three
slow blinks every five seconds: it is on the wifi and the app, and reports that
nothing is coming in on the serial port. On the harvest page, open a Part A row:
the Live Weight field shows `⚖ —  NO SCALE` or `STALE`. That is the whole chain
working except the wire.

Then on the indicator: once the stream is on and the wire is right, the LED
blinks quickly whenever the weight changes, and the harvest page shows the
number within a second, green with USE when the platform is still and amber
with SETTLING while it moves.

## What the LED means

| LED | Meaning |
| --- | --- |
| nothing | `code.py` isn't running: check CIRCUITPY and the serial console |
| two blinks, pause | a library is missing from `lib` |
| slow, even on/off | `settings.toml` is missing a key |
| solid | joining wifi |
| one quick blink | posted a reading |
| three slow blinks, every 5 s | nothing on the serial port: cable, stream off, wrong baud, or TX/RX swapped |
| long on, then off | can't reach the app (certificate, token, URL) |

The serial console (Chrome Labs serial terminal, see the wedge README) prints
every frame-less stretch and every error.

## Settings

| Key | What |
| --- | --- |
| `CIRCUITPY_WIFI_SSID` / `_PASSWORD` | shop wifi, 2.4 GHz |
| `CMC_API_URL` | `https://app.cowboymeats.com` |
| `CMC_WEDGE_TOKEN` | same as `SCALE_WEDGE_TOKEN` in Vercel |
| `CMC_SCALE_ID` | `live_animal` |
| `CMC_KIOSK` | a name for this board |
| `CMC_BAUD` | 9600 unless the indicator says otherwise |
| `CMC_POST_SECONDS` / `CMC_IDLE_SECONDS` | how fast a change is reported / how often a still weight is re-reported |

## Gotchas

- **Never wire the indicator's RS-232 pins straight to the Pico.** The MAX3232
  is the whole point of the parts list.
- **A reading goes stale after 5 s** without a report (lib/scaleReading.ts). The
  harvest page then greys the button rather than offering an old number.
- **USE is only offered when the indicator says the weight is still.** The status
  byte in each frame carries motion; the page waits for a space (valid) or Z
  (center of zero).
- **Net vs gross.** The frame says which; the app records whichever the indicator
  is showing. Tare on the indicator as usual.
