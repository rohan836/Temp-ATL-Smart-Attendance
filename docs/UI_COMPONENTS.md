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

## 1. Locked visual language (reference rollout — current)

- Desert ambient (`bg-spheres.jpg` light render, `0.12` pass,
  `#050507`) stays visible through the UI; warmth comes from the
  background only, never from controls.
- Surfaces: warm frost windows (`--ref-frost`, `22px` blur, `24px`
  radius) + opaque white cards (Students detail, Backup audit) +
  near-black cards (Setup Classes/Batches). No shadows, no per-cell
  boxes.
- Monochrome: white / near-black / translucent neutrals. No colored
  badges, chips, or shadows. Errors/destructive stay `danger` red.
- Actions are **pills** (`999px`): black primary (`--ref-pill`,
  silver text) vs transparent outline secondary. Sidebar Apply/rail
  actions are black pills (the ONE-pill block is the single truth).
- Type: `var(--sans)` for interface text, weight **400 normal / 500
  important-active** (never 600/700); `var(--mono)` only for dates,
  times, IDs, counts, technical data; serif only for major titles.
  Light surfaces force `--ref-ink` dark text in both ink modes.
  Primary white → secondary translucent → tertiary softer translucent.
- Frost tokens (`--frost-*`, `2px` radius) survive for popovers only
  (`.gsel-pop` reference, palette, pickers); windows/cards use the
  `--ref-*` system. Full values in `docs/UI_TOKENS.md`.

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

## 4. Admin shell (rail + top-center search)

- **Top bar**: left title, top-center search (`min(520px,44vw)`,
  `min(320px,50vw)` ≤900px — solid white `999px` pill, `40px` tall,
  dark text both poles; palette `+6px` under the box), right group
  `INK | ESC | CLOSE`. `overflow:visible` + `z-index:30` unclip results
  above pane content; palette stays below modals (40) / confirms (90)
  / pickers (120).
- **Rail** (`248px` frost card, `ref-radius`): the `#adminNav` node moved
  verbatim from the old header bar into `#adminSide` — vertical stack,
  `44px` left-aligned rows, `400/500` + directional-wash active
  (silver/dark poles), no separators. ≤900px it becomes a top strip.
- **Contexts** (`.side-ctx`): one per tab (Student / Attendance / Setup
  controls); `[hidden]` beats the flex shell so inactive controls never
  leak. Rail actions are black pills (`36px`, `999px`, `#attApplyBtn`).
- **Body/panes**: row flex (workspace + rail); one visible tab at a time.
  `#adminLayer.open` is transparent (old `0.12` veil retired); kiosk
  idle chrome hides while Admin is open.

## 5. Students pane

- Roster = frost window (`320–400px`, `ref-frost`, `ref-radius`,
  borderless, full-height stretch with internal scroll); rows
  transparent text-only, no fade wash (selection = 500 name +
  full-ink text, dark ink both poles).
- Detail = warm frost window (`--ref-frost`, `ref-radius`,
  `28px 32px` scroll); dark ink forced in both modes; inner
  tables/bars stripped; photo frameless `12px` round.
- Actions = floating pills under the roster (`#studentActionsCard`,
  no window): white New Enrollment + solid black Import/Export,
  EDIT-INFORMATION type (`34px/999px/10px/500/0.08em`); rail keeps
  filters only.
- Last 60 events in detail; history bundles `events` 500 + `daily` 500.

## 6. Attendance pane

- Workspace = one inset frost window (`.detail-scroll`, `ref-radius`,
  dark `--ref-ink` text both modes); stats/table/unknown inside with no
  divider bars; `LIVE TODAY` plain; table buttons = small outline pills.
- Filters live in the rail context (Today / Yesterday / Custom Date /
  Custom Range / This Week (7d) / This Month / Academic Year + Clear +
  black APPLY pill); the old pane `.tab-toolbar` is hidden truth (nodes
  moved verbatim, IDs/events untouched).
