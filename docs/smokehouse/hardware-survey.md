# Enviro-Pak Smokehouse — Hardware Survey (July 2026)

Photos taken by Charlie of the smokehouse control cabinet and related hardware, to scope
live data collection (and eventually command push) into cmc-app. This documents what we
have, what it means, and the candidate integration paths.

## Hardware inventory (from photos)

### 1. FDC-2110i HMI (Future Design Controls) — the smokehouse brain
Rear panel of the touchscreen operator interface mounted in the cabinet door.

- **Power**: 24 VDC input on green pluggable terminal block (yellow/yellow/green wires landed).
- **Comm ports**:
  - `COM1 [RS485 2/4W]`, `COM3 [RS485]`, `COM3 [RS232]` — terminal-block serial
  - `COM1 [RS232]` / `COM2 [RS232]` — DB9, **black DB9 cable currently connected**
    (almost certainly the Modbus RTU link to the loop controller(s) / relay board
    running the actual cook process)
  - **Ethernet (RJ45)** — port present next to the USB ports
  - USB host — beige USB cable connected (likely front-panel USB passthrough)
- **SD card slot with 2 GB SLC card installed** — this is where the HMI writes cook
  data logs. The CSVs we manually upload to the HACCP HTSS page
  (`Date,Time,Batch#,Truck#,Operator,Temperature,Temp SP,Humidity,Humidity SP,Core Probe 1,Damper %Out`)
  are this logger's export format.
- DIP SW / RESET access hatch top-left.

### 2. SNA10A — RS-232 ↔ RS-422/RS-485 converter (FDC/Brainchild)
Loose unit, powered up (ON LED lit), not currently in the loop.

- Universal AC input (90–264 VAC), DB9 RS-232 on one side, RS-422/485 screw
  terminals (TX1/TX2/RX1/RX2) on the other.
- An orange multi-conductor cable is landed on the RS-485 terminals with **frayed
  stray strands and two conductors (white/green) hanging loose — needs re-termination
  before it goes anywhere near the panel** (stray whiskers across TX/RX will short the bus).
- This is the adapter FDC ships so a PC running their MultiView/monitoring software can
  join the controller's RS-485 network. It's our fallback path if Ethernet on the HMI
  doesn't pan out: RS-485 side onto the Modbus network, RS-232 side into a small
  serial-to-IP gateway or a Pi.

### 3. Cat5 run into the cabinet (already pulled!)
- Blue Cat5 terminated to a keystone jack (T568A/B color chart visible on the jack).
- Inside the cabinet: grey Ethernet patch cable plugged into a blue keystone coupler,
  with the blue Cat5 coiled behind it — i.e., **a network drop already lands inside the
  control cabinet**. Need to confirm the patch cable's far end is in the HMI's Ethernet
  port and the keystone's far end reaches a switch on the shop LAN.

## What this adds up to

```
[Loop controller(s) / process I-O]
        │  RS-485 / RS-232 Modbus RTU (black DB9 cable)
[FDC-2110i HMI]───SD card (CSV cook logs — current manual HACCP upload)
        │  Ethernet (RJ45)
[blue keystone coupler in cabinet]───blue Cat5 run───[shop LAN?]  ← already pulled
```

The HMI is the single point that already has every value we care about (dry bulb, RH,
core probe, setpoints, damper) — it polls the controllers to drive its screens and its
SD logger. We don't need to touch the process wiring at all.

## Integration options, ranked

### Option A — Ethernet to the HMI (recommended, wiring is already done)
Patch the cabinet drop into the shop LAN, give the HMI a static IP, then probe what the
firmware exposes. FDC 2100-series HMIs typically offer some combination of:
1. **FTP server** — pull the SD-card data-log CSVs on a schedule. Zero risk to the
   process, and the files are byte-identical to what the HTSS page already parses.
   This automates today's manual upload with no new parsing work.
2. **Modbus TCP gateway/slave** — poll live registers (temps, RH, core, setpoints)
   for real-time dashboards, and (later, deliberately) write setpoints for command push.
3. **VNC / web server** — remote view of the touchscreen; handy for ops even if we
   never script against it.

### Option B — RS-485 tap via the SNA10A (fallback)
Land the SNA10A on the controller RS-485 network and poll Modbus RTU directly from a
gateway device. Caveats: Modbus RTU allows **one master** — the HMI is already master on
that bus, so we'd need a spare/second comm port on the loop controller, or accept
sniff-only. More wiring, more risk; only pursue if the HMI's Ethernet services are
locked down or the firmware predates them.

### Option C — Sneakernet SD card (status quo)
Keep pulling CSVs off the SD card manually. Works, but no live data and no automation.

## Next steps / info to gather (no code needed yet)

1. **Trace the grey patch cable** — confirm it's in the HMI's Ethernet port; if not, plug it in.
2. **Patch the far end** of the blue Cat5 into a LAN switch; test the run with a cable
   tester (the keystone punch-down should be verified A-vs-B consistent end to end).
3. On the HMI touchscreen, find the **system/setup menu**: record firmware version,
   Ethernet/IP settings, and any mention of FTP / VNC / Modbus TCP / "remote" services.
   (Photograph every screen — that decides Option A vs B.)
4. From a laptop on the same LAN: ping the HMI, then port-scan the obvious ports
   (21 FTP, 502 Modbus TCP, 5900 VNC, 80 web).
5. **Re-terminate or shelve the orange cable** on the SNA10A — trim the stray strands
   either way.
6. Model/photo of the **loop controller(s)** behind the HMI (likely FDC 9300/4100
   series) so we have the Modbus register map if we ever need Option B.

Once we know which services the HMI exposes, the first software milestone is an
automated log pull → the existing HTSS CCP-2B analyzer, then a live Modbus poller for
real-time cook monitoring.
