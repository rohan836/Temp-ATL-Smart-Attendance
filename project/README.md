# ATL Smart Attendance Terminal

Offline-first fingerprint attendance for one school: **GT-511C3 → Raspberry Pi 3 → Flask → SQLite → single-page Admin UI**.

The fingerprint terminal handles scan/identify/classify/record/display. Admin provides **Students, Attendance, Setup, and Backup** without leaving the device.

## Current development line

Active branch: `feature/ui-glass-redesign`.

The current Admin visual language is the **black-and-cream wall**. The authoritative UI contract is `docs/UI_TOKENS.md`; component structure is `docs/UI_COMPONENTS.md`.

## Source ownership

- `ATL-Smart-Attendance-Production.html` — markup + CSS/layout
- `backend/ui_app.js` — UI behavior/state/events/API calls
- `backend/app.py` — Flask API, scheduling, reconciliation, backup workers, serve-time JS injection
- `backend/gt511c3.py` — sensor driver
- `backend/gdrive_backup.py` — Google Drive backup engine
- `backend/schema.sql` — database schema

## Local development

From `E:\temp\project`:

```powershell
powershell -File tools/dev.ps1
```

or:

```powershell
python backend/app.py
```

Open `http://127.0.0.1:5000/`.

UI changes take effect on refresh because Flask serves the HTML shell with `ui_app.js` spliced into it using `Cache-Control: no-store`.

## Tests

```powershell
python -m unittest backend.test_app -v
python -m unittest backend.test_ui_e2e -v
```

Current branch documentation lists 124 backend tests and 16 Playwright E2E scenarios. Always report what was actually run.

## Hardware

GT-511C3 uses UART `/dev/serial0` at 9600 baud. **VCC is 3.3V pin 1 only. Never use 5V.**

## Documentation

Start at `AGENTS.md`, then `docs/DOCS.md`.
