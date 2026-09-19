# DBX 性能优化计划

> 状态：持续更新。已完成项随提交落地并推送至 `app-only` 分支，每项均附带测试与回归验证。
> 相关文档：[DOM 密度审计](dom-density-audit.md)。

## 背景

本计划源自 2026-09 的一次全量性能审查，覆盖两条线：

- **Rust 后端**（`crates/dbx-core` + `src-tauri`）：查询执行路径、连接管理、Tauri 命令层、导出/导入/迁移、Agent 驱动运行时。
- **Vue 前端**（`apps/desktop/src`）：数据网格、Pinia store、CodeMirror 编辑器、IPC 调用、缓存层。

先说结论：代码库已做了大量正确的性能工程（见文末"已有良好实践"），以下条目是审查后剩余的真实热点，按影响排序逐项落地。

---

## 已完成 ✅

以下 13 项已全部实施、测试、提交并推送（分支 `app-only`）。

### 1. Agent 守护进程：全局互斥锁改为按 daemon 分片 `d64c3b4c`

**问题** `call_daemon`（`crates/dbx-core/src/agent_runtime.rs`）持有 `daemons` HashMap 的锁跨越整个 RPC——包括冷启动 spawn JVM。所有走 Agent 协议的数据库（Oracle、达梦、金仓、Hive、DB2、Snowflake…）共享一个 `AgentManager`，一个连接上的慢调用会阻塞**所有其他** Agent 连接的连接测试。

**修复** 每个 daemon 客户端放 进自己的 `Arc<tokio::sync::Mutex>`：外层 map 锁只保护 lookup/insert；不同 daemon 的调用并行，同一 daemon 的调用保持串行（stdio JSON-RPC 管道的要求）。失败重启不再先销毁旧进程（重启失败时旧 daemon 仍可用），并用 `Arc::ptr_eq` 防止并发双重启。

**验证** 新增 `agent_runtime::tests`（非法 db_type 拒绝、失败不残留注册项）；`cargo test -p dbx-core` 全量回归。

### 2. SQL Server：行数限制后提前终止 TDS 流 `ef461a49`

**问题** `collect_first_result_limited`（`db/sqlserver.rs`）达到 `row_limit` 后只是停止*收集*，仍继续消费 TDS 流直到耗尽——对大表设了 1 万行限制，网络传输和行解析照样全量发生。

**修复** 收集器到达限制立即 `break`。由于放弃的流会在连接上留下未读 TDS 包，`execute_query_with_max_rows` / `execute_batch_with_max_rows` 返回 abandoned-wire 标志，查询路径复用既有的"协议状态污染即丢弃连接池"机制（与查询超时同路径）重建连接；多语句批处理保持完整排空（保证每个语句结果可见），池的丢弃延迟到整个脚本结束。

**验证** 新增源码守卫测试（防回退到全量收集）+ 全量回归。新增防回退测试锁定"截断必须 break"与"abandoned-wire 必须传播"。

### 3. 数据迁移：批次 SQL 生成去 O(n²) `6897e326`

**问题** `generate_transfer_write_sql_batches`（`transfer.rs`）为检查 512 KiB 语句上限，每加一行就从头重新格式化整条多行 INSERT/MERGE 再丢弃——默认 batch_size=1000 时每批约 50 万次行片段格式化，是跨库迁移的主要 CPU 开销。

**修复** 拆出 `prefix + fragments + suffix` 语句骨架，每行片段只格式化一次，按前缀和字节预算装箱成语句。对照测试证明与旧算法在 MySQL/Postgres/SQLite/DuckDB/SQL Server/Oracle/Hive（含行数上限路径）上**逐字节一致**。

**附带 bug 修复** 无主键表的 upsert 原先生成空语句、整批数据被静默跳过；现在退化为普通 INSERT（实际迁移路径上游已有回退 append 的守卫，此处是生成器层的兜底）。