- Stats row, attendance table (static thead), duplicate/late/not-
  scheduled/absent states per attendance law (`PRESENT ≤08:00`, else
  `LATE`; same-day re-scan `DUPLICATE`; `NOT_SCHEDULED` muted;
  `ABSENT` only after `lateCutoff` via daemon/manual reconcile).
- Unknown-scan strip + timing notice.

## 7. Setup pane

- **Month windows**: toolbar rides its own frost bar (legend + Global
  schedule selector + month nav, dark ink, underline-free selector,
  uniform 30px control slots, right-docked to the rail, same 1600 cap
  as the column below, top flush with the rail);
  SUN–SAT weekday strip owns its own frost window
  (`#calendarHeadGrid`, `ref-radius`, dark ink) stacked 12px above the
  date grid (`#calendarGrid` frost card, same padding/columns so headers
  align with dates); 12px vertical module throughout (strip→month→pager,
  slim pager row, 4px pager→cards); compact black cards (fixed 190px,
  breathing room at the pane bottom); cells flat text-only (`64px` fixed rows,
  transparent, no blur, `0.08` hairline grid both poles, Saturday edge
  open); headers display-only in a slim 44px strip (editing lives in the schedule popup);
  thin `#monthEditor` strip below (mono cutoffs + Save/Cancel,
  hairline top, fixed label/value slots).
- **Classes / Batches**: two near-black cards (`.cb-table`,
  `--ref-black`, `ref-radius`, white text both inks); rows hover white
  `0.06` wash, active directional wash; pager arrows ride above the cards.
- **Holidays / overrides**: list tables own all editing — holiday
  ranges and single-date overrides are added via the sidebar
  (`ADD HOLIDAY`, `ADD OVERRIDE`) and edited/removed via table
  Edit/Remove (`#holidayModal` / `#overrideModal` forms with the
  holiday validators). Tables live in eye popups (same frost
  modals as creation; `Close` dismisses). Every month
  day cell opens a read-only day window (resolved badge +
  global-vs-template source line + Close) — no editing verbs.
  Setup views, popup edits. Single-POST persist throughout. Validated `YYYY-MM-DD[..YYYY-MM-DD]:type:name`
  (`holiday|vacation|exam`, exam = working). Precedence:
  override → holiday/vacation/exam → weekly; weekly per-student
  Grade|Batch → batch → class → global; default Sun off, Mon–Sat on.

## 8. Backup pane

- **Manager** = frost window (`#backupManagerCard`, `ref-radius`, dark
  ink); **audit** = twin frost window (`:has(#auditBody)`, dark ink). Inner
  boxes/dividers transparent, bars gone.
- **Pill hierarchy**: `.primary` black, everything else transparent
  outline — all interactive states pinned, no square/flash.
- Checkboxes graphite (black when checked, silver tick); scheduler
  time/freq/interval soft filled slots, dark text; audit rows graphite
  hover wash; errors/destructive stay red.
- **Audit history**: editorial table on white, header `9.5px/500/uppercase`;
  Export/Clear actions; scrollbars ink-aware (D9).

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

- Screenshots can trail fixes by a turn: hard-reload (`Ctrl+Shift+R`)
  + Flask restart before judging; Pi needs `tools/deploy.ps1`.
- Interactive control borders outside setup/backup flip per-case on
  request (pattern established: idle dark `0.35`, focus `#0A0A0A`).
- D10 flattens structural alphas to one dark `0.14` (1px-negligible).
- Month cells are flat text-only (transparent, no blur) by the flat-cell
  law; outer windows keep their blur. The old `12px` tile-blur note is
  retired.
- The `0.12 admin-layer` veil watch-item is retired:
  `#adminLayer.open` is transparent; kiosk idle chrome hides in Admin.

## 13. Standing rule

- **Sibling rule**: fixing one instance obliges auditing every sibling
  (all panes, all modals, both ink modes) in the same turn.
