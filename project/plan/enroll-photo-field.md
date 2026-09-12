# Enroll Photo Field — current

Photo row is a 52px thumb tile (`Photo` → live preview) with name/size
meta, borderless `CHOOSE` + red `REMOVE`, drag-and-drop supported.

## Current
- Shared `enhancePhotoField()` in `project/backend/ui_app.js`, applied
  to enroll (`nsPhoto`) and edit (`edPhoto`); edit REMOVE delegates to
  existing Clear-photo semantics; edit row full-width.
- Modal inputs/textarea transparent + bottom hairline (+ink on focus);
  autofill wash killed.
- Preserved: all field IDs, required-validation copy, 2MB gate,
  FileReader dataURL flow, 3-lift fingerprint path, edit preview block.

## Notes
- Handlers/logic untouched (additive listeners only) · scan untouched.
