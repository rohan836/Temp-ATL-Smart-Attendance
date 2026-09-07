# UI Components — Full Inventory (single reference)

**Recovery snapshot:** this file describes the committed UI at `7677ca8`
(`feature/ui-glass-redesign`, 2026-09-08). Docs + that commit are the
recovery point: checking out the commit restores the code, this file
restores the *why* and *where*.

Snapshot of the admin + kiosk UI as implemented in
`ATL-Smart-Attendance-Production.html` (markup/CSS/layout, ~10k lines) and
`backend/ui_app.js` (behavior, ~5k lines). **Read-only reference — no UI
changes.** For the enforceable design contract see
`skills/atl-frosted-ui/SKILL.md`; for canonical frost numbers see
`docs/UI_TOKENS.md`. Anything here that contradicts the code is wrong —
trust the code, then fix this file.

## 0. Why the UI is this way (read before coding anything new)

- **Kiosk operator wants zero friction.** Walk up, place finger, read name +
  status in one glance, walk away. So the front page is one centered line
  (`PLACE YOUR FINGER`), one `Admin` trigger, and a frameless result that
  holds ~4s and clears itself. No menus, no chrome, no decisions.
- **Admin wants everything without leaving the device.** Four tabs own four
  jobs (roster / day verification / school setup / backups + audit). Every
  secondary control lives in the right rail next to the work surface it
  affects; the workspace itself stays a flat reading surface. If you add a
  control, put it in the rail section of its tab (see §5) — never a new
  toolbar row, never a popup for what a row can do.
- **The room is the theme.** A warm ambient image sits behind everything;
  the UI is quiet frosted text floating in it. That is why surfaces are
  translucent, structure is 1px hairlines, actions are plain text, and color
  never carries meaning (orange/red belong to the background, never to
  controls). A new element must let the background show through; if it
  needs emphasis, use weight 400→500 + a hairline marker, not a box.
- **Nothing may jump.** Tabs switch titles of different lengths, dropdowns
  take different values, months have 5 or 6 rows. Every construction
  below is shift-proofed (fixed slots, absolute centering, uniform
  weights, reserved space — see SKILL.md). New work must pass the same
  check: switch states and confirm no sibling moves.

## 1. Locked visual language (applies to everything below)

- Warm ambient background stays visible through the UI; subtle
  translucent/frosted neutral fills; 1px translucent hairlines for
  structural separation only.
- Monochrome: white / near-black / translucent white. No colored badges,
  chips, shadows, opaque cards, or heavy borders.
- Actions are **text-first, plain text** (transparent, no border; underline
  only where the existing link language uses it). One contained primary
  action per surface at most (e.g. Save, New Enrollment) — see
  `docs/UI_TOKENS.md`. Destructive verbs stay monochrome; the verb copy
  carries the warning.
- Type: `var(--sans)` for interface text, weight **400 normal / 500
  important-active** (never 600/700); `var(--mono)` only for dates,
  times, IDs, counts, technical data; serif only for major titles
  (kiosk name, profile initials). No text shadows.
  Primary `#F2F3F6` → secondary `rgba(242,243,246,0.65–0.75)` →
  tertiary `rgba(242,243,246,0.4–0.6)`.
- Theme vars: `bg #FCFBF7 · panel #F2F3F6 · ink #181A20 · ink-2 #6B6B6B ·
  ink-3 #A8A5A0 · line #E9E6E0 · paper #F6F4EF · ok #2F5D34 ·
  danger #8A3A3A`, fonts `Inter / Newsreader / ui-monospace`.
- Frost tokens (verbatim from `docs/UI_TOKENS.md` — the `242,243,246`
  pole, not white): fill `rgba(242,243,246,0.08)` · blur
  `blur(24px) saturate(1.2)` · line `rgba(242,243,246,0.14)` · radius
  `2px` (3px large modals) · `--hairline: rgba(242,243,246,0.12)` (the
  global structural line) · input underline `0.2` (`#F2F3F6` on focus) ·
  row separators `0.07–0.08`.
- Directional fade washes (locked pattern for search, weekly tiles, month
  tiles): `linear-gradient(90deg, rgba(POLE,HEAD), rgba(POLE,TAIL) 80%)`,
  per-tile, both poles — exact stops in `docs/UI_TOKENS.md`. Never one
  wash across a wrapping row; gradients don't transition (hover flips).

