# Runs before code.py, once, at power-up.
#
# This board only listens to a serial port and talks wifi, so it keeps the
# CIRCUITPY drive and the serial console on: there is no scale host to be
# fussy about what it looks like on USB, and the drive is how settings get
# changed on the floor. Nothing to configure here.
