# Custom Dropdowns — current

`__glassSelectInit` in `project/backend/ui_app.js` wraps each
`<select>` (native kept live, opacity-0, as truth): borderless trigger
+ chevron, fixed popup, 36px rows, hover wash, optgroup headers.

## Current
- Two-way sync (pick → native value + `change`; native `change` +
  option-mutations re-sync label); lazy rows; keyboard, outside-click,
  flip-up positioning, `listbox` roles, MutationObserver coverage.
- Scheduler Frequency fix: selector re-dispatches `change` so the
  weekday strip follows (see `renderUnifiedSchedule`).
- Excluded: date/time pickers.

## Notes
- App logic zero-change · E2E native bridge holds.
