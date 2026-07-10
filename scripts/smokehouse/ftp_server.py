#!/usr/bin/env python3
"""
Anonymous FTP receiver for the Enviro-Pak smokehouse HMI (FDC-2110i).

The HMI's Datalogging → "FTP \\ WAN Setup" screen pushes its data-log CSVs to
this machine (auto-backup nightly at 2:00 AM, or the Backup Now button). On the
HMI, set "FTP IP Add" to this PC's address, leave User Name/Password blank
(anonymous), and Server Dir to the oven name (e.g. Oven1).

Files land in incoming/<Server Dir>/ and are ingested into Supabase on arrival
(see ingest.py), then archived to processed/. Files that fail to ingest stay in
incoming/ and are retried on the next arrival or restart.

Run setup.bat once to install requirements, open the firewall, and register
this as a Windows scheduled task that starts on boot.
"""

import logging
import sys
from pathlib import Path

from pyftpdlib.authorizers import DummyAuthorizer
from pyftpdlib.handlers import FTPHandler
from pyftpdlib.servers import FTPServer

import ingest

BASE_DIR      = Path(__file__).parent
INCOMING_DIR  = BASE_DIR / 'incoming'
FTP_PORT      = 21
PASSIVE_PORTS = range(60000, 60100)

LOG_FILE = BASE_DIR / 'ftp_server.log'
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s  %(levelname)-7s  %(message)s',
    handlers=[
        logging.FileHandler(LOG_FILE, encoding='utf-8'),
        logging.StreamHandler(sys.stdout),
    ],
)
log = logging.getLogger(__name__)


class SmokehouseHandler(FTPHandler):
    def on_file_received(self, file: str) -> None:
        try:
            ingest.ingest_file(Path(file))
        except Exception:
            log.exception('ingest failed for %s — left in incoming/ for retry', file)

    def on_incomplete_file_received(self, file: str) -> None:
        log.warning('incomplete transfer removed: %s', file)
        Path(file).unlink(missing_ok=True)


def main() -> None:
    INCOMING_DIR.mkdir(exist_ok=True)
    (INCOMING_DIR / 'Oven1').mkdir(exist_ok=True)  # matches the HMI's Server Dir

    ingest.sweep()  # retry anything left over from previous runs

    authorizer = DummyAuthorizer()
    # e=cd l=list r=read a=append d=delete f=rename m=mkdir w=write M=chmod T=mtime
    authorizer.add_anonymous(str(INCOMING_DIR), perm='elradfmwMT')

    handler = SmokehouseHandler
    handler.authorizer = authorizer
    handler.banner = 'CMC smokehouse log receiver'
    handler.passive_ports = PASSIVE_PORTS

    server = FTPServer(('0.0.0.0', FTP_PORT), handler)
    log.info('FTP receiver listening on port %d, drop dir %s', FTP_PORT, INCOMING_DIR)
    server.serve_forever()


if __name__ == '__main__':
    main()
