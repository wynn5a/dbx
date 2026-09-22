# DBX 提升任务清单（tasks）

> 依据：[optimization-plan.md](optimization-plan.md) + [improvement-plan-2026-09.md](improvement-plan-2026-09.md)
> 来源说明：optimization-plan.md 的 18 项已全部完成、原待办条目已关闭，**无剩余任务**；本清单全部条目拆自 improvement-plan-2026-09.md §2–§6（Track A–E）。optimization-plan.md §落地流程约定 + improvement-plan-2026-09.md §7 作为每个 task 的提交与回归约定。
> 排序规则（按提升程度）：
> 1. **P0** —— 安全漏洞与数据/正确性风险（improvement-plan §1 "Top five" 的顺序）；
> 2. **P1** —— 稳定性与延迟（用户可感知的"闪断/卡顿"）；
> 3. **P2** —— 能力增强与打磨。
> 同级内按用户可感知影响粗排，可按实际情况调换。
> 规模沿用计划文档标注：S ≤ 1 天，M ≈ 1–3 天，L > 3 天。
> 状态：⬜ 待办 / 🔄 进行中 / ✅ 完成（附提交 hash，样式对齐 optimization-plan.md）。

## 拆分说明

- 原文档一个编号 = 一个 Conventional Commit 的粒度基本合适，仅以下几处做了拆分以保证独立验收：C7 → 2 个（T33/T36）、E6 → 2 个（T34/T35）、E7 → 3 个（T23/T40/T41）、E9 → 3 个（T37/T38/T39）。
- B6（结果集 IPC 重写）按原文档 §8 明确暂缓，见文末"暂缓/条件触发"。

## 总览

| # | 任务 | 来源章节 | 规模 | 状态 |
|---|---|---|---|---|
| T01 | 锁死 MCP 桥（鉴权 + 写门控） | improvement-plan §5 D1 | S | ✅ a0849b48 |
| T02 | 查询真实服务端取消 | improvement-plan §2 A1 | M | ✅ d4485b14 |
| T03 | SQL Server 连接池 | improvement-plan §2 A2 | M | ✅ b523ab5a |
| T04 | 网格保存先展示 SQL | improvement-plan §6 E1 | M | ✅ 0dacdb2a |
| T05 | 补全上下文剥离注释 | improvement-plan §4 C1 | M | ✅ fc95f900 |
| T06 | MySQL/SQL Server 标识符引号 | improvement-plan §4 C2 | S | ✅ db20604b |
| T07 | 前后端方言映射统一 | improvement-plan §4 C3 | M | ✅ fccd9dcd |
| T08 | 一次 IPC 取全部 schema 表 | improvement-plan §3 B1 | M | ✅ 879d2673 |
| T09 | 补全缓存按超集缓存 | improvement-plan §3 B2 | M | ✅ 4025a0cc |
| T10 | Redis 自动重连 | improvement-plan §2 A3 | S | ✅ 4c8c98e2 |
| T11 | 健康扫描覆盖全部驱动 | improvement-plan §2 A4 | S | ✅ fe4c270c |
| T12 | Agent 工具查询可取消可见 | improvement-plan §5 D2 | M | ✅ b2e2f9d8 |
| T13 | 启动并行加载 + 加载态 | improvement-plan §3 B3 | S | ✅ 014307e0 |
| T14 | DDL 后失效补全缓存 | improvement-plan §4 C4 | S | ✅ 9b9e361f |
| T15 | 启动无暗色闪烁 | improvement-plan §6 E2 | S | ✅ 73011fe7 |
| T16 | 全局错误处理器 | improvement-plan §6 E3 | S | ✅ 6609cd39 |
| T17 | 可行动的连接错误提示 | improvement-plan §6 E4 | M | ✅ 0bbf6f2d |
| T18 | 连接与 schema 加载可取消 | improvement-plan §6 E5 | M | ✅ 58f1c843 |
| T19 | 高危 SQL 增加确认摩擦 | improvement-plan §5 D3 | S | ✅ 75cfc769 |
| T20 | search_tables 工具 | improvement-plan §5 D4 | S | ✅ adf7a942 |
| T21 | Gemini/Ollama 工具调用 | improvement-plan §5 D5 | M | ⬜ |
| T22 | 置信门控未知列诊断 | improvement-plan §4 C5 | L | ⬜ |
| T23 | 网格 FK 点击跳转 | improvement-plan §6 E7-1 | M | ⬜ |
| T24 | 方言函数目录（CH/DuckDB/Oracle） | improvement-plan §4 C6 | M | ⬜ |
| T25 | Leaflet 按需加载 | improvement-plan §3 B5 | S | ⬜ |
| T26 | PG JSON 列免 parse-再序列化 | improvement-plan §3 B4 | S | ⬜ |
| T27 | SSH 隧道放弃时驱逐连接池 | improvement-plan §2 A5 | S | ⬜ |
| T28 | 原生 DB socket TCP keepalive | improvement-plan §2 A6 | S | ⬜ |
| T29 | idle_timeout 设置诚实化 | improvement-plan §2 A7 | S | ⬜ |
| T30 | 展示 token 用量与成本 | improvement-plan §5 D7 | S | ⬜ |
| T31 | AI 连接失败重试一次 | improvement-plan §5 D6 | S | ⬜ |
| T32 | 聊天结果一键图表 | improvement-plan §5 D8 | S | ⬜ |
| T33 | 关键字大小写跟随输入 | improvement-plan §4 C7-1 | S | ⬜ |
| T34 | 标签页切换快捷键 | improvement-plan §6 E6-1 | S | ⬜ |
| T35 | Format SQL 快捷键 | improvement-plan §6 E6-2 | S | ⬜ |
| T36 | getSqlCompletionResultValidFor 落地 | improvement-plan §4 C7-2 | S | ⬜ |
| T37 | prefers-reduced-motion 支持 | improvement-plan §6 E9-1 | S | ⬜ |
| T38 | 启动阶段 performance.mark | improvement-plan §6 E9-2 | S | ⬜ |
| T39 | QueryEditor 异步组件化 | improvement-plan §6 E9-3 | S | ⬜ |
| T40 | 列固定 + 拖拽排序 | improvement-plan §6 E7-2 | M | ⬜ |
| T41 | 侧栏拖表/列入编辑器 | improvement-plan §6 E7-3 | M | ⬜ |
| T42 | 最终 SQL 结构化输出 | improvement-plan §5 D9 | M | ⬜ |
| T43 | Agent loop 端到端测试 | improvement-plan §5 D10 | M | ⬜ |
| T44 | 命令面板 | improvement-plan §6 E8 | L | ⬜ |
| T45 | AST 驱动的引用提取 | improvement-plan §4 C8 | L | ⬜ |

---

## P0 —— 安全与正确性（最高提升）

### T01 锁死 MCP 桥（鉴权 + 写门控） ✅ a0849b48

- **来源** improvement-plan-2026-09.md §5 D1（Track D）· **规模** S
- **内容** `/data/execute-query`（`mcp_bridge.rs:482-494`）当前无鉴权且忽略 `allow_writes`/`allow_dangerous`。加共享 token 校验（复用 `load_or_create_local_device_secret`，`storage.rs:476`），spawn npm MCP server 时传入；写操作用 `is_read_only_sql` 门控。
- **验收**
  - [x] 新增测试：无 token / 错 token 的请求被拒绝
  - [x] 带 token 只读 SQL 正常返回
  - [x] 写 SQL 且 `allow_writes=false` 被拒、`=true` 放行；dangerous 同理受 `allow_dangerous` 门控
  - [x] npm MCP server 侧拿到 token 后端到端调用成功一次（node-core 集成测试覆盖 npm→桥 HTTP 全链路：token 头 + flags 转发 + 200 返回；桥→DB 段由 Rust socket→SQLite 测试覆盖）
  - [x] `cargo fmt --check && cargo test -p dbx-core`（另：`cargo test -p dbx --lib` 42 过、node-core 45 过、mcp-server 17 过）

### T02 查询真实服务端取消 ✅ d4485b14