### 4. XLSX 导出：消除每字符堆分配 `9f91cd91`

**问题** `escape_xml`（`xlsx_export.rs`）对每个字符分配一个 `Vec<char>`，且非字符串单元格跑两遍——万行 × 20 列导出是数百万次小分配。

**修复** 先扫描判断是否需要处理：干净文本走零分配拷贝快速路径；需要转义时用预分配缓冲 `push_str` 实体。worksheet body 也改为预预留容量，替代反复 collect 扩容。行为不变（同样的实体转义与控制字符剥离），有测试锁定。

### 5. 前端调试日志：内存缓冲 + 合并落盘 `98d839d6`

**问题** `appendDebugLog`（`lib/debugLog.ts`）每条日志同步全量读+解析+序列化+写回 localStorage（上限 1500 条）。开启调试日志后，每次点击、每次 API 调用（2 条）、每行 console、每个 long task 都触发——恰恰在排查性能问题时最伤性能。

**修复** 日志驻留内存缓冲：enabled 标志与既有条目只加载一次；追加原地 splice；500ms 防抖合并写盘。`pagehide` / `visibilitychange(hidden)` 强制落盘，关闭日志开关时先 flush，`clearDebugLogs` 重置缓冲防止旧条目复活。导出直接读内存。

**验证** 新增 `packages/app-tests/debugLog.test.ts`（6 个用例：合并写入、禁用零写入、立即 flush、导出含未落盘条目、clear 语义、1500 条截断）。

### 6. 标签页结果缓存：驱逐路径去掉冗余拷贝 `862497cd`

**问题** 驱逐大结果集标签页时（保留 5 个在内存，超出即落盘），`buildTabResultSnapshot` → msgpack 编码链路做约 3 次全量拷贝：`stripSessionIds` 逐行克隆、列式转置重建、`removeUndefinedFields` 再递归重建整个 payload，且编码同步在主线程——切标签页会卡 UI。

**修复** 快照只读（构建与编码同步完成、中间无 await），行数组与分析/元数据树共享引用（`toRaw`）；原始类型数组跳过 undefined 清理遍历；payload 层的二次 strip 合并进 envelope 层。驱逐成本从 3 次拷贝 + 编码降为 1 次转置 + 编码。测试契约同步更新（行共享身份断言）。

### 7. 数据网格：全列可见时跳过投影拷贝 `5795fee5`

**问题** `visibleDisplayItems`（`DataGrid.vue`）在 `displayItems` 每次失效（包括每次单元格提交）时，为每行重建投影拷贝（新的 data 与 dirty 标志数组）——即使没有任何隐藏列，投影等于逐行自我拷贝。

**修复** 全列可见（默认场景）时直接共享物化项；有隐藏列才走逐行投影。选择/导出等消费方均为只读，已核实无变异。

### 8. 数据网格：单元格编辑只重建触碰的行 `0c04e91e`

**问题** 每次单元格提交替换整个 `dirtyRows` Map → `displayRowRefs`/`displayItems` 全量失效重建；搜索激活时 `searchMatches` 随之 O(行×列) 重扫。10 万行页大小时每次击键在主线程为每行分配对象。

**修复** 行引用与行项按行缓存，有效性完全自校验（字段相等、rows/newRows 修订计数、脏项快照、基行身份）——编辑只重建触碰的行，变异点无需手动失效；搜索匹配按查询+行身份逐行缓存，搜索中提交只重扫被编辑的行。缓存项冻结，消费方逐一核实只读；`result.rows` 替换时整体清空。新增 `dataGridRowItems.test.ts`（12 用例）。

### 9. 重命名对话框：预览防抖 + 高亮缓存 `1c4ddf74`

**问题** 两个重命名入口（侧栏 TreeItem、ObjectBrowser）每击键一次 IPC invoke 刷新预览 SQL，且对话框每次击键对未变化的 SQL 重跑 Shiki `codeToHtml`（Shiki 无输入级缓存）。

