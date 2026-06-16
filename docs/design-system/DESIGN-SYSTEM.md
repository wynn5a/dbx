# Data Buddy — Design System (v1.1)

> Single-file reference for coding agents. Everything needed to build UI that looks like
> Data Buddy is in this file: tokens, type scale, component recipes, state rules.
> Copy the token block as-is; follow the recipes; obey the rules at the bottom.
> Reference docs live in `ds/` (index.html → colors, typography, spacing, components, states, theming, export).

## Identity (read first)

A dense, calm, keyboard-first **dark** interface in the Linear lineage, built for a database client.
- Hierarchy comes from **elevation** (5 stacked near-black surfaces) and a 4-step text ramp — never from heavy borders or big type.
- **Color means something.** UI is neutral by default; the indigo accent marks primary actions, selection and focus; semantic hues signal state; each data type owns a fixed hue reused everywhere.
- **Two typefaces, strict split:** Inter for interface chrome, IBM Plex Mono for anything machine-shaped (values, types, ids, keys, code).
- Chrome recedes; data is the loudest thing on screen.

## Setup

```html
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap" rel="stylesheet">
```

## Tokens (copy verbatim)

```css
:root {
  /* surfaces — darkest → most elevated. Page sits on base; panels/cards on panel;
     menus, popovers, hovering chrome on elevated; text fields on input. */
  --bg-base:      #08090a;
  --bg-canvas:    #0b0c0e;   /* content wells, table headers, code blocks */
  --bg-panel:     #0f1011;   /* cards, sidebar, panels */
  --bg-elevated:  #16171a;   /* overlays, menus, kbd chips */
  --bg-input:     #191a1e;   /* text fields */
  --bg-hover:     rgba(255,255,255,0.035);  /* hover fill on any surface */
  --bg-active:    rgba(255,255,255,0.06);   /* active/selected fill */

  /* borders — always white-alpha hairlines, never opaque gray lines */
  --border-soft:   rgba(255,255,255,0.045); /* row dividers, inner seams */
  --border:        rgba(255,255,255,0.07);  /* default card/control border */
  --border-strong: rgba(255,255,255,0.12);  /* hover borders, overlay edges */

  /* text ramp */
  --text-1: #f7f8f8;   /* titles, values, focused content */
  --text-2: #9c9da7;   /* labels, nav, body */
  --text-3: #6b6d79;   /* captions, metadata, placeholder */
  --text-4: #4c4e5a;   /* disabled, hints, NULL, row numbers */

  /* accent (user-tweakable in product — always derive, never hardcode) */
  --accent:       #6e79d6;
  --accent-soft:  rgba(110,121,214,0.16);   /* selection fills, active palette item */
  --accent-line:  rgba(110,121,214,0.45);   /* focus rings */

  /* semantic */
  --green:  #3fb950;  /* success, connected, true */
  --amber:  #d9a521;  /* warning, primary key */
  --red:    #e5534b;  /* error, destructive */
  --blue:   #4f9be6;  /* info */
  --purple: #a371e8;
  --teal:   #2dd4bf;

  /* data-type identity — fixed hue per column type, reused in badges,
     cell values, and syntax highlighting */
  --t-int:  #4f9be6;  --t-text: #3fb950;  --t-time: #d9a521;
  --t-bool: #a371e8;  --t-json: #e07a5f;  --t-uuid: #2dd4bf;

  /* geometry */
  --radius:      8px;    /* cards, panels (tweakable 0–14px) */
  --radius-sm:   6px;    /* buttons, inputs, nav rows */
  --radius-pill: 99px;
  --row-h:       34px;   /* data rows; 30px compact, 42px comfy (density tweak) */
  --sidebar-w:   256px;  /* tweakable 210–320px */

  /* type */
  --font: 'Inter', system-ui, sans-serif;
  --mono: 'IBM Plex Mono', ui-monospace, 'SF Mono', monospace;

  /* depth */
  --shadow-pop:  0 16px 48px -12px rgba(0,0,0,0.65), 0 4px 12px -2px rgba(0,0,0,0.45), 0 0 0 0.5px rgba(255,255,255,0.06);
  --shadow-card: 0 1px 2px rgba(0,0,0,0.25);
  --sheen:       inset 0 1px 0 rgba(255,255,255,0.07);  /* top highlight on raised elements */

  /* motion — durations (fast & layered) */
  --dur-1: 80ms;    /* hover tint, press, tiny flips */
  --dur-2: 120ms;   /* default control transition (== --speed) */
  --dur-3: 180ms;   /* entrances, fades, caret/chevron */
  --dur-4: 240ms;   /* overlays, dialogs, larger movement */
  --dur-5: 360ms;   /* full-view transitions only */
  --speed: 120ms;   /* legacy alias of --dur-2 */

  /* motion — easing */
  --ease:        cubic-bezier(0.25, 0.46, 0.45, 0.94); /* default — gentle ease-out */
  --ease-out:    cubic-bezier(0.16, 1, 0.30, 1);       /* entrances, overlays */
  --ease-in-out: cubic-bezier(0.45, 0, 0.40, 1);       /* continuous/looping motion */
  --ease-spring: cubic-bezier(0.34, 1.40, 0.64, 1);    /* faint overshoot — toggles, checks */
}

html, body {
  background: var(--bg-base); color: var(--text-1);
  font-family: var(--font); font-size: 13.5px; letter-spacing: -0.006em;
  -webkit-font-smoothing: antialiased;
}
::selection { background: var(--accent-soft); }
::-webkit-scrollbar { width: 10px; height: 10px; }
::-webkit-scrollbar-thumb { background: rgba(255,255,255,0.08); border-radius: 8px; border: 3px solid transparent; background-clip: padding-box; }
```