- **来源** improvement-plan-2026-09.md §2 A1（Track A）· **规模** M
- **内容** Cancel/超时目前只丢 Rust future（`query.rs:519-576`），语句仍在服务端跑。checkout 时捕获后端 pid/连接 id（PG 用 `cancel_token()` 免额外连接、MySQL `CONNECTION_ID()`、SQL Server `@@SPID`），存入 `RunningQueries`；cancel 与超时路径调用 `process.rs:121-125` 既有的 `pg_cancel_backend` / `KILL QUERY`。
- **验收**
  - [x] env 门控 live-DB 集成测试：`pg_sleep(30)` 查询被取消后 `pg_stat_activity` 不再显示该查询（`tests/live_postgres_query_cancel.rs`，含超时触发路径；Docker 临时 PG16 实测通过）
  - [x] MySQL（`KILL QUERY`）与 SQL Server（`@@SPID`）各一条同型验证（`live_mysql_query_cancel.rs` / `live_sqlserver_query_cancel.rs`，Docker mysql:8 / azure-sql-edge 实测通过；实现细节：MySQL 用 `conn.id()` 免查询获取连接 id，SQL Server 由既有健康检查 `SELECT 1` 改为 `SELECT @@SPID` 零额外往返）
  - [x] 拿不到后端 id 时降级为现状（仅丢弃 future），不阻塞不报错（空 registrar 为 no-op；fire 全程 best-effort + 5s 上界）
  - [x] DuckDB 既有中断路径（`query.rs:626-631`）不回退；全量回归通过（`cargo fmt --check` + dbx-core 797 过 + dbx --lib 42 过 + `pnpm check` 全绿）
- **附带修复**：PG SELECT 走 `BEGIN…DECLARE…FETCH` 游标事务，服务端停止后连接带已中止事务回池，fast recycle 会把脏连接给下一条查询 —— 取消/超时触发服务端停止后丢弃重建 PG 池。

### T03 SQL Server 连接池 ✅ b523ab5a

- **来源** improvement-plan-2026-09.md §2 A2（Track A）· **规模** M
- **内容** `connection.rs:51` 的 `PoolKind::SqlServer(Arc<Mutex<SqlServerClient>>)` 单 socket 单互斥锁，树/补全/所有标签页排在一条慢查询后面。改为 2–3 连接小池（semaphore，`QUERY_POOL_MAX_SIZE = 3` 对齐 PG/MySQL）；`check_conn_health`（`sqlserver.rs:21-39`）失败按 `mysql.rs:1448-1497` 模式透明重拨。
- **验收**
  - [x] 并发测试：两条慢查询并行执行（`tests/live_sqlserver_pool.rs` `live_sqlserver_pool_runs_slow_queries_in_parallel`：同池两条 2s WAITFOR 总耗时 <3s，azure-sql-edge 实测通过）
  - [x] 断连后下一次查询透明恢复；健康检查失败触发重拨而非报错（`live_sqlserver_pool_recovers_after_killed_session`：外部 `KILL` 会话后下一条查询 16ms 内经重拨恢复；`live_sqlserver_pool_schema_load_not_blocked_by_slow_query` 同时佐证慢查询不阻塞树加载）
  - [x] 一条慢查询不再阻塞树加载与补全（树加载在 WAITFOR 运行中 24ms 返回；T02 取消 live 测试回归通过）
  - [x] 全量回归通过（`cargo fmt --check` + dbx-core 798 过 + dbx --lib 42 过）
- **实现说明**：新增 `db::sqlserver::SqlServerPool`（`Semaphore(3)` 限并发 + 空闲列表）与 `SqlServerLease` 租约——借出前 `SELECT @@SPID` 健康检查（3s 上界）失败即丢弃重拨（≤3 次，对齐 MySQL）；租约默认 Drop 即丢 socket（超时/取消中断的连接绝不回池），`keep()`/`poison()` 控制健康回收；行限制 abandoned-wire 与连接错误从"废弃整池"改为"只丢当前连接"。`execute_query_with_max_rows` 去掉内部健康检查与 registrar 参数（SPID 注册移到租约借出处），查询语句往返开销与改造前持平。

### T04 网格保存先展示 SQL ✅ 0dacdb2a

- **来源** improvement-plan-2026-09.md §6 E1（Track E）· **规模** M
- **内容** `useDataGridEditor.ts:766-834` 直接执行准备好的 UPDATE/DELETE，唯一"预览"是 line 825 的 `console.info`。复用编辑器 danger-SQL 对话框展示 `stmts` / `rollbackStmts`，受既有确认设置门控。
- **验收**
  - [x] 保存时弹窗列出将执行的每条语句与对应回滚语句；取消则不执行任何语句
  - [x] 多选/多行删除场景全部语句可见
  - [x] 关闭"保存前确认"设置后行为回到直接保存（无弹窗）
  - [x] `pnpm test && pnpm typecheck && pnpm lint` 通过（另 `pnpm check` 全绿；vitest 160 文件 1109 用例）
- **实现说明**：`useDataGridEditor` 新增 `confirmBeforeSave` 选项（DataGrid 接到既有 `confirmDangerousSqlExecution` 设置），开启时 `saveChanges` 在 prepare 后暂停，经 `showSaveConfirm` / `pendingSaveStatements` / `pendingSaveRollbackStatements` 弹出复用的 `DangerConfirmDialog`，确认（`confirmDataGridSave`）才继续执行；取消/关闭弹窗不执行任何语句、待保存更改保留。弹窗内为"将执行的语句"与"回滚语句"两个编号分区——后端回滚语句顺序与保存语句不一一对应（回滚按 new→deleted→dirty 生成），不做 1:1 配对展示。预览文本由 `dataGridSql.ts` 新增纯函数 `formatDataGridSavePreview` 生成；弹窗带"不再提示"开关，写回同一设置。测试覆盖弹窗展示不执行（含多行删除全部语句）、取消保留待保存、设置关闭直接保存及格式化函数。

### T05 补全上下文剥离注释 ✅ fc95f900

- **来源** improvement-plan-2026-09.md §4 C1（Track C）· **规模** M
- **内容** `getSqlCompletionContext`（`sqlCompletion.ts:1350`）及所有 helper 只剥字符串字面量，不剥 `--` 与 `/* */`，被注释的 SQL 污染 `referencedTables` 与语句类型。入口加一次 `stripSqlComments()`，注释体替换为等长空格保持所有 offset 有效。
- **验收**
  - [x] 新测试：光标在注释内返回中性上下文；注释之后的代码上下文正确；`$$...$$` 体不被误剥
  - [x] 被注释掉的表不再进入表引用/语句类型判断
  - [x] `packages/app-tests/sqlCompletion*.test.ts` 全过，补全性能回归测试不劣化
- **实现说明**：`getSqlCompletionContext` 入口一次 `stripSqlComments()`（私有、offset 保持）：`--` 行注释与 `/* */` 块注释体替换为等长空格（换行保留），分隔符 `--`/`/*`/块结束符保持可见，避免整行注释被当成空行而截断语句块；扫描时跳过 `'…'`/`"…"`/反引号（含 `''` 转义）与 PG dollar-quote（`$$…$$`、`$tag$…$tag$`，tag 首字符须为字母/下划线，`$1` 占位符不受影响）内的注释起始符。光标落在注释内时直接返回与空文档一致的中性上下文。测试加在 `sqlCompletion.context.test.ts`（9 例：行/块注释内中性、注释后代码上下文、跨注释行语句完整、注释表不进引用/语句类型、dollar-quote 体不误剥、字符串内 `--`/`/*` 不误剥、尾注释后引号限定符解析）；`pnpm check` 全绿（vitest 160 文件 1118 用例，含 sqlCompletionPerformance 回归）。

### T06 MySQL/SQL Server 标识符引号 ✅ db20604b

- **来源** improvement-plan-2026-09.md §4 C2（Track C）· **规模** S
- **内容** `quoteSqlIdentifier`（`sqlCompletion.ts:2080`）对非 Postgres 一律不加引号。增加 MySQL 反引号与 SQL Server `[...]` 分支，配各对方言保留字集合。
- **验收**
  - [x] 测试：MySQL 保留字/特殊字符标识符插入反引号；SQL Server 插入 `[...]`；PG 行为不变；普通标识符不加引号
  - [x] 补全插入的标识符在对应方言语法合法
  - [x] sqlCompletion 测试全过
