# UI Tokens — Canonical Frost + Reference Values (single source of truth)

These values are canonized as global CSS variables in `:root`
(`ATL-Smart-Attendance-Production.html`). Use the variables, never literals:

```css
--frost-bg:      rgba(242, 243, 246, 0.08);   /* surface fill */
--frost-blur:    blur(24px) saturate(1.2);    /* frost */
--frost-line:    rgba(242, 243, 246, 0.14);   /* 1px structural border */
--frost-radius:  2px;                         /* 3px allowed for large modals */
--frost-opt-pad: 8px 14px;                    /* option-row rhythm (Y: 8px) */
--frost-opt-min-h: 32px;                      /* option-row minimum height */
```

Reference usage (All Status dropdown): `background: var(--frost-bg);
backdrop-filter: var(--frost-blur); border: 1px solid var(--frost-line);
border-radius: var(--frost-radius); box-shadow: none;`

If the reference changes, update the `:root` variables first —
every wired surface follows automatically.

## Reference rollout (current UI — user-ordered full-UI theme)

Canonized alongside the frost tokens in `:root`
(`ATL-Smart-Attendance-Production.html:42-56`). Use the variables,
never literals:

```css
--ref-frost:      rgba(228, 219, 208, 0.45);  /* warm frost window fill */
--ref-frost-blur: blur(22px) saturate(1.25);  /* window frost */
--ref-edge:       rgba(255, 255, 255, 0.4);   /* window edge */
--ref-radius:     24px;                        /* outer windows only */
--ref-white:      #FFFFFF;                     /* white cards */
--ref-white-line: rgba(24, 26, 32, 0.08);     /* white-card edge */
--ref-pill:       #181A20;                     /* black primary pills */
--ref-black:      #141414;                     /* Classes/Batches cards */
--ref-ink:        #181A20;                     /* dark text on light surfaces */
--ref-ink-2:      rgba(24, 26, 32, 0.55);      /* muted dark text */
```

Windows (no shadow; `ref-radius` outer): rail + Students roster use the
sheer frost (`--frost-bg` / `--frost-blur` / `--frost-line`) in BOTH
inks (milky swap retired — backgrounds frozen); Attendance workspace,
Setup month, and Backup manager use the warm `--ref-frost` /
`--ref-frost-blur` / `--ref-edge` in both inks. Roster rows carry no
fade wash — selection reads via 500 name + full-ink text only.
Rail dropdown rows are underline-free at rest in both inks (hover
keeps its pole-mirrored underline).

Cards: the white (`--ref-white`) cards are retired → Students detail
and Backup audit are twin warm-frost windows (same fill/blur/edge as
the other windows, dark text forced both poles); black (`--ref-black`,
white text both inks) = Setup Classes/Batches (`.cb-table`).

Pills (`border-radius: 999px`): black primary (`--ref-pill`, silver
text) vs transparent outline secondary (`1px solid
rgba(24,26,32,0.25)`, `--ref-ink` text) — Students detail, Backup,
sidebar (`#attApplyBtn`, rail actions). The sidebar ONE-pill block
(near `.side-act-row`) is the single sidebar-action truth — later
order + equal-or-higher specificity beats the retired ALL-TEXT twin;
do not re-add `:not()` rivals.

Ambient: `body::before` = `linear-gradient(rgba(5,5,8,0.12), …)` +
`/assets/images/ui/bg-spheres.jpg` (light desert render) +
`#050507` base; `#adminLayer.open` is transparent (old `0.12` veil
retired). Top chrome over the ambient uses `--on-img` inks
(`#F2F3F6` / `-70` / `-60`).

Sharp corners retired + flat cells (global laws): the everywhere-sharp
`html [class]` rule is deleted — it outranked the ID-scoped 24px window
rules and squared the white card, rail, roster, and frost windows. What
stays sharp by own narrow rules: day pills, month cells, option rows,
validation errors. `body > .gsel-pop.gsel-pop` pins the popover frost
border + `--frost-radius`. Month cells are flat text-only (`56px` fixed
rows, transparent, no blur) with a `0.08` hairline grid (dark pole
`rgba(24,26,32,0.08)`, Saturday edge open); state reads via text only.

## Directional fade washes (RETIRED globally — user order)

All `linear-gradient(90deg, …)` fade slabs are deleted from the CSS
(zero remain): roster/rail/cube/black-card actives, weekday states,
search beds (live + dead), dead cube-add/pane-search rules. Selection
reads via 500/bold + full-ink text only; hover keeps solid fills
(non-gradient); underline indicators stay. The stop table below is the
historical record, not current paint.

Shape (all tiles, both poles — silver `242,243,246`, graphite `24,26,32`):

```css
background: linear-gradient(90deg, rgba(POLE, HEAD), rgba(POLE, TAIL) 80%);
```

