# Month Template — current

Weekday headers carry the class/batch template; the grid is
display-only; holiday/override tables own all editing. (Condenses
~330 lines of shipped/reverted phase history — cubes, sheets,
popups, merges — all superseded.)

## Current
- Headers render `working|off` from the active context
  (`getScheduleContext` + per-class/batch resolvers); display-only.
- Class/batch **row tap previews only** (context sync + month repaint,
  no popup — E2E-pinned); the **pen button** opens the schedule editor.
- Matte-black date cubes (`var(--ref-black)`, white serif-italic
  numerals) on a cream bed; fixed 424px footprint (5- and 6-row months
  identical).
- States read paint-only, never layout: non-working hatch + inset 2px,
  holiday red fill, override dots + inset 3px, today inset ring.
- OFF header cubes: inset 2px border on-cube, box matches working cubes.
- Active cb rows: uniform 400 weight + inset 2px cream bar (no
  weight-flip shifts).
- Context selector lives in the month legend; scheduler Frequency
  dispatches `change` for the weekday strip.

## Notes
- Past arcs (cube tiles, day sheets, solid editors, reverts) are
  recorded in git history, not here. Single POST persist path kept.