## Type scale

| Role     | Spec                                   | Used for                       |
|----------|----------------------------------------|--------------------------------|
| display  | 44–46px / 600 / -0.032em, gradient `#f7f8f8 → 62%` | marketing/cover headlines only |
| title    | 22px / 600 / -0.022em                  | page titles                    |
| subject  | 16px / 600 / -0.012em                  | panel & dialog titles          |
| ui       | 13.5px / 400–500                       | default interface text         |
| body     | 13px / 400 / 1.55 line-height          | paragraphs                     |
| control  | 12.5px / 500                           | buttons, inputs, table cells   |
| caption  | 11.5px / 500 / `--text-3`              | helper text, descriptions      |
| label    | 11px / 600 / +0.06em / UPPERCASE / mono / `--text-3` | section labels |
| micro    | 10.5px / mono                          | kbd hints, type badges         |

Rules: tabular numerals (`font-variant-numeric: tabular-nums`) on all numeric columns. Mono for: cell values of int/uuid/time types, type badges, SQL, kbd, ids. Never bold mono above 600.

## Layout dimensions

topbar 44px · toolbar 38px · row 34px (30/42 density variants) · sidebar 256px · inspector 360px · command palette 560px wide · icon button 28×28 · icons: 1.5px-stroke line icons, 11–17px.

## Component recipes

### Primary button
```css
.btn-primary {
  display: inline-flex; align-items: center; gap: 7px; padding: 5px 12px;
  border-radius: var(--radius-sm); font-size: 12.5px; font-weight: 500; color: #fff;
  border: 1px solid color-mix(in srgb, var(--accent) 55%, rgba(255,255,255,0.18));
  background: linear-gradient(180deg, color-mix(in srgb, var(--accent) 94%, #fff), color-mix(in srgb, var(--accent) 90%, #000));
  box-shadow: var(--sheen), 0 1px 2px rgba(0,0,0,0.35);
  transition: filter var(--speed) var(--ease);
}
.btn-primary:hover { filter: brightness(1.08); }
```

### Secondary "chip" button
```css
.btn-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 5.5px 10px;
  border-radius: var(--radius-sm); border: 1px solid var(--border);
  background: transparent; color: var(--text-2); font-size: 12.5px;
  transition: background-color var(--speed) var(--ease), border-color var(--speed) var(--ease), color var(--speed) var(--ease);
}
.btn-chip:hover  { background: var(--bg-hover); color: var(--text-1); border-color: var(--border-strong); }
.btn-chip.active { background: var(--bg-active); color: var(--text-1); }
.btn-chip.danger { color: var(--red); border-color: color-mix(in srgb, var(--red) 30%, transparent); }
```

### Icon button — 28×28, radius 6px, transparent; hover → `--bg-active` fill, `--text-3 → --text-1`.