| Tile | White head | White tail | Dark head | Dark tail |
|---|---|---|---|---|
| Weekly idle | 0.10 | 0 | 0.10 | 0 |
| Weekly hover | 0.12 | 0 | 0.14 | 0.02 |
| Weekly working | 0.12 | 0 | 0.16 | 0.02 |
| Weekly off | 0.06 | 0 | 0.06 | 0.02 |
| Month base | 0.06 | 0 | 0.06 | 0 |
| Month working | 0.10 | 0 | 0.10 | 0 |
| Month off / holiday / vacation | 0.04 | 0.02 | 0.04 | 0.02 |
| Month override | 0.12 | 0.02 | 0.12 | 0.02 |
| Month today | 0.14 | 0.02 (ring untouched) | 0.14 | 0.02 (ring untouched) |

Rules: per-tile (never one wash across a wrapping row); hover flips, never
melts (gradients don't transition — preferred under no-animation).
Surviving washes: rail active-nav + palette hover (`0.06`) + black-card
row active. Month/weekday cells are flat text-only now (no washes) —
the table above is the historical record, not current paint.

## Frosted surface (dropdowns, dialogs, enrollment modal card)

```css
background: rgba(242, 243, 246, 0.08);   /* = var(--frost-bg): use the var */
backdrop-filter: blur(24px) saturate(1.2); /* = var(--frost-blur): use the var */
-webkit-backdrop-filter: blur(24px) saturate(1.2);
border: none;   /* borderless like the palette — the 1px edge drew a
                   visible square over milky cards (log 37) */
border-radius: 2px;            /* small popovers; 3px allowed for large modals */
box-shadow: none;
```

Two tiers, both variable-locked (log 27): popovers/small surfaces =
sheer `--frost-*` (+ `2px`) in BOTH poles — text ink alone flips;
fixed content windows = warm `--ref-*` (+ `24px`). Sole documented
exception: the search palette's dense coat (both poles — it floats
over large bright type). Never write a literal fill/blur — always the
var. Locked by `test_frost_tokens_unified_across_popups_and_windows`.

## Veils (behind overlays — keep minimal, never dark-dialog territory)

```css
/* Dialog overlay: transparent color, blur only (reference floats undimmed) */
background: transparent;

/* Enrollment modal veil (needs text contrast over bright spots): */
background: rgba(26, 20, 16, 0.2);

/* Base .modal light veil rgba(252,251,247,0.38): DO NOT reintroduce — milk source */
```

## Primary contained action (reference pills — current)

```css
black primary:   background: var(--ref-pill); border: 1px solid var(--ref-pill);
                 border-radius: 999px; color: #F2F3F6; font-weight: 500;
outline secondary: background: transparent; border: 1px solid rgba(24,26,32,0.25);
                 border-radius: 999px; color: var(--ref-ink);
```

The old sheer `0.12`-fill / `3px` treatment below is retired (kept as
history only):

```css
background: rgba(242, 243, 246, 0.12);   /* hover: 0.18 */
border: 1px solid rgba(242, 243, 246, 0.3); /* hover: 0.5 */
border-radius: 3px;
box-shadow: none;
color: #FFFFFF; font-weight: 500;
```

## Text hierarchy (var(--sans) unless noted)

```css
primary:    #F2F3F6;                                   /* titles, values, 500 for important */
secondary:  rgba(242, 243, 246, 0.65–0.75); font-weight: 400;
tertiary:   rgba(242, 243, 246, 0.4–0.6);  font-weight: 400;
mono:       var(--mono) — dates, times, IDs, counts, technical data only.
```

## Hairlines (global line)

```css
--hairline: rgba(242, 243, 246, 0.12);   /* THE global line: 1px structural
                                           separators (toolbars, grids, sections) */
structural: 1px solid var(--hairline);
input underline: 1px solid rgba(242, 243, 246, 0.2);  /* #F2F3F6 on focus */
row separator: 1px solid rgba(242, 243, 246, 0.07–0.08);
```

## Laws

- No 600/700. No text shadows. No colored UI.
- Opaque fills exist only for the reference cards below (white
  detail/audit, black Classes/Batches); everything else stays
  frost/transparent.
- Native `<select>` under custom dropdowns stays `opacity: 0` (invisible truth).
- Centered flex rows + dynamic text = shift bug; use absolute centering / fixed slots.
- Ink toggle (`INK: WHITE ⇄ BLACK` in admin top bar, `atl_ink` persisted):
  `html[data-ink="dark"]` flips text tiers only — primary `#181A20`,
  base `rgba(24,26,32,0.8)`, placeholders `rgba(24,26,32,0.5)`.
  Backgrounds/frost/blur/borders/layout frozen. Native `<option>` popups
  and kiosk layers excluded (keep white-on-dark).