- **实现说明**：`quoteSqlIdentifier` 改为按方言分支——postgres 保持原样（`"…"` + `""` 转义 + 小写正则 + 原关键字集）；新增 mysql 分支（反引号 + 反引号双写转义）与 sqlserver 分支（`[…]` + `]` 双写转义）。各方言配独立的"需要引号"判定：不匹配方言的普通标识符正则（MySQL `^[a-zA-Z_][a-zA-Z0-9_$]*$`、T-SQL `^[a-zA-Z_][a-zA-Z0-9_@$#]*$`）或命中对方言保留字集合（MySQL 8.0 保留字表 / T-SQL 保留关键字表，大小写不敏感比较）时才加引号，非保留字普通标识符在所有方言下仍裸插入。测试加在 `sqlCompletion.test.ts`（7 例：MySQL 保留字/特殊字符/反引号转义的表与列、SQL Server 保留字/特殊字符/`]` 转义的表、两侧普通标识符不引、`user` 一词跨 PG/MySQL/SQL Server 的方言差分契约）；`pnpm check` 全绿（vitest 160 文件 1124 用例）。

### T07 前后端方言映射统一 ✅ fccd9dcd

- **来源** improvement-plan-2026-09.md §4 C3（Track C）· **规模** M
- **内容** `ContentArea.vue:181-186` 把 25+ DatabaseType 映成 `mysql | postgres | sqlserver`（默认 mysql），后端 `normalize_dialect`（`sql_analysis.rs:91-100`）分组不同。暴露或复制后端分组为单一共享映射，前端 union 扩为含 `oracle` / `generic`；DuckDB 专属关键字（`QueryEditor.vue:1947-1964`）改为仅 `databaseType === "duckdb"` 启用。
- **验收**
  - [x] Redshift/GaussDB/openGauss 映射为 PG 族（与后端一致）；Oracle 走 oracle 方言
  - [x] MySQL 连接不出现 DuckDB 关键字，DuckDB 连接仍出现
  - [x] 前端映射 vs 后端分组的一致性单元测试
  - [x] `pnpm check` 通过
- **实现说明**：新增 `lib/sqlDialect.ts`：`SqlDialect` union（mysql/postgres/sqlserver/sqlite/clickhouse/duckdb/oracle/generic）+ `sqlDialectForDatabaseType()` 单一映射表，替换 ContentArea 与 ObjectBrowser 各自的手写映射；后端 `normalize_dialect` 同步扩为同一张表（kingbase/vastbase/kwdb→postgres、goldendb/databend→mysql、rqlite→sqlite、oracle/dameng/oceanbase-oracle/yashandb→oracle；oracle 族仍走 generic 解析——sqlparser 无 Oracle 方言），两侧表格逐别名一致。`QueryEditor` 的 CodeMirror base dialect 按完整 union 选择（新增 SQLite/PLSQL/StandardSQL 分支），DuckDB 关键字包经 `duckdbEditorKeywords(databaseType)` 仅对 duckdb 连接启用；语义诊断分析改传编辑器方言（词表与后端一致，duckdb/clickhouse 连接受益）；`sqlCompletion` 方言 union 扩为 `SqlDialect`（oracle 等新值标识符裸插入，不再误用 MySQL 反引号）。一致性测试双端锁定：`packages/app-tests/sqlDialect.test.ts` 硬编码后端分组表逐项对比前端映射（另覆盖全部 49 个 DatabaseType、generic 回退、DuckDB 关键字门控），Rust 侧 `sql_analysis.rs` 内嵌单测锁同一张表。`pnpm check` 全绿（vitest 161 文件 1129 用例）；`cargo fmt --check` + `cargo test -p dbx-core`（799 过）全绿。

---

## P1 —— 稳定性与延迟

### T08 一次 IPC 取全部 schema 表 ✅ 879d2673

- **来源** improvement-plan-2026-09.md §3 B1（Track B）· **规模** M
- **内容** `connectionStore.ts:2277-2358` 的 `listCompletionTables` / `listCompletionObjects` 逐 schema 发 `listTables`（5 并发扇出）。新增接受 schema 列表的后端命令一次返回分组表（PG `table_schema = ANY($1)`），一次 checkout。
- **验收**
  - [x] 多 schema 库加载补全元数据只产生 1 次 invoke（IPC 日志佐证；前端 store 测试断言 `list_completion_metadata` 恰好 1 次、`list_tables`/`list_completion_objects` 0 次）
  - [x] 返回结果与逐 schema 查询一致（对照测试：SQLite 内存对照走 core 全链路；PG/MySQL env 门控 live 对照 Docker 实测通过）
  - [x] PG/MySQL/SQLite 至少各一条测试；全量回归通过（`cargo fmt --check` + dbx-core 811 过 + `cargo check --workspace --locked` + `pnpm check` 全绿，vitest 162 文件 1133 用例）
- **实现说明**：新增 `list_completion_metadata` 命令（`SchemaCompletionGroup { schema, tables, objects }` 按请求 schema 顺序分组）。PG 用 `n.nspname = ANY($1)`（表/例程两条 SQL，例程保留既有无时间戳回退并套 `filter_completion_objects`）；MySQL 用 `TABLE_SCHEMA IN (...)` + 例程/触发器 IN 查询（信息为空时回退逐 schema 以保留 SHOW 兜底）；SQLite 单条 `sqlite_master` 查询按请求 schema 复制分组；其余引擎（SQL Server/Agent/DuckDB/ClickHouse/外部驱动/Doris/OB-Oracle 等）在这一次 invoke 内循环既有 per-schema 调用。`filter`/`limit` 保持 `list_tables` 逐 schema 语义（含 yashandb 回收站过滤）。前端多 schema 补全加载（表+例程）一次 invoke，结果按 (connection, database) 缓存于 `completionMetadataCache`（进 `invalidateCompletionCache`）；击键过滤/宽松重试在客户端以与后端一致的 contains 语义完成，不再触发新 invoke；显式指定 schema 仍走单次 `list_tables`/`list_completion_objects`；bulk 失败回退逐 schema 调用（一轮取齐表+例程），不回归。附带效果：T09 的"按超集缓存"在此已具雏形（缓存不再随击键增长）。

### T09 补全缓存按超集缓存 ✅ 4025a0cc

- **来源** improvement-plan-2026-09.md §3 B2（Track B）· **规模** M
- **内容** 缓存键含击键过滤（`connectionStore.ts:2269`），`u`/`us`/`use` 三条目三次往返，50 上限被击键冲刷。改为缓存无过滤 (schema, limit) 结果：未截断时客户端过滤排序，截断才回退服务端过滤。
- **验收**
  - [x] 连续键入 `u`/`us`/`use`（未截断）只触发 1 次后端请求
  - [x] 客户端过滤的排序/前缀优先与原服务端过滤一致（对照测试）
  - [x] 缓存条目不再随击键增长；sqlCompletion/store 测试全过
- **实现说明**：T08 只消除了多 schema 路径的 IPC 扇出（`completionMetadataCache` 按 (connection, database) 缓存、击键不再触发新 invoke），但 `completionTablesCache` 的键仍含击键过滤（每键一条目、50 上限被冲刷），且显式 schema 路径与非 schema-aware 引擎（MySQL/SQLite/mongo/es 等）仍按击键服务端过滤逐键 invoke——三条路径本次一并落地：`completionTablesCache` 替换为 `completionTablesSupersetCache`，按 (connection, database, schema, expanded-limit) 缓存无过滤超集（键永不含过滤词；上限取 `expandedCompletionLimit(limit)`，与宽松重试同界，覆盖 limit=200 的编辑器调用与 limit=20 的引用查找）；未截断时 `filterCompletionTablesFromSuperset` 客户端过滤，逐字对齐后端 `filter_table_infos` 语义（大小写不敏感 contains、保持列举顺序、末尾截断、零命中时宽松两字符重试），因此与原服务端过滤字节一致（"前缀优先"排序属编辑器本地索引层 `lookupLocalCompletionTables` 的 `tableMatchScore`，不在 store 对照范围、未改动）；仅"超集被截断 + 有过滤词"（可能存在截断窗外的命中）回退服务端过滤（in-flight 合并、不落缓存），超大 schema 保持 B2 前行为。表索引（`indexCompletionTables`）从每击键移入超集装载，编辑器 `tableNarrowCache` 不再被逐键清空。superset 缓存纳入 `invalidateCompletionCache`。行为差异一处：显式 schema 路径的超集装载失败由"吞错返回空"改为向上抛（全部调用方本就有 catch，行为等效为不出现补全）。测试新增 `packages/app-tests/connectionStoreCompletionSuperset.test.ts` 5 例：显式 schema 与单库引擎的客户端过滤 == 服务端过滤对照（过滤词 × limit × 宽松重试）、`u`/`us`/`use` 每 scope 恰 1 次 `list_tables`、截断回退（4 表 + limit 1）锁回退结果与其 invoke 计数、25 个不同过滤词双计数器不动 + `updateConnection` 失效后恰重取 1 次；T08 既有 4 例不改全过。`pnpm check` 全绿（vitest 163 文件 1138 用例）；未动 Rust。