## 2. Global primitives

- **Hairlines**: 1px translucent structural dividers (rail boundary,
  section splits, table header lines, row separators). Widths/styles never
  change; only hue remaps in dark mode. `var(--hairline)` is the one
  global line.
- **Ink toggle** (`inkToggleBtn`, top bar, `☀` / drawn crescent, persisted
  `atl_ink`): `html[data-ink="dark"]` flips **text tiers only** — primary
  `#181A20`, base `rgba(24,26,32,0.8)`, placeholders
  `rgba(24,26,32,0.5)`. Backgrounds/frost/blur/borders/layout frozen.
  Native `<option>` popups and kiosk layers excluded (stay white-on-dark).
  Flip is **instant**: a 2-frame `ink-switching` guard forces
  `transition:none` while the attribute swaps (`ui_app.js` ink IIFE).
- **Scrollbars**: painted + ink-aware (class/batch lists, audit
  table/detail, dropdown popups); tracks transparent; nav/toolbar strips
  hidden (`display:none`). Firefox `scrollbar-color` matched.
- **Custom dropdowns** (`gsel` system, `ui_app.js` glass-select IIFE): the
  native `<select>` is invisible truth (`opacity:0`, `pointer-events:none`)
  and keeps firing `change`; the visible `.gsel-btn` shows the value;
  `.gsel-pop` is fixed-positioned beside the trigger. Ghost-text cause: any
  rule re-showing the native select (`opacity:1`) renders the value twice —
  never do that. Close paths: outside press, `Esc` (refocuses trigger),
  arrows/Enter/Space keyboard, `Tab`, outer scroll, resize, 160ms
  pointer-leave grace (`CLOSE_DELAY`). Sidebar triggers additionally get
  the **rail reveal**: popup slides 12px over 160ms (`RAIL_REVEAL_DX/MS`)
  with a 1px `_railBridge` stub at trigger height so it reads as emerging
  from the owning row (`_revealFromRail`/`_railBridge`); opening a second
  sidebar dropdown reuses the open popup (sibling-switch reuse).
- **Segmented strip** (`seg-strip`, Attendance presets): built from the
  `attDatePreset` native options at boot — the native select stays hidden
  truth, strip buttons write its value + fire `change` + drive the
  custom-day/range reveal directly. `Academic Year` / `Custom Range`
  buttons fan out hover frost popups (`openAcadPop`/`openRangePop`,
  `.dt-pop`); re-click toggles shut. Trailing `Clear` (after a `seg-sep`
  hairline) runs `clearAttendanceSection` (preset→Today, dates emptied,
  year override dropped, filters to All).
- **Text actions**: `10.5px / 500 / 0.04em / uppercase`, transparent, no
  underline, no transition. Hover = color shift only.
- **Refresh**: static `↻` text glyph, no animation of any kind; click
  briefly disables while data reloads.
- **Search**: static `⌕` glyph (`18px`), tertiary, non-interactive, inside
  a `.search-wrap` fade wash (see §1) so icon + field share one line.
  Focus deepens the wash head (`:focus-within`), never draws a line.
- **Glass dialogs** (`glassConfirm`/`glassAlert`/`glassPrompt`,
  `.gconfirm`): Promise-based frosted replacements for native
  `confirm()`/`alert()`/`prompt()`. `Esc` cancels, `Enter` confirms, `Tab`
  cycles, focus returns to the opener. Destructive confirms stay
  monochrome.

## 3. Kiosk (idle) surface

- Idle prompt `PLACE YOUR FINGER`, `11px / 0.22em`; `Admin` entry
  bottom-middle (`openAdminBtn`). Kiosk layers excluded from ink mode.
- Result layers are frameless information, not cards: `identityLayer`
  (photo, serif name, roll, class/grade, section/batch, student ID, status,
  time — `showIdentity`, ~4s hold, 3.2s when muted `Already recorded` /
  `Not Scheduled`) and `unknownLayer` (`NOT RECOGNIZED`, 2.8s).
- Scan loop `POST /api/scan {waitSec:2}` runs on kiosk and behind Admin
  (identity popup suppressed while Admin is open); pauses during
  enrollment/modals and sensor maintenance; `GET /api/scan/last` bridge
  every 2s; both feed `window.handleRealScan`. `NO_FINGER/SENSOR_BUSY/UART`
  create no event. 15s background poller refreshes today's data (skipped
  while the tab is hidden).

