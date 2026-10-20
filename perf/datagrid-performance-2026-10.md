# DataGrid 性能测试与优化计划（2026-10-20）

> 测试对象：`apps/desktop/src/components/grid/DataGrid.vue`（canvas 渲染模式，DOM 模式作对照）
> 测试工具：[grid-bench](grid-bench/README.md)（headless Chrome + CDP，真实组件挂载，数据与方法可复现）
> 原始数据：[grid-bench/results.json](grid-bench/results.json)、`grid-bench/profile-*.cpuprofile`（Chrome DevTools 可直接打开）

## 一、测试方法

- 环境：macOS arm64，headless Chrome（新 headless），1440×900 @ dpr 1，无 Tauri；`@tauri-apps/api/core` 的 `invoke` 被 stub 阻断，其余代码路径与产线构建一致（vite build，非压缩）。
- 数据：确定性 PRNG 合成 QueryResult，8 类列型（id/name/email/status/amount/timestamp/notes/boolean），6% NULL，10% 长文本；每规格 3 样本取中位数。
- 指标：
  - **busyMs**：操作窗口内 `long-animation-frame` 累计时长 ≈ 主线程卡顿总量（搜索含组件内 150ms 防抖，只计入 wall 不计入 busy）。
  - **maxFrame**：窗口内最长帧 = 用户感受到的单次冻结。
  - **heapFootprint**：每规格独立 Chrome 进程挂载 + 双 GC 后的 `usedJSHeapSize`（同进程连续导航会把 V8 堆头寸算进来，虚增 3–6 倍，故独立测量）。
  - 挂载计时已排除 harness 数据生成（否则 100k 规格虚高 ~150ms）。

## 二、结果总览（3 样本中位数）

### 健康项 —— 全部规格无长帧（p95 ≤ 16.8ms = vsync），无需优化

| 场景 | 1k×20 | 10k×20 | 100k×20 | 10k×100 | dom 10k×20 |
| --- | --- | --- | --- | --- | --- |
| 首帧（挂载→canvas 首绘） | 83ms | 79ms | 109ms | 67ms | 79ms |
| 垂直滚动 maxFrame（2s 滚到底） | 16.8 | 16.8 | 16.8 | 16.8 | 16.8 |
| 水平滚动 maxFrame | 16.8 | 16.8 | 16.8 | 16.8 | — |
| 选区拖拽 120 行 maxFrame | 16.7 | 16.8 | 16.8 | 16.8 | — |
| 列宽拖拽 30 步 maxFrame | 16.8 | 16.8 | 16.8 | 16.8 | — |
| 列隐藏/恢复（wall） | 153/150ms | 152/150ms | 177/144ms | 158/143ms | — |
| 内存足迹（独立进程，GC 后） | 11MiB | 18MiB | 87MiB | 36MiB | 18MiB |

canvas 滚动每帧 JS 开销 ≈ 1–2ms（CPU profile：`drawCanvasDataGrid` + 文本测量在 2s 窗口合计 < 150ms），远低于 16.7ms 帧预算；DOM 模式（RecycleScroller）与 canvas 内存足迹相同（均被数据本体主导），但 DOM 模式 10 万行不可用（未测，历史上的 DOM 密度审计已证明）。

### 瓶颈 —— 客户端搜索：单次长帧阻塞主线程，随 行×列 线性放大

| 场景 busyMs（主线程阻塞） | 1k×20 | 10k×20 | 10k×100 | 100k×20 |
| --- | --- | --- | --- | --- |
| searchNarrow（冷扫描，命中 ~1 行） | <17 | **157** | **807** | **1731** |
| searchBroad（子集 ~1–3% 行） | <17 | **142** | **728** | **1385** |
| clearSearch（还原全表） | <17 | <17 | <17 | **123** |
| replaceResult（整表重建，对照） | <17 | <17 | 119 | 265 |

