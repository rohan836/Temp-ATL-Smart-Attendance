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

Warm ambient background (soft orange/cream blobs) provides all atmosphere and
color. UI floats over it as thin frosted layers: background must stay visible
through every surface. Palette is strictly monochrome — white, near-black,
translucent neutrals. Orange/red belong to the ambient background ONLY, never
to controls, badges, or text. Structure comes from 1px translucent white
hairlines, never boxes. Typography is soft, light, restrained — the UI should
feel like quiet text sitting inside the atmosphere, not windows on top of it.

## Canonical values (match these, don't invent — source: docs/UI_TOKENS.md)

- Card frost: `background: rgba(242,243,246,0.07)`, `backdrop-filter:
  blur(24px) saturate(1.2)`, `border: 1px solid rgba(242,243,246,0.14)`,
  `border-radius: 2–3px`, `box-shadow: none`.
- Dropdown popover (`.gsel-pop`, the reference treatment):
  `rgba(242,243,246,0.08)` + same blur/border, radius `2px`, no shadow.
- Enrollment modal: card frost above at `0.07`; veil
  `#enrollModal.modal { background: rgba(26,20,16,0.2) }` — deep enough for
  white text to read, light enough to stay luminous. Do NOT return to the
  global milky veil or a dark dialog.
- Primary contained action (only for genuinely important actions, e.g. New
  Enrollment, Continue): translucent neutral fill `rgba(242,243,246,0.12–0.14)`,
  1px `rgba(242,243,246,0.3)` border, radius `3–4px`, no shadow, silver-white 500 text.
- Everything else actionable = plain clickable text (transparent, no border;
  underline only where the existing link language uses it).

## Typography system

- `var(--sans)` for all normal interface text. `var(--mono)` ONLY for dates,
  times, IDs, technical/numeric data. Serif/editorial ONLY for major titles
  where already used (e.g. profile placeholder initials, kiosk idle prompt).
- Weight 400 normal / 500 important-active. Never 600/700. No text shadows.
- Restrained letter-spacing (`0.01–0.06em`); do not force everything uppercase.
- Color hierarchy: primary `#F2F3F6` → secondary `rgba(242,243,246,0.65–0.75)`
  → tertiary `rgba(242,243,246,0.4–0.6)`. Placeholders ~`0.4`.

## Component treatments (approved direction — preserve)

- **Sidebar shell (current):** admin = top bar (title + ink/esc/close)
  + main workspace + fixed 248px right rail (`#adminSide`: vertical
  `#adminNav` stack, then exactly one visible `.side-ctx` per tab —
  Students filters/actions · Attendance presets · Setup wheel/school/
  holiday/override/eyes · Backup none). Retired `.tab-toolbar` nodes stay
  in the DOM as hidden logic truth (never delete). `updateTabs` toggles
  `[hidden]` sections only.
- **Students controls:** filters + New Enrollment / Import / Export live in
  the rail as full-width quiet rows; search lives pinned at the roster
  list bottom (`.list-search` fade wash, icon + field one line). No
  toolbar rows anywhere.
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
- **Setup shortcuts:** the Action Wheel (hub + 6 sectors: Classes ·
  Batches · Schedules · Cutoffs · Exceptions · School Info; hover fans,
  click lands in ONE destination with scope/tab/focus preset) and the
  sidebar eye icons (record tables live in `#holidayViewModal` /
  `#overrideViewModal`; creation uses `#holidayModal` / `#overrideModal`).
  One path per action — wheel/eyes open the same destinations, never
  duplicate logic. Registry + weekdays + cutoffs live ONLY in the
  Schedule window (`#schedModal`); the Month View is display-only.
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
   doubled text = unhidden native layer; jumps on switch = moving anchors.
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

## Directional fade washes (locked pattern)

- When the user asks to remove an underline bar and wants a "fade,"
  "translucent fade," or "solid to fade," they mean: a **directional
  linear-gradient wash** on the control's wrapper — `linear-gradient(90deg,
  rgba(pole,0.10), rgba(pole,0) 80%)`, no border, no shadow, radius 4px.
- Solid at the leading edge, dissolving toward the end. Focus never draws
  a line — `:focus-within` only deepens the wash head (0.10 → 0.16).
- Type inside stays bare (transparent input, no chrome). Both inks mirror
  the stops with their own pole (silver / graphite).
- Paint-only change: flex, widths, and rhythm stay untouched so fixed-slot
  shift-proofing holds. Retire the dead underline rules, don't leave them.
- Canonical instance: students `.search-wrap`. Extend elsewhere only when
  the user names the spot.

## ATL Smart Attendance UI rules (locked — from the Students/Setup redesign)

1. **Global visual language:** flat editorial interface. Never turn a
   component into a card/window by default. Structure = typography,
   spacing, and 1px hairlines. Frost/translucency only for genuinely
   necessary surfaces (modals, popovers, primary contained action).
   No unnecessary blur, shadow, radius, glow, or decoration.
2. **Typography:** `var(--sans)` interface text; `var(--mono)` only for
   technical/numeric/time values; serif/editorial only for major
   identity/page titles (e.g. profile name). Weights 400 normal /
   500 active-important. Same hierarchy on every page.
3. **Theme:** light and dark modes share identical geometry; only
   ink/contrast values change. Reuse global variables
   (`--hairline` adapts per ink) and the `html[data-ink="dark"]`
   override pattern. Never hardcode a one-mode color. No
   browser-blue focus/selection against the monochrome UI.
4. **Selection:** no large filled cards. Preferred language: stronger
   text weight + subtle 1px marker in a reserved slot (no layout
   shift). A restrained neutral localized wash (directional fade,
   no blur/radius/shadow/motion) only when discoverability demands
   it. Never colored glow, large blur, movement, or shift. The
   active item must read instantly in both inks.
5. **List/row geometry:** stable columns — flexible identity/content
   track (`minmax(0,1fr)` + ellipsis) with fixed count/action slots
   so long names never move controls. Classes, Batches, and Students
   share the pattern where interaction matches. Every deletable row
   renders its own delete control, never only the selected row.
6. **Calendar/month view:** cells are text-first, never cards. Subtle
   horizontal/vertical hairlines for structure only (softer than
   major dividers). No per-cell windows, shadows, hover expansion,
   or animation. Fixed 7-column grid; reserve maximum height so
   5-row vs 6-row months never move surrounding UI. Zoom must not
   stretch, wrap, or shift geometry.
7. **Schedule editing:** Class/Batch/Global scope is edited ONLY in the
   Schedule window (`#schedModal`) — registry tabs + list, staged
   SUN–SAT toggles, per-scope Present/Late cutoffs with inherit notice,
   one Save/Cancel. The Month View never edits (display-only state row
   + inert cells). Never add a second schedule editor, month strip, or
   prompt-based cutoff path.
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
