---
name: atl-user-protocol
description: How to collaborate with this user on UI work. Use at the start of any UI task alongside atl-frosted-ui. Covers reading their terse directives, screenshot ground truth, section scoping, the no-motion/UI-only defaults, the live-staleness protocol, specificity and shift-proof engineering laws, and what never to do without an explicit order.
---

# Working With This User — Collaboration Protocol

The user directs, you execute. They speak in short imperative bursts, often
with an annotated screenshot. Every message is a work order — confirm
understanding briefly, then act. They will correct fast and bluntly
("you make mistake undo it"); a revert is one edit away, never an argument.

## How they communicate (read carefully, act literally)

- **Section scoping is law.** "Section: Backup. Only .backup-wall" means
  touch nothing else — not panels, layout, margins, or sibling panes.
  When they say "Don't do other things," freeze everything outside the ask.
- **"UI only"** = `ATL-Smart-Attendance-Production.html` CSS/markup and
  `backend/ui_app.js` behavior. Never servers, deploys, tests, `E:\sss`,
  backend API, or database work. Never run scripts/servers/tests — they
  verify live themselves.
- **"No hover, no motion"** trails most orders: add no hover/motion states
  to the change. An explicit motion order lifts it for that element only.
- **Approval verbs:** "do it", "yes", "go" = implement now. "Plan first" /
  "research and plan" = no edits, present options, wait. "Quick it / fix
  it quickly" = smallest decisive edit, no investigation monologue.
- **"Undo it"** = revert the last change exactly, no debate, no extras.
- **Questions they ask are diagnostic:** "why?" wants the mechanism,
  "how we can fix it?" wants options. When genuinely ambiguous after
  evidence, ask one compact question — but prefer deciding: they hired
  you as "designer and researcher and programmer and coder."

## Ground truth hierarchy (never invert)

1. **Their screenshot** beats your static reasoning about what renders.
2. **Their console snippet output** beats your mental model (you have no
   runtime here — never fabricate pixel values or runtime numbers).
3. **File bytes** beat memory — re-read before theorizing; `grep` before
   editing; re-read after editing.
4. **Live lags the file.** Screenshots routinely show older revisions.
   Never assume a fresh edit is live. Check markers first (below).

## Staleness protocol (use before blaming CSS)

- Flask splices `ui_app.js` into the HTML per request with `no-store`,
  paths anchored to the running `app.py` — so a stale page means the
  server isn't running `E:\temp` (wrong directory, old process, or the Pi
  box needing `tools/deploy.ps1`). CSS cannot fix undelivered bytes.
- Fingerprint with view-source markers (e.g. `data-ring="smil"`,
  `backup-wall::before`) or the one-line console snippet; each past
  "impossible" bug matched an older revision byte-for-byte.
- If markers prove stale: say so with the evidence, give the restart /
  deploy command for *their* machine, do not stack more edits.

## Engineering laws (paid for in full)

- **Specificity is arithmetic, not stacking.** Count IDs first; `:has()`
  contributes its argument's specificity (`:has(#x)` = +1 ID); ties
  resolve by source order. Answer wars with the minimum winning
  selector (doubled class/ID at the end-belt), never more stacked rules.
- **Shift-proof construction.** State changes must never move layout:
  inset shadows/outlines over borders, uniform font weights (400↔500
  alters width), reserved slots for dynamic text, fixed footprints.
- **Fragile CSS to avoid:** 4-value `background-position` mixed with
  `calc()`/`var()`; oversized negative-inset overlays (scroll containers
  and `overflow:hidden` ancestors clip them — verify the clip chain,
  including legacy "window" rules like `:11623` that ambush new wrappers).
- **Robust motion stack:** plain SVG attributes (JS-measured) + SMIL
  base + WAAPI driver. Immune to the file's `animation:none` minefield
  and OS reduced-motion freezes; direction flips and scrubs with no jumps.
- **Hit areas:** `pointer-events: stroke` on SVG so only paint grabs —
  never `auto` on a full-box overlay (it swallows panel clicks).
- **Sizes that must divide evenly** (dash rhythms, corner phases) get
  computed live in JS and logged (`[backup-ring]`-style console lines),
  never eyeballed — viewports vary, fixed px can't divide them all.

## Session mechanics

- Report selectors + changed lines, briefly. Paste exact rule text when
  asked — verbatim, never paraphrased.
- One risk at a time: verify each edit's exact bytes; after a wrong
  guess, say what it was plainly ("owning that") and give the mechanism.
- Update `docs/UI_COMPONENTS.md` log after UI work; keep the working
  tree clean of artifacts (`*.db`, `config.json`, `__pycache__`,
  `uploads/`); never commit or push unless explicitly told — and then
  only the named files.
