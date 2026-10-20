# grid-bench — DataGrid 浏览器基准

对 `apps/desktop/src/components/grid/DataGrid.vue` 做真实渲染性能测试的 harness：在无 Tauri 的纯浏览器页面里挂载真实组件 + 合成数据，由 Node 驱动脚本通过 CDP 控制 headless Chrome 采集指标。

## 运行

```bash
# 1. 构建 harness 页面（vite，产物在 ./dist）
../../node_modules/.bin/vite build

# 2. 跑完整基准（4 个 canvas 规格 + 1 个 dom 对照，各 3 样本 + 独立进程内存探测）
node bench.mjs --samples 3
node bench.mjs --quick      # 每规格 1 样本，快速验证
```

依赖：系统 Chrome（`CHROME_BIN` 可覆盖路径）、Node ≥ 22（内置 WebSocket/fetch，无 npm 依赖）。

## 结构

- `harness.ts` — 页面内脚本：挂载 DataGrid（pinia + i18n + TooltipProvider + 合成 QueryResult），暴露 `window.__bench` 操作 API。数据生成在计时窗口之外；`?rows=&cols=&mode=canvas|dom&seed=` 控制规格。
- `tauri-core-stub.ts` — alias 掉 `@tauri-apps/api/core` 的 `invoke`，让整个应用图不触达 Tauri，同时保留 `@/lib/api` 全部真实导出。
- `bench.mjs` — CDP 驱动：静态服务 dist、launch headless Chrome、按场景执行并采集。样本 1 额外抓 CPU profile（`profile-*.cpuprofile`，可用 Chrome DevTools 打开）。
- `results.json` — 最近一次运行的全量数据；`shots/` — 关键节点截图。

## 场景与指标

每个规格（1k×20 / 10k×20 / 100k×20 / 10k×100 canvas，10k×20 dom 对照）依序执行：

| 场景 | 说明 | 关键指标 |
| --- | --- | --- |
| firstFrame | 挂载 → canvas 首帧 | ms（数据生成已排除在计时外） |
| scrollVertical/Horizontal | 2s / 1.2s 匀速滚到底 | 帧间隔 p50/p95/max、>32ms 帧数、busyMs |
| searchNarrow | 搜索仅命中个位数行的词 | wall / busyMs（LoAF 主线程阻塞）/ 最长帧 |
| searchBroad | 命中约 1–3% 行的子集 | 同上 |
| clearSearch | 清空搜索还原 | 同上 |
| selectDrag120 | canvas 上鼠标拖 120 行选区 | 同上 |
| toggleColumn | 隐藏 + 恢复一列 | hide/show 两段 wall |
| resizeColumn | 表头拖拽 30 步 | 同上 |
| replaceResult | 替换整个 result 对象（模拟重新查询） | wall / busy |
| heapFootprint | 每规格独立 Chrome 进程挂载后 GC 两次读 usedJSHeapSize | MiB |

`busyMs` 来自 `long-animation-frame` 观察者 = 操作窗口内主线程被长帧阻塞的总量，比 wall（含 150ms 搜索防抖与等待开销）更能反映卡顿。

## 方法注意点（踩过的坑）

- 内存必须在独立进程中测：同一 renderer 连续导航时 `performance.memory` 含 V8 堆头寸，会虚增 3–6 倍且单调上涨。
- `firstFrameMs` 必须把 harness 数据生成放在计时窗口外，否则 100k 规格多算 ~150ms 的 toISOString。
- 搜索防抖 150ms 计入 wall，不计入 busyMs。
- `heap=0MiB` 表示 `Runtime.getHeapUsage` 在此 Chrome 版本不可用，用页面内 `performance.memory` 替代。