## 4. Admin shell

```
.admin-layer
├─ .admin-top            title + INK | ESC | CLOSE (48px, hairline bottom)
└─ .admin-body (row)
   ├─ .admin-main        one visible .admin-pane at a time
   └─ aside#adminSide    248px rail: #adminNav + per-tab .side-ctx
```

- **Top bar**: left per-tab title (`Students`, `Today — Attendance`,
  `Setup — School Configuration & Schedule`, `Backup — Audit` — titles
  map in `updateTabs`/`openAdmin`); right group ink toggle, `ESC` hint,
  `Close`. `openAdminBtn` opens (PIN-gated via header-only `/api/audit`
  check — 401 aborts, offline-with-no-PIN still opens); `adminClose` /
  `Esc` closes and re-arms the scan loop.
- **Rail**: fixed 248px, hairline left boundary, never scrolls itself. The
  global nav (`#adminNav`, same node/IDs/delegation as always) is a
  left-aligned vertical stack of 44px rows; active = opposite-pole text
  color + 500 weight only (no bar, no dot — the retired dot/selection
  rules are dead). Below the nav, exactly one `.side-ctx` section is
  visible per tab (`updateTabs` toggles `[hidden]`; the
  `display:none !important` guard beats the flex shell). The open section
  scrolls internally from top; nav stays fixed. Under 900px the rail
  becomes a top strip (boundary rotates, context flows inline).
- **Per-tab rail map** (nodes live in markup; `updateTabs` only toggles):

  | Tab | `#sideCtx-*` contents |
  |---|---|
  | Students | class / batch / status filters + New Enrollment + Import CSV + Export CSV |
  | Attendance | preset seg-strip + custom date/range inputs + Apply + Clear (filters below stay hidden truth — see §7) |
  | Setup | Action Wheel + School Information + Add Holiday (+ eye) + Add Override (+ eye) |
  | Backup | none (workspace owns everything) |

- **Hidden toolbars law**: retired `.tab-toolbar` nodes stay in the DOM as
  *logic truth* (IDs, values, change handlers untouched) and render
  nothing. Students' bar is `display:none` (still anchors the CSV-import
  fallback); Attendance's bar is `[hidden]` + a `display:none !important`
  override. Never delete these nodes — E2E and the gsel/seg builders
  address them by ID. Their *paint* was deleted as dead (dead-code pass):
  only live-group members, the `[hidden]` guard, and pointer comments
  remain — never re-add bar paint, surface controls in the rail instead.

## 5. Students pane

- Workspace is a split view: left roster (`#studentList`), right detail
  (`#detailScroll`). Pinned search lives at the **bottom** of the list
  (`.list-search`, fade wash, icon + field one line) so roster growth
  scrolls above a footer that never moves.
- Filters + New Enrollment / Import / Export live in the rail
  (`sideCtx-students`); the gsel wraps render them as full-width 40px
  quiet rows. Search spans name, roll, class, batch, phone, fingerprint
  ID, section, parent. Status filter: Active only / All / Inactive only.
- Rows are a flat editorial grid (`42px minmax(0,1fr)`): avatar/initials +
  flexible identity track with ellipsis — long names can never move
  anything. Selection is type-only (400→500) + 1px left marker in a
  reserved slot + the locked directional wash. Initials are bare text (no
  tile); uploaded photos render frameless, square. First student (sorted
  active-first) is always selected — never an empty detail pane
  (`ensureFirstStudent`).
- Detail: photo, name, Active/Inactive + batch badges, field grid
  (roll/class/batch/section/ID/parent/phone/address/fingerprint), actions
  **Edit · Re-enroll fingerprint · Re-activate (when inactive) · Print
  profile · Correct today**, then the last-60-events history table with
  per-row `Correct` (→ `correctionModal`, reason required, original
  preserved in audit). Deactivate = `DELETE` → `active=0`, roll suffixed,
  `fingerId=NULL`; re-activate restores the roll when free.
- Enrollment (`openNewStudent` → `#enrollModal`): profile form + photo
  dropzone (quiet hairline region, 2MB data-URL cap) + one Start and 3
  captures with lifts (`/api/sensor/progress`, scan-line sweep). Success
  closes modal + Admin and returns to the front page (`returnToFrontPage`).

