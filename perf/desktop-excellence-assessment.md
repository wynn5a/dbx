# DBX 桌面端极致化评估报告与路线图

> 日期：2026-09-19 · 分支：`app-only` @ `f0d2181a` · 类型：现状评估（未改动任何代码）
> 关联文档：[性能优化计划](optimization-plan.md)、[DOM 密度审计](dom-density-audit.md)

---

## 一、TL;DR

DBX 已经完成了"只保留桌面端"的结构性瘦身（`0b097c69` 删除 web/docker/CLI），且 13 项性能优化全部落地。当前代码质量整体很高，但要达到"极致桌面端"，存在 **1 个阻断性问题**、**3 个高价值性能缺口**、**2 个体积优化机会** 和 **若干架构收敛空间**。

最优先事项：**前端生产构建当前是坏的**（vite 8 rolldown 无法解析 `@babel/runtime`），任何发布都会失败——必须先修。

---

## 二、当前状态盘点

### 2.1 仓库结构（app-only 分支现状）

| 目录 | 角色 | 是否桌面端必需 | 备注 |
|---|---|---|---|
| `apps/desktop/` | Vue 3 前端 | ✅ 核心 | 137 个 `.vue` + 163 个 `lib/*.ts` |
| `src-tauri/` | Tauri 2 Rust 壳 | ✅ 核心 | 33 个命令模块，IPC 层很薄 |
| `crates/dbx-core/` | 数据库核心 | ✅ 核心 | 73 个 Rust 文件，14.5k 行 db 驱动层 |
| `packages/app-tests/` | 前端测试套件 | ✅ 保留 | 148 个测试文件 |
| `packages/node-core` | 共享 Node 包 | ⚠️ 可选 | 主要服务 mcp-server |
| `packages/mcp-server` | MCP server npm 包 | ⚠️ 可选 | `@dbx-app/mcp-server` v0.4.7，发布到 npm |
| `plugins/jdbc/` | JDBC 插件 | ⚠️ 可选 | 需 Java 17 构建，覆盖 H2/DB2/Hive 等 |
| `docs/` | Next.js 文档站 | ❌ 非桌面 | 独立 pnpm 项目，Cloudflare Pages，19 MB |

**结论**：桌面端本体（前 3 行）已高度收敛。剩余的非桌面交付物只剩 `mcp-server`（对外 npm 包）和 `docs`（文档站）。JDBC 插件虽是独立进程，但它是桌面端"40+ 数据库"承诺的一部分，删除会大幅削减支持面，不建议动。

### 2.2 构建产物体积

| 产物 | 体积 | 明细 |
|---|---|---|
| 前端 `dist/` | **7.1 MB**（未压缩） | 208 个 JS chunk + CSS + 字体 |
| 最大 chunk | 475 KB | `codemirror-*.js`（SQL 编辑器） |
| 其他大块 | 362 KB echarts-charts、264 KB App、265 KB DataGrid、256 KB esm（shiki）、171 KB×2 shiki 语言包、145 KB leaflet、259 KB ui（reka-ui） |
| 首屏 CSS | 153 KB | `index-*.css` |
| 字体 | 276 KB | IBM Plex Mono 6 字重 + Inter 2 字重（woff2，合理） |
| Rust 二进制 | 未实测（无 release 构建缓存） | README 宣称安装包 15 MB |
| `cargo check` 冷编译 | **27.2 s** | Apple Silicon，全 workspace |

**体积评价**：前端 7.1 MB 对 Tauri 应用是可接受的（会被压进 ~15 MB 安装包），但有几个明显可压缩点（见 §3.3）。

### 2.3 启动路径分析

**Rust 侧**（`src-tauri/src/lib.rs`，已有 `[STARTUP]` 计时日志）：

```
run() → rustls init → 9 个插件注册 → setup():
  ├─ log 插件初始化
  ├─ Storage::open (SQLite, spawn_blocking 单写者)
  ├─ migrate_from_json
  ├─ load_desktop_settings  ← block_on，串行
  ├─ AppState 构建
  ├─ mcp_bridge::start      ← 启动内置 MCP bridge
  ├─ tray / icon / window_state
  └─ show_main_window
```

**前端侧**（`apps/desktop/src/main.ts`）：

```
bootstrap() → 并行 import(i18n, App.vue) → loadSavedLocale()
            → createApp + pinia + i18n + VueVirtualScroller → mount
```

**良好实践**：窗口 `visible: false` 直到 setup 完成才 show（避免白屏）；非默认 locale 懒加载；启动失败有兜底错误面板而非裸崩溃。

**潜在问题**：
1. `mcp_bridge::start` 在 setup 关键路径上同步启动——内置 MCP bridge 是否在用户从未使用 AI/MCP 功能时也必须随启动拉起？可改为懒启动（首次调用时拉起）。
2. `load_desktop_settings` 用 `block_on` 串行等待，若 SQLite 冷读慢会延后窗口显示。可考虑与窗口显示并行、设置就绪后再应用。
3. `Storage::open` 启动时逐 secret 逐条查询（优化计划 §123 行已列出，可合并为一次查询）。

