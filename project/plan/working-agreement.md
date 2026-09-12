# Working Agreement — ACTIVE

Owner rules: `E:\temp\project` only · UI only (`ATL-Smart-Attendance-Production.html` visuals, `backend/ui_app.js` behavior; `app.py` splices JS at serve, `no-store`) · nothing without permission — no servers, tests, deploys, commits, pushes, asset changes · never touch `E:\sss`.

## Project (understood)
Fingerprint kiosk: sensor → Flask `:5000` → SQLite (truth = sensor
flash + SQLite). Branch `feature/ui-glass-redesign`; tags immutable.
Admin: Students / Attendance / Setup / Backup. Wall language
(`wall-theme.md`); frost retired. Live PC server runs the project
tree — restart it from `E:\temp\project` after moves.

## Docs I always read
`AGENTS.md` → `ADMIN.md` → `ARCHITECTURE.md` (UI/splice) →
`WORKFLOW.md` → `DEVELOPMENT.md` → `TESTING.md` → `API.md` (data only).

## My loop
Observe (docs + exact lines) → plan first when asked → act (one
small CSS/behavior diff) → evaluate: live server + hard reload,
view-source markers before any CSS hunt (live lags the file),
owner screenshots + console snippets as ground truth, `git diff`
review, suites only when ordered. Report short: what/where/how to
see. Never claim unverified work. Never invent runtime numbers.

## Standing permissions
Ask before: edits, commits, pushes, deploys, deletions, full suites.