**修复** 预览刷新防抖 150ms（与应用其他输入防抖一致，既有 request-id 守卫仍负责排序在途结果）；高亮 HTML 在 computed 中预计算，仅预览 SQL 实际变化时才重跑 Shiki。

### 10. 列表虚拟化：Mongo 文档 / 库搜索 / 数据对比 `cb67f918`

**问题** `MongoDocBrowser.vue` 文档列表平铺 v-for（页大小可达 10 万）且每次渲染对每个文档前 3 键跑 `JSON.stringify`；`DatabaseSearchDialog.vue` 结果可累计数千张卡片；`DataCompareDialog.vue` 四处列表（源表、批次任务预览、批次结果汇总表、差异明细行——"显示全部"下无上界）全部未虚拟化。

**修复** Mongo 文档列表改定高 RecycleScroller，预览按文档身份 WeakMap 缓存（每页只算一次）；库搜索结果行走 DynamicScroller（匹配列 badge 可换行、行高可变）配收缩式限高容器；数据对比的源表与任务预览走定高 RecycleScroller，差异明细与批次结果汇总表（`<table>` 改网格头+虚拟行）走 DynamicScroller，汇总行增加 `uid` 作稳定 key。回收视图内 `:last-child` 选择器永不生效，行边框移到行自身。

### 11. KeepAlive 上限 4→12 `f05d1a88`

**问题** 缓存上限 4 个标签内容，5 个以上查询标签时每次切换销毁/重建最久未用标签的 CodeMirror 实例（扩展、主题、补全装配全重来）；补全元数据虽有进程级缓存，编辑器本体重建仍每次付费。

**修复** 上限提到 12，覆盖现实并发标签数，超出部分行为不变（仍按 LRU 逐出）。

### 12. 前端杂项：导出单次拼接 + 编辑器主题 watcher 精准化 `3acbc486`

**问题** `copyAll`/`formatCsv` 先 join 出完整 body 再插值拼接，大结果全量导出/复制峰值内存翻倍；`sqlInsertExportData` 全列可见（常态）时仍逐行重建投影。`QueryEditor.vue` 深度 watcher 监听整个 `editorSettings`，任何嵌套变化（页大小、Mongo 视图模式等）都重建 CodeMirror 主题并重配 3 个 compartment。

**修复** 拼接改为 header+行片段一次 join；恒等投影直接共享行数组（与任务 7 同型）。主题 watcher 改为只对真正喂给编辑器外观的字段（字号/字体/换行/主题 id/解析后的自定义主题色/暗色）以 JSON key 精确跟踪。

### 13. connectionStore 侧栏树浅响应化 `0321966c`

**问题** `treeNodes` 是深响应 ref，数千表的 schema 每个节点都是响应式代理，树遍历、扁平化与渲染读取全付代理开销。

**修复** 树改为 `shallowRef` + 纯对象节点（完全去代理）；所有写点按 id 走 `commitTreeNode`，只克隆根到变更节点的路径并换根数组，未动子树保持引用身份（虚拟列表按路径精准重渲染）。这取代了旧的就地变异纪律——捕获的节点引用按设计即分离，加载器 finally 中按 id 提交清 `isLoading` 天然落在当前实例上，原 `rebuildTreeNodes` 注释防的"旋转图标永久卡住"由结构性方案消除。刷新链路（refreshTreeNode/refreshAllTree/refreshStaleTreeNode/restoreExpandedChildren）在恢复展开前按 id 重查节点；TreeItem/ConnectionTree 的写入改走新 store 动作。新增 `connectionStoreTreeCommits.test.ts`（4 用例：节点非代理、提交换根、经 stale 实例按 id 落点、合并保留展开与已加载 children）。

---

## 待办 📋

按预期收益排序。前置事实：前端结果分页默认 100 行，但用户可调到 `MAX_RESULT_PAGE_SIZE = 100000`（`lib/paginationPageSize.ts`）——大部分前端热点在这个配置下才咬人；后端默认 `MAX_ROWS = 10000`（`query.rs:15`）。

