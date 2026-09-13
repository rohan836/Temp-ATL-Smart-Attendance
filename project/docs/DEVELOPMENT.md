# DEVELOPMENT — safe changes

## Source ownership

- `ATL-Smart-Attendance-Production.html` — UI markup and CSS/layout.
- `backend/ui_app.js` — UI state, events, rendering, API calls.
- `backend/app.py` — Flask routes, validation, scheduling, reconciliation, backup workers, serve-time JS injection.
- `backend/gt511c3.py` — fingerprint UART driver.
- `backend/schema.sql` — database schema.
- `backend/gdrive_backup.py` — Google Drive backup engine.

The HTML inline `<script>` is replaced by `app.py`; do not edit it directly. Keep the architecture simple. Do not create `css/`, `js/`, `templates/`, or component folders without a documented need.

## Safe editing rules

- One task at a time.
- Preserve validation, scheduling precedence, authentication, and sensor locking unless explicitly changing that behavior.
- UI changes default to UI files only.
- Prefer deleting a stale rule over adding a more specific rival.
- Keep dynamic UI states shift-proof.
- Do not commit machine-local files: `backend/config.json`, databases, backup files, tokens, uploads, logs, caches, `.venv`, `.env`.

## Local development

From `E:\temp\project`:

```powershell
powershell -File tools/dev.ps1
```

or:

```powershell
python backend/app.py
```

Open `http://127.0.0.1:5000/`. Flask serves the same production HTML shell and splices `ui_app.js` on every request with `Cache-Control: no-store`.

## UI workflow

Before a UI edit, read `AGENTS.md`, `docs/ADMIN.md` when relevant, `docs/UI_TOKENS.md`, `docs/UI_COMPONENTS.md`, and the two UI skills.

Implement the requested visual mechanism using an existing sibling pattern. Do not redesign adjacent screens unless the request includes them.

For active UI redesign, iterate visually before committing. A user-approved visual pass is the gate for the eventual commit.

## Backend/data changes

Use additive database migrations. Keep `POST /api/settings` within its whitelist. Protect sensor access with `SENSOR_LOCK` and DB mutations with `DB_LOCK` according to the existing ordering. Preserve `override → holiday/vacation/exam → weekly` scheduling precedence and `Grade|Batch → batch → class → global` weekly resolution.

## Verification

Relevant suites:

```bash
python -m unittest backend.test_app -v
python -m unittest backend.test_ui_e2e -v
```

Current branch documentation lists 124 backend tests and 16 Playwright scenarios. A change is not considered verified merely because a test command is documented. Report what actually ran.