## 6. Attendance pane

- **Rail owns:** preset seg-strip (Today / Yesterday / Custom Date /
  Custom Range / This Week (7d) / This Month / Academic Year), the custom
  date/range inputs (revealed only for their preset), Apply (same reveal),
  Clear. Academic-Year span anchors to `Settings.startDate` month/day (no
  invented cutoffs); range Apply auto-orders.
- **Hidden truth:** class / batch / student / status / sort selects stay in
  the retired toolbar — present in DOM, wired to `renderAttendance`, not
  visible. They are driven by value + `change` (this is also how E2E drives
  them). Do not wire new visible controls to duplicate them; surface them
  in the rail when the redesign reaches this pane.
- **Workspace:** mono date readout (`#attDateLabel`, concise, never
  stretches) + mode badge (`Live Today` green-contained / Yesterday /
  `Date:` / `Range: (Nd)` / `STUDENT:`) + 9 KPI cards + main table +
  unknown-attempts strip. Single-day columns: Time · Student · Roll ·
  Class · Status[Correct] · Fingerprint. Multi-day adds Date and a
  Scheduled/Not-Scheduled working-day column. Status law: `PRESENT`
  ≤ present cutoff else `LATE`; same-day re-scan `DUPLICATE` (first
  timestamp kept); `NOT_SCHEDULED` muted, never absent; `ABSENT` only from
  `POST /api/reconcile` after the late cutoff (today guarded
  `BEFORE_CUTOFF`). Single-student scope pulls authoritative metrics from
  `/api/reports?studentId` (eligible / attended / rate); Today scope
  prefers `/api/kpis` when unfiltered.
- Refresh / Print / Export CSV handlers (`handleAttendanceRefresh/Print/
  Export`) stay wired to their hidden buttons (presence, not visible —
  E2E asserts exactly this). Live updates arrive via real scans + the 15s
  poller while the tab is open. Print builds the editorial report
  (header, metadata, KPIs, table, unknowns); Export streams backend CSV
  for the current range + filters.

## 7. Setup pane

- **Workspace toolbar** (`#setupToolbar`, kept — this bar was never
  retired): left CLASSES|BATCHES tabs + Wheel button; center Month View
  legend (WORKING / NON-WORKING / OVERRIDE filter chips) + schedule
  context selector (`#calClassSelect`); right Prev / month label / Next /
  Today. Priority footer always visible: *Override → Holiday/Vacation →
  Weekly*.
- **Classes & Batches** (`#cubeGrid` + add rows): one list, one add per
  view; `setCubeView` swaps kind and follows selection to the first item
  so the right side never disagrees. Class tiles nest their batches by
  display regroup only (batch nests under a class iff ≥1 student carries
  both; zero-student batches collect in an Ungrouped tile last — zero data
  change). Adds POST to `/api/settings` (`classes` / `batches`, duplicate
  names rejected case-insensitively) and re-render. Batch creation lives
  only in the BATCHES tab via the single `submitBatchName` path; new names
  surface there until a student carries them into a class.
- **Context selector values**: `""` = Global (all classes & batches),
  `class:Name`, `batch:Name` (bare legacy names and `Grade|Batch`
  composite keys still parse). It retargets editor + month + roster
  together — toolbar, month, list and editor can never disagree.
- **Month grid** (`#calendarGrid`, `renderCalendarMonth`): leading blanks +
  date cells + trailing fillers (fillers keep the last week full so the
  header row below always starts SUN under Sunday). Each cell resolves its
  state for the active context — `override` (note as tag) · `working` ·
  `non-working` (holiday name as tag) — plus a `today` ring. Cells are
  text-first, never cards; fixed 7 columns; 5-row vs 6-row months reserve
  identical geometry.
- **Weekday template header sits BELOW the date grid**, inside the same
  `#calendarGrid` so both delegated editors keep working. The
  `SUN–SAT` buttons stage into `pendingDays` (never persisted); the
  `#monthEditor` strip (per-context Present/Late cutoffs + Save/Cancel)
  composes staged days + cutoffs in one persist. Cancel drops the stage.
  The solid per-context editor (`#classDetail .sched-solid`, `data-cs-day`
  toggles + timing + inherit notice, same single persist) edits the
  saved template directly.
