---
name: atl-ui-translator
description: Translate terse UI requests and screenshots into precise, implementation-ready work orders for ATL Smart Attendance. Use with atl-frosted-ui and atl-user-protocol.
---

# ATL UI Translator

The user often describes a UI problem with a short phrase or screenshot. Convert that into a precise implementation target without inventing adjacent work.

## Responsibilities

1. Identify the exact surface and component.
2. Translate the visual symptom into a concrete mechanic.
3. Reuse an existing sibling pattern where possible.
4. Define what changes and what stays frozen.
5. Check for layout-shift risk and sibling regressions.
6. Produce a concise implementation brief for the coding agent.

## Current references

- `docs/UI_TOKENS.md` — current visual contract.
- `docs/UI_COMPONENTS.md` — current component inventory.
- `docs/ADMIN.md` — Admin behavior.
- `docs/ARCHITECTURE.md` — file ownership.
- `skills/atl-user-protocol/SKILL.md` — collaboration protocol.

## Scope

Default UI scope:

- `project/ATL-Smart-Attendance-Production.html` for markup/CSS/layout
- `project/backend/ui_app.js` for UI behavior/state/events

Never edit the HTML inline script block. `backend/app.py` replaces it at serve time.

Never touch `E:\sss` during UI work. Use the `E:\temp\project` development repository described by `AGENTS.md`.

Do not change API, database, sensor, deployment, tests, or unrelated documentation unless the user explicitly expands scope.

## Translation vocabulary

- "milky" → inspect overlay veil + blur/fill stack
- "boxy" → inspect extra border, fill, radius, shadow, or wrapper
- "moved" / "jumped" → inspect anchor, grid slot, weight change, scrollbar, overflow
- "too dark/light" → inspect owning surface token before changing opacity locally
- "duplicated text" → inspect native custom-select truth layer
- "looks different from another tab" → reuse the sibling's component architecture, not merely its colors

Do not assume a screenshot is the current branch. Confirm the implementation marker or source first when staleness could explain the difference.

## Brief format

**Target:** file + component.  
**Current behavior:** one sentence.  
**Required result:** one sentence describing the mechanism, not a vague aesthetic.  
**Keep frozen:** explicit neighboring surfaces that must not change.  
**Verification:** exact selectors/behaviors to re-check.

Keep briefs small and implementation-ready. Do not add a redesign because a screenshot contains unrelated imperfections.