### T10 Redis 自动重连 ✅ 4c8c98e2

- **来源** improvement-plan-2026-09.md §2 A3（Track A）· **规模** S
- **内容** `redis_driver.rs:98` 包装的 `MultiplexedConnection` 永不重连。内层换 `redis::aio::ConnectionManager`（内置退避），Sentinel 同样处理；cluster 已自带重连保持现状。
- **验收**
  - [x] 测试：Redis 重启后下一命令自动成功，无需用户手动重连（`tests/live_redis_reconnect.rs`，Docker 临时容器实测：重启后同一池第 2 条命令恢复，首条错误即触发重连的契约行为）
  - [x] Sentinel 路径同样自动重连（同型 live 测试，单容器 master+sentinel 实测通过；重连拨向连接时已解析的 master 地址——master 漂移到新地址的 failover 仍需手动重连，代码注释如实标注）；cluster 行为不变（连接池仍是 redis cluster 自愈的 `ClusterConnection`，由 `redis_driver.rs` 源码契约单测锁定，不回退）
  - [x] 全量回归通过（`cargo fmt --check` + dbx-core 837 过 + `cargo check --workspace --locked` 全绿；未动前端）
- **实现说明**：`RedisDirectConnection` 内层 `MultiplexedConnection` → `ConnectionManager`（standalone `connect` 与 Sentinel 复用的 `connect_client` 同换；cluster 每节点一次性连接的 `connect_direct_node` 顺带受益，主 cluster 池不动）。命令签名与既有 `ConnectionLike` 泛型 helper 全部不变；SCAN 的 TYPE pipeline 无 MULTI/EXEC 事务，与 ConnectionManager 兼容。新增行为契约：重连后的新会话回到配置 db，会使既有的"已 SELECT db 跳过"追踪失效——`ConnectionLike` 实现在恰好触发重连的错误上（I/O error / unrecoverable error，普通服务端错误如 WRONGTYPE 不在其列）将追踪 db 置空，下一条浏览命令重发 SELECT，杜绝重连后静默读错 db（live 测试断言 db0/db3 隔离）。开启 redis `connection-manager` feature（新增传递依赖 arc-swap、backon；redis 仍 0.32.7 未升未降）。

### T11 健康扫描覆盖全部驱动 ✅ fe4c270c

- **来源** improvement-plan-2026-09.md §2 A4（Track A）· **规模** S
- **内容** `refresh_connections`（`connection.rs:854-873`）只 ping MySQL/PG，其余走 `_ => Ok(())`。补 SQL Server（`check_conn_health`）与 Redis（`PING`）分支。
- **验收**
  - [x] 单测覆盖新增分支；MySQL/PG 行为不变（`connection.rs` 源码契约单测锁定扫描接线：MySQL 仍 checkout+ping、PG 仍 `SELECT 1`、SqlServer 走 `lease_checked`+`keep()`、Redis 双变体 `PING`、`clone_pool_kind` 与过滤器同集；Redis `ping` 探针以 mock `ConnectionLike` 做 3 例真实单测：PONG 通过 / I/O 错误上抛 / 不可解码回复失败）
  - [x] 断开的 SQL Server/Redis 连接在窗口聚焦触发刷新后显示离线（`tests/live_health_refresh.rs` env 门控 live 测试，Docker azure-sql-edge / redis:7 实测：健康池扫描后原样保留，`docker stop` 后一次 `refresh_connections` 即驱逐池（<1ms），随后 `get_or_create_pool` 失败即 UI 显示离线）
  - [x] 全量回归通过（`cargo fmt --check` + `cargo check --workspace --locked` + dbx-core 842 过（基线 837 + 新增 5）+ dbx --lib 42 过；未动前端）
- **实现说明**：`PoolKind::SqlServer` 本就是 `Arc` 可克隆；`RedisConnection` 两变体改为 `Arc` 包裹（`Direct(Arc<Mutex<…>>)` / `Cluster(Arc<…>)`，行为不变，`redis_ops` 全部调用点零改动）使扫描能在读锁内克隆句柄、释放锁后再探测。SQL Server 分支复用池自身 `lease_checked`（`SELECT @@SPID` 健康检查 + 失效 socket 透明重拨，即既有 `check_conn_health` 语义），健康租约 `keep()` 归还空闲列表——扫描零副作用（不关 socket、不重建整池），仅当服务器真正不可达时租约失败、按既有 5s 每池上界驱逐。Redis 分支新增 `redis_driver::ping`（泛型 `ConnectionLike`，直连保持 T10 的 tracked-db 与重连记账，cluster 走自愈 `ClusterConnection`），失败同样驱逐。两个新 live 测试显式带 env 各跑一次；T10 standalone 重连 live 测试在 Arc 包裹后的 `RedisConnection` 上复跑通过。

### T12 Agent 工具查询可取消可见 ✅ b2e2f9d8

- **来源** improvement-plan-2026-09.md §5 D2（Track D）· **规模** M · **依赖** T02（复用其真实取消基础设施）
- **内容** `agent_tools.rs:271,297,328` 传 `cancel_token = None` 且无 `execution_id`：Chat Cancel 只停流，SQL 跑满 30s。把循环的 cancelled `Notify` 接入 `QueryExecutionOptions` 并注册进 `RunningQueries`（对齐 `commands/query.rs:38-40`）。
- **验收**
  - [x] Chat 取消后 agent 发起的 SQL 端到端停止（配合 T02 服务端取消），不再空跑到超时（env 门控 live 测试 `tests/live_agent_tool_query_cancel.rs` 驱动 agent 工具层执行 `pg_sleep(30)`：run 取消 token 触发后（即 `ai::cancel_stream` 翻转的同一信号）断言错误 promptly 返回且 `pg_stat_activity` 探针消失；Docker 临时 PG16 实测通过。循环 cancelled `Notify` 经 `ai::cancel_stream` 在源头同时翻转该 token，不与 LLM 流的 Notify waiter 竞争单一 permit）
  - [x] agent 查询出现在 RunningQueries 且可被取消（每条工具 SQL 以 `agent-{session}-{tool_call_id}` 注册进 `RunningQueries`；live 测试第 2 阶段走标准 `process::cancel_running_query`（即 `cancel_query` 命令入口）取消成功、探针同样从 `pg_stat_activity` 消失；单测覆盖注册可见/结束后注销）
  - [x] 测试 + 全量回归通过（`cargo fmt --check` + `cargo check --workspace --locked` + dbx-core 848 过（基线 842 + 新增 6）+ T02 既有 PG live 取消测试复跑通过；未动前端）
- **实现说明**：`ai.rs` 新增 per-run `AI_AGENT_CANCELS` 注册表（`register_agent_cancel`），`cancel_stream` 同时翻转流 Notify 与该 token，`unregister_stream` 一并清理；`run_agent_loop` 增收 `tool_cancel: CancellationToken` 传给 `execute_tool_calls`/`run_with_confirmation`（写确认等待 `await_confirmation` 一并改为 select 该 token，签名从 `&Notify` 改为 `&CancellationToken`，轮首取消检查加 `|| tool_cancel.is_cancelled()`）。`agent_tools.rs` 新增 `execute_registered_query`：执行前注册（execution_id 唯一、并发工具调用不冲突），executor 拿注册表 token（等价编辑器路径），并 select run token——取消时翻转查询 token 让 `do_execute` 走既有取消 teardown（PG 连接按 T02 附带修复废弃重建），随后取出 checkout 注册的后端 id 走 T02 `fire_server_cancel`（best-effort、5s 上界）真正停掉服务端语句，最后 `RegisteredQuery` drop 注销；无取消信号时除注册条目外行为与原 `cancel_token = None` 完全一致。三处 SQL 工具（execute_query/get_sample_data/explain_query）全部接入；agent 查询超时路径顺带获得 T02 的服务端停止（execution_id 就位后 `do_execute` 既有逻辑生效）。

### T13 启动并行加载 + 加载态 ✅ 014307e0

