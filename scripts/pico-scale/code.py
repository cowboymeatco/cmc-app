# Cowboy Meat Co — Pico scale reader
#
# Runs on a Raspberry Pi Pico 2 W wired to the RS-232 port of a Rice Lake
# weight indicator through a MAX3232 level shifter (README.md has the
# wiring). The indicator streams its display ten times a second; this reads
# the stream, keeps the latest frame, and posts it to the app, which keeps
# one row per scale. The harvest page shows the number live and offers it
# for the live weight with one tap.
#
# Nothing is sent TO the indicator. The TX pin is wired only so the board
# can be used for a command-response indicator later; the program never
# writes to it.
#
# The onboard LED:
#   two blinks, pause       a library is missing from /lib
#   slow, even on/off       settings.toml is missing something
#   solid                   joining wifi
#   one quick blink         posted a reading (so, about twice a second while
#                           the weight moves, every few seconds at rest)
#   three slow blinks       no frames from the indicator for 5 s: cable,
#                           stream turned off, or wrong baud
#   long on, then off       can't reach the app; retrying

import os
import time

import board
import digitalio

led = digitalio.DigitalInOut(board.LED)
led.direction = digitalio.Direction.OUTPUT

def blink(times, on=0.06, off=0.08):
    for _ in range(times):
        led.value = True
        time.sleep(on)
        led.value = False
        time.sleep(off)

try:
    import busio
    import wifi
    import socketpool
    import ssl
    import adafruit_requests
except ImportError as e:
    print("missing library:", e, "- copy it from the CircuitPython bundle into /lib")
    while True:
        blink(2, on=0.15, off=0.15)
        time.sleep(1)

# ── settings ────────────────────────────────────────────────────────────────

def setting(name, default=None):
    v = os.getenv(name)
    return default if v is None or v == "" else v

API_URL       = str(setting("CMC_API_URL", "")).rstrip("/")
TOKEN         = str(setting("CMC_WEDGE_TOKEN", ""))
SCALE_ID      = str(setting("CMC_SCALE_ID", "live_animal")).strip()
KIOSK         = str(setting("CMC_KIOSK", "pico-scale")).strip()
BAUD          = int(setting("CMC_BAUD", 9600))
POST_SECONDS  = float(setting("CMC_POST_SECONDS", 0.5))     # fastest we report a change
IDLE_SECONDS  = float(setting("CMC_IDLE_SECONDS", 5))       # re-post an unchanged weight this often
SSID          = str(setting("CIRCUITPY_WIFI_SSID", ""))
PASSWORD      = str(setting("CIRCUITPY_WIFI_PASSWORD", ""))

DEVICE_URL = API_URL + "/api/scale-readings/device"
HEADERS = {"Authorization": "Bearer " + TOKEN, "Content-Type": "application/json"}

if not (API_URL and TOKEN and SSID):
    print("settings.toml is missing CMC_API_URL, CMC_WEDGE_TOKEN or CIRCUITPY_WIFI_SSID")
    while True:
        blink(1, on=0.5, off=0.5)

# ── the indicator's stream ──────────────────────────────────────────────────
# Rice Lake stream format: <STX><polarity><wwwwwww><unit><G/N><status><CR>[<LF>]
# We hand the app the frame as-is and parse only enough here to know whether
# it changed. The app's lib/scaleReading.ts is the one parser of record.

uart = busio.UART(board.GP0, board.GP1, baudrate=BAUD, bits=8, parity=None, stop=1, timeout=0.05, receiver_buffer_size=512)
STX = 0x02

def read_frames(buf):
    """Pull every complete frame out of what the indicator has sent so far.
    Returns (frames, leftover). A frame runs from STX to CR."""
    frames = []
    while True:
        start = buf.find(bytes([STX]))
        if start < 0:
            return frames, b""
        end = buf.find(b"\r", start)
        if end < 0:
            return frames, buf[start:]
        frames.append(buf[start + 1:end])
        buf = buf[end + 1:]

def frame_text(fr):
    try:
        return "".join(chr(b) for b in fr if 32 <= b < 127)
    except Exception:  # noqa: BLE001
        return ""

# ── wifi ────────────────────────────────────────────────────────────────────

def connect_wifi():
    while not wifi.radio.connected:
        led.value = True
        print("wifi: joining", SSID)
        try:
            wifi.radio.connect(SSID, PASSWORD, timeout=20)
        except Exception as e:  # noqa: BLE001
            print("wifi: failed:", e)
            led.value = False
            time.sleep(5)
    led.value = False
    print("wifi: up,", wifi.radio.ipv4_address)

connect_wifi()
pool = socketpool.SocketPool(wifi.radio)
ssl_ctx = ssl.create_default_context()
try:
    with open("/certs.pem") as f:
        ssl_ctx.load_verify_locations(cadata="".join(line for line in f if not line.startswith("#")))
    print("tls: trusting the roots in certs.pem")
except OSError:
    print("tls: no certs.pem, using the built-in trust list")
if str(setting("CMC_INSECURE_TLS", "")).strip() in ("1", "true", "yes"):
    ssl_ctx.check_hostname = False
    ssl_ctx.verify_mode = ssl.CERT_NONE
    print("tls: VERIFICATION OFF (CMC_INSECURE_TLS)")
requests = adafruit_requests.Session(pool, ssl_ctx)

def post(body):
    body["scale_id"] = SCALE_ID
    body["kiosk"] = KIOSK
    with requests.post(DEVICE_URL, json=body, headers=HEADERS, timeout=10) as r:
        if r.status_code != 200:
            raise RuntimeError("app answered %d: %s" % (r.status_code, r.text[:120]))

# ── main loop ───────────────────────────────────────────────────────────────

print("scale reader for", SCALE_ID, "at", BAUD, "baud, posting to", DEVICE_URL)
leftover = b""
latest = None            # text of the newest frame
last_sent = None
last_post = 0.0
last_frame_at = time.monotonic()
reported_idle = False
backoff = 1.0

while True:
    try:
        if not wifi.radio.connected:
            connect_wifi()

        data = uart.read(512)
        if data:
            frames, leftover = read_frames(leftover + data)
            if frames:
                latest = frame_text(frames[-1])
                last_frame_at = time.monotonic()
                reported_idle = False

        now = time.monotonic()
        silent = now - last_frame_at > IDLE_SECONDS
        if silent and not reported_idle:
            print("no frames from the indicator for %.0fs" % IDLE_SECONDS)
            post({"error": "no frames from the indicator for %.0fs" % IDLE_SECONDS})
            reported_idle = True
            last_post = now
            blink(3, on=0.25, off=0.25)
        elif latest and not silent and (
            (latest != last_sent and now - last_post >= POST_SECONDS) or now - last_post >= IDLE_SECONDS
        ):
            post({"frame": latest})
            last_sent = latest
            last_post = now
            backoff = 1.0
            blink(1, on=0.02, off=0)

        time.sleep(0.05)
    except Exception as e:  # noqa: BLE001 — keep the board alive on the floor
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
