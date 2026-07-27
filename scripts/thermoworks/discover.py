#!/usr/bin/env python3
"""
Run this once to discover your ThermoWorks Cloud devices and generate config.json.

Usage:
    python discover.py

It will:
  1. Log in to ThermoWorks Cloud
  2. Print every device, channel label, and current reading
  3. Write a config.json template you then edit to map channels to the CMC app
"""

import asyncio
import json
import os
from dataclasses import asdict
from pathlib import Path

from aiohttp import ClientSession
from dotenv import load_dotenv
from thermoworks_cloud import AuthFactory, ThermoworksCloud, ResourceNotFoundError

load_dotenv(Path(__file__).parent / '.env')

COLD_STORAGE_KEYS = [
    'showcase_freezer_f',
    'showcase_cooler_f',
    'retail_freezer_f',
    'custom_freezer_middle_f',
    'custom_freezer_east_f',
    'new_carcass_cooler_f',
    'old_carcass_cooler_f',
]


def temp_display(value, units) -> str:
    if value is None:
        return 'no reading'
    u = (units or 'F').upper()
    return f'{value}°{u}'


async def main():
    email    = os.environ.get('THERMOWORKS_EMAIL')    or input('ThermoWorks email: ').strip()
    password = os.environ.get('THERMOWORKS_PASSWORD') or input('ThermoWorks password: ').strip()

    print('\nConnecting to ThermoWorks Cloud...')

    async with ClientSession() as session:
        auth = await AuthFactory(session).build_auth(email, password)
        tw   = ThermoworksCloud(auth)
        user = await tw.get_user()
        devices = await tw.get_devices(user.account_id)

        print(f'\nFound {len(devices)} device(s):\n{"=" * 60}')

        config_cold  = []
        config_cook  = None
        discovered   = []

        for device in devices:
            print(f'\nDevice : {device.label!r}')
            print(f'Type   : {device.type}')
            print(f'Serial : {device.serial}')

            if not device.serial:
                print('  (no serial — skipping)')
                continue

            channels = []
            for ch_num in range(1, 10):
                try:
                    ch = await tw.get_device_channel(device.serial, str(ch_num))
                    label = ch.label or f'Channel {ch_num}'
                    print(f'  Ch{ch_num}: {label!r} → {temp_display(ch.value, ch.units)}')
                    channels.append({
                        'channel': ch_num,
                        'label':   label,
                        'value':   ch.value,
                        'units':   ch.units,
                    })
                except ResourceNotFoundError:
                    break
                except Exception as e:
                    print(f'  Ch{ch_num}: error — {e}')

            discovered.append({'device': device, 'channels': channels})

            # Build template config entries for every channel found
            device_type = (device.type or '').upper()
            if 'THERMADATA' in device_type or 'LOGGER' in device_type:
                # Likely the cook/smoke logger
                config_cook = {
                    'serial': device.serial,
                    'channels': [
                        {'channel': c['channel'], 'label': c['label']}
                        for c in channels
                    ],
                }
            else:
                for c in channels:
                    config_cold.append({
                        'serial':        device.serial,
                        'channel':       c['channel'],
                        'channel_label': c['label'],
                        'unit_key':      '← REPLACE with one of the keys below',
                    })

        print(f'\n{"=" * 60}')
        print('\nAvailable unit_key values for cold_storage mapping:')
        for k in COLD_STORAGE_KEYS:
            print(f'  {k}')

        config = {'cold_storage': config_cold, 'cook_logger': config_cook}
        config_path = Path(__file__).parent / 'config.json'

        # Never clobber a working mapping — this script regenerates a blank
        # template, so keep a copy of whatever was there before.
        if config_path.exists():
            backup = config_path.with_suffix('.json.bak')
            backup.write_text(config_path.read_text())
            print(f'\nExisting config backed up to {backup}')

        config_path.write_text(json.dumps(config, indent=2))

        print(f'\nconfig.json written to {config_path}')
        print('\nNext steps:')
        print('  1. Edit config.json — set the correct unit_key for each cold storage channel')
        print('  2. Remove any channels you don\'t want to log (delete those entries)')
        print('  3. Verify cook_logger serial/channels are correct for your ThermaData')
        print('  4. Run sync.py to test, then run setup.bat to schedule it')


asyncio.run(main())
