# Runs before code.py, once, at power-up. Decides what the Pico looks like on USB.
#
# Out of the box a CircuitPython board shows up as three things at once: a
# keyboard, a serial console and the CIRCUITPY drive. A laptop is fine with
# that. If a Hobart turns out to want a plain keyboard and nothing else,
# add this line to settings.toml and power-cycle the board:
#
#     CMC_KEYBOARD_ONLY = 1
#
# The drive and the console then stay off, so the board can no longer be
# edited by plugging it in. To get the drive back, wire GP15 to GND (a jumper
# wire between those two pins) while plugging it in: that overrides the
# setting for that boot. Or re-flash from scratch (README.md).

import os

import board
import digitalio
import storage
import usb_cdc
import usb_hid

override = digitalio.DigitalInOut(board.GP15)
override.switch_to_input(pull=digitalio.Pull.UP)
dev_mode = not override.value          # GP15 pulled to GND = keep the drive
override.deinit()

keyboard_only = str(os.getenv("CMC_KEYBOARD_ONLY") or "").strip() in ("1", "true", "yes")

usb_hid.enable((usb_hid.Device.KEYBOARD,))
if keyboard_only and not dev_mode:
    storage.disable_usb_drive()
    usb_cdc.disable()