- Log:
  1. Segment blue survived in holiday/override date fields — scope was
     `#adminLayer` only; extended to all three modals, both poles.
  2. Same turn: modal text/date/select/textarea underlines had zero
     dark coverage (setup D11 pattern) — flipped idle `0.35` + focus
     premium charcoal for holiday/override/correction.
  3. Override/holiday dropdown (gsel-btn) underline likewise unflipped —
     fixed idle + hover/open poles.
4. Opposite-pole hover law: white hover `#0A0A0A`, dark hover
   `#FFFFFF` (D4b), all 14+ dialog verbs + pane saves + picker.
5. Rail search palette bled the bright rail nav through its sheer
   `0.08` fill (ghost Students/Attendance/Setup/Backup + side
   controls behind results; hover bar buried white text; `ara`/`ad`
   rows collided in the 248px rail; native autocomplete bubble
   covered the field). Fixed in place: graphite scrim image over
   the verbatim frost fill + `1px frost-line` border + `2px`
   radius + `isolation` (both inks), rows rebuilt as a fixed
   two-slot grid with ellipsis (uniform 400), highlight retuned
   to the directional wash, input hardened
   (`autocorrect/capitalize off`, `spellcheck false`,
   `aria-autocomplete`), options carry `cmdOpt-N` ids with
   `aria-selected`/`aria-activedescendant`. Covered by
   `test_rail_search_palette_opaque_grouped_and_hardened` +
   E2E `test_16`.
6. Palette follow-up: fat native scrollbar + percentage-squeezed hint
   slivers ("a…"/"s…") broke the frost look. Bar hidden on all
   engines (`scrollbar-width:none` + `::-webkit-scrollbar{display:none}`,
   same precedent as `.side-ctx`; wheel/arrows still scroll, gutter
   reserve removed) and hints moved to a fixed 64px right-aligned slot.
   Locked by `cmd-pal::-webkit-scrollbar` (unit) + computed
   `scrollbar-width` (E2E `test_16`).
7. User-ordered frosted finish: the dark scrim read as off-theme, so it
   was retired — palette is now two coats of the verbatim frost fill
   (no new color) + blur + frost-line border, i.e. the reference
   popover voice; rail text behind melts into the blur. Unit + E2E
   assertions retuned to the frost coats (`test_16` renamed
   `…_frosted_…`).
8. Frosted-but-legible: ghost rail text still read through the 24px
   reference blur, so the palette (and only the palette) carries a
   heavier frost — `blur(32px) saturate(1.3) brightness(0.9)` — which
   melts background text into a smudge while the ambient stays
   visible. Locked by `brightness(0.9)` (unit) + computed
   `backdrop-filter` (E2E `test_16`).
9. Reference-mirror (user order — palette must equal the other
   popups): audited `.gsel-pop` §4345 / `.gsel-opt` §4394 / `.dt-pop`
   §10167 and copied verbatim — single-coat frost fill + reference
   blur, no border, 2px radius, `4px 0` pad, token row rhythm
   (11.5px/400 secondary, `frost-opt` pad/min-h), `0.06` hover wash,
   reference group type. Scrim, double-coat, heavy blur, and border
   all retired. Palette-only keeps: absolute anchor, 300px cap,
   isolation, hidden scrollbar, 64px hint slot. Assertions retuned
   (computed fill `rgba(242,243,246,0.08)`, `border 0px`,
   `blur(24px)`).
11. Dense frost (user order — sheer reference let giant workspace
   headlines read through the results): same popup voice/hue, but one
   extra frost coat (~0.43 total, token hue only) + 44px melt blur, so
   the ambient glows through while background content dissolves.
   Locked by coat + blur strings (unit) and computed `blur(44px)`
   (E2E `test_16`).
12. Ambient swapped, round 1 (superseded): black gold-spheres render
   as `bg-spheres.jpg` (JPG q82 88KB) over a `#080A0D` base.