- **来源** improvement-plan-2026-09.md §3 B3（Track B）· **规模** S
- **内容** `initFromDisk`（`connectionStore.ts:2872-2889`）串行 await 三个独立 IPC；`WelcomeScreen.vue:171` 在完成前显示"无连接"。改 `Promise.all`，加 `connectionsLoading` 标志让空态等待首载。
- **验收**
  - [x] 启动 3 个调用并行发出，总耗时 ≈ 最慢项（`connectionStoreStartupLoad.test.ts` mock 佐证：三个 IPC 命令在任一未决时全部在途（串行实现会在首个挂起读取上死锁、测试必失败）；另有墙钟上界用例——3×50ms 读取 250ms 内完成，串行需 ≥150ms）
  - [x] 加载期间显示加载态而非"无连接"；加载完成且确为空才显示空态（WelcomeScreen 快捷连接卡与侧栏 ConnectionTree 空态均以 `connectionsLoading` 门控，加载中显示 Loader2 + 新文案 `sidebar.loadingConnections`；非空列表在重载期间保持渲染；store 标志语义有单测锁定——UI 组件无既有挂载测试设施，按任务约定断言 store 标志）
  - [x] 测试通过（`pnpm check` 全绿：vitest 164 文件 1142 用例）
- **实现说明**：三个读取改 `Promise.all` 并发、全部成功后按原顺序提交（`reconcileLayout` 依赖已装载的 connections，`rebuildTreeNodes` 依赖两者）；容错语义与原串行版一致——`loadPinnedTreeNodeIds` 自行 catch IPC，`loadConnections`/`loadSidebarLayout` 失败向上传播（App.vue toast `connection.loadFailed`），任一失败不阻止其余扇出。一处有意收紧：`Promise.all` 下任一读取失败则什么都不提交（原串行版会在 layout 失败后留下 connections 已装载但树未重建的半载状态）；失败时 `connectionsLoading` 在 `finally` 清除。标志初值 `true`（store 创建即加载中），冷启动首帧即加载态、无"无连接"闪现；后续 `initFromDisk` 重载（mcp-reload-connections 等事件）期间同样置位。UI 跟随仓库既有 Loader2 + `animate-spin` + `--ds-*` token 风格，文案六个 locale 全部就位。

### T14 DDL 后失效补全缓存 ✅ 9b9e361f

- **来源** improvement-plan-2026-09.md §4 C4（Track C）· **规模** S
- **内容** `invalidateCompletionCache`（`connectionStore.ts:796`）目前只在断连/更新时调用。编辑器成功执行 `CREATE|ALTER|DROP|TRUNCATE` 后，对该 connection + database 调用它。
- **验收**
  - [x] 执行 CREATE TABLE 后新表立即出现在补全（无需重连/手动刷新）（`sqlDdlCompletionInvalidation.test.ts` 以真实 Pinia store + IPC stub 断言：CREATE 成功后缓存被清、下一次补全请求恰好一次 `list_tables` 重取并返回新表，其余 database 不受影响）
  - [x] 纯 SELECT/DML 不触发缓存失效（SELECT/INSERT/UPDATE/DELETE/TRUNCATE 及 `-- CREATE TABLE` 注释均零重取；执行失败 `success=false` 时完全不进入刷新路径）
  - [x] 测试通过（`pnpm check` 全绿：vitest 165 文件 1146 用例）
- **实现说明**：DDL 判定复用仓库既有分类器 `sqlMetadataRefreshTarget`（`lib/sqlMetadataRefresh.ts`，与侧栏树刷新同源），不自造正则：成功执行的回调（`useSqlExecution` 的 `doExecute`，抽为导出的 `refreshMetadataAfterExecution`）在对象 DDL（CREATE/ALTER/DROP/RENAME …）命中时对该 connection+database 调用 `invalidateCompletionCache`（新从 connectionStore 导出），数据库级 DDL（CREATE/DROP DATABASE/SCHEMA）则失效整个 connection 的缓存。**TRUNCATE 有意不触发**：该分类器（既有测试锁定）把 TRUNCATE 归为数据操作——它不改结构，补全列表（表/列名）依然有效；任务原文中的 TRUNCATE 按仓库现状从宽处理为不失效。注释在匹配前剥离，CTE/子查询无 DDL 关键字头不会命中（字符串字面量内含 "CREATE TABLE" 的极端误判与树刷新现状一致，仅多一次无害重取）。失效是惰性的：下一次补全请求时重取。侧栏树刷新原本就有 DDL 钩子（同一成功分支），本次仅在同分支补上补全缓存失效，未扩大范围。

### T15 启动无暗色闪烁 ✅ 73011fe7

- **来源** improvement-plan-2026-09.md §6 E2（Track E）· **规模** S
- **内容** `index.html` 无主题引导，`applyTheme()` 在 `App.vue:940` onMounted 才跑。加 5 行内联脚本（读同一 localStorage key，首帧前设 root class），并给 `#root:empty` 加 `prefers-color-scheme: dark` 背景。
- **验收**
  - [x] 暗色系统冷启动无白闪（首帧前 class 就位）；亮色/暗色/跟随系统三模式均正确（chrome-headless-shell + CDP 对 `pnpm build` 产物实测：首帧 rAF 探针在首帧绘制前已读到 `html.dark` + `color-scheme: dark`；录得首帧截图——存储 dark / system→dark 的预挂载加载帧为深色 `rgb(19 20 22)`、存储 light 在暗色系统下保持白底、禁用脚本的 no-JS 对照经 media query 回退同样深色）
  - [x] localStorage 键与语义和 `applyTheme()` 一致（`lib/appTheme.ts` 新增 `resolveBootThemeAppearance` 纯函数命名该解析并有单测；`index.html` 内联脚本注释锁定键名/class/归一化/system 解析；`appTheme.test.ts` 从 index.html 抽出真实内联脚本对 DOM stub 执行（三种模式 × 丢失/非法键），并加源码契约测试防漂移：脚本必须在 `<head>` 且先于 app bundle、读 `APP_THEME_STORAGE_KEY`、`html.dark #root:empty` 深色规则存在、`#root` 保持空）
  - [x] 手工截图/录屏佐证 + `pnpm check`（无头浏览器截图见上；`pnpm check` 全绿：vitest 165 文件 1149 用例）
- **实现说明**：`<head>` 内联脚本与 `useTheme.applyTheme` 同契约（同 key `dbx-theme`、同 `html.dark` class、同内联 `color-scheme`、非法/缺失值回退 system、system 走 matchMedia），onMounted 的 `applyTheme()` 仍是主题所有者、重复应用无视觉变化。**附带修复一处既有缺陷**：`#root:empty` 的样式原来写在 `#root` 内部——`:empty` 只匹配无任何子节点的元素，选择器从未命中，预挂载帧实际始终是浏览器白底（即暗色白闪的真正来源），"Loading…" 也从未显示；样式块移入 `<head>` 后加载帧真正生效，并新增三层着色：`html.dark`（引导脚本已解析）→ `@media (prefers-color-scheme: dark)` 无 JS 回退 → `html:not(.dark)` 钉死亮色（防暗系统上的显式 light 被误染）。深色取值对齐 `styles/globals.css` 的 `.dark` token（`--background` / `--muted-foreground` 回退值）。

### T16 全局错误处理器 ✅ 6609cd39

- **来源** improvement-plan-2026-09.md §6 E3（Track E）· **规模** S
- **内容** 全项目无 `app.config.errorHandler` / `onErrorCaptured`。在 `main.ts` 注册一个：写入 debug-log 缓冲 + toast 指向"导出调试日志"。
- **验收**
  - [x] 组件抛错被捕获：出现 toast，堆栈可从导出的调试日志看到（`main.ts` 在 `app.mount` 前注册 `lib/globalErrorHandler.ts`；每个未处理错误格式化为单条日志——组件名 `$options.name`/`__name` 回退、失败钩子 info、含堆栈的错误——经新增 `appendErrorDebugLog` 写入缓冲并立即 flush；toast 走 App.vue 渲染的 `useToast` 单例，文案 `app.unhandledErrorTitle`/`app.unhandledErrorExportHint` 指向 设置 → 编辑器 的"下载日志"；以上均由 `globalErrorHandler.test.ts` 单测 + main.ts 挂载前注册的源码契约测试覆盖）
  - [x] 不吞掉 Vue 默认告警链路（console 仍可见或按设计降级）（设置 errorHandler 后 Vue 不再自行打印，故 handler 内显式 `console.error(message, error)` 保留 console 可见性，debug 开启时同时进入既有 console 捕获；`warnHandler` 未动，dev 告警默认链路不变）
  - [x] 新增用例；既有 debugLog 测试不回退（新增 `globalErrorHandler.test.ts` 7 例：格式化、逐错误记录 + toast 限频（10s 窗口内只弹一次、窗口后恢复）、真实 `installGlobalErrorHandler` 接线（调试日志关闭时仍入缓冲并同步持久化）、main.ts 契约；`debugLog.test.ts` 新增 `appendErrorDebugLog` 关闭态记录 + 立即 flush 一例；`pnpm check` 全绿：vitest 166 文件 1157 用例）
