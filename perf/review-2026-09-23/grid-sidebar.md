# Review — data grid / sidebar (T04, T23, T25, T40, T41)

Back to [index](README.md).

| Task | Commit | Verdict |
|---|---|---|
| T04 Grid save shows SQL first | 0dacdb2a | OK |
| T23 FK click-to-navigate | 37fc558b | 1 medium |
| T25 Leaflet on demand | b963ea14 | OK |
| T40 Column pin + drag reorder | 958f01b6 | 2 medium, 2 low |
| T41 Sidebar drag into editor | 8cf4f39f | 1 low |

## T23 — FK click-to-navigate

- [ ] **MEDIUM — FK filter invisible, dropped on first page/sort/refresh**
  - Where: `apps/desktop/src/composables/useNavigationTargets.ts:18-110`; filter bar seeded from `initialWhereInput = activeTab.whereInput` (`ContentArea.vue:974`, `DataGrid.vue:543`).
  - `openTableTarget` bakes `whereInput` into SQL but never sets `tab.whereInput`. Cmd+click `orders.customer_id=42` → customers tab filtered, WHERE bar empty → `onPaginate`/`onSort`/`onReloadData` use `currentWhereInput()`="" → full table silently returns. With `reuseDataTab`, reused grid keeps the previous tab's stale filter.
  - Fix: set `tab.whereInput = target.whereInput ?? ""` for new and reused tabs; for reused tabs sync the grid's `whereFilterInput` (e.g. watch `initialWhereInput`). Pre-existing (database-search target has it too) but T23's "定位到对应行" depends on it.

## T40 — Column pin + drag reorder

- [ ] **MEDIUM — scroll-into-view leaves the column under the pinned area**
  - Where: `DataGrid.vue:4836-4852` `scrollGridColumnIntoView` (`scrollLeft = colLeft - ROW_NUM_WIDTH`), and column-highlight centering at `DataGrid.vue:1747-1753`.
  - Pin a 200px column, scroll right, ArrowLeft/search-jump to a column just left of view → it lands under the pinned column. DOM `scrollIntoView({inline:"nearest"})` thinks it's visible; canvas has no correction.
  - Fix: `scrollLeft = Math.max(0, colLeft - DATA_GRID_ROW_NUM_WIDTH - pinnedTotalColumnWidth.value)`; center at `ROW + pinnedW + (clientWidth - ROW - pinnedW)/2`.
- [ ] **MEDIUM — saved layout leaks into a different query in the same tab**
  - Where: `useDataGridColumnLayout.ts:61-64`, `:136`; `executeTabSql` without `preserveResultDuringExecution` (`queryStore.ts:723`, `1000`) clears `tab.result` → DataGrid remounts with same cacheKey `<tab>-0`.
  - Query A: pin `id`, widen `name`; run query B with the same names → `id` pinned, order reused, A's widths applied (sample widths persisted even without manual resize). Contradicts "换 SQL 重置".
  - Fix: store `scopeKey` in the cached layout; discard on mismatch at restore.
- [ ] **LOW — duplicate column names break reorder and swap widths**
  - Where: `dataGridColumnLayout.ts:118-127` (`resolveDataGridColumnRenderOrder` ranks by first index of a name), `DataGrid.vue:2022-2028`.
  - `[id, name, id]`, drag pos 0 to end: `after=[1,2,0]` resolves to `[1,0,2]`; widths already permuted to `after` → the two `id` columns swap widths, column not where dropped. Verified.
  - Fix: rank duplicates by occurrence (consumed count per name), or derive the width permutation from the resolved order.
- [ ] **LOW — hidden-column interactions**
  - (a) `setColumnOrder` stores only visible names; unranked sort after ranked (`order.length + position`) → a column hidden then shown after any drag jumps to the far right. Fix: merge with previous order.
  - (b) `pinColumnInLayout` guard counts stale hidden pinned names (`useDataGridColumnLayout.ts:117`) vs menu guard `canPinAdditionalColumn` counting visible (`DataGrid.vue:5616`). 4 cols, pin A+B, hide A, "Pin" C → menu enabled, click does nothing. Fix: filter pinned list to visible before the guard.

## T41 — Sidebar drag into editor

- [ ] **LOW — generic-family column names inserted unquoted**
  - Where: `queryEditorTableDrop.ts:196-201` → `quoteSqlIdentifier` default branch (`sqlCompletion.ts`).
  - SQLite/DuckDB/Oracle/ClickHouse `Order Date`, `my-col`, Oracle mixed-case `"myCol"` inserted bare; table drops in the same editor are quoted via `quoteTableIdentifier` (`tableSelectSql.ts:19-34`). Matches completion (as the task specified) — shared limitation; fixed together with the T07 finding in [completion.md](completion.md).
  - Fix: default branch quotes with `"…"` when not `[A-Za-z_][A-Za-z0-9_$]*` (Oracle: when not all upper-case).

## T04 / T25 — OK

- T04: only save entry is `onToolbarCommit` (`DataGrid.vue:2559`), no shortcut bypass; close/ESC/overlay handled; no confirm/close race; `customSave` hosts skip preview as documented; six locales complete.
- T25: only dynamic imports reach `geometryMapPreview` (`DataGrid.vue:1627`) and `LayerPreviewDialog.vue`; Leaflet only imported inside the dialog; failed load resets for retry.
