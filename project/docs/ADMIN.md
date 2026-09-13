# ADMIN — current behavior and UI responsibilities

Admin is gated behind the terminal's `Admin` trigger and contains four tabs: **Students**, **Attendance**, **Setup**, and **Backup**. The terminal scan loop can continue in the background while Admin is open; it pauses only for exclusive sensor operations such as enrollment, re-enrollment, deletion, and restore.

## Shared Admin rules

- No duplicate top navigation. The right rail owns tabs and contextual controls.
- The current branch visual language is the black-and-cream wall documented in `UI_TOKENS.md`.
- Destructive actions use matte red and the established remove glyph.
- Interactive states must not resize or move surrounding content.
- Use existing component patterns before creating new surfaces.

## Students

Students owns the roster and enrollment lifecycle.

### Roster

The workspace contains a roster and a detail view. Search stays local to the roster. Rail filters cover class, batch, and active state.

### Student detail

The detail view supports edit, re-enroll, deactivate/reactivate, print, attendance history, and CSV operations.

Enrollment and edit rules:

- name: 1–80
- roll: 1–20, unique case-insensitive
- class/grade: 1–40, required
- batch: ≤40
- section: ≤20
- parent: ≤80
- phone: ≤40, at least 8 digits when present
- address: ≤200
- photo: validated data URL / current backend size limit

New enrollment must use an existing Setup class. Batch choices depend on that class. An empty class shows Setup guidance instead of inventing a batch.

## Attendance

Attendance is one workspace for live Today plus historical reporting and single-student metrics.

The default view is today. The rail supplies date presets and contextual filters. The table switches between single-day and multi-day forms without changing the surrounding workspace geometry.

Attendance semantics are defined by `DATA_MODEL.md` and `WORKFLOW.md`:

`PRESENT → LATE → DUPLICATE`, with `NOT_SCHEDULED` muted and `ABSENT` produced only after reconciliation/cutoff rules allow it.

Correction is an explicit audited action with a required reason.

## Setup

Setup owns school information, classes, batches, weekly schedules, holidays, overrides, and per-context cutoffs.

### Month view

Month View is the main schedule workspace. Its context selector supports:

- Global
- Class
- Batch
- per-class batch timing using `Class|Batch` composite keys

Calendar footprints are fixed so changing month shape does not move sibling sections.

### Classes and batches

Classes and Batches are persistent boards below Month View.

- tap row = select/preview
- pencil = edit/rename
- remove glyph = delete
- class selection scopes the Batches board
- shared batch names are reused rather than duplicated
- composite schedule records hold per-class timing

Rename propagation updates the related lists, schedule keys, composite keys, and student records through the existing persistence path.

### Holidays and overrides

Holiday ranges use `holiday`, `vacation`, or `exam`; `exam` is a working day. Overrides target a specific date. Optional time ranges are stored/displayed but schedule resolution remains day-granular.

Resolution precedence:

`override → holiday/vacation/exam → weekly`

Weekly student resolution:

`Grade|Batch → batch → class → global`

## Backup

Backup is a unified manager for Google Drive, Telegram, USB, local SQLite backup/restore, and audit export.

The three destinations share one scheduler and selection model while retaining destination-specific status and connection controls. Manual backup can target only selected destinations. USB status is refreshed without reloading the page.

Database restore is an operator action and is validated before replacement. Cloud restore is never automatic.

## Documentation ownership

UI visuals → `UI_TOKENS.md`  
UI structure → `UI_COMPONENTS.md`  
Runtime sequences → `WORKFLOW.md`  
Data/status rules → `DATA_MODEL.md`  
API endpoints → `API.md`
