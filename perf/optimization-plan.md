# DBX 性能优化计划

> 状态：持续更新。已完成项随提交落地并推送至 `app-only` 分支，每项均附带测试与回归验证。
> 相关文档：[DOM 密度审计](dom-density-audit.md)、[2026-09 改进计划](improvement-plan-2026-09.md)（连接稳定性 / 延迟 / 补全 / AI / UX）。

## 背景

本计划源自 2026-09 的一次全量性能审查，覆盖两条线：

- **Rust 后端**（`crates/dbx-core` + `src-tauri`）：查询执行路径、连接管理、Tauri 命令层、导出/导入/迁移、Agent 驱动运行时。
- **Vue 前端**（`apps/desktop/src`）：数据网格、Pinia store、CodeMirror 编辑器、IPC 调用、缓存层。

先说结论：代码库已做了大量正确的性能工程（见文末"已有良好实践"），以下条目是审查后剩余的真实热点，按影响排序逐项落地。

---

## 已完成 ✅

以下 18 项已全部实施、测试、提交并推送（分支 `app-only`）。

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

### 14. PG 连接池扩容 + search_path 事务内作用域 + Fast 回收 `2279655a`

**问题** 单库 PG 池 `max_size(1)`（`db/postgres.rs`）：所有查询、元数据与长事务在一条物理连接上排队；schema 查询每次 `SET`+`RESET` search_path（+2 RTT）；`RecyclingMethod::Verified` 每次 checkout 付一次校验往返。会话时区只在首条连接上 `SET` 一次。

**修复** 池扩到 3（与 MySQL 查询池一致；交互式多语句事务本就经 `execute_statements_in_transaction` 钉住专用连接）。会话时区移入启动包 `options`（`-c timezone=...`），每条新建连接天然生效、零 RTT，值域收敛到 IANA 字符集防启动包被拆词。SELECT 路径 schema 作用域改为游标事务内 `SET LOCAL search_path`，与 `BEGIN`/`DECLARE` 合并为一次 batch（每查询净省 2 RTT，ROLLBACK 自动还原）；DML 保持会话级 SET/RESET 括号。`Verified` → `Fast`：空闲期被杀的连接改由查询路径透明重试一次吸收（SELECT 对任意非 DB 错误重试、DML 仅对语句未上线的 `is_closed` 重试），语义不劣于原预校验。

### 15. Redis：跳过未变化的会话 db SELECT `b634a11c`

**问题** 每个浏览操作先 `SELECT db`——固定浏览同一 db 时白付一个 RTT（`redis_ops.rs` 约 20 处调用点）。

**修复** 直连/Sentinel 连接包装为 `RedisDirectConnection`（实现 `ConnectionLike` 委托全部命令，调用点零改动），跟踪当前会话 db：初始值取 URL `/db` 路径（Sentinel 恒 0），`select_db` 仅在变化时发送。控制台可执行用户输入的 SELECT，直连路径改用 `execute_command_tracked` 成功后回写跟踪值（参数不可解析则置未知强制重 SELECT）；断线重建时随新连接重新初始化。集群逐 key 删除保持不变——redis-rs 0.32 pipeline 强制单槽（跨槽报 `CrossSlot`），现状即正确写法。

### 16. Tauri 同步导出构建器移出主线程 `afadbc0e`

**问题** `build_export_insert_statements` / `build_export_sql_insert` / `build_database_sql_export` 是同步命令，主线程逐行生成 INSERT/整库 SQL，大表导出期间 UI 冻结。

**修复** 三个命令改 async + `spawn_blocking`，命令名与契约不变、前端零改动。csv/xlsx 导出命令此前已是 async + spawn_blocking；其结果集 JSON 经 IPC 往返的成本属前端主导的导出架构（前端发起、前端写盘），保持现状。

### 17. MongoDB：无过滤页计数走元数据 + 批次对齐 `243815c6`

**问题** 文档浏览每页 `count_documents`——无过滤时全表扫描，大集合每次翻页全量计数；find/aggregate 未设 `batch_size`，首页默认小批次再多次 getMore。

**修复** 无过滤改 `estimated_document_count`（元数据 O(1)，分页总数近似可接受）；带过滤仍精确计数。find 的 batch_size 对齐页大小、aggregate 对齐 fetch_limit。ES SQL 经核实无需处理：响应本就按 cursor 分页（默认 fetch_size=1000，解析层已处理 has_more），不存在全量缓冲。

### 18. 杂项：线性 sqlite 规范化、共享 hex、缓冲导出、一次载入 secrets `ac716fec`

sqlite SQL 规范化去掉每个标识符边界对剩余后缀的 collect+lowercase（O(n²)→线性，仅比较别名窗口）；DuckDB blob 十六进制改共享 `db::hex_encode`、Redis `\x` 转义改 `write!` 原地追加（消除逐字节堆分配）；整库 SQL 导出文件写入包 `BufWriter` + 显式 flush；`load_connections` 启动时一次查询载入全部 secrets（原为每连接每密钥一查）。`schema.rs` get_table_comment 通用回退维持现状：list_tables 已按表名过滤 + 256 上限兜底。

---

## 待办 📋

截至 2026-09-19，原待办条目已全部落地或经核实关闭（结论并入已完成条目 14–18）。经调查后**有意不做**的记录：

- **MySQL `set_fetch_size` 服务端截断**：不可行。项目所用 mysql_async fork（t8y2 rev 7b565fb，上游 0.37 同）无 `set_fetch_size`/COM_STMT_FETCH 服务端游标 API；且 MySQL 只读游标在服务端整体物化结果集，对大表是比"提前断流 + 重建池"（`a7bc2c3f` 已落地）更差的服务端副作用。行数限制维持现状。
- **Redis 集群逐 key 删除改 pipeline**：redis-rs 0.32 的集群 pipeline 强制单槽（跨槽 `CrossSlot` 错误），逐 key 循环即正确写法（并入条目 15）。
- **csv/xlsx 导出结果集 IPC 往返**：编码已在 spawn_blocking，序列化/拷贝成本根植于前端发起-前端写盘的导出架构；若要消除需后端托管导出全流程（连接、查询、写盘、进度），改动面大，暂不立项。

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