13. Ambient swapped, round 2 (current): light desert render
   overwrites `bg-spheres.jpg` (JPG q82, 420KB) with the 0.38
   near-black pass + `#050507` base; `glass-bg.png` fully
   unreferenced (locked by unit asserts); prior spheres recoverable
   from the user's D:\ original.
   Watch-item: `.admin-layer.open` still lays its 0.12 white veil
   over admin — may read foggy; tune only on request.
14. Pass lightened 0.38 → 0.22 (user: scene read dimmed). Measured
   ambient luminance 0.69; 0.22 leaves it at ~0.54 — desert glows,
   and all text still sits under the dark `.terminal` glass, so
   contrast is carried by the window, not the ambient.
16. Black-window audit (user: admin reads dim) — computed-style probe
   in real Chromium: `.terminal` transparent + no blur, `.admin-layer`
   open transparent + no blur, panes transparent; only dimmer left is
   the 0.12 ambient pass. Verdict: no black window exists. If the
   screen still reads dim, suspect a stale build (redeploy +
   hard-reload), not the code.
15. Pass 0.22 → 0.12 (user: whole admin read dim). Stack audit:
   ambient 0.69 → 0.61 after pass → ~0.33 under the 0.46 `.terminal`
   window — the window is the dimmer, but it also protects all
   white ink, so it stays; reserve lever is window 0.46 → 0.38 with
   stated contrast cost.
10. Search moved rail → top-center (user order): same node/IDs into
   `.admin-top`, absolute-centered (retired nav pattern) at
   `min(520px,44vw)` (`min(320px,50vw)` ≤900px); palette rules
   re-scoped `#adminSide` → `#adminLayer`, anchored `+6px` under the
   box. Two topbar traps fixed: `overflow:visible` (unclip) and
   `z-index:30` — the centering transform makes a stacking context,
   so without it pane content painted over the results (caught by
   `elementFromPoint` probe; E2E `test_16` click went red, now
   green). Stays below modals (40) / confirms (90) / pickers (120).
17. Reference rollout (user order — full-UI theme, current):
    desert ambient + warm frost windows (`--ref-*`, `24px`) + white
    Students-detail / Backup-audit cards (dark ink forced both modes)
    + near-black Classes/Batches cards + black-pill primaries /
    outline pills everywhere (sidebar ONE-pill block is the single
    truth; `:not()` rivals deleted). Rail + roster + attendance +
    month + backup windows per `docs/UI_TOKENS.md`. Everywhere-sharp law
    later retired (log 18); flat text-only month cells (`56px`, `0.08`
    hairline grid) stay.
    `#adminLayer.open` transparent (veil retired), kiosk chrome
    hidden in Admin. Old text-first / zero-card language retired —
    §§1,4–8 rewritten to match.
18. Everywhere-sharp retired + dark popup fill (user order — sharp
    white box + washed-out class/batch/status popups in dark mode):
    the G4 sharp law's `:is(#adminLayer…)` chain (1,2,1) outranked the
    ID-scoped 24px window rules and squared the white detail card,
    rail, roster, attendance frost, and backup cards (pills/black
    cards/month survived on 3–4-ID selectors) — law deleted, narrow
    sharpness (day pills, cells, rows, errors) untouched. Dark-mode
    `.gsel-pop` kept the sheer 0.08 coat while text flipped graphite,
    so rail rows ghosted through — same dense-coat cure as log 11
    (extra token-hue coat ~0.43 + 44px melt blur). Braces balanced
    (1306/1306); no unit/E2E radius locks exist.
19. White-card ink gaps + rail chevron (user order — monogram, status
    line, trash, empty text invisible on the white card in white mode;
    dropdown chevrons clipped specks): monogram/badges/trash/empty wear
    silver-white base paint for dark glass with no both-pole forcing —
    dark mode was saved by the D1 blanket alone. Pinned after every
    rival (`#pane-students .detail-pane …`, both poles): plain badges /
    monogram / trash / empty → `#181A20`; status badges keep their
    light-surface colors (present `ok`, late amber, absent danger,
    not-scheduled ink-2; unknown/duplicate near-black). In dark mode D1
    still wins (graphite, readable). Rail `.gsel-chev` had silver-only
    paint — reserved slot (`flex:none` + `8px`, label keeps ellipsis)
    and graphite dark twin. Paint-only, no geometry; no unit locks;
    braces 1313/1313.
