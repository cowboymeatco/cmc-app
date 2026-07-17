#!/usr/bin/env python3
"""
Modbus register discovery for the Enviro-Pak smokehouse (FDC nCompass HMI).

We know the HMI's live values from the touchscreen Main View (Temperature,
Humidity, Lowest Core, Damper %, Blower %). This script reads a block of Modbus
registers from the HMI and flags any register whose value matches one of those
readings (raw, or x10 — nCompass usually stores temps/RH as value x10). That
tells us which register holds which process value, so we can write the poller.

One-time use, run on the shop PC while looking at the touchscreen:

    pip install pymodbus
    python discover_registers.py --temp 81 --humidity 62 --core 83

Pass whatever the Main View currently shows for --temp/--humidity/--core (and
optionally --damper/--blower). Anything you don't pass is just listed, not matched.

Connection defaults come from the confirmed HMI settings (Web Server/Modbus/VNC
screen): host 192.168.1.176, port 502, unit id 1. Override with flags if needed.
"""

import argparse
import sys

try:
    from pymodbus.client import ModbusTcpClient, ModbusSerialClient
except ImportError:
    sys.exit("pymodbus not installed — run:  pip install pymodbus")


# pymodbus renamed the unit-id keyword across versions (slave / device_id / unit).
# Detect which one this install accepts, once, then reuse it.
_READ_KW = None

def _call_read(fn, start, count, unit):
    global _READ_KW
    if _READ_KW is not None:
        kw = {_READ_KW: unit} if _READ_KW else {}
        return fn(start, count=count, **kw)
    for cand in ('slave', 'device_id', 'unit', ''):
        try:
            kw = {cand: unit} if cand else {}
            rr = fn(start, count=count, **kw)
            _READ_KW = cand
            return rr
        except TypeError:
            continue
    raise RuntimeError("no compatible pymodbus read signature found")


def read_block(client, kind, start, count, unit):
    fn = client.read_holding_registers if kind == 'holding' else client.read_input_registers
    rr = _call_read(fn, start, count, unit)
    if rr is None or rr.isError():
        return None
    return rr.registers


def scan(client, kind, first, last, unit):
    """Read registers first..last in <=125-wide chunks; return {addr: value}."""
    out = {}
    addr = first
    while addr <= last:
        n = min(125, last - addr + 1)
        regs = read_block(client, kind, addr, n, unit)
        if regs:
            for i, v in enumerate(regs):
                out[addr + i] = v
        addr += n
    return out


def main():
    ap = argparse.ArgumentParser()
    # TCP mode (default): poll a Modbus TCP endpoint (HMI or a serial->TCP gateway)
    ap.add_argument('--host', default='192.168.1.176')
    ap.add_argument('--port', type=int, default=502)
    # Serial (RTU) mode: --serial COM3  (for a USB-serial adapter into the HMI's
    # Modbus slave port, via the SNA10A if that port is RS-485)
    ap.add_argument('--serial', metavar='COMx', help='use Modbus RTU on this serial port instead of TCP')
    ap.add_argument('--baud', type=int, default=9600)
    ap.add_argument('--parity', default='N', choices=['N', 'E', 'O'])
    ap.add_argument('--stopbits', type=int, default=1)
    ap.add_argument('--bytesize', type=int, default=8)
    ap.add_argument('--unit', type=int, default=1)
    ap.add_argument('--first', type=int, default=0)
    ap.add_argument('--last', type=int, default=511)
    ap.add_argument('--temp', type=float)
    ap.add_argument('--humidity', type=float)
    ap.add_argument('--core', type=float)
    ap.add_argument('--damper', type=float)
    ap.add_argument('--blower', type=float)
    args = ap.parse_args()

    targets = {k: v for k, v in (
        ('temp', args.temp), ('humidity', args.humidity), ('core', args.core),
        ('damper', args.damper), ('blower', args.blower),
    ) if v is not None}

    if args.serial:
        client = ModbusSerialClient(port=args.serial, baudrate=args.baud,
                                    parity=args.parity, stopbits=args.stopbits,
                                    bytesize=args.bytesize)
        where = f"{args.serial} @ {args.baud} {args.bytesize}{args.parity}{args.stopbits}"
        hint = "check the COM port, the SNA10A wiring, and the serial settings (baud/parity)."
    else:
        client = ModbusTcpClient(args.host, port=args.port)
        where = f"{args.host}:{args.port}"
        hint = "check the IP, the network, and that Modbus TCP is enabled/reachable."

    if not client.connect():
        sys.exit(f"Could not connect to {where} — {hint}")

    print(f"Connected to {where}, unit {args.unit}\n")
    for kind in ('holding', 'input'):
        regs = scan(client, kind, args.first, args.last, args.unit)
        label = 'HOLDING (4xxxx)' if kind == 'holding' else 'INPUT (3xxxx)'
        if not regs:
            print(f"{label}: no readable registers in {args.first}..{args.last}")
            continue
        print(f"=== {label}: {len(regs)} registers read ===")
        # Non-zero registers (compact)
        nonzero = {a: v for a, v in regs.items() if v != 0}
        for a in sorted(nonzero):
            v = nonzero[a]
            print(f"  reg {a:5d} = {v:6d}   (/10 = {v/10:.1f})")
        # Matches to known Main View values (raw or x10)
        for name, want in targets.items():
            hits = [a for a, v in regs.items() if v == want or v == round(want * 10)]
            if hits:
                print(f"  >>> {name} ({want}) matches register(s): "
                      + ', '.join(str(h) for h in hits))
        print()

    client.close()
    print("Note the registers that match temp/humidity/core — those are the ones "
          "the poller will read. Re-run once during an active cook to confirm they "
          "track (idle values can collide by coincidence).")


if __name__ == '__main__':
    main()