### 后端

- **[高] PG 连接池 `max_size(1)`**（`db/postgres.rs:1004`）：单库所有查询与元数据共用一条物理连接互相排队；schema 查询路径每次执行 SET/`RESET` `search_path`（`postgres.rs:1715/1733`，+2 RTT），回收用 `RecyclingMethod::Verified`（`:991`）再付一次校验往返。建议：小池（2-4）+ 仅在 search_path 实际变化时设置（或改用全限定名，代码库他处已生成）。MySQL 侧查询路径每次 checkout 都 ping（`mysql.rs:1448-1470`，上限 3s；元数据路径约 15 处直取连接不 ping）。
- **[高] `fetch_size` 未接入原生驱动**：`QueryExecutionOptions.fetch_size` 字段已存在（`query.rs:57`）但只转发给 agent/插件驱动。MySQL/PG 的行数限制目前是客户端截断，剩余行仍在网络传输；接上后可用服务端游标（PG portal / MySQL `set_fetch_size`）真正截断。只有 ClickHouse 已做服务端限制（`max_result_rows` + `result_overflow_mode=break`）。
- **[中] 表导入整文件进内存**（`table_import.rs:435,307-316,472-492`）：CSV/JSON 先整读 `Vec<Vec<Value>>`，再为整个文件物化全部 INSERT 语句才执行——GB 级文件 OOM；无事务包裹，失败留半截数据。csv crate 支持流式读取，改为按块 流式构建-执行-提交。
- **[中] XLSX 导出无内存上限**（`table_export.rs:330-403`）：xlsx 分支把所有分页批次累积进 `all_rows`，worksheet XML 整个构建为一个 String；csv/json/markdown/sql 分支已是逐批流式写出，xlsx 应对齐（或接流式 xlsx writer）。
- **[中] 导出用 OFFSET 分页**（`database_export.rs:493-567`、`csv_export.rs:83-135`）：服务端每页重扫 offset 行；前者另有每表无条件 `SELECT COUNT(*)`（`database_export.rs:482-490`，csv_export 无 COUNT 但同样只有 OFFSET）。`table_export.rs` 已实现 keyset 分页（启用判定 `:195-208`，`keyset_pagination_sql` 定义于 `transfer.rs:1558`），复用即可。
- **[中] Redis 每操作先 `SELECT db`**（`redis_ops.rs` 多处，实现 `redis_driver.rs:418-423`）：db 未变时重复 SELECT 白付一个 RTT；每条连接被一把 `Mutex` 串行化所有操作，而 `MultiplexedConnection` 可 clone + pipeline。集群路径逐 key 删除（`redis_ops.rs:523-531`）可改 UNLINK pipeline。
- **[中] 同步 Tauri 命令在主线程拼接大字符串**（`src-tauri/src/commands/query.rs:483-502` 三个 INSERT/整库导出构建器是同步命令；`commands/csv_export.rs`/`xlsx_export.rs` 让整个结果集作为 JSON 跨 IPC 往返——编码本身已放 `spawn_blocking`，代价在 IPC 序列化与两侧内存拷贝）。重活应走 async + 事件进度（导出/导入/迁移的其余部分已正确这么做）。
- **[低] MongoDB 每页 `count_documents`**（`db/mongo_driver.rs:125-145`，无索引时全扫描）且 find 未设 `batch_size`；ES SQL 无 `fetch_size` 全量缓冲响应（`elasticsearch_driver.rs:768-788`，DSL 路径已正确分页）。
- **[低] 杂项**：`schema.rs:575` 通用 get_table_comment 兜底列出 256 张表找一个注释；`sqlite.rs:506-589` SQL 规范化在每个标识符边界对剩余整个后缀做 to_lowercase（最坏 O(n²)）；`query.rs:111,151` 与 `redis_driver.rs:1205` blob 十六进制编码逐字节 `format!`（应使用 `db/mod.rs:56-64` 的共享 `hex_encode`）；`database_export.rs:354` 文件写入未包 `BufWriter`（Windows/网络盘明显）；`storage.rs:708-773` 启动时逐 secret 逐条查询可合并为一次。

