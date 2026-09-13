# ARCHITECTURE — system and file ownership

## Runtime model

```text
GT-511C3 UART
    ↕
backend/gt511c3.py
    ↕
backend/app.py (Flask :5000)
    ↕
SQLite + sensor flash
    ↕
HTML shell + spliced backend/ui_app.js
    ↕
Admin / kiosk UI
```

SQLite and the GT-511C3 template store are operational truth. Browser LocalStorage is a display cache and is never authoritative.

## Code ownership

| File | Owns |
|---|---|
| `ATL-Smart-Attendance-Production.html` | HTML shell, markup, CSS, layout |
| `backend/ui_app.js` | UI behavior, state, events, API interaction |
| `backend/app.py` | Flask routes, validation, scheduling, reconciliation, backup workers, serve-time composition |
| `backend/gt511c3.py` | GT-511C3 UART protocol |
| `backend/gdrive_backup.py` | Google Drive snapshot/upload/retention |
| `backend/schema.sql` | SQLite schema |

No separate frontend framework or template tree is used.

## Serve-time composition

`app.py` reads the production HTML shell and replaces its inline script with the maintained `backend/ui_app.js`. A scan bridge is injected when the UI exposes `window.handleRealScan`. HTML and API responses use `Cache-Control: no-store`.

Because the script is injected at request time, UI changes should be made in `ui_app.js`, not by modifying the obsolete HTML inline script.

## Scan architecture

The frontend `sensorScanLoop()` posts `POST /api/scan {waitSec:2}`. The backend serializes sensor access through `SENSOR_LOCK`.

A second bridge polls `GET /api/scan/last` every two seconds and routes persisted scan results to `window.handleRealScan`. `NO_FINGER`, sensor-busy, and UART failures do not create attendance events.

Admin scanning continues in the background while Admin is open, but the identity overlay is suppressed. Enrollment and other exclusive sensor/database operations pause the scan loop.

## Data load

The UI loads cache first, then authoritative API data:

`cacheLoad → settings/classes → students → history → today attendance → cacheSave`

Visible Admin refreshes authoritative data periodically. All writes go through the backend API.

## Background workers

`app.py` owns automated attendance reconciliation and the multi-destination backup scheduler. Reconciliation follows the attendance cutoff and writes `ABSENT` or `NOT_SCHEDULED` only when resolution rules allow it.

Backup workers are isolated by destination so a Google Drive, Telegram, or USB failure does not block attendance processing.

## UI architecture on the current branch

`feature/ui-glass-redesign` uses the black-and-cream wall as the current Admin visual system. The workspace and rail are stable structural regions. Students, Attendance, Setup, and Backup reuse the same wall primitives instead of each inventing a separate theme.

Exact design values live in `docs/UI_TOKENS.md`; component responsibilities live in `docs/UI_COMPONENTS.md`.

## Boundaries

- API endpoint contracts → `API.md`
- data/status/scheduling rules → `DATA_MODEL.md`
- runtime sequences → `WORKFLOW.md`
- Admin behavior → `ADMIN.md`
- deployment/recovery → `OPERATIONS.md`
