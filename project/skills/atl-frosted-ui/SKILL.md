---
name: atl-frosted-ui
description: Current visual rules for the ATL Smart Attendance UI. Use for any UI/CSS change, screenshot review, or Admin redesign on feature/ui-glass-redesign.
---

# ATL UI visual skill

`feature/ui-glass-redesign` uses the **black-and-cream wall** as its current Admin visual language. The old desert/frost design is historical. Exact reusable values live in `docs/UI_TOKENS.md`.

## Current visual system

- Black `#141414` for dark beds and primary controls.
- Cream `#F4EEE1` for walls and light fields.
- Matte red `#8A3A3A` for destructive states only.
- Cream cube fields use a 3px black outline.
- Close/confirm/remove/add/edit use the established glyph language.
- Internal joins are sharp; outer page corners alone may be rounded.
- No shadows, decorative blur, or decorative overlays on wall surfaces.
- No hover animation or layout animation on redesigned surfaces.
- Scrollbars are thin 4px tracks/thumbs.

## Information hierarchy

Use structure before decoration:

1. page/workspace boundary
2. section seam
3. primary content
4. contextual action
5. secondary metadata

Do not solve weak hierarchy by adding another floating card, badge, glow, gradient, or stronger color.

## Geometry law

All UI states must be shift-proof.

- Reserve fixed slots for actions and dynamic labels.
- Keep row columns stable.
- Avoid weight-driven width changes between normal and active states.
- Prefer inset paint/markers over borders that alter dimensions.
- Keep month footprints fixed across calendar shapes.
- Do not add wrappers merely to move an existing element by a few pixels.

## State language

State changes should normally change paint or an inset marker, not geometry.

Destructive is red. Normal, selected, active, working, holiday, and override states use the documented wall palette. Do not invent additional status colors.

## Custom controls

For `gsel` custom selects, the native `<select>` is invisible truth and must remain `opacity: 0`. The visible button/popover carries presentation. Never restore native opacity as a cosmetic fix because it duplicates text.

Date/time pickers and dialogs may retain the scoped frost treatment documented in `UI_TOKENS.md`. That is a local component, not a license to return the whole Admin UI to glass.

## Scope rules

- UI redesign: `project/ATL-Smart-Attendance-Production.html` for markup/CSS and `project/backend/ui_app.js` for behavior.
- Do not edit the HTML inline script block because Flask replaces it with `ui_app.js` at serve time.
- Do not create new CSS/JS/template/component directories without an explicit architectural reason.
- Do not touch backend/API/DB/tests for a UI-only request unless explicitly requested.

## Review before editing

Check, in order:

1. Which current component owns the surface?
2. Is the requested result already represented by a sibling pattern?
3. Will text, weight, scrollbar, or overflow change move anything?
4. Is a stale rule defeating the intended rule?
5. Can the fix be made by deleting the rival rather than adding another override?

Prefer one clean rule over a ladder of increasingly specific overrides.

## Verification

After a UI change, re-read the changed selectors and check sibling coverage. Confirm that no unrelated file changed. The user screenshot is the visual ground truth; do not invent runtime pixel measurements when none are available.

Never claim a browser, screenshot, test, or deployment was performed unless it actually was.