### 前端

以下条目已全部落地（任务 8–13），前端暂无待办：

- ~~[高] DataGrid 编辑路径全量重建~~ → 任务 8 `0c04e91e`
- ~~[中] 重命名对话框每击键一次 IPC + 一次 Shiki 高亮~~ → 任务 9 `1c4ddf74`
- ~~[中] Mongo 文档浏览器 / 数据库搜索 / 数据对比列表未虚拟化~~ → 任务 10 `cb67f918`
- ~~[中] KeepAlive max=4 重建编辑器~~ → 任务 11 `f05d1a88`
- ~~[低] connectionStore 树全量深响应~~ → 任务 13 `0321966c`
- ~~[低] 杂项（导出字符串拼接、QueryEditor 深度 watcher）~~ → 任务 12 `3acbc486`

---

## 已有良好实践（勿重复建设）

审查确认以下方面已到位，新工作应复用这些模式而非另起炉灶：

**前端**
- 虚拟化：网格行 RecycleScroller（canvas 渲染为默认，rAF 批量绘制）、侧栏树扁平化 + RecycleScroller、QueryHistory/ObjectBrowser/Redis 各浏览器均已虚拟化；DOM 网格水平列窗口化（二分偏移）。
- 大数据隔离：`markRaw(result.rows)` 后才入 store/缓存；脏追踪用 per-cell Map 原地改行不克隆。
- 格式化缓存：2 万条原始值缓存 + WeakMap 对象缓存，列/格式器变更才失效。
- 结果缓存：IndexedDB + msgpack 列式快照，内存上限 5，磁盘逐出/恢复。
- 防抖/纪元：侧栏搜索 120ms、网格搜索 150ms、补全元数据 150ms、语义诊断 500ms + run-id 守卫、标签/布局持久化 300ms、AI 流式 ~10fps 且流式期间禁用 Shiki。
- 高亮器为模块级懒加载单例（动态 import），绝不 per-editor 实例化。
- 编辑器失活时暂停后台工作；i18n 除默认语言外全部懒加载；DataGrid 异步导入 + 定向预加载。

**后端**
- 连接池按 (connection, database) 缓存，`KeyedMutex` 防连接惊群，健康检查有界（MySQL ping 3s、刷新扫描 5s 并发）。
- 行数限制 + `CancellationToken` + `tokio::select!` 取消；DuckDB 注册了真实中断句柄；查询超时可配置。
- 阻塞调用正确放 `spawn_blocking`；锁 clone-then-drop，不在 `.await` 上持锁；connections RwLock 等待超 500ms 有告警日志。
- 表导出逐批流式写 + `BufWriter` + 主键可用时 keyset 分页；PG 有 `COPY ... TO STDOUT` 辅助。
- 元数据单查询无后端 N+1、`tokio::join!` 并行 DDL、PG `prepare_cached`、连接断开重试一次。
- 迁移/导入/导出的重活 `tokio::spawn` + 事件进度 + 批间取消检查；存储层 SQLite + `spawn_blocking` 单写者。
- Redis 浏览全用 SCAN（KEYS 仅命令行控制台带确认门）；i64/u64 越界安全转字符串。

---

## 落地流程约定

1. 每项优化独立提交（Conventional Commits，`perf(...)` 前缀），包含问题、修复、行为契约说明。
2. 提交前跑对应全量回归：Rust `cargo fmt --check && cargo test -p dbx-core`；前端 `pnpm test && pnpm typecheck && pnpm lint`；涉及行为契约的新增/更新测试随提交走。
3. 完成后推送 `app-only` 分支，并更新本清单状态。