### Card / panel
```css
.card {
  border: 1px solid var(--border); border-radius: var(--radius);
  background: linear-gradient(180deg, rgba(255,255,255,0.016), transparent 42%), var(--bg-panel);
  box-shadow: var(--shadow-card);
}
```
The page itself stays flat — only overlays get `--shadow-pop`.

### Nav row (sidebar)
```css
.nav-item { display: flex; align-items: center; gap: 9px; padding: 7px 9px;
  border-radius: var(--radius-sm); font-size: 13px; color: var(--text-2); }
.nav-item:hover  { background: var(--bg-hover); }
.nav-item.active { background: var(--bg-active); color: var(--text-1); font-weight: 500; }
/* active leading icon switches stroke to var(--accent); idle icons use var(--text-3) */
```

### Kbd hint
```css
.kbd { font-family: var(--mono); font-size: 10.5px; padding: 1.5px 5px; border-radius: 4px;
  background: var(--bg-elevated); border: 1px solid var(--border); color: var(--text-2);
  line-height: 1; box-shadow: var(--sheen), 0 1px 1px rgba(0,0,0,0.3); }
```

### Status / enum pill — 14%-tint fill, full-hue text, 5px leading dot
```css
.pill { display: inline-flex; align-items: center; gap: 6px; padding: 2px 8px;
  border-radius: var(--radius-pill); font-size: 11.5px; font-weight: 500;
  background: color-mix(in srgb, var(--hue) 14%, transparent); color: var(--hue); }
.pill .pdot { width: 5px; height: 5px; border-radius: 99px; background: var(--hue); }
```

### Type badge — `font-family: var(--mono); font-size: 10.5px; color: var(--t-<type>);` (e.g. `int8`, `varchar`, `timestamptz`).

### Constraint tag — mono 9.5px/600 caps, 4px radius, 13%-tint fill: amber = PRIMARY KEY, teal = UNIQUE, `--text-3` = NOT NULL.

### Input / inline cell editor
```css
.field { border: none; outline: 2px solid var(--accent); background: var(--bg-elevated);
  color: var(--text-1); font-size: 12.5px; padding: 7px 9px; border-radius: 4px; }
/* numeric / uuid fields switch to var(--mono) */
```

### Data grid
- Header: sticky, `--bg-canvas` fill, `--border` bottom, 12px/500 `--text-2`, height 34px.
- Rows: `--row-h`, `--border-soft` dividers, no zebra striping.
- Cells: 12.5px; numbers mono + right-aligned + tabular; `NULL` italic `--text-4`; row numbers mono `--text-4`.
- Hover row: `--bg-hover`. Selected row: `--accent-soft` fill.

### Command palette (⌘K)
560px wide, `--bg-elevated` + faint top sheen gradient, 12px radius, `--border-strong`, `--shadow-pop`. Search row 14px with trailing `esc` kbd. Group labels: mono 10.5px/600 caps `--text-4`. Items 13.5px, 7px radius; active item `--accent-soft` fill + `--text-1` + accent icon.

### Status dot — 7px filled dot + `box-shadow: 0 0 0 3px <hue at 13%>` halo; green pulse = live connection.

### Tooltip
```css
.tooltip {
  display: inline-flex; align-items: center; gap: 8px; width: max-content;
  padding: 4.5px 9px; border-radius: 6px;
  background: linear-gradient(180deg, rgba(255,255,255,0.02), transparent 40%), var(--bg-elevated);
  border: 1px solid var(--border-strong);
  box-shadow: var(--sheen), 0 4px 12px -2px rgba(0,0,0,0.5);
  font-size: 11.5px; font-weight: 500; color: var(--text-1); line-height: 1.4;
}
.tooltip .tkbd { font-family: var(--mono); font-size: 10px; color: var(--text-3);
  padding: 1px 4px; border-radius: 3px; background: var(--bg-active); }
.tooltip .tsub { color: var(--text-3); font-weight: 400; }  /* secondary detail */
```
Behavior: show after 400ms hover delay, 6px from anchor, no arrow; fade in 120ms; shortcut hint in `.tkbd` chip; never wrap past ~36ch.

## States

