# TESTING — verification contract

## Backend unit/API suite

Run from `project/`:

```bash
python -m unittest backend.test_app -v
```

The suite uses temporary SQLite and simulated sensor state. It covers API validation, scheduling, scans, duplicates, reconciliation, backup providers, restore safety, auth, images, CSV import/export, and sensor-lock behavior.

Current branch inventory: **124 backend tests**.

## Playwright browser suite

Run from `project/`:

```bash
python -m unittest backend.test_ui_e2e -v
```

Current branch inventory: **16 browser scenarios** covering kiosk idle/scan, Admin gate and navigation, enrollment, Backup destinations/scheduling, Setup scheduling/calendar flows, Attendance, holiday/override round trips, and the rail search palette.

## UI verification shortcut

Use:

`http://127.0.0.1:5000/?tab=setup`

(or another tab name) to open a specific Admin tab after refresh. This is a development convenience only.

## What to report

Documentation of a test command is not evidence that it ran. Report the actual result. In particular, a UI screenshot pass is not the same as a backend or Playwright pass.

## Hardware verification

Hardware checks are separate from the simulated test suite. GT-511C3 wiring must remain:

- VCC → 3.3V pin 1
- GND → pin 6
- sensor RX → GPIO14 / pin 8
- sensor TX → GPIO15 / pin 10
- `/dev/serial0` at 9600 baud

`tools/led_test.py` is diagnostic only.

## Production verification

After an explicit deployment, verify:

```bash
curl -s http://127.0.0.1:5000/ | grep -o "ATL Smart Attendance Terminal"
curl -s http://127.0.0.1:5000/ | grep -c "F4EEE1"
curl -s http://127.0.0.1:5000/ | grep -c "pane-backup"
curl -s http://127.0.0.1:5000/api/health
```

Also verify `Cache-Control: no-store`, `/backend/config.json` is not exposed, and the served page contains the spliced UI bridge.

Do not claim live hardware or production verification unless it actually occurred.