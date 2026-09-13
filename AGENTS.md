# AGENTS.md — repository map

Read this first. Keep this file short: it is the map, not the encyclopedia. Detailed truth lives in `project/docs/` and the task-specific skills. This structure follows the agent-documentation pattern where the root instruction file points agents to deeper sources of truth rather than duplicating them. citeturn238251search10turn238251search24

## Current repository

- Product: offline-first fingerprint attendance terminal for one school, one Raspberry Pi, one GT-511C3 sensor, one SQLite database.
- Production release: `v1.2.0` (`bf575451`). Historical tags are immutable.
- Current development branch: `feature/ui-glass-redesign`.
- Current branch tip: `7d549d5` (`feat(setup): class-scoped batches, enrollment linkage, rename, cutoff persistence, boards readability, classic theme restore`).
- Current branch test inventory documented in `project/docs/TESTING.md`: 124 backend tests + 16 Playwright E2E scenarios.

## Source of truth

| Question | Read |
|---|---|
| What the product is / non-goals | `project/docs/PROJECT.md` |
| End-to-end runtime behavior | `project/docs/WORKFLOW.md` |
| Admin behavior and screen responsibilities | `project/docs/ADMIN.md` |
| System architecture / file ownership | `project/docs/ARCHITECTURE.md` |
| Data, scheduling, validation, statuses | `project/docs/DATA_MODEL.md` |
| API contract | `project/API.md` |
| Safe development rules | `project/docs/DEVELOPMENT.md` |
| Tests and verification | `project/docs/TESTING.md` |
| Pi / deployment / recovery | `project/docs/OPERATIONS.md` |
| Release history | `project/docs/VERSIONS.md` |
| UI component inventory | `project/docs/UI_COMPONENTS.md` |
| UI visual contract | `project/docs/UI_TOKENS.md` |
| Coding-agent procedure | `project/docs/AGENT_WORKFLOW.md` |
| Documentation index / authority order | `project/docs/DOCS.md` |

`project/plan/` contains working and historical notes. It is not the authority for current architecture or UI unless the index explicitly marks a note as active.

## Code ownership

- `project/ATL-Smart-Attendance-Production.html` = UI shell, markup, CSS, layout.
- `project/backend/ui_app.js` = UI behavior, state, events, API calls.
- `project/backend/app.py` = Flask API, serve-time JS injection, reconciliation, backup workers.
- `project/backend/gt511c3.py` = GT-511C3 UART driver.
- `project/backend/gdrive_backup.py` = Google Drive backup engine.
- `project/backend/schema.sql` = SQLite schema.

Do not edit the HTML inline script block: `app.py` replaces it with `backend/ui_app.js` at serve time. Do not create `css/`, `js/`, `templates/`, or component folders unless a concrete need is documented.

## Current UI language on this branch

The branch uses the **black-and-cream wall**. This is the current design system, not an optional override:

- matte black `#141414`
- cream `#F4EEE1`
- matte red `#8A3A3A` for destructive states only
- cream cube fields with 3px black outlines
- glyph actions for close / confirm / remove / add / edit
- one continuous wall per page; sharp internal joins; radius only at outer corners
- no hover-driven motion and no animation in redesigned wall surfaces
- thin 4px scrollbars
- state changes must not resize or move surrounding content

Legacy frost values remain only where the current implementation still uses them, chiefly kiosk/idle, print, and small popovers. When documentation conflicts, the current branch wall rules win and `project/docs/UI_TOKENS.md` is authoritative.

## UI work

For any UI change, read:

1. `project/docs/ADMIN.md` if the change affects an Admin tab.
2. `project/docs/UI_TOKENS.md` for visual values.
3. `project/docs/UI_COMPONENTS.md` for component structure.
4. `project/skills/atl-frosted-ui/SKILL.md` for enforceable UI rules.
5. `project/skills/atl-user-protocol/SKILL.md` for collaboration and scope rules.

UI work changes only the HTML/CSS shell and/or `backend/ui_app.js` unless the request explicitly expands scope. Do not invent a new visual system for one screen.

## Safety

- Development source is `E:\temp\project`.
- Never touch `E:\sss` during UI work.
- Never commit or deploy `backend/config.json`, `*.db`, `*.pre_restore.bak`, `*gdrive_token.json`, `uploads/`, `__pycache__/`, `*.log`, `.venv/`, or `.env`.
- Sensor VCC is 3.3V pin 1, never 5V.
- Keep `SENSOR_LOCK`, `DB_LOCK`, scan/enrollment semantics, attendance scheduling precedence, and auth rules intact unless explicitly changing that behavior.

## Collaboration

Do one task at a time. Prefer the smallest correct change. Do not silently expand scope. Verify documentation against the code after behavior changes. Do not commit, push, deploy, or change branches unless explicitly requested for that task.