- **实现说明**：错误日志写入不受"启用调试日志"开关限制（错误罕见且缓冲本身有 1500 条上限，保证用户没开开关时也能导出堆栈），并立即 flush 防止随后崩溃丢条目。toast 按 10s 限频，错误本身仍逐条记录/打印，渲染死循环不会刷屏。文案落六个 locale 原本空的 `app:` 段。

### T17 可行动的连接错误提示 ✅ 0bbf6f2d

- **来源** improvement-plan-2026-09.md §6 E4（Track E）· **规模** M
- **内容** `i18n/backend-errors.ts` 只映射 4 种安装器错误。增加跨驱动分类器：refused/timeout → host/port/VPN、auth 关键字 → 凭据、TLS → SSL 设置；原文兜底。
- **验收**
  - [x] 每类至少一条 × 多驱动（PG/MySQL/SQL Server/Redis）样例文本的单测（新增 `connectionErrorHints.test.ts` 12 例：network/auth/tls 三类各覆盖 PG、MySQL、SQL Server、Redis 至少两条真实错误文本——如 PG `Connection refused`、MySQL `ERROR 2003`/`Can't connect`、SQL Server `Error: 10061`/`Login failed`/`Error: 18456`、Redis `NOAUTH`/`WRONGPASS`；另有大小写不敏感、驱动错误码仅在传入驱动时生效（`mssql`/`postgresql` 别名归一）、不可分类透传 null）
  - [x] 无法分类的错误原样展示；新文案 i18n 就位（分类未命中返回 null，title 保持原文且 description 为空；安装器错误翻译链路不变；`connection.errorHintNetwork/errorHintAuth/errorHintTls` 三条文案进六个 locale，测试逐一断言六语言 key 存在且非空）
  - [x] `pnpm check` 通过（format + lint + typecheck + vitest 全绿：167 文件 1168 用例）
- **实现说明**：分类器在 `lib/connectionErrorHints.ts`（无框架依赖），三类按 auth → tls → network 优先级匹配（auth 关键字最具体，refused/timeout 最宽泛）；裸驱动错误码（18456、ERROR 2003/1045/2026、SQLSTATE 28P01）歧义大，仅在调用方能提供 `db_type` 时参与匹配（对话框表单、连接配置处顺带可得）。接线走现有展示链路：`backend-errors.ts` 新增 `presentConnectionError`（toast title + hint description）与 `formatConnectionError`（hint 追加到字符串），App/TreeItem/AppSidebar/AiAssistant 的连接失败 toast 把 hint 放进 DsToast 既有 description 弱色行、对话框测试结果按 Mongo hint 先例追加、侧栏 ConnectionErrorIndicator 气泡在原文下加 hint 块。原文永不替换；连接失败 toast 在所有语言下显式走 error 变体（原 `inferVariant` 对"连接失败"这类非英文文案会误判为 success）。

### T18 连接与 schema 加载可取消 ✅ 58f1c843

- **来源** improvement-plan-2026-09.md §6 E5（Track E）· **规模** M
- **内容** `connect()` 与树加载器只有 `withConnectionAttemptTimeout`。按 attempt 引入 abort/取消令牌，spinner 上加 Cancel 交互（对齐查询取消）。
- **验收**
  - [x] 连接中点 Cancel：attempt 中止、UI 恢复、可立即重试（侧栏树行 loading 时显示 X 取消按钮（`sidebar.cancelLoading`，六 locale）；点击 → `cancelTreeNodeLoading` 立即复位行状态并调 `cancel_connection_attempt`，后端 `connect_db` 的 `tokio::select!` 被 token 中止；`connectionStoreCancel.test.ts` 断言取消后行复位、同一 attempt id 被取消、取消后可立即再次 connect 成功）
  - [x] 不产生半开连接或重复池条目（后端结构保证：池/config 写入收敛到 `commit_connection_pool`——先取两把写锁、两次 insert 之间无 await 点，被中止的 attempt 要么零注册条目、要么完整连接；取消落在 commit 之后时注册表已清理、cancel 返回 false 且保留完整池（下次 connect_db 先 `remove_connection_pools` 重建，无重复条目）；dbx-core `ConnectionAttempts` 单测锁 cancel 翻转 token + 清条目/未知 id no-op/unregister 不取消）
  - [x] 测试通过（`cargo fmt --check` + `cargo test -p dbx-core` 851 过（含 3 条新注册表单测）+ `cargo check --workspace --locked` + `cargo test -p dbx --lib` 42 过；`pnpm check` 全绿：vitest 168 文件 1177 用例，含新增 9 例）
- **实现说明**：后端 `connect_db` 新增 `attempt_id` 参数并注册进 `AppState.connection_attempts`（dbx-core 新 `ConnectionAttempts` 注册表，模式对齐 T02 `RunningQueries` / T12 `AI_AGENT_CANCELS`），新命令 `cancel_connection_attempt` 翻 token 中止 connect future。前端 `connect()` 每 attempt 生成 uuid 传入；前端超时路径同样 fire-and-forget 取消（对齐 queryStore 查询超时取消先例），后端不再无人监听地跑完。树加载取消按任务约定只需丢弃 future（元数据读无服务端语句可杀）：loadDatabases/loadSchemas/loadTables/loadRedisDatabases/loadMongoDatabases/loadMongoCollections/loadSqlServerDatabaseObjects/loadObjectGroupChildren/loadColumns/loadIndexes/loadForeignKeys/loadTriggers 全部接 per-node attempt guard——取消/被新 attempt 取代后 `attemptIsActive` 为 false，迟到结果不写 children、不展开、不记错误（静默）。取消以 `ConnectionAttemptCancelledError` reject `connect()`，ConnectionDialog/App.vue/useFileDrop 对其静默（不弹"连接失败"也不弹"成功"，one_time 连接仍清理）；透明后台重连（ensureConnected/reconnectForMetadata）不传 attempt id，保持现状（不产生半开状态，最多留下完整池）。UI 组件无挂载测试设施，TreeItem 取消按钮与 App/useFileDrop/对话框的静默接线以源码契约测试锁定（同 T15/T16 先例）。

### T19 高危 SQL 增加确认摩擦 ✅ 75cfc769

- **来源** improvement-plan-2026-09.md §5 D3（Track D）· **规模** S
- **内容** Agent 确认卡（`AiAssistant.vue:1170-1178`）对 `dangerous` 与 `low_risk_write` 都是同样一键 Run。对 `dangerous` / `schema_change` 级要求勾选确认或输入目标表名。
- **验收**
  - [x] dangerous/schema_change 未完成额外确认时 Run 不可用；完成后可用（新增纯函数 `requiresAiConfirmFriction` / `isAiConfirmRunEnabled`（`aiSqlExecutionPolicy.ts`，前者恰为 dangerous+schema_change，后者即 Run 可用性门控）；确认卡渲染显式勾选框（`ai.toolConfirm.highRiskAck`，六 locale），未勾选时 Run 按钮 disabled，`confirmTool` 批准路径复查同一函数防程序化绕过；`aiSqlExecutionPolicy.test.ts` 断言两函数在各 category 下的取值 + 源码契约锁定 AiAssistant 接线）
  - [x] low_risk_write 与只读工具交互不变；`aiSqlExecutionPolicy` 分类测试不回退（状态挂在 `PendingToolConfirm.frictionAcknowledged` 上、每张新卡初始化 false，执行/拒绝/取消随 pendingConfirm 整体丢弃，低风险与只读卡片不渲染勾选框、Run 保持一键；既有分类与自动执行测试原样全过）
  - [x] 测试通过（`pnpm check` 全绿：format + lint + typecheck + vitest 168 文件 1182 用例，含新增 4 例——friction 仅限 dangerous/schema_change、Run 可用性映射、friction 取自确认卡同一 decision、AiAssistant 接线与六 locale 文案源码契约）