| State    | Treatment |
|----------|-----------|
| hover    | fill `--bg-hover`; borders step up to `--border-strong`; text steps up one ramp level |
| active/selected | fill `--bg-active` (neutral) or `--accent-soft` (data selection) |
| focus    | `outline: 2px solid var(--accent-line); outline-offset: 1px` — or full `--accent` outline for cell editing |
| disabled | `--text-4`, no hover response, `cursor: default` |
| empty    | centered, icon in `--text-4`, one 13px `--text-2` line + one caption, single chip-button CTA |
| loading  | skeleton bars `--bg-elevated` with shimmer; never spinners taller than 16px |
| error    | inline `--red` text + 14%-tint banner; never modal for recoverable errors |

Motion: see the **Motion** section below. In short — 120ms / `--ease` on color/background/border; entrances 180ms fade + 2px rise; no movement on hover; no decorative animation.

## Motion

Fast, quiet, functional. Motion confirms an action, reveals structure, or shows where something came from — then gets out of the way. If an animation doesn't help the user understand state, it doesn't ship. Reference: `ds/motion.html` (live demos).

**Principles:** fast over fluid (most transitions 80–180ms) · ease *out*, not in (decelerate into rest) · move with meaning (no idle/decorative motion).

**Durations** — reach for the smallest that reads:

| Token | Time | Use |
|-------|------|-----|
| `--dur-1` | 80ms  | hover tint, press, row-select, tiny flips |
| `--dur-2` | 120ms | default control transition (= legacy `--speed`) |
| `--dur-3` | 180ms | entrances, fades, caret/chevron rotation |
| `--dur-4` | 240ms | overlays, dialogs, toasts, larger movement |
| `--dur-5` | 360ms | full-view / page transitions only — never inside a working view |

**Easing:** `--ease` everyday default · `--ease-out` entrances & overlays (decisive arrival) · `--ease-in-out` continuous motion (shimmer, progress) · `--ease-spring` faint overshoot, reserved for toggle knob & checkbox tick.

**Recipes:**
- **Hover/press** — `background-color, color, border-color` over `--dur-2 --ease`. Tint only; never translate or scale.
- **Focus** — fade a `box-shadow: 0 0 0 2px var(--accent-line)` ring in over `--dur-2` as the border goes transparent. Crisp ring, never a growing glow.
- **Content entrance** — `opacity` + `translateY(4px → 0)` over `--dur-3 --ease-out`.
- **Overlay entrance** — `opacity` + `translateY(6px)` + `scale(0.985 → 1)` over `--dur-4 --ease-out`.
- **Toast** — `opacity` + `translateX(14px → 0)` from its edge over `--dur-4 --ease-out`.
- **Toggle** — knob `translateX(16px)` on `--ease-spring`; track recolors on `--ease`.
- **Checkbox** — draw the tick via `stroke-dashoffset` over `--dur-3 --ease-out`.
- **Caret** — `transform: rotate(90deg)` over `--dur-3`.
- **Loops (only while pending/live):** spinner 700ms linear (≤20px, one at a time) · skeleton shimmer 1.4s `--ease-in-out` · indeterminate bar 1.3s · live status pulse 1.8s halo. Stop the loop the instant state resolves.

**Performance:** animate `transform` and `opacity` only — both composite on the GPU and never reflow. Never animate `height`, `width`, `top`, or `left`.

**Reduced motion:** wrap everything so it degrades to its end-state under `prefers-reduced-motion: reduce` — drop movement and loops, keep ~0.01ms fades so state changes stay legible.

## Hard rules (do / don't)

- **Do** keep the accent user-tweakable: derive all accent tints via `color-mix` from `--accent`.
- **Do** use white-alpha hairlines for every border; **don't** use opaque gray borders.
- **Do** use mono for machine-shaped content only; **don't** set chrome/labels in mono (exception: section labels and kbd).
- **Don't** introduce new hues — pick from semantic/data-type palette.
- **Don't** use pure black or pure white; surfaces span #08090a–#191a1e, text caps at #f7f8f8.
- **Don't** put shadows on in-page elements beyond `--shadow-card`; reserve `--shadow-pop` for overlays.
- **Don't** exceed weight 600; hierarchy comes from color ramp + size, not boldness.
- Keyboard-first: every primary action gets a visible kbd hint; ⌘K reaches everything.
