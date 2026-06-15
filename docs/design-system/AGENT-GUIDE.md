# Editor Settings — Implementation Guide

A spec for rebuilding the **Editor Settings** dialog inside Data Buddy, aligned to the
Data Buddy design system. Hand this file (plus `DESIGN-SYSTEM.md`) to a coding agent and
they can reproduce the panel from scratch.

The working reference implementation lives in **`settings.jsx`** (component) and
**`settings-preview.html`** (isolated preview that renders the dialog open). It is wired
into the live app via the gear button in the top bar and the `⌘,` shortcut.

---

## 1. What changed vs. the original

The original screen was a generic dark settings sheet: bright blue (`#5b6cff`-ish) slider,
opaque gray borders, system-default selects, a 12px mono label scale, no surface hierarchy.
The redesign re-skins every control onto Data Buddy tokens — **nothing about the feature
set changes**, only the visual language.

| Element | Original | Data Buddy |
|---|---|---|
| Surface | flat near-black sheet | `--bg-elevated` card + top sheen, `--border-strong`, `--shadow-pop` |
| Section labels | 14–16px sentence case | mono 11px/600 **UPPERCASE** `--text-3`, +0.06em |
| Selects | native `<select>` | custom popover select on `--bg-input`, accent focus ring |
| Slider | blue native range | `--accent` fill + `--text-1` knob, mono value chip, 10/24 end labels |
| Toggles | gray pill | `.db-toggle` — accent track when on, white knob |
| Setting blocks | bare rows | `.card`-style panels (`--bg-panel` + hairline + `--shadow-card`) |
| Code preview | static highlight | live, reflects font / size / wrap / theme; DS syntax hues |
| Accent | hardcoded blue | derived from `--accent` (user-tweakable) everywhere |

---

## 2. Tokens used (all from the DS — never hardcode)

- Dialog surface `--bg-elevated`; setting cards `--bg-panel`; inputs `--bg-input`; code well `--bg-canvas`.
- Borders: `--border` default, `--border-soft` inner dividers, `--border-strong` overlay edge.
- Text ramp `--text-1 … --text-4`. Accent: `--accent`, `--accent-soft` (selection fill), `--accent-line` (focus ring).
- Semantic `--red` for the dangerous-SQL keywords. Geometry `--radius`, `--radius-sm`, `--radius-pill`.
- Fonts `--font` (chrome) / `--mono` (values, labels, kbd, code). Depth `--shadow-pop`, `--shadow-card`, `--sheen`. Motion `--speed` + `--ease`.

The accent **must** stay derivable: every accent tint is `var(--accent)` or a `color-mix`/`rgba`
off it, so the product's accent tweak recolors the whole dialog.

---

## 3. Dialog shell

- **Overlay:** `position: fixed; inset: 0; z-index: 110;` scrim `rgba(0,0,0,0.55)` + `backdrop-filter: blur(3px)`; flex, top-aligned, `padding-top: 8vh`. Click-scrim closes. (Same recipe as the ⌘K command palette.)
- **Card:** `width: 640px; max-width: 92vw; max-height: 84vh;` flex column. `background: linear-gradient(180deg, rgba(255,255,255,0.022), transparent 22%), var(--bg-elevated)`; `border: 1px solid var(--border-strong)`; `border-radius: 14px`; `box-shadow: var(--shadow-pop)`; `overflow: hidden`. Entrance: `.fade-in` (180ms fade + 2px rise).
- **Header (fixed):** 30×30 `--accent-soft` rounded tile with gear icon in `--accent`; title "Editor settings" 15px/600 `--text-1`; sub-caption 11.5px `--text-3`; trailing 28×28 close `IconBtn`. `--border` bottom.
- **Body (scrolls):** `padding: 20px 18px; overflow-y: auto`. Sections separated by `--border-soft` hairlines (`height:1px; margin:20px 0`).
- **Footer (fixed):** `--bg-base`, `--border` top. Left: text-button "Reset to defaults" (`--text-3` → `--text-1` on hover). Right: chip **Cancel** + **primary** Done button (gradient per DS recipe) with an `esc` kbd chip.
- **Esc** closes; the modal owns a `keydown` listener while open.

---

## 4. Controls

### Custom Select (`Select`)
Replaces native `<select>` so the menu obeys the dark theme.
- Trigger: full-width button, `--bg-input`, `1px --border`, `--radius-sm`, 12.5px. Mono when the value is machine-shaped (font family). Hover → `--border-strong`. Open → `box-shadow: 0 0 0 2px var(--accent-line)`. Trailing `chevD` rotates 180° when open.
- Menu: absolute, `top: calc(100% + 5px)`, `--bg-elevated` + sheen, `--border-strong`, `radius 10px`, `--shadow-pop`, 5px pad. Items 12.5px/`radius 6px`; hover `--bg-hover`; selected item `--accent-soft` fill + `--text-1` + trailing `check` in `--accent`.
- Closes on outside `mousedown` and `Escape`.

