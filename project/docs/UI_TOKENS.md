# UI Tokens — current visual contract

This file is the single source of truth for the rendered UI language on `feature/ui-glass-redesign`. Do not treat the old frost/desert specification as the current Admin theme.

## 1. Current branch theme: black-and-cream wall

| Token | Value | Use |
|---|---|---|
| `--wall-black` | `#141414` | Main dark beds, boards, primary controls |
| `--wall-cream` | `#F4EEE1` | Main wall, light fields, readable surfaces |
| `--wall-red` | `#8A3A3A` | Destructive actions and destructive state only |
| working month state | `#F2DEC7` | Scheduled/working day state |
| off/override month state | `#E1B8A2` | Non-working and override state |
| holiday month state | `#CF7D65` | Holiday state |

The wall is one continuous structure per page. Internal joins are sharp. Outer corners may carry the page-level radius; do not add independent card shells merely to separate content.

## 2. Surface rules

- Admin beds are flat black or cream. No shadows.
- No translucent white veil over Admin.
- The previous desert ambient image is retired on this branch.
- The previous pellet/ring treatment is retired.
- State changes must not resize or move neighboring content.
- Internal page sections are separated by deliberate seams or whitespace, not stacked floating cards.
- Use one surface language across sibling screens. Do not invent a special card for one tab.

## 3. Actions

Use glyph actions for the wall system:

- close: red cross
- confirm/apply: black tick
- remove: red trash, positioned consistently at the far-left remove slot
- add: black plus
- edit: black pencil

Use pills only where the existing component already uses a pill as a semantic control. Do not turn every action into a pill.

## 4. Fields and selectors

Cube field:

```css
background: #F4EEE1;
border: 3px solid #141414;
color: #141414;
```

Selected values may use a black capsule with cream text when the component already uses that selection pattern. Native selects that back custom dropdowns remain invisible truth (`opacity: 0`) and must never be made visually visible again.

## 5. Typography

- Sans is the default interface face.
- Monospace is reserved for dates, times, identifiers, counts, and technical values.
- Serif/editorial styling is reserved for existing major identity/title moments.
- Normal weight: 400.
- Important/active weight: 500.
- Do not introduce 600/700 as a visual fix.
- Avoid forced uppercase and excessive tracking.

## 6. Motion and interaction

Current wall surfaces are snap-state UI:

- no hover animations
- no layout animation
- no decorative transitions
- no scaling or movement to communicate selection

Hover may change a paint value only where an existing component explicitly needs it. Never use hover to move the element.

## 7. Geometry laws

Every interactive state must be shift-proof:

- reserve space for dynamic labels
- keep control slots fixed
- use stable grid columns
- avoid centered flex rows whose width changes when text becomes 500 weight
- prefer inset markers or paint changes over border insertion that changes box size
- keep month footprints fixed across 5-row and 6-row months

## 8. Scrollbars

Wall surfaces use thin 4px scrollbars with no arrow controls. The scrollbar thumb must maintain enough contrast against its owning surface. Do not introduce a large native scrollbar as a layout solution.

## 9. Frost is a scoped legacy surface

Frost still exists where the current implementation intentionally retains it: small custom popovers, selected picker surfaces, and untouched kiosk/print surfaces. Those values remain exact:

```css
--frost-bg: rgba(242, 243, 246, 0.08);
--frost-blur: blur(24px) saturate(1.2);
--frost-line: rgba(242, 243, 246, 0.14);
--frost-radius: 2px;
--frost-opt-pad: 8px 14px;
--frost-opt-min-h: 32px;
```

Do not use these values to rebuild an entire Admin page. The current branch wall takes precedence.

## 10. Retired patterns

These are historical and must not be reintroduced unless the user explicitly orders a theme change:

- desert ambient image / `bg-spheres.jpg`
- full-page translucent Admin veil
- warm frost as the default Admin window
- white floating cards as the primary page structure
- directional fade slabs as a state language
- colored status chips/badges
- decorative pill-everything treatment
- animation as a selection or hover language

## 11. Source of truth rule

When a selector or value is changed in code, update this document only when the change changes the reusable design contract. One-off implementation detail belongs in `UI_COMPONENTS.md`, not here.
