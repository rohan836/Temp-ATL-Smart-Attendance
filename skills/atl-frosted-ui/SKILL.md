---
name: atl-frosted-ui
description: Locked visual language for the ATL Smart Attendance fingerprint-kiosk UI. Use whenever changing ANY UI/CSS in ATL-Smart-Attendance-Production.html, styling Admin screens (Students, Attendance, Setup, Backup), enrollment modal, dropdowns, toolbars, or header nav — or when reviewing a UI screenshot. Defines the frosted monochrome theme, component treatments, typography, hard-won diagnoses, and the mandatory low-risk workflow.
---

# ATL Frosted UI — Locked Visual Language

## What this project is

Fingerprint attendance kiosk. `ATL-Smart-Attendance-Production.html` = UI shell,
markup, and ALL CSS. `backend/ui_app.js` = behavior/state/events/API (spliced
into the HTML at serve time by `backend/app.py` — never edit the HTML inline
script block). Flask serves UI at `/`, API at `/api/*`. Truth = sensor flash +
SQLite. Never touch backend/API/database/tests/docs for a UI task unless
explicitly ordered. Never create `css/`/`js/`/`templates/` folders, new files,
tests, or plans unless explicitly ordered. Never open a browser.

## The theme (why it looks this way)

Desert ambient (light cactus render, `0.12` pass over `#050507`) provides
all atmosphere and color. UI floats over it as warm frost windows
(`--ref-frost`, `22px` blur, `24px` radius) — Students roster/detail,
Attendance workspace, the single Setup window, the single Backup window.
Primary actions are black pills (`--ref-pill`,
`999px`); secondary actions are transparent outline pills. Month cells
are flat text-only with a quiet hairline grid — state reads via text,
never boxes. Palette is otherwise monochrome — white, near-black,
translucent neutrals. Orange/red belong to the ambient background ONLY,
never to controls, badges, or text (errors/destructive stay `danger`
red). Typography is soft, light, restrained — quiet text inside the
atmosphere, not windows on top of it.

## Canonical values (match these, don't invent — source: docs/UI_TOKENS.md)

- Popover frost (`.gsel-pop` reference): `background:
  rgba(242,243,246,0.08)`, `backdrop-filter: blur(24px) saturate(1.2)`,
  `border: 1px solid rgba(242,243,246,0.14)` (palette: borderless),
  `border-radius: 2px`, `box-shadow: none`.
- Window frost: `background: var(--ref-frost)` (`rgba(228,219,208,0.45)`),
  `backdrop-filter: var(--ref-frost-blur)` (`blur(22px) saturate(1.25)`),
  `border: 1px solid var(--ref-edge)`, `border-radius: 24px`, no shadow.
- White cards (Students detail, Backup audit): `var(--ref-white)` +
  `1px solid var(--ref-white-line)` + `24px`, dark `--ref-ink` text
  forced in both ink modes. [RETIRED — both converted to warm frost,
  log 25; vars stay defined.]
- Black cards (Setup board rows — Classes/Batches/Holidays/Overrides):
  `var(--ref-black)`, no border, `24px`, white text both inks.
- Pills (`999px`): black primary `var(--ref-pill)` + silver text;
  secondary transparent + `1px solid rgba(24,26,32,0.25)` + `--ref-ink`.
- Enrollment modal: warm milky `ref-frost` window (`24px`, dark ink
  both poles), white slot pills, black-pill SAVE + graphite CANCEL;
  transparent modal veil (dark dialog retired, log 35).
- `#adminLayer.open` is transparent (old `0.12` veil retired); kiosk idle
  chrome hides while Admin is open.
- Everywhere-sharp law retired (it squared the 24px windows — white
  card, rail, roster, frost workspaces). Narrow sharpness stays by own
  rules: day pills, month cells, option rows, validation errors.
  `body > .gsel-pop.gsel-pop` pins borderless popover frost + `2px`. Month cells
  flat text-only (`64px`, transparent, `0.08` hairline grid).

## Typography system

- `var(--sans)` for all normal interface text. `var(--mono)` ONLY for dates,
  times, IDs, technical/numeric data. Serif/editorial ONLY for major titles
  where already used (e.g. profile placeholder initials, kiosk idle prompt).