### 2.4 测试与 CI 健康度

- 前端：148 个测试文件，`pnpm check` = fmt + lint + typecheck + vitest 并行。
- Rust：`cargo fmt --check` + `cargo clippy` + `cargo test --workspace --locked`。
- CI：frontend check、node package tests、publish dry-run、JDBC 插件版本守卫。
- **缺口**：CI 里没有"生产构建 smoke test"能捕获当前的构建失败（见 §3.1）；没有包体积回归门禁；没有启动时间基准。

---

## 三、发现的问题（按优先级）

### 3.1 🔴 阻断性：生产构建失败

```
Error: Rolldown failed to resolve import "@babel/runtime/helpers/extends"
from @uiw/codemirror-theme-xcode/esm/index.js
```

- **影响**：`pnpm build` 直接失败 → `pnpm tauri build` 无法产出安装包。**当前分支无法发布。**
- **根因**：`@uiw/codemirror-theme-xcode` v4.25.10 的 ESM 产物引用了 `@babel/runtime`，但 (a) 它没把 `@babel/runtime` 声明为 dependency，(b) vite 8 换用 rolldown 后对未声明依赖的解析更严格。
- **修复选项**（按推荐排序）：
  1. 在根 `package.json` 显式添加 `@babel/runtime` 依赖（最小改动，立即解锁构建）。
  2. `vite.config.ts` 中 `build.rollupOptions.external` 排除并换成内联 helper（治标不治本）。
  3. 用 `@codemirror/theme-one-dark` + 自定义 `HighlightStyle` 替换 6 个 `@uiw/codemirror-theme-*` 包——它们每个都是"几个颜色值"却引入 babel 运行时依赖，**顺手能砍掉 ~50 KB 并消除整条问题依赖链**。`editorThemes.ts` 已是懒加载（`await import`），替换成本低。

### 3.2 🟠 高价值性能缺口（后端，来自优化计划遗留项）

优化计划文档（`optimization-plan.md` 115–123 行）已精确定位了这些，此处按"极致桌面端"价值重新排序：

| 优先级 | 问题 | 位置 | 影响 |
|---|---|---|---|
| P0 | `fetch_size` 未接入 MySQL/PG 原生驱动 | `query.rs:57` | 设了 1 万行限制，剩余行仍在网络传输+客户端截断。接入服务端游标（PG portal / MySQL `set_fetch_size`）后大表首屏提速可达数倍 |
| P0 | MySQL `SQL_MAX_ROWS` 后台循环全量拉取 | `mysql.rs:1448-1470` | 同上，且元数据路径 15 处直取连接不 ping（上限 3s 才返回） |
| P1 | 表导入整文件进内存 | `table_import.rs:435` | GB 级 CSV/JSON 导入 OOM；无事务包裹，失败留半截数据。csv crate 支持流式，改按块构建-执行-提交 |
| P1 | XLSX 导出无内存上限 | `table_export.rs:330-403` | 全量行累积进 `all_rows` + 整个 worksheet XML 构建为一个 String |
| P1 | 导出用 OFFSET 分页 | `database_export.rs:493-567`、`csv_export.rs:83-135` | 服务端每页重扫；`table_export.rs` 已实现 keyset 分页可直接复用 |
| P2 | Redis 每操作先 `SELECT db` | `redis_ops.rs` | 每操作白付 1 RTT；`MultiplexedConnection` 可 clone+pipeline 替代 Mutex 串行化 |
| P2 | 同步 Tauri 命令主线程拼大字符串 | `commands/query.rs:483-502` | INSERT/整库导出构建器是同步命令，阻塞 IPC |

### 3.3 🟡 前端体积优化机会

1. **echarts 拆分可更激进**：当前 `echarts-charts` 362 KB 全量打包所有图表类型。检查实际用到的图表（可能只有 line/bar/pie），用 echarts 的按需 `use()` 注册可砍 60%+。
2. **shiki 语言包**：`javascript-*.js` 171 KB、`typescript-*.js` 177 KB、`tsx-*.js` 171 KB 作为独立 chunk 存在——确认 AI 助手 Markdown 渲染是否真的需要完整 shiki 语言包，或可用 `shiki/core` + 按需语言。
3. **leaflet 145 KB**：地理数据可视化。若是低频功能，确认已是懒加载 chunk（看名字是独立 chunk，应该是），无需动作。
4. **`@uiw/codemirror-theme-*`**：见 §3.1，换原生方案省 ~50 KB。

### 3.4 🟡 架构收敛空间（"极致"的可选动作）

这些不改变功能，但让"纯桌面端"定位更彻底：