20. Fixed frost both poles (user order — dark roster/rail turned opaque
    milky while white mode stayed sheer): the two dark-only fill swaps
    (rail, roster → `ref-frost`) are pinned back to the sheer
    `frost-bg`/`frost-blur`/`frost-line` in dark mode too. Only the text
    pole flips now (sheer + graphite = dark-on-light, ambient visible).
    Attendance/month/manager already wear `ref-frost` both poles —
    untouched. No unit locks; braces 1313/1313.
21. Roster window kept + dark dropdown underlines off (user order):
    frosted roster window stays (sheer both poles); rail dropdown
    resting underlines retired in dark mode to match white
    (`transparent`; hover keeps its pole-mirrored underline).
    Paint-only; no unit locks; braces 1313/1313.
22. Roster row fade wash removed, window restored (user correction —
    "not a window": the target was the selected-row directional fade,
    not the frosted panel): de-card reverted, sheer frost window back
    both poles; active-row gradients (white + dark twin) → transparent.
    Selection reads via 500 name + full-ink text only. Base row fills
    can't resurface (no `!important`, lower specificity). Paint-only;
    braces 1313/1313.
23. Fade washes deleted GLOBALLY (user order — checklist): zero
    `linear-gradient(90deg,…)` remain. Removed: rail nav active,
    rail-search bed + focus deepen, G3 + black-card actives (+ inset
    markers), weekday base/hover/working/off + 4 dark twins, dead
    cube-grid actives, dead cube-add bed, orphan pane-search bed.
    Reads kept: 500 nav/roster/cube names (added 500 to G3 + black
    active names, ellipsis-contained), weekday WORKING/OFF words,
    legend/admin underlines. Kept (not faded): solid hover fills,
    1px indicators. Roster marker slot → `border-left:none` both
    poles; roster bars hidden all engines (wheel/touch scroll kept).
    Paint-only; no unit locks; braces 1307/1307.
37. Borderless filter popups (my call — user deferred): the frost-line
    pin drew a visible square over milky cards, so `.gsel-pop` joins
    the palette at `border:none` (+ `2px`). Pale options over milky in
    white mode deliberately left — legible, airy, reference-light.
    Tokens doc updated. Paint-only; braces 1373/1373.
34. Frosted-slot highlight (user order — slots read flat matte, not
    frosted): blur melts nothing over the opaque black card, so the
    frost read now comes from a lit top edge (`inset 0 1px 0 0.12`,
    `0.18` on focus) over the smoky fill. No gradients (90deg lock
    holds), no geometry. Braces balanced.
30. Edit/Enroll modal reference pass (user order — fat card bars +
    underline maze + broken photo + jammed buttons vs frosted-login
    reference): card bars hidden all engines (scroll kept), card air
    `28`→`34/34/38`; fields become filled slots (`0.10` fill,
    `999px`, `44px`, brighter on focus; micro-labels kept for `*` +
    a11y); SAVE → black pill `42px` (CANCEL stays text); preview
    renders only when a photo exists (kills broken-img box) with
    rounded frameless thumb; dropzone joins slots + CHOOSE black
    mini-pill. Scoped `#enrollModal` (shared New/Edit form);
    labels/IDs untouched — validation, gsel, photo paths intact
    (all preview/clear lookups null-guarded). Note: screenshot field
    order ≠ tree markup → served build stale; hard-reload + redeploy
    Pi. Braces 1308/1308.
