# Confirm Dialogs — current

`glassDialog({title,message,okText,cancelText,danger})` →
`Promise<boolean>`; wrappers `glassConfirm` / `glassAlert`. Frosted
overlay + card, serif title, `pre-line` message via `textContent`
(XSS-safe names). Cancel text-button + solid OK (red when danger).
Overlay click = no-op. Enter=OK, Esc=Cancel (capture+stop), Tab
trapped, focus restored.

## Current
- All 6 confirms + ~45 alerts converted, zero native left.
- Admin PIN `prompt()` stays native (E2E PIN tests untouched).

## Notes
- IDs/endpoints intact · deletes/restores still explicitly confirmed.