1. **`mcp_bridge` 懒启动**：见 §2.3。若用户不开 AI 功能，启动少拉起一个进程。
2. **`packages/mcp-server` 去留**：它是独立 npm 包（`npx @dbx-app/mcp-server`），让 Claude Code/Cursor 能查 DBX 管理的数据库。这与"桌面端"不冲突（它读取的是桌面端的数据目录），但它是一份需要持续维护的对外 API 表面。**若"极致"= 专注，可考虑停止对外发布、仅保留内置 AI 助手；若"极致"= 体验，保留它是差异化优势。** 这是产品决策，非技术决策。
3. **`docs/` 移出本仓库**：19 MB 的 Next.js 站 + 独立 lockfile，与 app 开发完全解耦。移出后 clone/CI 更快，但需要另建仓。
4. **首屏 CSS 153 KB**：Tailwind v4 按需生成，153 KB 偏大——可用 `pnpm build --mode analyze` 或检查是否有未 purge 的组件样式（reka-ui/leaflet 全量 CSS import）。

---

## 四、"极致桌面端"路线图

按投入产出比排序，分四个阶段：

### 阶段 0：恢复可发布状态（立即，0.5 天）
- [x] 修复 `@babel/runtime` 构建失败 ✅ `b63f49f1`（加依赖解锁）→ 随后 `7e10d4f0` 内联主题、彻底移除 @uiw 包与 babel 运行时
- [x] CI 增加 `pnpm build` smoke 步骤 ✅ `0bc1c534`（并使 CI 在 app-only 分支触发）

### 阶段 1：性能攻坚（1–2 周，价值最高）
- [~] `fetch_size` 部分落地：MySQL 行数上限即放弃响应流并重建连接池 ✅ `a7bc2c3f`；PG 文本回退去 simple_query 全量缓冲 ✅ `a326a649`。剩余：服务端游标（PG portal / MySQL set_fetch_size）
- [x] MySQL 行数上限后不再全量拉取 ✅ `a7bc2c3f`（abandoned-wire 标志 + 连接池重建，SQL Server 同款模式）
- [x] 表导入流式化 ✅ `eff7d94f`（按 batch_size 块流式读取-执行，内存 O(批次)；事务包裹未做）
- [x] XLSX 导出流式化 ✅ `ebd18a70`（`XlsxSheetStreamWriter` 逐页写 sidecar scratch，内存 O(页)；finish 输出与旧路径逐字节一致，取消不留残文件）
- [x] 导出 keyset 分页替换 OFFSET ✅ `ebd18a70`（`transfer::keyset_pagination_eligible` 统一判定；`table_export` xlsx / `database_export` / `csv_export` 均优先 keyset、无可用 PK 回退 OFFSET）
- [ ] 每项独立提交 + `cargo test -p dbx-core` 回归（遵循优化计划 §落地流程约定）

### 阶段 2：启动与体积打磨（1 周）
- [x] `mcp_bridge` 核实无需改动：setup 中仅 spawn 一个 127.0.0.1:0 轻量 TCP 监听（非外部进程），不阻塞启动关键路径
- [ ] 启动时 secrets 查询合并为一次（`storage.rs:708-773`）
- [x] 替换 `@uiw` 主题包 ✅ `7e10d4f0`。echarts 核实已按需注册（QueryChart.vue 用 use() 注册 3 种图表），shiki 审计确认全为懒加载 chunk——无需动作
- [ ] 建立包体积基线（release 构建 + 记录各 chunk 大小），CI 设回归阈值
- [ ] 建立启动时间基准（利用现有 `[STARTUP]` 日志 + `cargo build --release` 计时）

### 阶段 3：架构收敛（产品决策后执行，各 0.5–1 天）
- [x] `mcp-server` 保留 ✅（用户决策 2026-09-19）
- [x] `docs/` 已移出本仓库 ✅ `705b7586`（性能文档移至 `perf/` `002c08d0`）
- [ ] Redis `MultiplexedConnection` pipeline 化、同步 Tauri 命令 async 化（P2 项）
- [ ] 杂项：MongoDB `count_documents` 优化、ES `fetch_size`、共享 `hex_encode`、`BufWriter` 补齐

### 阶段 4：持续卓越（长期机制）
- [ ] CI 门禁：包体积回归、启动时间回归、`pnpm build` 必须通过
- [ ] 每次大版本前跑一次 `perf/dom-density-audit.md` 的内存基线对比
- [ ] 保持优化计划文档的"问题/修复/验证"三段式提交规范

---

## 五、不建议做的事

- **不要删 `plugins/jdbc/`**：它是"40+ 数据库"承诺的承载，删除会把支持面砍到 ~15 个。
- **不要删 `crates/dbx-core` 独立 crate 结构**：它让 `cargo test -p dbx-core` 能脱离 Tauri 快速跑，是值得保留的架构。
- **不要为减体积换 slimmer 图表库**：echarts 已深度集成（ER 图、explain plan、监控图表），替换成本远超体积收益。
- **不要动 `[patch.crates-io]` 的 fork**：GaussDB 和 sha256_password 支持依赖它们，CLAUDE.md 有明确警告。

---

*本报告基于静态分析与构建实测，未做运行时 profiling。阶段 1 开始前建议先用 `pnpm dev:tauri` + 真实大表跑一次 MySQL/PG 查询，确认 `fetch_size` 问题的实际影响面。*