29. Reference-air detail pass (user order — detail "not look good" vs
    the frosted-login/white/black reference): sweep extended to `tr`,
    `.table-wrap > div`, `.detail-grid` (kills header-row + NO RECORDS
    box + field-grid lines with double-ID finality); detail scroll
    padding `28/32`→`36/40`, grid gap `14/20`→`20/28`, history margin
    `24`→`32`, action-row `16/8`→`22/10` (JS inline), field gap `3`→`5`;
    action pills `30px/12px/600`→`34px/18px/500` (inline 22px table
    buttons untouched). All internal — panel geometry frozen. Note:
    per-cascade most lines were already dead, so stale screenshots
    likely predate the sweep — hard-reload + redeploy Pi before
    judging. Braces 1307/1307.
31. Enroll buttons + card shade (user order — text CANCEL/CONTINUE,
    blank CHOOSE oval, blotchy card): root cause of the blank CHOOSE =
    the D1 graphite blanket (2 IDs) repainting silver pill labels —
    added triple-ID dark guards (established pill-guard pattern) for
    `.btn.primary` + `.photo-choose`. CANCEL (`ns`/`ed`) graduates to
    outline pills (dark twins included); SAVE/CONTINUE black pill
    stands (was already black in tree — screenshots showing text SAVE
    prove a STALE viewed build, see below). Card fill `0.08`→`0.14`
    luminous so desert contrast melts even instead of blotchy (blur
    stays token; enroll-only exception). STALENESS WARNING: text-SAVE
    screenshots cannot come from this tree — hard-reload AND redeploy
    Pi before judging; self-check: top search must be a white pill.
25. White cards → frost twins (user order): Students detail + Backup
    audit leave `--ref-white` for the warm `--ref-frost` family
    (fill/blur/edge, 24px kept) — same windows as Attendance/manager.
    Dark-text forcing untouched (dense data stays readable both
    poles); pills/checkboxes/hovers keep working on frost. Zero
    `ref-white` paint remains (vars stay defined). Paint-only; no
    unit locks; braces 1308/1308.
24. Instant Admin open (user order — frost flashed crystal-clear then
    frosted on open): the 320ms opacity+translate transition on
    `.admin-layer` faded the translucent frost itself, so the sharp
    background showed through mid-fade; plus an 80ms `0.6`-opacity
    pane staging in `openAdmin`. Killed the transition/transform
    (both states final, frost full strength frame one — easier on Pi
    repaint) and dropped the pane flicker + dead tab-alias vars
    (timeout still calls `updateTabs()`). E2E waits on the `open`
    class only — compatible. HTML braces 1308/1308; JS off-by-one is
    a pre-existing string-artifact (HEAD identical).
33. Frosted slots + guaranteed pills (user order — slots flat, CONTINUE
    bare text): slots/dropzone gain milky glow (`0.16`/`0.22` + 12px
    blur, same position/size, both inks). CONTINUE mystery: cascade
    audit shows the white rule unopposed — screenshot predates it, but
    an end-of-cascade 3-ID pin (`#nsSave`/`#edSave` white,
    `#nsCancel`/`#edCancel` outline) now guarantees both buttons past
    every legacy rule + ink blanket; ID-count re-verified vs D1
    (`(3,0,1)` beats `(2,1,2)`). Retired graphite cancel twins
    confirmed absent (never landed). Paint-only; braces balanced.
32. Enroll/Edit BLACK card (user order — reference "New in": black +
    frost merge, not frosted): card is solid `ref-black`, no blur,
    `24px`, floating over ambient; light slots + silver labels/inputs
    (double-ID prefix beats D1/D2 both poles, zero twins); SAVE white
    pill w/ dark text, CANCEL/Clear outline silver pills, CHOOSE white
    mini-pill. Dropdowns anchored in the card get `.on-dark` from
    `openPop` (JS, both branches) + near-black pop CSS — sheer pop
    over black would unreadably flip graphite-on-dark. Test retargeted
    (`#daySheetModal` keeps the frost-blur assert). HTML balanced;
    JS statements brace-neutral.
