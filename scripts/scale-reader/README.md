# Scale reader (laptop / kiosk)

Reads the Rice Lake indicator on the live-animal scale through a USB-to-serial
adapter and posts the weight to the app. The harvest page's Live Weight field then
shows ⚖ 1,245 lb · USE and takes it with a tap. The Pico version of the same job is
`scripts/pico-scale`; this one uses a computer and the Keyspan adapter instead, so
there is nothing to order.

Runs on the harvest-side computer the same way the ThermoWorks sync runs on the
packaging kiosk (`scripts/thermoworks/SHOP-SETUP.md`): a folder, a `.env`, Python,
and a scheduled task.

## Hardware

| | |
| --- | --- |
| Indicator → plug | three wires into the green 3-pin Phoenix plug: TXD, RXD, GND, per the label by the header |
| Plug → DB9 | TXD to DB9 pin 2, RXD to pin 3, GND to pin 5 (a DB9 breakout with screw terminals makes this easy) |
| DB9 → computer | the Tripp Lite Keyspan USB-to-serial adapter, then its USB A-to-B cable |

Only the indicator's TXD actually carries anything. If nothing ever shows up, swap
the two signal wires at the plug.

## Indicator setup

On the port you wired: **stream** (continuous) mode, the Rice Lake stream format,
**9600** baud, 8 data bits, no parity, 1 stop bit. Write the settings down.

## Install (once)

1. **Keyspan driver.** Windows needs Tripp Lite's driver for the USA-19HS. Download
   it from tripplite.com (search Keyspan USA-19HS), install, plug the adapter in.
2. **Python 3**, if the machine doesn't have it: python.org, tick "Add to PATH".
3. In this folder, in a terminal:
   ```
   pip install -r requirements.txt
   copy .env.example .env
   ```
4. `python reader.py --ports` lists the serial ports. The Keyspan is the one that
   says Keyspan or USA-19HS. Put its `COMx` in `.env` as `SCALE_PORT`, and the token
   from the wedges' `settings.toml` as `CMC_WEDGE_TOKEN`.

## First look at the stream

```
python reader.py --watch
```

prints every frame as it arrives, ten a second, like `'   1245.LG '`. Put something
on the platform and watch the number move. A `?` in front means a line that isn't a
weight frame (noise, or the wrong baud). Nothing at all means the cable, the port
setting, or the TX/RX swap. Ctrl+C stops it.

## Run it

```
python reader.py
```

reads and posts until the window is closed. Open the harvest page, open a Part A
row, and the Live Weight field shows the number. Green with USE when the platform is
still, SETTLING while it moves, STALE if the reader stops.

To keep it running on its own, a scheduled task **at log on** pointing at this
folder with `pythonw.exe reader.py` (windowless), the same shape as the ThermoWorks
task. `reader.log` next to the script says what it is doing.

## What the app sees

One row in `scale_readings` for `live_animal`, overwritten about twice a second
while the weight moves and every five seconds at rest, with `kiosk` naming this
reader. A reading older than five seconds is shown as stale. If the reader loses the
indicator, it posts an error and the page says NO SCALE.
