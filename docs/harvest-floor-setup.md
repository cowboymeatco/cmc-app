# Harvest floor laptop: scale, carcass tags, QR

Set up once on the Windows laptop at the rail scale (Charlie, 2026-11-21).

## Scale (Rice Lake 420 Plus) — already done, nothing to change
- Port 1 (EDP, RS-232) is wired to the Tripp Lite Keyspan USB-serial adapter (COM5).
- Port 1: 9600 baud, 8 bits, no parity, 1 stop, CR/LF, INPUT = CMD. Proven in PuTTY 2026-11-02.
- The app asks for the gross weight with `XG` and waits until two readings in a row match, so no continuous stream is needed. Leave the indicator in setup only if a Rice Lake tech changes Port 1; setup mode needs the setup switch under the access screw on the bottom of the enclosure (420 Plus install manual, PN 85127, section 1.1).

## Printer (Brother QL-810W)
1. Plug the QL-810W into the laptop by USB and install Brother's Windows driver for it.
2. Load DK-2205 (2.4" / 62 mm continuous) tape.
3. Windows Settings → Printers → QL-810W → Printing preferences: paper 62 mm continuous, length 127 mm (5"), cut every 1 label.
4. Set the QL-810W as the Windows default printer.

## Chrome: one tap to print
1. Make a desktop shortcut with this target:
   `"C:\Program Files\Google\Chrome\Application\chrome.exe" --kiosk-printing https://app.cowboymeats.com/harvest`
2. Close every Chrome window, then open Chrome only from that shortcut (the flag only takes effect when Chrome starts).
3. In Chrome, allow pop-ups for app.cowboymeats.com (the tag opens in its own window, prints, and closes).

## First use on the floor
1. Harvest → Part B (Weights). Tap ⚖ Connect next to Left Half once and pick the Keyspan (COM5). Chrome remembers it.
2. Hang the left side, tap ⚖ Read; hang the right side, tap ⚖ Read. "Still moving" means read again. HCW fills in.
3. Save, then 🏷 Print Tags: two tags, L and R, each with its own weight, HCW, customers and the carcass QR.

## QR
- Any phone camera opens the carcass page: cut card, days hung vs aging target (beef 10 days unless set), Move to staging, Mark cut (time clock PIN).
- Cooler & Staging list: app.cowboymeats.com/staging
