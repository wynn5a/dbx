# Review — command palette (T44)

Back to [index](README.md).

| Task | Commit | Verdict |
|---|---|---|
| T44 Command palette | 909b8f4f | 1 medium, 3 low |

Requirement coverage: Mod+K toggle, type-to-filter, Enter to run, one-line `registerCommand`, and transfer / diff / compare / driver store / SQL library are all present. The i18n is complete in all six locales, and the component is lazy-loaded. `pnpm test` passes (183 files, 1432 tests). Mod+K doesn't collide with CodeMirror: its only related binding is `Shift-Mod-k` (deleteLine), and the matcher rejects the extra Shift.

## Findings

- [ ] **MEDIUM — the palette bypasses the toolbar's enable/disable rules**
  - Where: `apps/desktop/src/lib/commandPalette.ts` (`CommandDefinition` has no enabled predicate) and `App.vue` `commandPaletteContext` (~L241-261). Compare `AppToolbar.vue:106-151`, where New Query, Transfer, Schema Diff and Data Compare are `:disabled="!hasConnections"` and Execute SQL File is `:disabled="!hasSqlFileConnections"`.
  - Scenario: with no saved connections, the palette still lists these commands and opens the Transfer, Schema Diff and Data Compare dialogs, which the toolbar never allows in that state. Execute SQL File opens with no file-capable connection. New Query silently does nothing (`resolveNewQueryTarget` returns null) and the palette just closes.
  - Fix: add an optional `enabled?(context): boolean` to `CommandDefinition`, and expose `hasConnections` / `hasSqlFileConnections` on the context. Hide those commands, or render them disabled so Enter skips them. Test with a stub context where there are no connections.
- [ ] **LOW — the palette is a second action registry, separate from the shortcut registry**
  - The plan (E8) said "build after E6 so the action registry exists". The palette doesn't reuse `SHORTCUT_DEFINITIONS`:
    - Commands show no key hint, even where one exists (New Query, New Connection, Settings).
    - Shortcut-registry actions aren't in the palette: Format SQL, toggle sidebar, next/previous tab, refresh data.
    - The New Query and New Connection routing is written three times: toolbar, keydown branch, palette context.
  - Fix: add an optional `shortcutId: ShortcutActionId` to `CommandDefinition`. Render the bound key with the existing shortcut formatter, and add the registry actions as palette commands that call the same handlers as `handleKeydown`.
- [ ] **LOW — Mod+K opens the palette on top of other modal dialogs**
  - Where: `App.vue` `handleKeydown` (~L847) has no guard. With Settings or the connection dialog open, Mod+K stacks the palette over it. Running a command then opens a third dialog. The Settings shortcut has the same pre-existing pattern.
  - Fix: ignore Mod+K while another modal is open (e.g. check for an open `[role="dialog"]`), or close the current modal before the command runs.
- [ ] **LOW (cleanup) — `watch(open)` in `CommandPalette.vue` never fires**
  - App mounts the palette with `v-if="showCommandPalette"` and `open` already true, and the watch isn't `immediate`. So the query/selection reset and the `searchInputRef.focus()` inside it are dead code. It works today only because the component is remounted each time and reka's `DialogContent` auto-focuses the input.
  - Fix: remove the watch, or make it `immediate` if the component may later stay mounted.