- Weight 400 normal / 500 important-active. Never 600/700. No text shadows.
- Restrained letter-spacing (`0.01–0.06em`); do not force everything uppercase.
- Color hierarchy: primary `#F2F3F6` → secondary `rgba(242,243,246,0.65–0.75)`
  → tertiary `rgba(242,243,246,0.4–0.6)`. Placeholders ~`0.4`.

## Component treatments (approved direction — preserve)

- **Sidebar shell (current):** no top bar (`#adminLayer .admin-top`
  renders nothing — title, search, controls all retired or relocated);
  single admin window (workspace + fixed 248px right rail fused with a
  dashed seam, dark ink both poles — `#adminSide`: vertical
  `#adminNav` stack, then exactly one visible `.side-ctx` per tab —
  Students filters · Attendance presets · Setup wheel/school/
  holiday/override/eyes · Backup none) + rail foot (`#sideFoot`:
  INK/ESC/CLOSE docked bottom). Retired `.tab-toolbar` nodes stay
  in the DOM as hidden logic truth (never delete). `updateTabs` toggles
  `[hidden]` sections only.
- **Students:** ONE frost roster window (`320–400px`, `ref-frost`,
  borderless, dark-ink text both poles): roster-local search slot,
  transparent text-only rows (selection is 500 name + full-ink text),
  action pills docked below — dashed divider hairlines; detail fused
  edge-to-edge (shared seam, squared meeting corners). Pills:
  `#studentActionsCard` white primary + solid black pair, same type
  as EDIT INFORMATION — `34px/999px/10px/500/0.08em`.
- **Header nav:** the tab stack lives in the RIGHT RAIL, left-aligned
  44px rows, uniform weight 400 (active reads via opposite-pole color +
  500, no bar, no dot) — per-tab title-length swings can never push it.
  The old top-bar-centered-nav rules are dead.
- **Filters/selects:** transparent, no box/pill, bottom hairline only,
  `11.5px/400` sans. Custom dropdown (`gsel`) rule: the native `<select>` is
  invisible truth (`opacity: 0`, `pointer-events: none`) and `.gsel-btn` shows
  the value — NEVER set `opacity: 1` on a select or the value renders twice.
- **Header nav:** see Sidebar shell above — tabs are a vertical rail
  stack, uniform weight 400 active+inactive (active reads via full ink +
  500); weight swaps cause layout shift, bars/dots are retired.
- **Attendance presets:** a `seg-strip` built from the hidden
  `attDatePreset` truth (buttons write value + fire change); Academic /
  Range fan hover frost pops. Never a dropdown here.
- **Setup shortcuts:** the Action Wheel (hub + 5 sectors, hover fans,
  click lands on the real rail/pane destination) and the sidebar eye
  icons (record tables live in `#holidayViewModal`/`#overrideViewModal`;
  creation uses `#holidayModal`/`#overrideModal`). One path per action —
  wheel/eyes open the same destinations, never duplicate logic.
- **Profile placeholder:** no card, no border, transparent, ambient visible
  through; initials in serif `22px/400`, soft white `0.85`. Same size/position,
  text and function unchanged.
- **Photo upload:** quiet translucent region (`transparent`–`0.02`) + minimum
  `1px rgba(242,243,246,0.1)` hairline. Never a dashed heavy card.
- **Validation errors in frosted modals:** transparent + hairline + white text
  (never red/colored boxes).

## Mandatory workflow for every UI task

1. Look at the provided screenshot; compare against THIS baseline first.
2. Run the layout-shift risk check: dynamic text lengths, 400↔500 weight
   width changes, flex-centering dependencies, veil/blur stacking,
   cross-tab differences. Build shift-proof (slots, absolute centering,
   uniform weights, reserved space).