- **实现说明**：摩擦形式选勾选确认框（简单可靠，纯前端）。判定与门控抽为 `aiSqlExecutionPolicy.ts` 纯函数供测试；`AiAssistant.vue` 的 `PendingToolConfirm` 增加 `frictionAcknowledged` 字段，`tool_confirm_request` 每次置 false（状态独立、随卡复位），勾选框仅在 `requiresAiConfirmFriction(category)` 为真时渲染，Run 按钮绑定 `isAiConfirmRunEnabled`。后端确认 API 与风险分类逻辑零改动。UI 组件无挂载测试设施，接线以源码契约测试锁定（同 T15/T16 先例）。

### T20 search_tables 工具 ✅ adf7a942

- **来源** improvement-plan-2026-09.md §5 D4（Track D）· **规模** S
- **内容** schema 上下文只是 listing 顺序前 50 张表（`ai.ts:375, 413-455`）+ truncated 标志。新增按表名/注释子串搜索的工具，agent 在数千表 schema 里可自助定位。
- **验收**
  - [x] 测试：数千表 schema 下 agent 通过搜索定位目标表并继续查询（工具层两步模拟：2 500 表 SQLite 实库上先断言 capped `list_tables` 确实看不到排在末尾的目标表，再 `search_tables` 命中、随后 `execute_query` 对该表 COUNT 成功；另有纯函数层 5 000 表 mock 清单的大小写不敏感命中测试）
  - [x] 命中上限时返回 truncated 标记（命中数超过 limit 时尾部追加 `... (truncated ...)` 行；纯函数返回 `truncated` 布尔并被单测锁定，超限/未超限两侧都有断言）
  - [x] 工具注册与描述进入 agent 工具清单测试（`search_tables` 进 Ask 模式与 Agent 模式（SQL/非 SQL 引擎）清单断言，描述含 case-insensitive/comment、`read_only=true`、`parallel_ok=true`、`required=["search"]` 逐一锁定）
- **实现说明**：`agent_tools.rs` 新增 `search_tables`（`search` 必填、`schema` 可选默认当前 database、`limit` 可选默认 50 上限 100 复用 `requested_limit`）。行为：对目标 schema 取**无 filter/limit 的完整表清单**（复用 `list_tables_core`，不新写 SQL——截断的 listing 会漏掉命中，违背工具初衷），对表名+注释做大小写不敏感子串匹配（匹配与渲染拆成纯函数便于 mock 测试），按 listing 顺序输出 `- 表名 (类型) -- 注释` 行；schema-aware 引擎输出 `schema.table` 限定名（`is_schema_aware` 判定，与 `build_table_select_sql` 一致），扁平命名空间引擎（MySQL/SQLite）输出裸表名；零命中显式输出 `(no tables matching …)`。注册进 `read_only_tools`/`all_tools`（紧随 `list_tables`），只读、parallel_ok——自动执行、不经写确认卡（确认卡仅对 `execute_query` 非 read-only SQL 触发，前端零接线改动）；Agent 模式提示词的工具清单行补入 search_tables 并附一句"列表找不到就搜索"的指引。schema 限定用 DuckDB 内存库三 schema 实测（analytics/sales 显式限定互斥、默认 scope 只见 main）。

### T21 Gemini/Ollama 工具调用 ⬜

- **来源** improvement-plan-2026-09.md §5 D5（Track D）· **规模** M
- **内容** `provider_supports_function_calling`（`ai.rs:1146-1156`）对两者硬编码 `false`；`ToolDefinition::to_gemini_tool()`（`agent_events.rs:125`）是死代码。实现 Gemini `functionCall`/`functionResponse` 轮次；Ollama 按模型 opt-in。
- **验收**
  - [ ] mock SSE 多轮工具交换测试通过（Gemini provider）
  - [ ] 不支持工具的 Ollama 模型行为不变；opt-in 模型走工具循环
  - [ ] 全量回归通过

### T22 置信门控未知列诊断 ⬜

- **来源** improvement-plan-2026-09.md §4 C5（Track C）· **规模** L
- **内容** unknown-column 诊断被有意禁用（`QueryEditor.vue:818-822`，schema 缓存不全防误报）。仅当表可无歧义解析且全列已加载时启用，复用 `sql_analysis.rs` 的 spans。
- **验收**
  - [ ] 明确拼错的列名被标出
  - [ ] 歧义表名/部分缓存场景零误报（测试锁定）
  - [ ] 遵循既有 500ms 防抖 + run-id 守卫模式；`pnpm check` 通过

---

## P2 —— 能力增强与打磨

### T23 网格 FK 点击跳转 ⬜

- **来源** improvement-plan-2026-09.md §6 E7 第 1 项（Track E）· **规模** M
- **内容** FK 元数据已取（`DataGrid.vue:5571`），`useNavigationTargets.ts:18` 已接受 `whereInput`，只差一个 click handler。
- **验收**
  - [ ] 点击 FK 单元格跳到目标表并定位到对应行
  - [ ] 无 FK 元数据的列不可点、无误导
  - [ ] 测试 + 手工验证

### T24 方言函数目录（ClickHouse/DuckDB/Oracle） ⬜

- **来源** improvement-plan-2026-09.md §4 C6（Track C，计划指定的优先三方言）· **规模** M
- **内容** `DATABASE_FUNCTION_SIGNATURES`（`sqlCompletion.ts:848`）只覆盖 5/25+ 引擎。先补 ClickHouse、DuckDB、Oracle；存储过程参数提示（`information_schema.parameters`/`pg_proc`）留待后续。
- **验收**
  - [ ] 三方言函数名+签名补全生效；其他方言清单不变
  - [ ] 测试通过

### T25 Leaflet 按需加载 ⬜

- **来源** improvement-plan-2026-09.md §3 B5（Track B）· **规模** S
- **内容** `DataGrid.vue:133` 静态 import `geometryMapPreview` → 静态引入 Leaflet 对话框。改为 `execute()` 内动态 import。
- **验收**
  - [ ] 初始 chunk 不含 Leaflet（构建产物体积对比，数字记录）
  - [ ] 有几何列时地图预览功能正常
  - [ ] 构建 + 手工验证

### T26 PG JSON 列免 parse-再序列化 ⬜

- **来源** improvement-plan-2026-09.md §3 B4（Track B）· **规模** S
- **内容** `postgres.rs:709-716` 读成 `serde_json::Value` 再 `.to_string()`。先按 `String` 读，`Value` 仅作回退。
- **验收**
  - [ ] json/jsonb 读取路径无 parse→serialize 往返（代码断言或微基准对照）
  - [ ] 输出与原先逐字节一致（对照测试）

### T27 SSH 隧道放弃时驱逐连接池 ⬜

- **来源** improvement-plan-2026-09.md §2 A5（Track A）· **规模** S
- **内容** `ssh_tunnel.rs:223-228` 10 次尝试后只记日志返回，上层 DB 池仍缓存并持续报 "connection refused"。放弃时调 `discard_pool` 并发一次事件，前端提示隧道断开。
- **验收**
  - [ ] 放弃后旧池不再缓存；后续操作得到明确错误而非 refused
  - [ ] 前端收到事件并展示提示；测试通过

### T28 原生 DB socket TCP keepalive ⬜

- **来源** improvement-plan-2026-09.md §2 A6（Track A）· **规模** S
- **内容** 目前只有 SSH 会话有 keepalive（`ssh_tunnel.rs:51`）。PG/MySQL/SQL Server 原生连接在 connect 时设 `SO_KEEPALIVE`。
- **验收**
  - [ ] 三驱动连接均带 keepalive 选项（代码/单测断言）
  - [ ] 半开连接（手工断网）不挂死，能被探测或报错恢复

### T29 idle_timeout 设置诚实化 ⬜

- **来源** improvement-plan-2026-09.md §2 A7（Track A）· **规模** S
- **内容** `idle_timeout_secs` 只到 Mongo（`connection.rs:451`）；PG（`postgres.rs:1119`）与 MySQL（`mysql.rs:371` 硬编码 300s）忽略。按原文档"懒方案"：对不生效的引擎隐藏该控件。
- **验收**
  - [ ] PG/MySQL 连接表单不再出现可调但无效的 idle_timeout 控件
  - [ ] Mongo 行为不变；i18n 文案与测试就位

### T30 展示 token 用量与成本 ⬜