- **Day window** (`openDaySheet` → `#daySheetModal`): clicking any date
  cell opens the read-only sheet — resolved badge + source line
  (global-vs-template) + `Close` + `Add override for this date…`, which
  swaps to the override form with the date prefilled (door only — the eye
  tables stay the single editor).
- **Action Wheel** (`openSetupWheel`, `#setupWheelModal`): center SETUP hub
  (click closes) + 5 SVG sectors — CLASSES (`+ New`, View, Schedules) ·
  BATCHES (same trio) · CUTOFFS (timings window, present/late quick-edit
  via `glassPrompt` + `HH:MM` validation) · EXCEPTIONS (add/view holidays
  + overrides) · SCHOOL INFO (rules window, academic-year focus, admin
  PIN focus). Hovering a sector fans its outer action arc; clicking an
  action closes the wheel and opens the real destination (wheel shortcuts
  click the same sidebar buttons — one path, no duplicate logic).
  Openers: rail `Action Wheel` button + toolbar `Wheel` button.
- **Sidebar actions + eyes**: `ADD HOLIDAY` / `ADD OVERRIDE` build the
  creation forms into `#holidayModal` / `#overrideModal` (inline
  validation errors, no red boxes); the eye icons open the *record*
  popups (`#holidayViewModal` / `#overrideViewModal`) whose tables own all
  Edit/Remove (`data-edit-holiday` etc., rename moves the range with no
  orphan, one-date overrides replace by date). `Close` dismisses. Empty
  tables point at the sidebar action that fills them.
- **School Information** (`openSchoolInfoBtn` → `#schoolInfoModal`):
  name, address, academic year, attendance start date, present/late
  cutoffs (with plain-language threshold hints), Export CSV, Cancel/Save.
  Save POSTs the whitelisted settings keys, mirrors cutoffs into local
  state, reloads settings + re-renders. (Backend rejects non-whitelisted
  keys such as sensor/uart/db — that contract lives in `API.md`.)
- **Single persist path**: every calendar mutation (holiday, override,
  weekday stage, cutoff, class/batch schedule) goes through
  `persistCalendar()` → one `POST /api/settings` (holidays, overrides,
  workingDays, class/batch schedules) → `cacheSave()` → re-render
  month + lists. Formats: `YYYY-MM-DD[..YYYY-MM-DD]:type:name`
  (`holiday|vacation|exam`, exam = working); overrides `date:1|0:note`.
- **Resolution law** (both paint and counts): specific-date override →
  holiday range → weekly template; weekly per-student `Grade|Batch` →
  batch → class → global; default Sunday off, Mon–Sat on.

## 8. Backup pane

- **Action column law**: statuses sit right (`READY`, `NOT CONNECTED`,
  `ON`); action rows (Telegram pair, USB trio, schedule pair) are one
  left-aligned system — `10.5/500/0.04em`, `16px` gaps.
- **File row**: `Last backup: Never` left; `RESTORE DB | DOWNLOAD DB`
  right as baseline-locked text (`inline-flex`, `line-height:1`,
  shared padding/type, `16px` gap, no boxes/bars).
- Checkboxes custom-drawn (`14px`, hairline box + check; dark-flipped).
  Schedule time/freq/interval: dark text, idle underlines dark `0.35`,
  focus near-black.
- **Audit history**: editorial table, header `9.5px/500/uppercase`
  (`0.8` dark), rows `0.07`; Export/Clear are text actions; scrollbars
  ink-aware. (Backend contracts — destinations, scheduler, restore
  validation — live in `API.md` / `docs/OPERATIONS.md`, untouched by this
  file.)

## 9. Custom frost date/time picker (replaces native popups)

- Native clock/calendar popups are browser chrome and can never wear the
  theme — so date/time fields (`YYYY-MM-DD` / `HH:MM` 24h) get their own
  trigger + portalled `.dt-pop` (same architecture as gsel dropdowns).
- Trigger: text glyph (`▦` date / `◷` time, `13px`, tertiary → dark
  `0.6`), absolute-right inside a `.dt-wrap`; native indicator hidden.
- Popup: frost tokens, `12px` padding, `z 120`; date = weekday row +
  tile grid (`6px` gaps, `4px` tiles, selected deeper, today ring,
  outside-month dim) + Month/Prev/Next + Clear/Today text actions;
  time = hour (1–12) / minute (5-min steps, keeps typed odd minutes) /
  AM-PM scroll columns, live-apply + Done/Clear.
