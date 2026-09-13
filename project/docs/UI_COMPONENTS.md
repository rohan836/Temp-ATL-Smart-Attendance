# UI Components — current inventory

This document describes the UI that exists on `feature/ui-glass-redesign`. It is a structural reference, not a historical scrapbook. Exact reusable visual values live in `docs/UI_TOKENS.md`; product behavior lives in `docs/ADMIN.md` and `docs/WORKFLOW.md`.

## Kiosk

- `#terminal`: biometric idle surface.
- `#fingerPrompt`: `PLACE YOUR FINGER` idle instruction.
- `#openAdminBtn`: Admin entry at the bottom-middle.
- `#identityLayer`: frameless successful scan result with photo, name, roll, class, section/batch, ID, status, time.
- `#unknownLayer`: frameless unknown-fingerprint state.

The kiosk is intentionally quieter than Admin. Do not import the Admin wall into the kiosk merely to make the two surfaces identical.

## Admin shell

Admin contains four tabs: Students, Attendance, Setup, Backup.

The shell uses a workspace plus right rail. The rail owns navigation and contextual controls. The old centered Admin top bar is retired. `INK`, `ESC`, and `CLOSE` live in the rail footer.

Rules:

- one visible pane at a time
- fixed rail geometry
- no duplicate navigation bars
- no per-pane floating window unless a component explicitly requires a modal
- state changes must not move sibling content

## Students

Students is a roster/detail workspace.

- Roster list with local search and class/batch/status filtering.
- Selected student is previewed in the detail area.
- Detail owns student identity, attendance history, edit, re-enroll, deactivate/reactivate, print, import/export and enrollment entry points.
- Enrollment collects the validated student fields defined in `DATA_MODEL.md`.
- Class selection is limited to real Setup classes.
- Batch selection depends on the selected class; empty class batches produce Setup guidance instead of phantom values.
- Legacy edit values are preserved and labeled rather than silently rewritten.

Wall treatment: cream panes, black beds where the current implementation uses a black gutter/boundary, glyph actions, stable row/action slots.

## Attendance

Attendance is one workspace for live Today and historical reporting.

- Rail owns date presets and contextual filters.
- Today remains the default live mode.
- Single-day and multi-day tables use stable columns and fixed action slots.
- KPI content must not change row height when values change.
- Unknown scans remain operational data, not decorative status cards.
- Correction is an explicit action requiring a reason.

Live background scanning continues while Admin is open, except during exclusive sensor operations.

## Setup

Setup is the school configuration and schedule editor.

### Month view

The month is the primary workspace. It resolves the effective schedule and shows the current class/batch context.

- seven weekday columns
- fixed day footprint
- stable month height across five- and six-row months
- no layout movement when today, holiday, or override state changes
- context selector supports Global, Class, and Batch scopes

### Classes and batches

Classes and Batches are editable boards below the month. Tapping a class scopes the Batches board. Shared batch names may be reused; per-class timing is represented by `Class|Batch` composite schedule keys.

Row behavior is split:

- tapping the row selects/previews
- pencil edits
- remove glyph removes

Renaming propagates through lists, schedule keys, composite schedules, and student records according to the current code path.

### Holidays and overrides

Holiday ranges and date overrides use their existing create/edit/view flows. Month cells are read-oriented; the dedicated record windows remain the editing surface.

Precedence is:

`override → holiday/vacation/exam → weekly`

Weekly schedule resolution is:

`Grade|Batch → batch → class → global`

## Backup

Backup is a unified manager for Google Drive, Telegram, USB, local DB backup/restore, and audit export.

The three destinations share one interaction model. Destination selection, shared scheduling, manual execution, refresh, and destination-specific management remain grouped in the Backup workspace.

The Backup page uses the wall language, not the older warm-frost card language.

## Modals and popovers

Use a modal only when the information or operation genuinely needs a separate interaction context.

Current families include:

- enrollment
- school information
- holiday / override forms
- holiday / override record views
- schedule/action wheel
- attendance correction
- day readout
- custom dropdowns and date/time pickers
- confirm / alert / prompt replacements

Every modal needs a clear owner, explicit close path, and stable geometry. Do not create a new modal when the action can be completed directly in the owning row or workspace.

## Shared interaction laws

- Native select = hidden truth when the custom dropdown system is used.
- Popovers anchor to their owning control and must not create layout shift.
- Remove/confirm/close actions keep consistent glyph semantics.
- Dynamic labels never cause neighboring controls to move.
- A redesign of one sibling component requires checking its sibling implementations before changing the shared rule.

## Retired component patterns

Do not treat the old `7677ca8` recovery snapshot as current. The following descriptions are obsolete: desert-ambient Admin as the main theme, warm-frost Admin windows, fade-slab state backgrounds, and historical pellet/ring motion. Git history preserves those states; this file documents the current branch instead.