- **来源** improvement-plan-2026-09.md §5 D7（Track D）· **规模** S
- **内容** `AgentEvent::AgentEnd` 带真实 usage（`agent_loop.rs:244`），前端丢弃（`AiAssistant.vue:795` `case "agent_end": break`）。持久化到消息并渲染尾部，可选静态价格表算成本。
- **验收**
  - [ ] 回答尾部显示 token 用量；历史消息中保留
  - [ ] 无 usage 的 provider 显示为空不报错；测试通过

### T31 AI 连接失败重试一次 ⬜

- **来源** improvement-plan-2026-09.md §5 D6（Track D）· **规模** S
- **内容** `ai.rs` / `agent_loop.rs` 零重试。初始请求对 429 / 5xx / 连接错误退避重试一次，流式中途绝不重试。
- **验收**
  - [ ] 单测：mock 首响应 429/5xx → 重试成功；流中断不重试
  - [ ] 全量回归通过

### T32 聊天结果一键图表 ⬜

- **来源** improvement-plan-2026-09.md §5 D8（Track D）· **规模** S
- **内容** `QueryChart.vue` 已存在，无入口把工具结果接进去。在结果卡加一个"生成图表"动作，不写新图表代码。
- **验收**
  - [ ] 查询结果卡可打开图表并正确渲染
  - [ ] 无新增图表组件/依赖；手工验证

### T33 关键字大小写跟随输入 ⬜

- **来源** improvement-plan-2026-09.md §4 C7 第 1 项（Track C）· **规模** S
- **内容** 补全关键字硬编码大写。改为跟随输入前缀大小写（或加设置项）。
- **验收**
  - [ ] 小写前缀得到小写补全（或设置生效并有默认值）
  - [ ] 测试通过

### T34 标签页切换快捷键 ⬜

- **来源** improvement-plan-2026-09.md §6 E6 第 1 项（Track E）· **规模** S
- **内容** `shortcutRegistry.ts` 缺 next/prev tab 与 `Cmd+1-9`。注册进 registry。
- **验收**
  - [ ] 快捷键生效且在快捷键面板可见
  - [ ] 与既有绑定无冲突（清单断言/测试）

### T35 Format SQL 快捷键 ⬜

- **来源** improvement-plan-2026-09.md §6 E6 第 2 项（Track E）· **规模** S
- **内容** `formatActiveSql` 仅工具栏可达。注册快捷键。
- **验收**
  - [ ] 编辑器内快捷键触发格式化；registry 可见；测试通过

### T36 getSqlCompletionResultValidFor 落地 ⬜

- **来源** improvement-plan-2026-09.md §4 C7 第 2 项（Track C）· **规模** S
- **内容** `getSqlCompletionResultValidFor`（`sqlCompletion.ts:1249`）是返回 `undefined` 的 stub。实现前缀 regex，或以结论性注释说明为何不需要。
- **验收**
  - [ ] 二选一落地：有实现 + 测试，或有写明理由的注释
  - [ ] 相应行为有测试锁定

### T37 prefers-reduced-motion 支持 ⬜

- **来源** improvement-plan-2026-09.md §6 E9 第 1 项（Track E）· **规模** S
- **内容** `styles/` 下该 media query 零命中。全局支持减弱动态效果。
- **验收**
  - [ ] 系统开启后关键过渡/动画禁用（CSS 清单覆盖主要动效）
  - [ ] 手工验证 + `pnpm check`

### T38 启动阶段 performance.mark ⬜

- **来源** improvement-plan-2026-09.md §6 E9 第 2 项（Track E）· **规模** S
- **内容** 现状是散落的 `console.log(performance.now())`。启动各阶段打 `performance.mark` 并写入 debug log。
- **验收**
  - [ ] 导出的调试日志含各启动阶段耗时标记
  - [ ] 无残留 ad-hoc console 计时

### T39 QueryEditor 异步组件化 ⬜

- **来源** improvement-plan-2026-09.md §6 E9 第 3 项（Track E）· **规模** S
- **内容** CodeMirror 经 `App.vue → ContentArea.vue → QueryEditor.vue:17` 启动即加载。`QueryEditor` 包 `defineAsyncComponent`（对齐 DataGrid 模式）。
- **验收**
  - [ ] 纯浏览会话首屏 chunk 不含 CodeMirror（构建产物对比记录）
  - [ ] 编辑器打开与功能不回退

### T40 列固定 + 拖拽排序 ⬜

- **来源** improvement-plan-2026-09.md §6 E7 第 2 项（Track E）· **规模** M
- **内容** `useDataGridColumnResize` 只管 resize。增加列 pin/freeze 与拖拽重排。
- **验收**
  - [ ] 列可固定与拖拽排序；横向大范围滚动下固定列不漂移
  - [ ] 布局随标签页持久化；测试通过

### T41 侧栏拖表/列入编辑器 ⬜

- **来源** improvement-plan-2026-09.md §6 E7 第 3 项（Track E）· **规模** M
- **内容** `sidebar/` 无任何 `dragstart`。实现拖表名/列名入编辑器插入（按方言引号规则，与 T06 一致）。
- **验收**
  - [ ] 拖表/列到编辑器光标处插入，引号规则与补全一致
  - [ ] 不破坏现有拖放与编辑行为；测试通过

### T42 最终 SQL 结构化输出 ⬜

- **来源** improvement-plan-2026-09.md §5 D9（Track D）· **规模** M
- **内容** 最终 SQL 靠提示词约定"首个 ```sql 块"（`ai.ts:278`）+ fence 扫描解析。在支持的 provider 上改 JSON schema / 工具形态结构化输出；保留 fence 回退。
- **验收**
  - [ ] 支持 provider 走结构化输出（mock 测试）
  - [ ] 不支持 provider 回退路径不回退；测试通过

### T43 Agent loop 端到端测试 ⬜

- **来源** improvement-plan-2026-09.md §5 D10（Track D）· **规模** M
- **内容** 单测只覆盖 helper，没有跨多轮工具交换驱动 `run_agent_loop` 的测试。加一个用微型 hyper 测试服务器（hyper 已传递依赖则零新增 crate，否则 wiremock）。
- **验收**
  - [ ] 测试覆盖至少两轮工具调用 + 最终回答
  - [ ] 无新增重量级依赖（如新增需记录理由）；CI 内通过

### T44 命令面板 ⬜

- **来源** improvement-plan-2026-09.md §6 E8（Track E）· **规模** L · **依赖** T34/T35（动作注册表就位后建设）
- **内容** 全局命令面板：快捷键唤起，注册 transfer / diff / compare / driver store / SQL library 等动作，可搜索执行。
- **验收**
  - [ ] 快捷键唤起、键入过滤、回车执行
  - [ ] 动作注册表可扩展（新动作一行注册）；测试通过

### T45 AST 驱动的引用提取 ⬜

- **来源** improvement-plan-2026-09.md §4 C8（Track C）· **规模** L
- **内容** 用既有 Rust `analyze_sql_references`（异步 + 按语句文本缓存）替换 `extractReferencedTables` / `extractCteDefinitions` / `extractSubqueryReferences`；正则仅保留"当前关键字上下文"判断。
- **验收**
  - [ ] 既有补全回归全过；新增正则易错边界用例（嵌套子查询、注释内、`$$` 体）对比通过
  - [ ] 性能不劣化（既有 2500 表性能测试）
  - [ ] 双解析器重复逻辑删除

---

## 暂缓 / 条件触发

- **结果集 IPC 路径重写**（improvement-plan-2026-09.md §3 B6，L）：分页链路已通。仅当 T08–T13（B1–B5）落地后 profiling 仍显示首页卡顿，才用 `tauri::ipc::Channel` 立项。
- Track A 各任务的 live-DB 集成测试统一走 env 门控特性开关（improvement-plan §7 约定）。

## 执行约定（每个 task 通用）

1. 每 task 独立提交，Conventional Commits（`fix(...)`/`feat(...)`/`perf(...)`），提交信息含问题、修复、行为契约说明——对齐 optimization-plan.md §落地流程约定。
2. 回归门禁：Rust `cargo fmt --check && cargo test -p dbx-core`；前端 `pnpm test && pnpm typecheck && pnpm lint`（`pnpm check`）。
3. Track C 任务随提交更新 `packages/app-tests/sqlCompletion*.test.ts`；Track A 任务加 env 门控 live-DB 测试（improvement-plan-2026-09.md §7）。
4. 完成后推送 `app-only` 分支，并更新本清单状态（⬜→✅ + 提交 hash）。