28. Dark popup fill reverted to sheer (user order — dark dropdown read
    near-opaque white, white-mode sheer is the reference): my log-18
    dense coat (extra 0.38 + 44px) stacked opaque over the rail on small
    popups. Deleted — dark `.gsel-pop` now wears the identical sheer
    frost; only option text flips pole (graphite rows/washes kept).
    Sole dense survivor: palette (both poles, large-type cure).
    Sched card radius `0` → `3px` (all 8 modal cards uniform).
    Paint-only; braces 1307/1307.
26. Barless filter popups + white search pill (user order): `.gsel-pop`
    (the All Classes/Batches/Status dropdowns) hides bars on all
    engines (`scrollbar-width:none` + webkit `display:none`, palette
    precedent; wheel/touch/arrows still scroll). Top search rebuilt as
    a solid white `999px` pill, `40px` tall, `13px` dark text both
    poles (input/icon/placeholder re-inked; dark wash twins now pin
    the same white). Absolutely centered — nothing around it moves.
    Only palette scrollbar lock exists in tests — untouched. Paint +
    contained height; braces 1308/1308.
27. Frost tokens unified + locked (user order — same values in popups
    and fixed windows): audit found every live frosted surface already
    on tokens; the last 4 literal blurs (enroll/sched modal cards) →
    `var(--frost-blur)`. System: popovers/small = sheer `--frost-*`
    (`2px`); fixed content windows = warm `--ref-*` (`24px`);
    documented exceptions only (palette + dark `.gsel-pop` dense
    coats). Veils: all modal veils transparent (base dark veil dead).
    Locked by new `test_frost_tokens_unified_across_popups_and_windows`
    (tokens defined, tier selectors present, zero `90deg` slabs).
    Could not execute the suite — no Python runtime in this shell;
    every assert string grep-verified against the served HTML.
38. Student pills dock rail-bottom (user order — dead gap under the
    actions): `margin:auto 16px 4px` on `#newStudentToolbarBtn` inside
    the flex column settles all three pills into the bottom gap; zero
    markup change, tab switching untouched (stays in
    `#sideCtx-students`), ≤900px strip docks them right. Caution
    logged: an edit briefly overwrote the `[hidden]` mapping rule —
    restored and deduped (single copy verified). Braces 1374/1374.
36. Horizontal enroll modal + unified actions + soft thumb (user order):
    card `max-width 520`→`880` (2-col grid finally breathes; ≤640px
    collapses single-column); Edit actions `:has(#edSave)` joins the
    New row rule — both forms render the identical compact
    right-aligned CANCEL + black-pill pair (Edit stacked because its
    container fell back to column). Thumb loses its hairline for a
    frosted mini (white `0.35` + blur + `14px`, graphite glyph).
    Paint + contained geometry; braces balanced.
35. Enroll FROSTED window (user order — black retired, reference login
    card): milky `ref-frost` card, `24px`, dark ink both poles
    (double-ID prefix, zero twins); white `0.35/0.5` slot pills w/ dark
    text; dropzone white slot + black CHOOSE mini; SAVE black pill,
    CANCEL + Clear graphite outlines, errors danger-red. `.on-dark`
    pop variant + JS tags deleted (sheer pops read fine over milky);
    obsolete black-era end pins deleted. Hover states verified held by
    resting specs. Braces 1370/1370.
39. Student black action box (user order — reference "New in" pair;
    log-38 rail dock retired): the three pills leave `#sideCtx-students`
    (rail keeps filters only) for a new `#studentActionsCard` black
    window under the roster — frost card on top, `ref-black` box below,
    `12px` apart. `list-pane` goes transparent full-height stack
    (`align-self:stretch`, frost coat moves to `list-scroll` which fills
    + scrolls internally); compact top-align retired, desert gap gone.
    Buttons share `40px/999px/11px/500/uppercase` metrics: New = white
    pill, Import/Export = silver hairline outlines, all states
    identical (ONE-pill philosophy). IDs unchanged so JS wiring holds;
    legacy rail button rules now match nothing (harmless). Markup +
    paint; braces 1378/1378.