- 每敲一个字符 = 一次全表重扫（`searchScanCache` 只在前缀扩展时复用，且实际几乎不命中，见下文），100k×20 规格下打字期间 UI 冻结 **1.4–1.7 秒/键**。
- 次要发现：100k 规格选区 mouse-up 有 53ms 阻塞；10k×100 的 DOM 模式搜索与 canvas 同量级（瓶颈在扫描不在渲染）。

## 三、瓶颈归因（100k×20 搜索的 CPU profile）

自耗时合计 ~1.36s / ~1.9s 活跃窗口（**~72% 在单元格格式化链**）：

| 自耗时 | 函数 | 位置 |
| --- | ---: | --- |
| 608ms | `formatCellLowerCached` | DataGrid.vue:2618 |
| 424ms | `formatCellCached` | DataGrid.vue:3779 |
| 123ms | `formatCell`（真实格式化） | DataGrid.vue:3760 |
| 110ms | `tableColumnForGridColumn` | DataGrid.vue:2552 |
| 93ms | `rememberPrimitiveCellFormat` | DataGrid.vue:3743 |
| 125ms | GC（上述路径的分配副产品） | — |

三个结构性问题：

1. **缓存 key 比缓存本身贵**。`primitiveCellFormatKey`（:3756）对每个单元格拼 `` `${col}\u0000${typeof}\u0000${String(value)}` `` ——每次扫描 200 万次字符串拼接 + 两次 Map 探测；`cellLowerCache`（:2617）再用格式化结果做 key 再探一次 Map。扫描期间的分配潮还触发 125ms GC。
2. **缓存容量注定失效**。`CELL_FORMAT_CACHE_LIMIT = 20_000`（:3724），而高基数列（name/email/timestamp）单次扫描就有上百万个不同值——20k 容量 + "清空式"逐出使缓存反复失效。这就是 warm 搜索（1385ms）几乎不比 cold（1731ms）快的原因。缓存只对低基数列（status/boolean）有效。
3. **每列信息查找是 O(列数)**。`tableColumnForGridColumn`（:2552）对 `tableMeta.columns` 做大小写不敏感的线性 `find`，缓存未命中时每单元格调用一次 → 100 列规格 O(行×列²)。
4. **双扫描**。`sortedRows`（:2634）扫一遍找"任一列命中"，`searchMatches`（:2792）再扫一遍已命中行找"哪几列命中"，两遍都走完整格式化链；`searchMatchSet`（:2805）再把中间对象数组转字符串 Set。

## 四、优化计划

### P0 搜索扫描路径重构（预期 100k×20：1.7s → 0.4–0.7s；10k×20：157ms → <50ms）

- **G1 每列值键缓存**：`primitiveCellFormatCache`/`cellLowerCache` 改为 `Map<columnIndex, Map<原始值, 显示串>>`。原始值直接作 Map key（SameValueZero），零 key 构建、零拼接分配。失效沿用现有 `clearCellFormatCache` watcher（列集合/格式器签名变化时清空）。
- **G2 列信息预索引**：挂载/`tableMeta` 变化时构建一次 `Map<lowerName, ColumnInfo>`，`tableColumnForGridColumn` 变 O(1)。
- **G3 单遍扫描**：合并 `sortedRows` 与 `searchMatches` 为一次遍历，产出 `matchedIndices` + 每行命中列数组；`searchMatchSet` 直接构建（消除中间 `SearchMatch[]`）。`searchScanCache` 前缀扩展逻辑可删（G4 之后不再需要）。

### P1 行级 display 物化（预期 100k×20 热键入：→ 50–150ms/键）

- **G4**：`RowItem` 增加惰性 `display: string[]`（首次访问逐列格式化并冻结），挂进现有 `displayItemCache`（行修订 revision 已有失效机制）。搜索扫描退化为 `item.display.some(s => s.includes(q))`——每行一生只格式化一次，与基数无关；顺带让渲染取文本零 Map 开销（`formatCell` 回调可直接读 `display[col]`）。高基数列的格式化成本从"每次搜索"移到"每行一次"。
- **G5**：若 G1–G4 后 10 万行级键入仍不流畅，再做分片扫描（`scheduler.yield` 每 ~30ms 让出、新键入可取消、渐进高亮）。改动面大（computed 链同步），仅在 P0/P1 实测不达标时启动。

