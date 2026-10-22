"""Cowboy Meat Co — scale reader (laptop / kiosk edition)

Reads the Rice Lake indicator's serial stream through a USB-to-serial
adapter (the Keyspan) and posts the latest weight to the app, which keeps one
row per scale. The harvest page shows it live and takes it with one tap. The
same job scripts/pico-scale does on a Pico, done on a computer instead, with
the gear already in the drawer.

    python reader.py --ports      which COM ports Windows sees (find the Keyspan)
    python reader.py --watch      print the frames as they arrive; no posting
    python reader.py              read and post, forever (what the kiosk runs)

Settings come from .env next to this file (see .env.example). Nothing is sent
to the indicator; the port is opened for reading only.
"""
from __future__ import annotations

import argparse
import logging
import os
import sys
import time
from pathlib import Path

HERE = Path(__file__).parent
logging.basicConfig(
    level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s',
    handlers=[logging.FileHandler(HERE / 'reader.log', encoding='utf-8'), logging.StreamHandler(sys.stdout)],
)
log = logging.getLogger('scale-reader')

STX = b'\x02'


def split_frames(buf: bytes) -> tuple[list[bytes], bytes]:
    """Every complete frame in the buffer (STX … CR), and whatever is left over."""
    frames: list[bytes] = []
    while True:
        start = buf.find(STX)
        if start < 0:
            return frames, b''
        end = buf.find(b'\r', start)
        if end < 0:
            return frames, buf[start:]
        frames.append(buf[start + 1:end])
        buf = buf[end + 1:]


def frame_text(frame: bytes) -> str:
    return ''.join(chr(b) for b in frame if 32 <= b < 127)


def looks_like_weight(text: str) -> bool:
    """Rice Lake stream format: <polarity><7-char weight><unit><G/N><status>.
    Enough of a check to skip line noise; the app's parser is the real one."""
    return len(text) >= 10 and text[-3] in 'LKTO' and text[-2] in 'GN' and text[-1] in ' MIOZ'


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--ports', action='store_true', help='list serial ports and exit')
    ap.add_argument('--watch', action='store_true', help='print frames, do not post')
    args = ap.parse_args()

    try:
        import serial  # pyserial
        from serial.tools import list_ports
    except ImportError:
        log.error('pyserial is not installed: run  pip install -r requirements.txt')
        return 2

    if args.ports:
        found = list(list_ports.comports())
        if not found:
            print('No serial ports. Is the Keyspan plugged in, and its driver installed?')
        for p in found:
            print(f'{p.device:8} {p.description}')
        return 0

    try:
        from dotenv import load_dotenv
        load_dotenv(HERE / '.env')
    except ImportError:
        pass
    port     = os.environ.get('SCALE_PORT', '')
    baud     = int(os.environ.get('SCALE_BAUD', '9600'))
    scale_id = os.environ.get('SCALE_ID', 'live_animal')
    kiosk    = os.environ.get('KIOSK_NAME', 'kiosk-scale-reader')
    api_url  = os.environ.get('CMC_API_URL', 'https://app.cowboymeats.com').rstrip('/')
    token    = os.environ.get('CMC_WEDGE_TOKEN', '')
    post_every = float(os.environ.get('POST_SECONDS', '0.5'))
    idle_every = float(os.environ.get('IDLE_SECONDS', '5'))
    if not port:
        log.error('SCALE_PORT is not set in .env (run  python reader.py --ports  to find it)')
        return 2
    if not args.watch and not token:
        log.error('CMC_WEDGE_TOKEN is not set in .env')
        return 2

    import requests
    session = requests.Session()
    session.headers.update({'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'})
    device_url = f'{api_url}/api/scale-readings/device'

    def post(body: dict) -> None:
        if args.watch:
            return
        body.update(scale_id=scale_id, kiosk=kiosk)
        r = session.post(device_url, json=body, timeout=10)
        if r.status_code != 200:
            raise RuntimeError(f'app answered {r.status_code}: {r.text[:120]}')

    log.info(f'reading {port} at {baud} baud for {scale_id}, {"watching only" if args.watch else "posting to " + device_url}')
    leftover = b''
    latest: str | None = None
    last_sent: str | None = None
    last_post = 0.0
    last_frame_at = time.monotonic()
    reported_idle = False
    backoff = 1.0

    while True:
        try:
            with serial.Serial(port, baud, bytesize=8, parity='N', stopbits=1, timeout=0.1) as ser:
                log.info('port open')
                backoff = 1.0
                while True:
                    data = ser.read(512)
                    if data:
                        frames, leftover = split_frames(leftover + data)
                        for fr in frames:
                            text = frame_text(fr)
                            if looks_like_weight(text):
                                latest = text
                                last_frame_at = time.monotonic()
                                reported_idle = False
                                if args.watch:
                                    print(repr(text))
                            elif args.watch:
                                print('?', repr(text))
                    now = time.monotonic()
                    silent = now - last_frame_at > idle_every
                    if silent and not reported_idle:
                        log.warning(f'no frames from the indicator for {idle_every:.0f}s')
                        post({'error': f'no frames from the indicator for {idle_every:.0f}s'})
                        reported_idle = True
                        last_post = now
                    elif latest and not silent and (
                        (latest != last_sent and now - last_post >= post_every) or now - last_post >= idle_every
                    ):
                        post({'frame': latest})
                        last_sent = latest
                        last_post = now
        except KeyboardInterrupt:
            log.info('stopped')
            return 0
        except Exception as e:  # noqa: BLE001 — a kiosk script keeps going
            log.error(f'{e} — retrying in {min(backoff, 30):.0f}s')
            time.sleep(min(backoff, 30))
            backoff = min(backoff * 2, 30)


if __name__ == '__main__':
    sys.exit(main())