40. Students top-lock + one-frost + borderless (user order — roster sat
    lower than detail; roster frost differed and flipped per pole; thin
    edges everywhere): `split-view` goes `align-items:stretch` with a
    `> .list-pane / > .detail-pane` child pin (`margin-top/bottom 0`,
    `align-self:stretch`) — identical top AND bottom by construction.
    Roster window takes the exact detail coat (`ref-frost/blur`, both
    inks) so the two read as one continuous frost; both window edge
    lines deleted (detail innards were already stripped — tables,
    table-wrap, cards, photo). Roster ink pinned both poles
    (names/monograms `#181A20`, meta/roll/empty `0.6` graphite,
    selected full-ink + 500 name; `#studentList` ID outranks the
    white-mode white-active rule, dark twins agree). Pill-button
    outlines kept — they are controls, not frames. Paint (+ flex-align
    lock); braces 1381/1381.
41. Roster luminous exception (user order — shade still off; full audit:
    tokens were identical, every rival eliminated, blur confirmed
    working): frost is translucent, so the dark foliage + orange rock
    behind the roster always mixed darker than detail/rail over light
    beige, and saturate(1.25) amplified the orange. Same warm hue at
    `0.65` alpha, plain `blur(22px)` — log-31 exception pattern. Note:
    brace count drifted 1381→1394 from outside churn (balanced, block
    re-verified present). Paint-only.
42. Roster 0.65 to 0.85 (user order — mottling + mode-shift survived):
    full audit closed every value lead — vars defined once (`:root`,
    never redefined), ambient `body::before` has no ink qualifier,
    veil retired unconditionally both modes, rows transparent, no
    background/opacity rival on the frost element. Verdict: nothing
    roster-owned changes with the pole; the dark foliage/orange slice
    breathed through translucency against flipping chrome. Same warm
    hue at 0.85 (about 15 percent backdrop): mottling and mode-travel
    stop. Text pins, blur, borderless untouched. Paint-only; braces
    balanced.
43. REAL root cause (headless ground truth — logs 41/42 backdrop theory
    retracted): white-mode computed roster bg was TRANSPARENT. The old
    scrollbar-clip rule's `#pane-students #studentList` (2 IDs) beat the
    frost block's 1-ID white selector; only the 3-ID dark twin won —
    hence color travel with the pole (plus 10px vs 24px radius split).
    Fix: `#studentList` selectors (both poles) joined the frost block —
    tie goes to later order. Re-rendered headless both modes:
    identical `0.85` bg, even milky roster matching detail. Paint-only;
    braces balanced.
44. Roster back to exact detail tokens (user order — 0.85 read flat
    cream, "too much white", no glass feel): `ref-frost` +
    `ref-frost-blur`, borderless, both poles. Headless re-render both
    modes: translucent frost with desert melting through, same family
    as detail; reads a touch deeper over its darker slice, which is
    honest frost. Exception retired. Paint-only; braces balanced.
45. Black action card retired (user order — window gone, bars stay):
    `#studentActionsCard` transparent (same padding/gap, zero position
    shift); Import/Export graduate to dark `0.6` bars, white text;
    New Enrollment white pill untouched. Headless render confirms the
    three pills floating on ambient in place. Paint-only; braces
    balanced.
46. Floating pills match EDIT INFORMATION type (user order — mine were
    40px/11px translucent, reference is 34px/10px/0.08em solid):
    all three pills to 34px/999px/10px/500/0.08em; Import/Export solid
    `ref-pill` black, white text; New Enrollment white pill same
    metrics. Headless render confirms one button type. Paint-only;
    braces balanced.
47. Push rebase (remote `af63bbc` rebuilt docs): conflict merge keeps
    remote curation (ADMIN Setup/Attendance, SKILL shell/presets/wheel,
    UI_COMPONENTS values/residuals) + this log; Students action
    locations corrected to floating pills (rail holds filters only).