### P2 绘制微优化（backlog，滚动已达标，仅在 profile 回归时做）

- **G6**：`paintCell` 对每个可见单元格每帧做两次 `measureText`（截断判断 + `fitCanvasText` 内部，canvasDataGridRenderer.ts:386-388）→ 复用一次测量或把宽度并入 `fitCanvasTextCache`。
- **G7**：`searchMatchKeys.has(\`${row}:${col}\`)`（canvasDataGridRenderer.ts:332）每帧每格拼串 → 改数值键（`row * colCount + col`）。
- **G8**：100k 规格选区 mouse-up 53ms（范围提交路径）与 `replaceResult` 265ms（整表重建，本质 O(n)）——先观察，G4 落地后复测再定。

### 验收与回归

- 每项落地后跑 `perf/grid-bench`：目标 searchNarrow busyMs —— 10k×20 < 50ms、10k×100 < 250ms、100k×20 < 700ms（P0）；P1 后 100k×20 热键入 < 150ms。
- 滚动/挂载/内存不得回退（现基线：全规格滚动 maxFrame ≤ 16.8ms；100k×20 首帧 ≤ 110ms；足迹 ≤ 87MiB）。
- `packages/app-tests/dataGrid*.test.ts` 全绿（搜索/排序/选区行为不变）。

## 五、实施结果（2026-10-20，G1–G4 全部落地）

提交：G1 `c0a254b5`、G2 `c713af64`、G3 `a8364f6d`、G4 `902b50f6`（bench 加热搜索场景 `df61c04a`）。每项均 typecheck + `dataGrid*.test.ts`（159）全绿后提交；G4 后全量 vitest（1555）通过。

busyMs（3 样本中位数，ms）：

| 场景 | 10k×20 | 10k×100 | 100k×20 | dom 10k×20 |
| --- | --- | --- | --- | --- |
| searchNarrow 冷扫描（基线 → G4 后） | 157 → **86** | 807 → **268** | 1731 → **485** | 131 → 95 |
| searchWarmPrefix 热键入（新增场景） | 0 | 0 | **0** | 0 |
| searchWarmFull 暖全表重扫（新增场景） | 0 | 58 | **53** | 0 |
| searchBroad | 142 → 86 | 728 → 258 | 1385 → 478 | 114 → 74 |
| clearSearch | <17 | <17 | 123 → 148 | <17 |

滚动 maxFrame 全规格 16.8ms、首帧、heap 足迹（87MiB@100k×20）与基线完全一致，无回退。

**门槛判定**：

- P1 热键入 < 150ms：**达标**（前缀扩展路径 0ms——G4 后打字续输不再触发任何格式化，只剩上轮命中行的 `includes`）。
- P0 冷扫描门槛（10k×20 <50 / 10k×100 <250 / 100k×20 <700）：100k×20 达标；10k 规格未达（86 / 268）。原因：bench 的 searchNarrow 是新页面上的**首次**搜索，冷成本 ≈ 全表每格 `formatCell` 一次的下限（200k 格 ≈ 80ms），G1–G4 已把 key 构建、双扫描、重复格式化全部消掉，再往下只有动 formatCell 本身或分片扫描。
- **G5 不启动**：其触发条件（G1–G4 后十万行级键入仍不流畅）不成立。
- G6–G8 维持 backlog（滚动无回归、无 profile 恶化；replaceResult 235ms 为 O(n) 本质，观察不变）。

诚实的用户体感总结：100k×20 首次搜索从 ~1.7s 冻结降到 ~0.5s；此后同一搜索会话内打字/换词不再有可感知卡顿（0–53ms）。