- Typing stays native; picker writes well-formed values only and fires
  `input` + `change` so existing save flows work. Esc / outside /
  scroll / resize closes. Ink-aware like `.gsel-pop`.

## 10. Overlays — every window, who opens it, how it closes

| Modal | Opened by | Closes by | Purpose |
|---|---|---|---|
| `#enrollModal` | kiosk enroll btn, rail New Enrollment, student Re-enroll | veil¹, `Esc` (aborts + re-arms scan), success | profile + 1 Start + 3 captures |
| `#daySheetModal` | any month date cell | Close btn, veil¹ | read-only day + override shortcut |
| `#holidayModal` | rail Add Holiday, wheel, day-sheet shortcut | Cancel, veil¹, `Esc`, save | create/edit holiday range |
| `#overrideModal` | rail Add Override, wheel, day-sheet shortcut (prefilled) | Cancel, veil¹, `Esc`, save | create/edit single-date override |
| `#holidayViewModal` | rail eye, wheel All Holidays | Close, veil¹, `Esc` | holiday record table (Edit/Remove) |
| `#overrideViewModal` | rail eye, wheel All Overrides | Close, veil¹, `Esc` | override record table (Edit/Remove) |
| `#schoolInfoModal` | rail School Information, wheel (3 actions, focus field) | Cancel, veil¹, `Esc`, save | school profile + rules |
| `#setupWheelModal` | rail Action Wheel, toolbar Wheel | hub click, veil¹, `Esc`, any action | 5-sector shortcut wheel |
| `#correctionModal` | row Correct buttons | veil¹, `Esc` | fix a record (reason required) |
| `.gconfirm` | any `glassConfirm/Alert/Prompt` | verbs, `Esc`/`Enter`/`Tab` | confirm / notice / input |

¹ **Veil rule**: dismiss needs press AND release on the veil (`mousedown`
+ `click` both targeting the overlay) — a drag ending outside, e.g.
finishing a text selection, must never close the window. Enrollment veil
also aborts the capture loop.

**Esc order** (topmost first): enroll → holiday-view → override-view →
holiday → override → school-info → wheel → correction → close Admin.
Enrollment `Esc` while Admin is open aborts capture but keeps Admin.

## 11. Values & formats (single list — no other copy)

- Present cutoff default `08:00` (scan at/before = Present, else Late);
  late cutoff default `08:30` (absence reconciliation after this).
- Holiday string: `YYYY-MM-DD[..YYYY-MM-DD]:type:name`,
  `type = holiday|vacation|exam` (`exam` counts as working).
- Override string: `YYYY-MM-DD:1|0:note` (`1` working, `0` holiday).
- Schedule context: `""` global · `class:Name` · `batch:Name`
  (`Grade|Batch` composites + bare legacy names still parse).
- Attendance presets: `today · yesterday · custom_day · custom_range ·
  week(7d) · month · academic` + Clear.
- Status law: `PRESENT → Present/Late · DUPLICATE → Already recorded
  (muted) · NOT_SCHEDULED → muted, never absent · ABSENT → post-cutoff
  reconcile only`.
- Rail: 248px, hairline left boundary, 44px nav rows, 40px control rows,
  24px side padding; reveal 12px / 160ms `cubic-bezier(0.16,1,0.3,1)`.

## 12. Known residuals (current state — fix in redesign, not in secret)

- Attendance Refresh / Print / Export CSV are wired to hidden buttons
  (presence, not visible — E2E asserts exactly this). No visible trigger
  exists in the sidebar shell.
- Attendance class / batch / student / status / sort filters are hidden
  truth (value + `change` driven). Surface them in the rail when this
  pane is redesigned — do not build a second filter system.
- `#daySheetModal` is missing from the `Esc` chain: with only the day
  sheet open, `Esc` falls through and closes Admin. Add it at the top of
  the chain (below enroll) when touching overlays.
- Screenshots trail fixes by a turn: hard-reload (`Ctrl+Shift+R`) +
  Flask restart before judging; Pi needs `tools/deploy.ps1`.
- Calendar tiles use `12px` (not 24px) blur deliberately for Pi perf.

## 13. Standing rule

- **Sibling rule**: fixing one instance obliges auditing every sibling
  (all panes, all modals, both ink modes) in the same turn.
