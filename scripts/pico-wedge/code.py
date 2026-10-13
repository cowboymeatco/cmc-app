# Cowboy Meat Co — Pico scale wedge
#
# Runs on a Raspberry Pi Pico W / Pico 2 W plugged into a Hobart HT scale's
# USB port. The scale sees a USB keyboard, the same thing a barcode scanner
# is. We join the shop wifi, ask the app every second or so whether the
# packer has tapped a cut for THIS scale, and if so type the digits and
# press Enter, which is exactly what a scanner would have sent. The scale
# calls the product up and the packer weighs it.
#
# CircuitPython. Settings come from settings.toml next to this file (see
# settings.toml.example). Libraries needed in /lib: adafruit_hid,
# adafruit_requests, adafruit_connection_manager. README.md has the steps.
#
# The onboard LED says what it's doing:
#   nothing at all   code.py isn't running: no CircuitPython, or it crashed
#                    before this file's first line (read the serial console)
#   two blinks, pause   a library is missing from /lib (or is the wrong bundle)
#   slow on/off, even   settings.toml is missing something
#   solid            joining wifi
#   one short blink  checked in with the app, nothing to do (heartbeat)
#   three fast       typed a call-up
#   long on/off      can't reach wifi or the app; retrying

import os
import time

import board
import digitalio

# LED first, before anything that can fail, so a failure has a way to show.
led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

def blink(times, on=0.06, off=0.08):
    for _ in range(times):
        led.value = True
        time.sleep(on)
        led.value = False
        time.sleep(off)

try:
    import usb_hid
    import wifi
    import socketpool
    import ssl
    import adafruit_requests
    from adafruit_hid.keyboard import Keyboard
    from adafruit_hid.keycode import Keycode
except ImportError as e:
    print("missing library:", e, "- copy it from the CircuitPython bundle into /lib")
    while True:
        blink(2, on=0.15, off=0.15)
        time.sleep(1)

# ── settings ────────────────────────────────────────────────────────────────

def setting(name, default=None):
    v = os.getenv(name)
    return default if v is None or v == "" else v

API_URL      = str(setting("CMC_API_URL", "")).rstrip("/")
TOKEN        = str(setting("CMC_WEDGE_TOKEN", ""))
SCALE        = str(setting("CMC_SCALE", "")).strip()
POLL_SECONDS = float(setting("CMC_POLL_SECONDS", 1.0))
KEY_DELAY    = float(setting("CMC_KEY_DELAY_MS", 20)) / 1000.0
SSID         = str(setting("CIRCUITPY_WIFI_SSID", ""))
PASSWORD     = str(setting("CIRCUITPY_WIFI_PASSWORD", ""))

DEVICE_URL = API_URL + "/api/scale-callup/device"
HEADERS = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}

# ── keyboard ────────────────────────────────────────────────────────────────

DIGITS = {
    "0": Keycode.ZERO, "1": Keycode.ONE, "2": Keycode.TWO, "3": Keycode.THREE,
    "4": Keycode.FOUR, "5": Keycode.FIVE, "6": Keycode.SIX, "7": Keycode.SEVEN,
    "8": Keycode.EIGHT, "9": Keycode.NINE,
}

kbd = Keyboard(usb_hid.devices)

def type_keys(keys):
    """Type the digits one at a time with a scanner-like pause, then Enter.
    Anything that isn't a digit is skipped: the app only ever sends digits,
    and a stray character typed into a scale is worse than a missing one."""
    for ch in keys:
        code = DIGITS.get(ch)
        if code is None:
            continue
        kbd.press(code)
        time.sleep(KEY_DELAY)
        kbd.release_all()
        time.sleep(KEY_DELAY)
    kbd.press(Keycode.ENTER)
    time.sleep(KEY_DELAY)
    kbd.release_all()

# ── wifi ────────────────────────────────────────────────────────────────────

def connect_wifi():
    """Join the shop wifi; keep trying until it works. CircuitPython already
    tries once at boot from settings.toml, this covers the times it didn't
    take or the network dropped. Pico W is 2.4 GHz only."""
    while not wifi.radio.connected:
        led.value = True
        print("wifi: joining", SSID)
        try:
            wifi.radio.connect(SSID, PASSWORD, timeout=20)
        except Exception as e:  # noqa: BLE001 — anything; keep the board alive
            print("wifi: failed:", e)
            led.value = False
            time.sleep(5)
    led.value = False
    print("wifi: up,", wifi.radio.ipv4_address)

if not (API_URL and TOKEN and SCALE and SSID):
    print("settings.toml is missing CMC_API_URL, CMC_WEDGE_TOKEN, CMC_SCALE or CIRCUITPY_WIFI_SSID")
    while True:
        blink(1, on=0.5, off=0.5)

connect_wifi()
pool = socketpool.SocketPool(wifi.radio)
requests = adafruit_requests.Session(pool, ssl.create_default_context())

# ── main loop ───────────────────────────────────────────────────────────────

def check_in(done):
    """One round trip: report the last job (or None) and get the next."""
    body = {"scale": SCALE}
    if done:
        body["done"] = done
    with requests.post(DEVICE_URL, json=body, headers=HEADERS, timeout=15) as r:
        if r.status_code != 200:
            raise RuntimeError("app answered %d: %s" % (r.status_code, r.text[:120]))
        return r.json().get("job")

print("wedge for scale", SCALE, "polling", DEVICE_URL)
done = None
backoff = POLL_SECONDS
while True:
    try:
        if not wifi.radio.connected:
            connect_wifi()
        job = check_in(done)
        done = None
        backoff = POLL_SECONDS
        if job:
            keys = str(job.get("keys", ""))
            print("call-up:", job.get("plu"), job.get("item_name"), "->", keys)
            try:
                type_keys(keys)
                done = {"id": job["id"], "ok": True}
                blink(3)
            except Exception as e:  # noqa: BLE001
                done = {"id": job["id"], "ok": False, "error": str(e)[:120]}
            # Tell the app straight away rather than waiting a poll.
            continue
        blink(1, on=0.02, off=0)
        time.sleep(POLL_SECONDS)
    except Exception as e:  # noqa: BLE001 — never let the loop die on the bench
        print("error:", e)
        led.value = True
        time.sleep(min(backoff, 10))
        led.value = False
        time.sleep(0.5)
        backoff = min(backoff * 2, 30)
        if not wifi.radio.connected:
            try:
                wifi.radio.enabled = False
                time.sleep(1)
                wifi.radio.enabled = True
            except Exception:  # noqa: BLE001
                pass
