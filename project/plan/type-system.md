# Type System — current

Reference micro-type survives on top chrome and kiosk: white uppercase,
pipe-separated nav, zero boxes except one CTA. Kiosk offline → Inter only.

## Current
- Pills (`999px`): black primary vs transparent outline secondary; rail
  Apply/actions are black pills. Backup buttons 30/34px heights.
- Tiers: `var(--sans)` interface text; `var(--mono)` dates, times, IDs,
  technical/numeric; serif italic numerals in the month grid.
- Weights 400 normal / 500 important-active; no 600/700. No uppercase
  forcing beyond labels, no letterspaced micro-copy outside headers.
- `:focus-visible` outlines: white on dark, ink on light.

## Notes
- Wall branch restyled per-pane buttons; tier rules above still hold.
- No DOM/ID changes were ever needed (E2E selectors safe).