3. Change ONLY the identified element, scoped as narrowly as possible
   (prefer `#id`-scoped selectors so other screens can't regress).
4. Diagnose before styling: milky surface = veil+blur stack, not card fill;
   doubled text = unhidden native layer; jumps on switch = moving anchors;
   square pills/cards = rival `:not()` rules or a stray global
   radius-zero (everywhere-sharp law retired — delete, don't stack);
   pill rivals = re-added `:not()` rules fighting the ONE-pill block
   (delete, don't stack).
5. Verify with evidence: re-read the cascade, grep specificity conflicts,
   confirm no other file changed. No browser, no screenshots of your own.

## How to understand what the user wants

- The user speaks in screenshots + short vibe directives ("milky", "too dark",
  "moved too much", "match the reference"). Translate vibe words to mechanics:
  milky = veil/fill too light; dark dialog = veil too dark; jumpy = anchor or
  weight shift; boxy = border/fill/shadow to remove.
- Default to the SMALLEST diff that fixes the identified problem. Never
  redesign layout, reorder fields, recolor, or "improve" adjacent elements.
- Functionality, validation, flows, backend, API, DB, tests, docs are frozen
  unless the user names them. One task at a time; report residuals honestly
  instead of expanding scope.

## Directional fade washes (RETIRED — do not reintroduce)

The 90° fade-slab pattern is deleted globally (user order, log 23):
no selection, state, or input bed may paint a gradient. State reads
via 500/bold + full-ink text; hover keeps solid fills; indicators
stay 1px underlines. If a new surface needs emphasis, use the text
language — never a wash.

## ATL Smart Attendance UI rules (locked — from the Students/Setup redesign)

1. **Global visual language:** desert ambient + one admin window
   (`24px`, roster/detail/attendance/setup/month/backup-single-window)
   + near-black Setup board cards + black-pill primaries / outline
   pills. Never invent a new surface: reuse the window/card/pill
   systems. No shadows, no colored UI (danger red excepted).
2. **Typography:** `var(--sans)` interface text; `var(--mono)` only for
   technical/numeric/time values; serif/editorial only for major
   identity/page titles (e.g. profile name). Weights 400 normal /
   500 active-important. Same hierarchy on every page.
3. **Theme:** light and dark modes share identical geometry; only
   ink/contrast values change. Reuse global variables
   (`--hairline` adapts per ink) and the `html[data-ink="dark"]`
   override pattern. Never hardcode a one-mode color. No
   browser-blue focus/selection against the monochrome UI.
4. **Selection:** stronger text weight + subtle wash in a reserved slot
   (no layout shift). Rail nav: 500 + directional fade wash. Black-card
   rows: white `0.06` hover wash, directional active wash. Never colored
   glow, large blur, movement, or shift. The active item must read
   instantly in both inks.
5. **List/row geometry:** stable columns — flexible identity/content
   track (`minmax(0,1fr)` + ellipsis) with fixed count/action slots
   so long names never move controls. Classes, Batches, and Students
   share the pattern where interaction matches. Every deletable row
   renders its own delete control, never only the selected row.
6. **Calendar/month view:** frost window outside, flat text-only cells
   inside (`56px` fixed rows, transparent, no blur, `0.08` hairline
   grid). No per-cell windows, shadows, hover expansion, or animation.
   Reserve maximum height so 5-row vs 6-row months never move
   surrounding UI. Zoom must not stretch, wrap, or shift geometry.
7. **Inline schedule editing:** the selected Class/Batch is edited
   inline at the Month View — clickable SUN–SAT headers, editable
   Present/Late cutoffs, Save/Cancel in one strip. Never reintroduce
   a schedule popup unless explicitly ordered.
8. **Workspace geometry:** one unified workspace, stable left/right
   columns, a single 1px structural divider. Align siblings through
   shared boundaries and hairlines, never new containers. Fix the
   underlying grid — no positional hacks, no override accumulation
   (retire dead rules; consolidate rivals into one system).
9. **UI review method:** for every screenshot/change inspect geometry,
   spacing/sizing, typography, light/dark parity, selection/focus
   states, interaction clarity, component consistency, responsive/zoom
   behavior, data/state consistency, regressions, and siblings.
   Flag mistakes proactively, even unmentioned ones.
10. **Maintenance rule:** when a component is redesigned or a visible
    button/interaction changes behavior, update this skill (and the
    relevant `docs/*.md`) so the implementation stays reconstructible.