### Slider (`.db-range`, in `styles.css`)
- Track 4px, `--bg-active`; **fill via inline `linear-gradient(90deg, var(--accent) X%, var(--bg-active) X%)`** where `X = (value-min)/(max-min)*100`. (Firefox uses `::-moz-range-progress`.)
- Thumb 16px, `--text-1`, `--sheen` + drop shadow; hover scale 1.08; focus ring `--accent-soft`.
- Value shown in a mono chip (`--bg-input` + `--border`); min/max ("10px"/"24px") in `--text-4` mono below.

### Toggle (`.db-toggle`, in `styles.css`)
- `role="switch"`, `aria-checked`. Track 38×22 pill; off = `--bg-active` + `--border`, knob `--text-2`. On = `--accent` track, white knob translated +16px. 120ms transitions. Focus ring `--accent-line`.

### Setting card (`ToggleCard` + the Execute-mode card)
- Shell: `--radius`, `1px --border`, `linear-gradient(180deg, rgba(255,255,255,0.016), transparent 42%), var(--bg-panel)`, `--shadow-card`, padding `13px 15px`.
- Title 13px/600 `--text-1` (+ optional leading icon, `kbd` chip, or `--red` icon for danger); description 11.5px/1.55 `--text-3`.
- A toggle card lays title/desc + trailing `Toggle` in a row; a select card stacks title/desc then the control, with a flex spacer so the control sits at the bottom and both cards in a row match height (`align-items: stretch`).

> **Consistency rule:** when two setting blocks sit side-by-side in a row, both must use the
> same card shell — don't pair a bare control with a card. (This was the fix applied to the
> Execute-mode / Word-wrap row.)

---

## 5. Layout (top → bottom inside the body)

1. **Row** `grid 1fr / 200px`: **Font family** select (mono) + **Theme** select. Each has a mono-caps `SetLabel` (with `type` / `palette` icon) above.
2. divider — **Font size**: `SetLabel` + right-aligned mono value chip; full-width slider; min/max labels.
3. divider — **Row** `grid 1fr / 1fr`, `align-items: stretch`: **Execute mode** card (title + `⌘↵` kbd + helper + select) and **Word wrap** toggle card.
4. **Confirm before dangerous SQL** — full-width toggle card; description inlines `ALTER · DROP · DELETE · TRUNCATE` in mono `--red`.
5. divider — **Live preview** (§6).

---

## 6. Live preview

A miniature read-only editor that re-renders from the current settings:
- Container: `--radius`, `1px --border`, `overflow: hidden`, background = the selected theme's `bg`.
- Caption bar: `query` icon + `query.sql` + trailing mono `{fontFamily} · {fontSize}px`, on `rgba(255,255,255,0.02)` with `--border-soft` bottom.
- Body: a `--text-4` line-number gutter (mono, right-aligned, `--border-soft` divider) + a `<pre>` of highlighted SQL. `font-family` = selected family, `font-size` = slider value, `line-height: 1.65`. **Word wrap** toggles `white-space: pre-wrap` ↔ `pre` (+ horizontal scroll when off).
- Highlighter: single-pass tokenizer → spans. Keyword = `theme.kw`, string = `theme.str`, number = `theme.num`, comment = `theme.com` italic, identifier = `theme.txt`, punctuation = `theme.punc`.
- **Themes are the only place non-DS colors are allowed** — they color *preview content* (a code editor), not chrome. `Data Buddy` maps onto DS tokens (`--accent` / `--t-text` / `--t-int` / `--text-4`); `VS Dark+`, `Monokai`, `GitHub Dark` use their authentic palettes.

---

## 7. State & integration

- Settings object: `{ fontFamily, theme, fontSize, execMode, wordWrap, confirmDangerous }`, defaults in `SETTINGS_DEFAULTS`. Persisted to `localStorage["db.editorSettings.v1"]` on every change; re-hydrated on open. "Reset to defaults" rewrites the stored object.
- App wiring (`app.jsx`): `settingsOpen` state; gear `IconBtn` in `TopBar` (`title="Editor settings  ⌘,"`); global `keydown` toggles on `⌘,` / `Ctrl+,`; `<SettingsModal open={settingsOpen} onClose={…} />` rendered alongside the command palette.
- `SettingsModal` accepts an `embed` prop: when set, it returns just the card (no fixed scrim) for previewing/embedding in a settings page.

## 8. Files

| File | Role |
|---|---|
| `settings.jsx` | `SettingsModal` + `Select`, `Toggle`, `ToggleCard`, `SetLabel`, theme-aware `previewHTML`. |
| `styles.css` | adds `.db-range` (slider) and `.db-toggle` (switch). |
| `icons.jsx` | adds `gear`, `type`, `wrap`, `palette`, `shield`. |
| `app.jsx` | `settingsOpen` state, gear button, `⌘,` shortcut, modal render. |
| `Data Buddy.html` | registers `settings.jsx` before `app.jsx`. |
| `settings-preview.html` | standalone open-state preview. |

## 9. Hard rules to honor

- White-alpha hairline borders only — no opaque gray lines.
- Mono only for machine-shaped content (values, labels, kbd, code); never for chrome body text.
- No new hues beyond DS semantic/data-type palette (themes excepted, §6).
- No shadows on in-body elements beyond `--shadow-card`; reserve `--shadow-pop` for the dialog itself.
- Weight never exceeds 600; hierarchy comes from the color ramp + size.
- Keep the accent tweakable — derive every accent tint from `var(--accent)`.
