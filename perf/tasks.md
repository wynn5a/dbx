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
| T21 | Gemini/Ollama 工具调用 | improvement-plan §5 D5 | M | ✅ ed844722 |
| T22 | 置信门控未知列诊断 | improvement-plan §4 C5 | L | ✅ 4d08758a |
| T23 | 网格 FK 点击跳转 | improvement-plan §6 E7-1 | M | ✅ 37fc558b |
| T24 | 方言函数目录（CH/DuckDB/Oracle） | improvement-plan §4 C6 | M | ✅ 9a8178b2 |
| T25 | Leaflet 按需加载 | improvement-plan §3 B5 | S | ✅ b963ea14 |
| T26 | PG JSON 列免 parse-再序列化 | improvement-plan §3 B4 | S | ✅ 057fa533 |
| T27 | SSH 隧道放弃时驱逐连接池 | improvement-plan §2 A5 | S | ✅ 43e5c824 |
| T28 | 原生 DB socket TCP keepalive | improvement-plan §2 A6 | S | ✅ 7ffeb3ad |
| T29 | idle_timeout 设置诚实化 | improvement-plan §2 A7 | S | ✅ ed3c4bae |
| T30 | 展示 token 用量与成本 | improvement-plan §5 D7 | S | ✅ 96fbac3b |
| T31 | AI 连接失败重试一次 | improvement-plan §5 D6 | S | ✅ b051862a |
| T32 | 聊天结果一键图表 | improvement-plan §5 D8 | S | ✅ b7ad137e |
| T33 | 关键字大小写跟随输入 | improvement-plan §4 C7-1 | S | ✅ b4588cba |
| T34 | 标签页切换快捷键 | improvement-plan §6 E6-1 | S | ✅ e66e03dc |
| T35 | Format SQL 快捷键 | improvement-plan §6 E6-2 | S | ✅ fa0e42a8 |
| T36 | getSqlCompletionResultValidFor 落地 | improvement-plan §4 C7-2 | S | ✅ ad03e069 |
| T37 | prefers-reduced-motion 支持 | improvement-plan §6 E9-1 | S | ✅ a92296bb |
| T38 | 启动阶段 performance.mark | improvement-plan §6 E9-2 | S | ✅ f158bc2b |
| T39 | QueryEditor 异步组件化 | improvement-plan §6 E9-3 | S | ✅ cfb367b9 |
| T40 | 列固定 + 拖拽排序 | improvement-plan §6 E7-2 | M | ✅ 958f01b6 |
| T41 | 侧栏拖表/列入编辑器 | improvement-plan §6 E7-3 | M | ✅ 8cf4f39f |
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

### T21 Gemini/Ollama 工具调用 ✅ ed844722

- **来源** improvement-plan-2026-09.md §5 D5（Track D）· **规模** M
- **内容** `provider_supports_function_calling`（`ai.rs:1146-1156`）对两者硬编码 `false`；`ToolDefinition::to_gemini_tool()`（`agent_events.rs:125`）是死代码。实现 Gemini `functionCall`/`functionResponse` 轮次；Ollama 按模型 opt-in。
- **验收**
  - [x] mock SSE 多轮工具交换测试通过（Gemini provider）（新 `tests/ai_tool_stream.rs` 用 loopback mock HTTP server 真实驱动 `stream_with_tools` 两轮：turn 1 SSE 流出文本 + 完整 `functionCall` part → 断言解析出的 ToolCall（name/args/合成的 call_0 id）与 usageMetadata 计数；按 agent loop 的消息管线回放 assistant tool_calls + tool 结果；turn 2 断言请求体 contents 含 model 的 `functionCall` part 与 user 的 `functionResponse` part（name + response.result），最终文本流出）
  - [x] 不支持工具的 Ollama 模型行为不变；opt-in 模型走工具循环（opt-in 判定：每次 agent run 对模型 native `/api/show` 探测一次，capabilities 含 `tools` 才进工具循环；探测失败/无该端点/无 tools 一律回退文本模式。测试锁定：opt-in 模型先打 `/api/show`（body `{model}`）→ chat 请求体含 `tools`+`tool_choice`、tool_calls 流解析、assistant/tool 消息按 OpenAI 形状回放；非 opt-in 模型 `provider_supports_function_calling=false` 且文本模式 chat 请求体无 `tools`/`tool_choice`、逐字段等于既有形状；404 探测保持回退。纯函数层另有 `/api/show` URL 从各 endpoint 拼写推导的单测）
  - [x] 全量回归通过（`cargo fmt --check` + `cargo test -p dbx-core`：839 lib + 4 新集成 + 既有套件 0 失败；`cargo check --workspace --locked` 干净）
- **实现说明**：两 provider 都并入既有 `stream_with_tools` 链路（`ai.rs`），复用 `StreamingToolCallAccumulator` 与 agent loop 的多轮管线，与 OpenAI/Claude 同一转换点。**Gemini**：请求体 `tools: [{ functionDeclarations: [...] }]`（`to_gemini_tool()` 即 declaration 条目，参数 schema 本就是 Gemini 接受的 OpenAPI 子集），function-calling mode 用 API 默认 AUTO，POST `:streamGenerateContent?alt=sse`；流解析把 `candidates[0].content.parts[]` 的 text part 流为文本 delta、`functionCall` part（完整到达、无参数分片）走 start+delta+complete 进 accumulator，`usageMetadata` 给 best-effort token 数；回传用 `gemini_contents_with_tools` 把 assistant tool_calls 转成 model 的 `functionCall` parts、tool 结果转成 `functionResponse` part（`{name, response:{result}}`）并归并到单个 user turn——Gemini 无 call id，function 名从最近一条声明该 id 的 assistant 轮解析。**Ollama**：走本仓库已有的 OpenAI 兼容 `/v1/chat/completions` 路径（其 `tools`/`tool_calls` JSON 与 `/api/chat` 同形，不新增 native 端点/解析器）；opt-in 选 `/api/show` 能力探测而非模型名清单/环境变量——`AiConfig` 无 per-model 能力字段，名字清单随 Ollama 发版过时，探测每次 run 一次、失败即安全回退，非 opt-in 流量与改动前逐字节一致。`provider_supports_function_calling` 变 async（唯一调用方 `agent_loop.rs`）；工具执行、写确认门控、事件发射零改动。

### T22 置信门控未知列诊断 ✅ 4d08758a

- **来源** improvement-plan-2026-09.md §4 C5（Track C）· **规模** L
- **内容** unknown-column 诊断被有意禁用（`QueryEditor.vue:818-822`，schema 缓存不全防误报）。仅当表可无歧义解析且全列已加载时启用，复用 `sql_analysis.rs` 的 spans。
- **验收**
  - [x] 明确拼错的列名被标出（`select usr_nme from users` 在 `users` 全列已加载且唯一解析时，对 `usr_nme` span 出 amber 波浪线警告，消息走 `editor.diagnostics.unknownColumn` 六语言；门控纯函数测试锁定）
  - [x] 歧义表名/部分缓存场景零误报（测试锁定：同名多 schema → ambiguous、列缓存缺失/为空 → unresolved、CTE 同名遮蔽、SELECT 别名（ORDER BY alias 合法）、表别名列清单（`UNNEST(...) AS u(tag)`/`g(n)`）、join 多表非限定列不可归属、qualifier 匹配 0/2 个引用——任一不满足整批丢弃）
  - [x] 遵循既有 500ms 防抖 + run-id 守卫模式（源码契约测试锁定 `scheduleSemanticDiagnostics(delay = 500)` 与两次 await 后各查一次 `semanticDiagnosticRunId`）；`pnpm check` 通过（format + lint + typecheck + vitest 169 文件 1204 测试）
- **实现说明**：门控为**全局门**——本次 analyze 通过的所有置信检查缺一即整批不出 unknown-column 诊断（parser-error 诊断路径不受影响）。前端新增 `lib/sqlUnknownColumns.ts`：同步纯函数 `gateUnknownColumnDiagnostics`（穷举单测）+ 异步 `buildUnknownColumnDiagnostics`（按引用去重解析、resolver 异常按 unresolved 处理）。解析器用**不过滤不限量**的表清单（首次加载后走 B2 超集缓存）做精确名匹配——清单完备性是"唯一解析"可信的前提；命中列缓存（与补全/hover 共享 `ensureColumnsForTable`/`cachedColumnsByTable`）才视为全列已加载。大小写不敏感双向匹配（PG 小写折叠语义，漏报优于误报）。Rust 侧 `SqlReferenceAnalysis` 增补 `select_aliases`/`alias_columns`（作用域内可见但非 schema 列的标识符，前端免正则提取）；顺带修复 `table_reference_from_name` 在单段表名时把表名泄漏进 schema 槽位的 bug（该 bug 会使裸 `FROM users` 被当作 schema 限定引用，直接废掉主用例），并配集成测试锁定。

---

## P2 —— 能力增强与打磨

### T23 网格 FK 点击跳转 ✅ 37fc558b

- **来源** improvement-plan-2026-09.md §6 E7 第 1 项（Track E）· **规模** M
- **内容** FK 元数据已取（`DataGrid.vue:5571`），`useNavigationTargets.ts:18` 已接受 `whereInput`，只差一个 click handler。
- **验收**
  - [x] 点击 FK 单元格跳到目标表并定位到对应行（交互形式：**Cmd/Ctrl+点击**——普通点击保留选中/框选、双击保留编辑，沿用网格修饰键惯例；Cmd/Ctrl+点击 FK 单元格 → `openTableTarget` 打开 `ref_schema(ref_schema 缺省回落当前 schema).ref_table`，`whereInput` 为 `ref_column = <单元格值>`，复用页面大小/标签页复用逻辑定位到匹配行）
  - [x] 无 FK 元数据的列不可点、无误导（列无 FK、或单元格值为 NULL/复合值（JSON/数组）时：无 pointer 光标、无 hover 下划线、无 title，点击退化为普通选中；`isForeignKeyCellValueNavigable` 拒绝 NULL/NaN/Infinity/非标量）
  - [x] 测试 + 手工验证（手工点击验证在本环境不可行，以 20 项测试佐证接线链路每一环：`gridForeignKeyNavigation.test.ts` 覆盖 whereInput 构造纯函数（数字/布尔/字符串字面量、各方言标识符引用与转义——引号全方言双写、反斜杠仅 MySQL 系双写、SQL Server N 前缀）、可点判定矩阵（NULL/NaN/Infinity/对象/数组不可点、空串可点）、ref_schema 回落；源码契约测试锁定 DataGrid 接线（FK 预热拉取、修饰键守卫、DOM/Canvas 两种渲染模式的可点样式与点击 handler、emit 链 ContentArea→App.vue→`openTableTarget`、canvas 渲染器 hover 下划线选项）与六语言 tooltip；`pnpm check` 通过（format + lint + typecheck + vitest 170 文件 1224 测试）、`pnpm build` 通过）
- **实现说明**：新增 `lib/gridForeignKeyNavigation.ts` 纯函数模块（FK 按列索引、可点判定、SQL 字面量/whereInput 构造、NavigationTarget 组装）。FK 元数据从"仅打开表信息抽屉才拉取"改为表格数据展示时预热（沿用 loaded/loading 守卫，失败静默=不可点，不影响 results 上下文——无 tableMeta 即不拉取）。两处渲染模式都接了交互：DOM 单元格 pointer 光标 + hover 下划线 + title（`grid.foreignKeyNavigateHint`，六语言，含平台修饰键 Cmd/Ctrl）；canvas 渲染器新增 `isForeignKeyCell` 选项绘制同样式 hover 下划线 + pointer 光标，canvas click 仅在落点 = mousedown 单元格时导航（拖拽框选不误触）。同列多 FK 取第一个；复合外键点击仅按所点列过滤（与主流工具一致）。

### T24 方言函数目录（ClickHouse/DuckDB/Oracle） ✅ 9a8178b2

- **来源** improvement-plan-2026-09.md §4 C6（Track C，计划指定的优先三方言）· **规模** M
- **内容** `DATABASE_FUNCTION_SIGNATURES`（`sqlCompletion.ts:848`）只覆盖 5/25+ 引擎。先补 ClickHouse、DuckDB、Oracle；存储过程参数提示（`information_schema.parameters`/`pg_proc`）留待后续。
- **验收**
  - [x] 三方言函数名+签名补全生效；其他方言清单不变（补全走既有 `databaseType` 消费路径（`activeFunctionSignatures` 覆盖共用目录），QueryEditor 已传该 prop，零接线改动；签名卡新增可选 `databaseType` 参数并由 QueryEditor 传入，方言条目按大小写不敏感解析、优先于共用目录、显示引擎规范拼写，不带 `databaseType` 时行为逐字节不变；既有 5 方言目录条目数/内容/共享引用（rqlite≡sqlite）与 apply 模板被测试钉死，并断言新函数不泄漏到其他方言）
  - [x] 测试通过（新增 `packages/app-tests/sqlCompletion.dialectFunctions.test.ts` 9 项：三方言注册与结构完整性（目录条目数 74/76/50、描述与签名 key 一一对应、无大小写重复——可捕捉 Map 字面量重复键静默覆盖）、每方言代表性函数补全（精确 apply 模板与描述文案，CH 抽 countIf/toYYYYMM/groupArray/arrayJoin，DuckDB 抽 list_transform/struct_extract/json_extract*，Oracle 抽 LISTAGG/NVL2/ADD_MONTHS）、签名卡参数提示（含规范拼写与大写输入、activeParameter 位次）、跨方言不泄漏、共用目录行为不变、既有 5 方言清单钉死；`pnpm check` 全绿（format + lint + typecheck + vitest 171 文件 1233 测试，含 sqlCompletionPerformance 通过——目录扩大不影响既有补全性能测试））
- **实现说明**：新增 `CLICKHOUSE/DUCKDB/ORACLE_FUNCTION_SIGNATURES`（`Map<string, string[]>` 参数签名）与 `DATABASE_FUNCTION_DESCRIPTIONS`（每函数一行英文说明，作为补全 item detail；与签名目录 key 一一对应，由测试锁定）。CH 保留 camelCase 规范拼写（该引擎函数名大小写敏感，`TODATETIME` 无法解析），DuckDB 按 docs 的小写/下划线拼写，Oracle 全大写。覆盖：聚合、字符串、日期/时间、数学、类型转换、条件、空值处理，CH/DuckDB 另有数组/list/struct/map/lambda（`list_transform` 等），Oracle 另有分析/层级函数；通用函数（COUNT/SUM/窗口函数族等）继续由共用目录 + `WINDOW_FUNCTIONS` 提供，未重复收录。签名由可靠知识编写，参数名参照各方言官方文档风格；不确定的变体（如 ClickHouse 参数化聚合 `quantile(level)(expr)`、`topK(N)(x)`）宁缺勿错未收录。存储过程参数提示按计划留待后续。`pnpm test && pnpm typecheck && pnpm lint` 全部通过。

### T25 Leaflet 按需加载 ✅ b963ea14

- **来源** improvement-plan-2026-09.md §3 B5（Track B）· **规模** S
- **内容** `DataGrid.vue:133` 静态 import `geometryMapPreview` → 静态引入 Leaflet 对话框。改为 `execute()` 内动态 import。
- **验收**
  - [x] 初始 chunk 不含 Leaflet（构建产物体积对比，改动前后各一次 `pnpm build`：入口 `index-*.js` 68.64 kB（gzip 24.28 kB）前后一致且均无 leaflet 字样。如实记录：Leaflet JS/CSS 改动前就已是独立异步 chunk——对话框内 `loadLeaflet()` 本就动态 `import("leaflet")` + CSS，静态引入的是 handler 模块 + 对话框组件壳；本次把它们切到按需 chunk：DataGrid chunk **274.93 kB → 263.36 kB**（gzip 74.21 → 70.35，**−11.57 kB / gzip −3.86 kB**），新增按需 chunk `geometryMapPreview` 1.95 kB、`LayerPreviewDialog` 11.57 kB + 0.43 kB CSS；`leaflet-src` 148.82 kB / `leaflet.css` 15.09 kB 维持独立异步 chunk，仅在地图初始化时加载）
  - [x] 有几何列时地图预览功能正常（源码契约 + node 冒烟：注册动作对 geometry/geography 列型可用（含 `geometry(Point,4326)`、大小写/空白）；`execute` 构建的 FeatureCollection 行为不变（hex 跳过、NULL 跳过、重复 WKT 去重、非几何列进 properties），有可展示要素时才 `await import()` 对话框，并以 stub 模块验证返回组件与 geojson 内容；DataGrid 侧 memoized 动态 import + 结果含几何列即预热，注册完成后菜单可复算出现；模块加载失败 toast `grid.previewLoadFailed`（六语言）而非静默失败）
  - [x] 构建 + 手工验证（GUI 手工点击在本环境不可行，以构建产物断言替代并如实标注：`pnpm build` 产物断言——入口链 index.html（entry + rolldown-runtime + ui + index.css）与 DataGrid chunk 均无 leaflet/对话框标记（改前 DataGrid chunk 含对话框代码与 3 处 leaflet 样式类名），对话框代码（openstreetmap 底图串、leaflet 引用）位于独立异步 chunk；`pnpm check` 全绿：format + lint + typecheck + vitest 172 文件 1241 测试）
- **实现说明**：`DataGrid.vue` 去掉 `import "@/lib/previewHandlers/geometryMapPreview"`，改为 `ensurePreviewHandlersLoaded()`（memoized 动态 import，失败重置以允许重试）+ `previewHandlersVersion` ref（handler 注册完成后使 `previewActions` computed 失效重查 registry）+ watch（结果含 geometry/geography 列时立即预热，右键前动作已注册）。`geometryMapPreview.execute()` 改 async，在构建完要素集合之后才 `await import("@/components/grid/LayerPreviewDialog.vue")`——无可展示要素时不加载任何东西；`PreviewAction.execute` 签名放宽为可返回 Promise，`executePreviewAction` await 并 catch，失败以 toast 呈现。Leaflet 依赖未删除；其 CSS 由对话框内动态 import 携带，随异步 chunk 走，无需额外处理。

### T26 PG JSON 列免 parse-再序列化 ✅ 057fa533

- **来源** improvement-plan-2026-09.md §3 B4（Track B）· **规模** S
- **内容** `postgres.rs:709-716` 读成 `serde_json::Value` 再 `.to_string()`。先按 `String` 读，`Value` 仅作回退。
- **验收**
  - [x] json/jsonb 读取路径无 parse→serialize 往返（代码断言：新增 `PgJsonText` FromSql 适配器直读线上文本——先做线上探针实验确认可行性：PG 对 json 列传存储原文（`{ "b" : 1.000 }` 原样）、对 jsonb 列传 1 字节版本号 + jsonb_out 规范文本（`0x01 + {"a": 1, "bb": 2}`），文本协议/无前缀载荷同样直读（JSON 文本不可能以 `0x01` 开头）；单测断言 `from_sql` 输出与线上字节逐字节相等（带空白/重复键/转义的原文是 parse+serialize 无法复现的）+ jsonb 仅剥版本字节 + accepts 矩阵（JSON/JSONB 是、TEXT 否）。微基准对照（release、2.1KB 文档、2 万次）：原路径 ≈4.1µs/格 vs 直读 ≈0.08µs/格，约 51x；仓库无 criterion，不新增基准依赖，时间数字不入测试）
  - [x] 输出与数据库原文逐字节一致（语义修正见实现说明；对照测试 `tests/live_postgres_json.rs`：env 门控 `DBX_TEST_POSTGRES_URL`，Docker 临时 PG16 实测通过、用后弃容器；11 行覆盖嵌套对象/数组/unicode/转义/重复键/30 位大整数/38 位高精度小数/指数/顶层标量/空对象空数组/NULL/>50KB 大对象，逐格断言 json/jsonb 列 == 服务端 `::text` 原文（经驱动 TEXT 路径读取，同版本同服务器），另加精确钉子防 parse 路径回归：json 空白与重复键原文保留、30 位整数完整、jsonb 键序按长度+字典序）
- **实现说明**：`pg_value_to_json` 的 JSON/JSONB 分支改为先 `PgJsonText` 直读（jsonb 仅剥一节版本字节；类型匹配按 OID 与名字双重判断，对齐 gaussdb fork 的 `is_json_type`，GaussDB 兼容端同样适用），`serde_json::Value` parse 仅作防御回退，NULL 仍为 Null；顺带删除本就不可达的 `try_get::<String>`（fork 的 `String::accepts` 不含 json/jsonb）。**行为契约（语义修正，经实验决定）**：输出不再与旧 serde_json 序列化逐字节一致——旧路径是 parse 后重排：规范化空白与数字字面量（`1.000`→`1.0`、`1e2`→`100.0`）、丢弃重复键、解转义、**超 f64 精度数字被静默改写（30 位整数显示为 `1.2345678901234568e+29`）**；直读产出 PG 自己的文本（psql 所见），才是"展示数据库真实内容"的正确结果，也是原实现想要的效果。网格仍收到 JSON 字符串，前端展示形态不变。验证：`cargo fmt --check` + `cargo test -p dbx-core` 全绿（873 通过）；live PG 实测 json/network/completion_metadata/query_cancel/transaction_recovery 全过；`live_postgres_transfer` 在本环境的 base 提交上同样失败（gaussdb fork `Row::get` 对 domain 类型列索引越界，与本任务无关，如实记录）。

### T27 SSH 隧道放弃时驱逐连接池 ✅ 43e5c824

- **来源** improvement-plan-2026-09.md §2 A5（Track A）· **规模** S
- **内容** `ssh_tunnel.rs:223-228` 10 次尝试后只记日志返回，上层 DB 池仍缓存并持续报 "connection refused"。放弃时调 `discard_pool` 并发一次事件，前端提示隧道断开。
- **验收**
  - [x] 放弃后旧池不再缓存；后续操作得到明确错误而非 refused（代码/测试断言：隧道任务放弃时向 manager 自有 channel 发一次 `TunnelGiveUp`（tunnel id + SSH 端点）；桌面壳启动时单消费者 drain——按 tunnel id 找到所属连接、`remove_connection_pools` 驱逐其全部池（base/按库/按 tab session），再 emit 一次事件。后续操作重建传输层：sshd 仍宕机时 `get_or_create_pool` 快速失败于 "SSH layer N failed: SSH connection failed: …"（明确指向隧道），不再是从缓存池漏出的裸 refused。连接对话框探针隧道（`{id}:test`）不服务池，只报告不驱逐。重连退避参数化为 `ReconnectPolicy`（生产默认 5s→60s/10 次不变），测试注入毫秒级策略观察放弃）
  - [x] 前端收到事件并展示提示；测试通过（`useTauriEvents` 订阅 `ssh-tunnel-lost`，App.vue 在 10s 防重窗口内每连接至多一条 error toast（多跳连接同连多隧道只提示一次），文案 `connection.tunnelLost`/`tunnelLostHint` 进六 locale；`sshTunnelLost.test.ts` 7 例锁展示/防重/六语言/源码接线契约（含前后端事件名字面量一致））
- **实现说明**：dbx-core 不依赖 Tauri，事件走 `tokio::mpsc::UnboundedSender<TunnelGiveUp>`——`TunnelManager::take_give_up_receiver()` 单次交付，`src-tauri/src/lib.rs` 的 `start_tunnel_give_up_relay` 在 setup 时 drain（evict + emit，模式对齐 `mcp_bridge::start`）；防重在源头（每隧道生命周期恰好一次通知）+ 前端（每连接 10s 窗口）两层保证。重试内循环抽为 `reconnect_with_backoff(policy, attempt)`（mock connect 可测放弃预算与指数退避封顶）。验证：`cargo fmt --check` + `cargo test -p dbx-core` 全绿（lib 846 过，新增 5：退避递进/放弃预算/单消费者/隧道 id 映射/驱逐范围）+ `cargo check --workspace --locked` + `pnpm check` 全绿（173 文件 1248 用例，含新增 7 例）；env 门控 live 测试 `tests/live_ssh_tunnel_giveup.rs`（Docker 临时 alpine sshd，密码认证，测试自行 stop/start 容器）实测通过：隧道建立 → kill sshd → 恰好一条 notice（字段正确）→ 池全部驱逐 → 宕机期间 `get_or_create_pool` 报明确 SSH 层错误 → sshd 恢复后传输层无重启自愈。

### T28 原生 DB socket TCP keepalive ✅ 7ffeb3ad

- **来源** improvement-plan-2026-09.md §2 A6（Track A）· **规模** S
- **内容** 目前只有 SSH 会话有 keepalive（`ssh_tunnel.rs:51`）。PG/MySQL/SQL Server 原生连接在 connect 时设 `SO_KEEPALIVE`。
- **验收**
  - [x] 三驱动连接均带 keepalive 选项（代码/单测断言：`db::mod` 统一常量 `TCP_KEEPALIVE_IDLE=60s` / `INTERVAL=30s` / `RETRIES=5`（最坏 ~3.5 分钟检出半开）。PG：gaussdb fork 默认开 keepalive 但沿用 libpq 2 小时窗口——`connect()` 用 fork 的 `keepalives_idle/interval/retries` Config setter 填入统一值，fork 对每条拨号连接（明文与 TLS）生效；URL 里的 `keepalives*` 参数优先。MySQL：`create_pool` 经 `OptsBuilder::tcp_keepalive(60_000ms)` 下发（crate 只支持 idle 时长；URL `tcp_keepalive=` 参数优先），纯函数单测断言取值 + `include_str!` 契约锁接线。SQL Server：tiberius 无 keepalive 配置面，但 `try_connect` 自行拨号——socket2 直接对 TDS 裸 socket 设统一 schedule（失败仅告警）；回环 socket 真实 setsockopt 往返单测 + 源码契约锁接线。PG 两分支单测经 Config getter 断言 fork 默认值→统一值、URL 参数不被覆盖。live：`tests/live_postgres_keepalive.rs` phase 1（全平台）以真实驱动路径连 Docker PG 实测两套 schedule（fork 在 setsockopt 失败时连接即失败，SELECT 1 成功即证 socket 已带选项））
  - [x] 半开连接（手工断网）不挂死，能被探测或报错恢复（如实标注验证方式：live 测试 phase 2（Linux 宿主机）在容器内 `iptables DROP` 制造真半开——对端无 ACK 无 RST，断言挂起查询在 keepalive 窗口内报错、同池在规则移除后新连接自愈；本机为 macOS + Docker Desktop，发布端口由宿主 `com.docker.backend` 代理终结，客户端 TCP 对端永不变哑（`docker pause` 亦不可用：暂停容器的内核仍会 ACK），故该环境只跑 phase 1。机制等价验证已在 Linux 容器间完成：直连容器 IP + 相同 schedule（idle=10s/interval=5s/retries=3）对 `pg_sleep` 挂起连接，`pg_stat_activity` 确认服务端执行后落 DROP 规则，25.5s ETIMEDOUT（恰为 10+3×5），DROP 计数器逐包计入探测；phase 2 代码即按此编排）
- **实现说明**：统一常量与 socket2 schedule 构造放 `db::mod`（SSH 隧道自身 30s keepalive 不动；Redis 走 ConnectionManager 自带探测不在范围）。`socket2` 作为直接依赖加入 dbx-core，版本 0.6 + feature "all"——与 gaussdb fork 已编译的构建完全一致，不引入新代码；仅 SQL Server 路径使用（PG/MySQL 经各自 crate 内部 socket2）。三驱动 URL 参数优先策略：PG 按 getter 探测 fork 默认值（2h/None/None）缺省才填，MySQL 取 `opts.tcp_keepalive()` 缺省才填，避免覆盖用户显式配置。验证：`cargo fmt --check` + `cargo test -p dbx-core` 全绿（lib 853 通过，新增 7）+ `cargo check --workspace --locked`；live 测试 env 门控 `DBX_TEST_POSTGRES_KEEPALIVE_URL`/`DBX_TEST_POSTGRES_KEEPALIVE_CONTAINER`，Docker 临时 postgres:16-alpine（`--cap-add=NET_ADMIN`，用后弃容器）实测通过。

### T29 idle_timeout 设置诚实化 ✅ ed3c4bae

- **来源** improvement-plan-2026-09.md §2 A7（Track A）· **规模** S
- **内容** `idle_timeout_secs` 只到 Mongo（`connection.rs:451`）；PG（`postgres.rs:1119`）与 MySQL（`mysql.rs:371` 硬编码 300s）忽略。按原文档"懒方案"：对不生效的引擎隐藏该控件。
- **验收**
  - [x] PG/MySQL 连接表单不再出现可调但无效的 idle_timeout 控件（控件显隐由 lib 层 `supportsIdleTimeout` 谓词门控，支持清单 = 仅 mongodb；替换对话框原 `v-show="form.db_type === 'mongodb'"` 内联判断）
  - [x] Mongo 行为不变；i18n 文案与测试就位（Mongo 仍显示控件、后端零改动；`connection.idleTimeout` 六 locale 文案由测试逐一断言；已保存连接的现存 idle_timeout 值原样保留——表单装载/保存归一化对所有引擎照常透传，只隐藏 UI 不清理数据）
  - [x] 各引擎核查清单（依据 = 后端 `idle_timeout_secs` 实际消费点，见下"实现说明"）：
    - **显示**：MongoDB（native 驱动 `db::mongo_driver::connect` → `ClientOptions::max_idle_time`；dbx-core `connection.rs` 的 `get_or_create_pool` 与 src-tauri test/probe 的两份池构建副本各消费一次）
    - **隐藏**：MySQL 族 MySQL/Doris/StarRocks/Databend（`mysql.rs create_pool` 硬编码 `with_inactive_connection_ttl(300s)`）；PG 族 Postgres/Redshift/Gaussdb/Kwdb/OpenGauss（deadpool 无 idle TTL，`postgres.rs` 全文零 `idle_timeout`）；SQL Server（`SqlServerPool` 无 idle 过期概念）；SQLite/DuckDB/RQLite/Redis/ClickHouse/Elasticsearch（长连接客户端，无该配置消费点）；全部 agent/JDBC 引擎（`agent_connect_params` 不转发该字段）
- **实现说明**：`IDLE_TIMEOUT_SUPPORTED_TYPES` 集合 + `supportsIdleTimeout()` 谓词落在既有 `databaseCapabilitySets.ts`/`databaseFeatureSupport.ts` 能力集模式上，作为"哪些驱动支持 idle_timeout"的单一事实源（文档注释记录后端审计依据）。测试加在 `databaseCapabilities.test.ts`（4 例）：支持清单对整个 DatabaseType union 穷举断言（union 从 `types/database.ts` 解析，新引擎加入时测试失败、强制显式归类）；与后端消费点对齐的源码契约（connection.rs 恰好一处绑定 + 一处 Mongo 消费、src-tauri 副本两处、mongo `max_idle_time` 映射、MySQL 硬编码 300s、postgres.rs 零命中——任一后端接线变化都会触发清单复审）；对话框以共享谓词接线 + 旧内联门控已移除；六 locale 文案。未动后端（无需 cargo）。`pnpm check` 全绿（format + lint + typecheck + vitest 173 文件 1252 用例）。

### T30 展示 token 用量与成本 ✅ 96fbac3b

- **来源** improvement-plan-2026-09.md §5 D7（Track D）· **规模** S
- **内容** `AgentEvent::AgentEnd` 带真实 usage（`agent_loop.rs:244`），前端丢弃（`AiAssistant.vue:795` `case "agent_end": break`）。持久化到消息并渲染尾部，可选静态价格表算成本。
- **实现说明**：`agent_end` 事件把累计 usage 写进当前回答消息；逻辑落在 `lib/aiTokenUsage.ts`（事件提取 / 历史容错读取 / 紧凑格式化），消息经 `AiChatMessage.usage` 随会话持久化——`TokenUsage` 加 serde derive（`default` + 缺省跳过），字段出现前的旧消息原样加载、原样回存。回答尾部渲染 "↑ 1.2k / ↓ 3.4k tokens" 小字 meta 行（hairline 分隔、`--ds-text-4`），重载历史后保留；Ask 模式与不报 usage 的 provider 不渲染任何行。**成本估算不做**：8 个 provider（claude/openai/gemini/deepseek/qwen/ollama/openai-compatible/custom）模型名与端点自由填写，仓库内无价格数据且价格漂移，静态表会把编造数字当事实呈现——只展示 token 数。六 locale 新增 `ai.tokenUsage.tokens`。含少量 Rust 序列化改动（`ai.rs`），故跑了 cargo 三件套。
- **验收**
  - [x] 回答尾部显示 token 用量；历史消息中保留（agent_end 写入消息 → persistConversation 携带 usage → selectConversation 容错回读；`aiTokenUsage.test.ts` 断言新格式消息读出 usage、旧格式消息读出 undefined）
  - [x] 无 usage 的 provider 显示为空不报错；测试通过（text-only 回退路径 `AgentEnd{None,None}` 两字段省略 → 提取 undefined → 无行；畸形持久化值（字符串/负数/数组/Infinity）→ undefined 不抛错；`pnpm check` 全绿 format + lint + typecheck + vitest 174 文件 1268 用例；`cargo fmt --check` / `cargo check --workspace --locked` / `cargo test -p dbx-core`（854 通过）全绿）

### T31 AI 连接失败重试一次 ✅ b051862a

- **来源** improvement-plan-2026-09.md §5 D6（Track D）· **规模** S
- **实现说明**：11 个聊天发送点（4 非流式 `call_*` + 4 普通流式 `stream_*` + 3 工具流式 `stream_*_with_tools`，覆盖 claude/openai/responses/gemini；`agent_loop.rs` 自身无发送点）统一收敛到 `ai.rs` 新增的 `send_with_retry_once`：`.send()` 报错（连接拒绝/DNS/TLS/等响应头的超时——`.send()` 只在响应头解析完成后才 resolve，其错误必然发生在任何响应字节之前）或响应为 HTTP 429/5xx 时，固定等 1s 后原样重发同一请求，**恰好一次**。口径按计划原文 "429 / 5xx / connect error"：500 含在内（`is_retryable_status` = 429 或 `is_server_error()`），不读 Retry-After、保持固定短退避。重试严格限定在"流开始前"：响应头到达后的任何错误一律按原状上抛——SSE 中途断开、body 解析失败、400/401 等确定性客户端错误、第二次 429/5xx——流中不重试，杜绝重复回答/重复计费。模型列表 GET 与 Ollama `/api/show` 能力探测维持无重试（探测本就 fail-closed 回退文本模式，加重试只会拖慢 opt-in 判定）。
- **验收**
  - [x] 单测：mock 首响应 429/5xx → 重试成功；流中断不重试（`ai.rs` 内嵌单测以 1ms 退避驱动 `send_with_retry_once` 打真实 loopback canned server：429→200 成功且请求恰 2 次、429→429 恰好 2 次即放弃、400 只发 1 次、连接拒绝首试→重试命中；另有 `is_retryable_status` 429/5xx 矩阵。`tests/ai_tool_stream.rs` 复用 T21 mock provider 走公开路径：`stream` 首响应 429 → 重试成功且两次请求体字节相同、Gemini 工具流 503 → 成功、非流式 `complete` 502 → 成功（各恰 2 次请求）、200 流中途断 body（Content-Length 虚高 + 提前关闭）→ 错误上抛且请求总数为 1、400 错误信息原样上抛只发 1 次）
  - [x] 全量回归通过（`cargo fmt --check` + `cargo check --workspace --locked` + `cargo test -p dbx-core`：lib 859 过（基线 854 + 新增 5）+ 集成全绿（含 ai_tool_stream 9 例，新增 5）；未动前端）

### T32 聊天结果一键图表 ✅ b7ad137e

- **来源** improvement-plan-2026-09.md §5 D8（Track D）· **规模** S
- **内容** `QueryChart.vue` 已存在，无入口把工具结果接进去。在结果卡加一个"生成图表"动作，不写新图表代码。
- **实现说明**：`execute_query`/`get_sample_data` 的结果没有结构化旁路（与 `explain_query` 携带 `explain_data` 不同），到达前端的是后端 `format_query_result_as_text` 渲染的 markdown 表格文本。新增纯函数模块 `lib/aiChartResult.ts` 把该表格解析回 `QueryResult` 形状（剥离 `(N rows, Xms)` 脚注、还原 `\|` 转义、去分隔符填充、`NULL`→null、数字样文本→number 以命中 QueryChart 的数值列检测；日期与截断单元格保持文本）。`AiAssistant.vue` 查询工具步骤卡在既有"立即执行"按钮旁新增"生成图表"动作，点击后在卡内嵌展开 `QueryChart`（`defineAsyncComponent` 按需加载，与 ContentArea 同款懒加载模式，ECharts 不进聊天 chunk）。动作仅对执行成功、表格可解析且存在数值列的 `execute_query`/`get_sample_data` 步骤显示（镜像 QueryChart 自身 `hasData`，不会打开到空态）；每次仅展开一张图（按 tool_call_id 记键），再点收起。行数上限 100——即后端 markdown 表格自身的 `MAX_ALLOWED_ROWS`——在解析侧镜像设防，图表不会扩到无界结果；零行/无列/纯文本结果不显示动作。未新增图表组件、未新增依赖。
- **验收**
  - [x] 查询结果卡可打开图表并正确渲染（数据/列经 `chartResultFromToolText` 从结果卡文本直接映射为 QueryChart 的 `result` prop；本环境无 Tauri 运行时无法手工点验，以测试+构建佐证：解析器/映射/接线契约测试 + `pnpm check` 全绿 + `pnpm build` 通过，echarts 走既有异步 chunk）
  - [x] 无新增图表组件/依赖；手工验证（手工不可行，如上以 `packages/app-tests/aiChartResult.test.ts` —— 解析、映射、可图表化判定、AiAssistant 源码契约（懒加载引入/谓词门控/prop 透传）、六 locale i18n —— 及 typecheck/lint/test/build 全绿佐证并如实标注）

### T33 关键字大小写跟随输入 ✅ b4588cba

- **来源** improvement-plan-2026-09.md §4 C7 第 1 项（Track C）· **规模** S
- **内容** 补全关键字硬编码大写。改为跟随输入前缀大小写（或加设置项）。
- **验收**
  - [x] 小写前缀得到小写补全（或设置生效并有默认值）
  - [x] 测试通过
- **实现说明**：选"跟随前缀"方案（无设置面）。新增纯函数 `applyKeywordCasing(keyword, prefix)`（`sqlCompletion.ts`）：以前缀首个字母的大小写决策——小写插入 `select`、大写插入 `SELECT`、空前缀/无字母前缀（未键入单词即唤起补全）保持规范大写；混合输入（`Sel`/`sEL`）按首字母确定性归入大/小写。按首字母（而非全大写/全小写/混合三分规则）决策使选择随前缀增长保持稳定（`se`→`sel` 已弹出的补全不会中途翻转大小写，对未来 T36 的 case-insensitive `validFor` 正则同样成立）。接线全部在 `sqlCompletion.ts` 内：关键字 item 无 `apply`（编辑器插入 `apply ?? label`），label 即弹出文本即插入文本，编辑器零改动；内置语句 snippet 体硬编码大写，新增 `applySnippetBodyCasing` 仅对命中关键字目录的单词重设大小写，`{name}`/`${name}`/`#{name}` 占位符、数字、标点与非关键字单词（用户自写的标识符）原样保留，`detail` 预览与插入同大小写；比较值提示（NULL/IS NULL/IS NOT NULL/TRUE/FALSE）同为 keyword 类型且按 label 去重，一并跟随同一规则，避免与目录项分裂成两条不同大小写的条目。函数目录补全（`COUNT(`、`DATE_FORMAT(...)`）不在范围——其规范拼写即方言文档（如 ClickHouse camelCase）。已知取舍：历史加权的 key 是 item label，`select` 与 `SELECT` 的选择统计分开累计。测试：新增 `packages/app-tests/sqlCompletion.keywordCasing.test.ts`（纯函数矩阵 + 端到端：小写/大写/混合/空前缀、前缀增长稳定性、占位符不重写、方言关键字、NULL 值提示、内置 snippet apply 模板）；既有断言大写插入的用例更新为新契约（`sqlCompletion.test.ts` 的 SELECT/jsonb/SERIAL/USING 标签与 `select *`/CASE WHEN snippet apply/detail、`sqlCompletion.snippet.test.ts` 两处 apply/detail），函数项断言未动。`pnpm check` 全绿（format + lint + typecheck + vitest 176 文件 1304 用例，含补全性能回归测试）。

### T34 标签页切换快捷键 ✅ e66e03dc

- **来源** improvement-plan-2026-09.md §6 E6 第 1 项（Track E）· **规模** S
- **内容** `shortcutRegistry.ts` 缺 next/prev tab 与 `Cmd+1-9`。注册进 registry。
- **验收**
  - [x] 快捷键生效且在快捷键面板可见
  - [x] 与既有绑定无冲突（清单断言/测试）
- **实现说明**：三组绑定注册进 `shortcutRegistry.ts`（scope 均为 global），经既有 App.vue 全局 keydown 路径生效。键位选择：next tab `Mod+Alt+ArrowRight`（macOS Cmd+Alt+→，其余 Ctrl+Alt+→）、prev tab `Mod+Alt+ArrowLeft`——跟随 Chrome/VS Code 的编辑器循环惯例，且与 CodeMirror 不冲突（mac 上 CM 只绑不带 Cmd 的 Alt-Arrow 词移动）；弃选 Ctrl+Tab（webview 可能吞键不送达页面）。`Mod+1..Mod+9` 跳第 N 个，跟随浏览器惯例：`Mod+9` = 最后一个标签页，`Mod+1..8` 直映射位置 1..8，位置超界（打开数不足 N）为 no-op——已知取舍：恰好开 10 个标签页时第 9 个无键可达（与 Chrome 相同）。next/prev 首尾环绕；无活动标签（仅驱动商店打开）时 next 进第一个、prev 进最后一个。解析逻辑在新增纯模块 `lib/tabSwitch.ts`（`resolveTabSwitchTarget`）；App.vue 的 `switchTab` 仅赋值 `queryStore.activeTabId`，既有 activeTabId watcher 照常触发 `dbx:before-tab-switch`（网格待存快照）、关闭驱动商店标签并复位分标签 UI 状态——与标签点击/closeTab 同一路径。面板可见性零改动即得（面板逐行渲染 registry）；`gotoTab1..8` 共享 `settings.shortcutGotoTabN` 标签，为此给 `ShortcutDefinition` 增加可选 `labelParams`（vue-i18n 命名参数），面板 label 渲染/搜索统一走带参 helper，`gotoTab9` 用 `settings.shortcutGotoLastTab`；六个 locale 均补 4 个标签 key。老用户快捷键设置无需迁移：`normalizeShortcutSettings` 以默认值回填新 id；默认值在 global scope 内两两不同。测试：新增 `packages/app-tests/tabSwitch.test.ts`（相邻移动、环绕、单/零标签、活动 id 缺失、goto 位置与超界、10 标签下 9=末尾 vs 8=第 8）；新增 `packages/app-tests/shortcutRegistry.test.ts`（三组绑定 id/scope/默认键清单断言、逐 scope 默认键唯一性 + `findShortcutConflict` 全默认零冲突、面板可见性契约——每条 labelKey 在六个 locale 均为字符串且 labelParams 占位符存在）；`keyboardShortcuts.test.ts` 增 matcher 用例（Mod+Alt+方向键的修饰键缺失/多余/自定义重绑、`gotoTabNumberFromShortcut` 1..9 解析与 0/Shift/Alt/无修饰键拒绝、自定义重绑）。`pnpm check` 全绿（format + lint + typecheck + vitest 178 文件 1323 用例）。

### T35 Format SQL 快捷键 ✅ fa0e42a8

- **来源** improvement-plan-2026-09.md §6 E6 第 2 项（Track E）· **规模** S
- **内容** `formatActiveSql` 仅工具栏可达。注册快捷键。
- **验收**
  - [x] 编辑器内快捷键触发格式化；registry 可见；测试通过（编辑器内触发与 registry 可见性以清单断言 + 源码契约 + matcher 测试佐证，`pnpm check` 全绿）
- **实现说明**：绑定注册进 `shortcutRegistry.ts`（scope 为 editor，与 execute/save 同组），经既有 App.vue 全局 keydown 路径生效。键位选择 `Mod+Shift+F`（macOS Cmd+Shift+F，其余 Ctrl+Shift+F）——跟随 DBeaver 的 Format SQL 惯例，SQL 客户端用户的肌肉记忆所在；与既有绑定零冲突（所有 scope 均无 Mod+Shift+F，逐 scope 唯一性断言覆盖），CodeMirror 在用的键位表（default/search/history/fold/completion）均未绑定 Mod-Shift-f，按键从编辑器冒泡到 window handler；弃选 VS Code 的 Shift+Alt+F——macOS 上 Option 合成按键字符（event.key 不再是 "F"），matcher 无法匹配。分发逻辑镜像 executeSql 块：活动 tab 须为 query tab、事件 target 在 `[data-query-editor-root]` 内，随后调用工具栏按钮同一入口 `formatActiveSql()`——作用域语义不变：请求携带活动 tab id，只格式化当前活动 tab 的编辑器，空 SQL 为 no-op（`formatActiveSql` 自带守卫）。面板可见性零改动即得（面板逐行渲染 registry），label `settings.shortcutFormatSql` 六 locale 均补。老用户快捷键设置无需迁移：`normalizeShortcutSettings` 以默认值回填新 id，默认值在 editor scope 内唯一。测试：`shortcutRegistry.test.ts` 增 formatSql 清单断言（id/scope/默认键/label）与 App.vue 接线源码契约（限定 query editor 作用域并调用 `formatActiveSql`，connectionStoreCancel 同款源码契约方式）；既有逐 scope 默认键唯一性、`findShortcutConflict` 全默认零冲突、六 locale label 检查自动覆盖新绑定；`keyboardShortcuts.test.ts` 增 matcher 用例（Cmd/Ctrl+Shift+F 匹配，仅 Shift/仅 Mod/缺 Shift/多 Alt 拒绝、composing 拒绝、自定义重绑）。`pnpm check` 全绿（format + lint + typecheck + vitest 178 文件 1328 用例）。

### T36 getSqlCompletionResultValidFor 落地 ✅ ad03e069

- **来源** improvement-plan-2026-09.md §4 C7 第 2 项（Track C）· **规模** S
- **内容** `getSqlCompletionResultValidFor`（`sqlCompletion.ts:1249`）是返回 `undefined` 的 stub。实现前缀 regex，或以结论性注释说明为何不需要。
- **验收**
  - [x] 二选一落地：有实现 + 测试，或有写明理由的注释
  - [x] 相应行为有测试锁定
- **实现说明**：选"实现"路线（保守正则）。前缀 ≥2 字符时返回 `/^[A-Za-z0-9_$]*$/i`。CodeMirror 的 validFor 契约：结果 `from` 到光标之间的文本持续匹配该正则时，弹层复用已构建的 options、不再调用补全 source——键入延续同一标识符即跳过语句重解析、引用表提取、目录查找与逐键列表重建（`from = position - prefix.length`，被测文本恰为光标处的裸标识符 token）。安全性论证（全文写在函数注释）：① 前缀 <2 字符的结果一律不复用——`suggestRoutines` 恰在 2 字符处开启，token 增长会合法地新增函数项，复用会隐藏它们；从 2 字符起 item 集对标识符增长单调——所有候选过滤都经 `matchesPrefix()`（大小写不敏感的子序列/子串匹配，长前缀匹配蕴含一切更短前缀匹配），复用列表恒为正确结果的超集、已列项不会消失；② `.` 不在字符集——键入限定符点（`users.`）恰是结果必须从表/关键字切换为限定列的位置，失配即强制重算；③ 大小写不敏感安全——过滤两侧小写化，且 T33 的 `applyKeywordCasing` 按前缀首字母决定插入大小写，token 延展不改变首字母；④ `$` 是本管线合法标识符字符（`[\w$@]`）故保留；`@` 排除（仅作 SQL Server 变量 token 起始，`from` 落在 `@` 上永不匹配→逐键重算）；带引号标识符终会含引号字符→重算。已知取舍（与既有 Elasticsearch validFor 相同）：结果以 `filter: false` 构建，复用列表不再随前缀收窄——保持弹层打开时算出的超集，直至非标识符字符（或退格越过 token 起点）触发重算；后台 schema 元数据加载不受复用拖延——其刷新显式重发 `startCompletion` 构建全新结果。QueryEditor 三个结果构建方（context-only/local/async）本就透传该函数返回值，零接线改动；函数内部为前缀门槛多跑一次 `getSqlCompletionContext`，代价按每次弹层一次计，被复用省下的逐键开销远盖过。测试：`packages/app-tests/sqlCompletion.test.ts` 将两条 stub 锁定用例改写为新契约——空前缀/1 字符前缀无 validFor、2 字符起返回正则且接受标识符延展（含大小写翻转、`_`、`$`）、拒绝上下文切换字符（`.`、空格、括号、引号、运算符、`;`、`@`）、光标在注释内不复用。`pnpm check` 全绿（format + lint + typecheck + vitest 178 文件 1331 用例）。

### T37 prefers-reduced-motion 支持 ✅ a92296bb

- **来源** improvement-plan-2026-09.md §6 E9 第 1 项（Track E）· **规模** S
- **内容** `styles/` 下该 media query 零命中。全局支持减弱动态效果。
- **验收**
  - [x] 系统开启后关键过渡/动画禁用（CSS 清单覆盖主要动效）（`styles/globals.css` 新增全局 `@media (prefers-reduced-motion: reduce)`：`*, *::before, *::after` 的 `animation-duration: 0.01ms !important` + `animation-iteration-count: 1 !important` + `transition-duration: 0.01ms !important` + `scroll-behavior: auto !important`；源码契约测试锁定媒体查询、通用选择器覆盖与四条声明）
  - [x] 手工验证 + `pnpm check`（手工/DevTools emulate 以真实无头 Chrome 实测替代并如实标注：对 `pnpm build` 产物用 Chromium `--force-prefers-reduced-motion` / `--force-prefers-no-reduced-motion`（与 DevTools 模拟同一 media feature）各跑一次探针页——reduce 开启时 `animate-spin`/`animate-pulse`/`transition-all`/`animate-in` 四类探针元素计算样式全部坍缩为 `animation-duration 1e-05s`（=0.01ms）、`animation-iteration-count 1`、`transition-duration 1e-05s`、`scroll-behavior auto`；关闭时基线不变（spin 1s/infinite、pulse 2s/infinite、transition 0.15s）。`pnpm check` 全绿（format + lint + typecheck + vitest 179 文件 1336 用例，含新增 5 例））
- **实现说明**：① 全局兜底选"坍缩为一帧"而非移除声明（业界标准写法）：状态变化保持即时，加载态不消失——`animate-spin`（96 处 Loader2）停在首帧成静止图标、`animate-pulse` 骨架（5 处）定格为静态色块，旁边加载文字/样式仍表达状态；`0.01ms` 而非 `0s` 保持 `transitionend`/`animationend` 触发，Vue `<Transition>`（toast 进出场、编辑器搜索面板、网格搜索浮层）与 reka-ui overlay presence 生命周期正常完成（tw-animate-css 退场动画 `animation-fill-mode: none`，但 Presence 在首个 animationend 即卸载，不会闪回可见）；`animation-iteration-count: 1` 停掉全部无限循环（spinner/骨架/树状态点脉冲——TreeItem.vue 既有单点 reduce 覆盖保留且与新全局规则一致）。组件内 `<style>` 与 Tailwind 工具类动画经通用选择器 + `!important` 一并覆盖，无需逐文件清单。② JS 驱动的动效不在 CSS 可达范围：新增框架无关 `lib/reducedMotion.ts`（`prefersReducedMotion` / `scrollBehaviorForMotion`，默认读 `window.matchMedia`、可注入 matcher 供测试），接线 tab 栏两处平滑滚动——`useTabScroll.ts` 箭头翻页 `scrollBy` 与 `AppTabBar.vue` 活动 tab/driver store 的 `scrollIntoView`（后者在 `scrollActiveTabIntoView` 单点收敛，auto/smooth 全部调用方一并覆盖）。③ 豁免决定：无豁免项——仓库没有承担信息传达的关键动画（导出进度条宽度是数据驱动非 keyframe 动画，其 `animate-pulse` 仅标记不确定态，静止后进度条+文字状态仍可读）；ECharts 渲染动画属 JS 数据可视化动画，不在本次 CSS 级改动范围。测试：`packages/app-tests/reducedMotion.test.ts`——helper 单测（media query 常量、reduce 开/关的行为映射含 auto 透传、缺 matchMedia 视为关闭）、globals.css 源码契约、useTabScroll/AppTabBar 全部 smooth scroll 经 helper 且无未守卫的 `behavior: "smooth"` 残留。

### T38 启动阶段 performance.mark ✅ f158bc2b

- **来源** improvement-plan-2026-09.md §6 E9 第 2 项（Track E）· **规模** S
- **内容** 现状是散落的 `console.log(performance.now())`。启动各阶段打 `performance.mark` 并写入 debug log。
- **验收**
  - [x] 导出的调试日志含各启动阶段耗时标记（`lib/startupMarks.ts`：每阶段 `markStartupPhase` 记录一次（幂等）真实 `performance.mark`（DevTools performance 面板可见）+ 内存缓冲；`flushStartupMarks` 经 `appendDebugLog` 写入单行摘要 `[DBX][startup-timing] phase atMs(+stepMs) | …`（time origin 起的绝对耗时 + 相邻阶段步进）。debug log 默认关闭且最早阶段时缓冲可能不可达，故标记只存内存，摘要仅在可落盘时 flush 且不重复：① 首帧（main.ts rAF）② initApp 链路终点（`connectionStore.initFromDisk` 落定后，补齐首帧 flush 时未完成的磁盘读）③ 启动后才开启 debug log 时——debugLog 新增 `onDebugLoggingEnabled` 钩子，startupMarks 模块级注册，缓冲摘要随即落盘；摘要只在其覆盖未 flush 标记时追加且始终含全部标记，日志末条即完整版，反复开关不重复。行为测试以 `getDebugLogText()`（导出内容来源）+ localStorage 持久化双向断言）
  - [x] 无残留 ad-hoc console 计时（main.ts/App.vue 的 8 处 `[STARTUP]` console 里程碑与 2 处 `console.log(performance.now())` 计时全部删除，信息（里程碑+耗时）由 12 个 `startup:*` 标记与摘要承载；启动失败 `console.error` 路径保留；DataGrid/ContentArea/TreeItem 运行期网格诊断日志非启动计时，不动。源码契约测试锁定：启动文件无 `console.log`+`performance.now()` 同行模式、无 `[STARTUP]` console 残留）
- **实现说明**：新增框架无关 `lib/startupMarks.ts`（无 performance API 时 `Date.now()` 兜底、mark 发射尽力而为，测试环境安全）。阶段清单（12）：`bootstrap-begin → modules-loaded → locale-ready → app-created → on-mounted-begin → theme-applied → init-app-begin → on-mounted-sync-done → vue-mounted → first-frame`（onMounted 系列在 `app.mount()` 内先于 vue-mounted 触发，摘要按真实时间序呈现）+ 异步尾 `saved-sql-loaded → connections-loaded`（initFromDisk 三读并发，`connections-loaded` 后触发完整摘要 flush）。debugLog 仅新增 `onDebugLoggingEnabled` 监听注册（`setDebugLoggingEnabled(true)` 时通知），无循环依赖。测试：`packages/app-tests/startupMarks.test.ts` 10 例——mark 工具单测（stub performance API：时钟/步进/真实 mark 发射/幂等 first-wins/缺 API 降级/摘要格式/空 flush）、flush 行为断言（导出文本含摘要并落 localStorage；关→开后经钩子恰好落一次、重复开关不重复；迟到处标记产出一条更新后的完整摘要）、源码契约（启动文件无 ad-hoc 计时模式、12 阶段全部接线、两处 flush 触发点、debugLog 钩子与 appendDebugLog 接线在位）。`pnpm check` 全绿（format + lint + typecheck + vitest 180 文件 1346 用例）。

### T39 QueryEditor 异步组件化 ✅ cfb367b9

- **来源** improvement-plan-2026-09.md §6 E9 第 3 项（Track E）· **规模** S
- **内容** CodeMirror 经 `App.vue → ContentArea.vue → QueryEditor.vue:17` 启动即加载。`QueryEditor` 包 `defineAsyncComponent`（对齐 DataGrid 模式）。
- **验收**
  - [x] 纯浏览会话首屏 chunk 不含 CodeMirror（`pnpm build` 产物对比：首屏 chunk 闭包（index + App + i18n 入口及其全部传递静态依赖，构建产物图 BFS 实测）1720.4 kB → 1169.4 kB raw（543.0 → 368.6 kB gzip，-32%）；CodeMirror chunk 486.50 kB / gzip 155.91 kB 与 QueryEditor chunk 均只剩独立异步 chunk，从启动入口静态不可达。副作用一并消除：editorThemes chunk 此前因 QueryEditor 静态在环而被并入启动共享组（其 `lib/editorThemes.ts` 静态 import `@codemirror/language`），拆分后缩为 11.91 kB 纯样式主题 chunk）
  - [x] 编辑器打开与功能不回退（`pnpm check` 全绿：format + lint + typecheck + vitest 181 文件 / 1351 用例；props/events 对 `defineAsyncComponent` 透明，模板未动；defineExpose 的 `openSearch`/`openReplace`/`scrollCursorIntoView` 由源码契约测试锁定接线；GUI 交互手工验证本环境不可行，以构建 + 类型检查 + 契约测试佐证）
- **实现说明**：新增 `components/editor/queryEditorAsync.ts`——`defineAsyncComponent({ loader, loadingComponent })` 包装 `QueryEditor.vue`，对齐 ContentArea 既有 DataGrid 模式：`loadQueryEditorComponent()` 记忆化动态 import（并发挂载共享一次加载，附 `[DBX][QueryEditor:load:start/done]` 耗时日志），loading 占位为等面积 Loader2 旋转骨架（异步组件默认 200ms delay，本地快速加载不闪现，慢加载不塌陷/不跳动布局）。静态引用点两处全部改造：`ContentArea.vue:28` 与 `ObjectBrowser.vue:82`（对象侧源码查看/编辑）。ref 方法处理：`defineAsyncComponent` 对 props/events 透明但对实例 ref 不透明，`queryEditorRef` 由 `InstanceType<typeof QueryEditor>` 改为显式 `QueryEditorHandle`（镜像 DataGridHandle 先例）；三个调用点（`focusSearch`→`openSearch`、`handleModRTarget`→`openReplace`、执行结束 watch→`scrollCursorIntoView`）均已 `?.` 优雅降级——`openSearch` 在加载窗口内回落侧栏搜索（与今日非 query 模式行为一致），`openReplace` 仅可由编辑器自身 DOM（`[data-query-editor-root]`）触发、天然后置于加载完成。刻意不加 DataGrid 式 idle 预载：纯浏览会话不应拉取编辑器 chunk。防回退：`packages/app-tests/queryEditorAsync.test.ts` 5 例源码契约——包装器为记忆化动态 import 且自身无 `@codemirror`/静态 import；两个引用点无静态 `QueryEditor.vue` import 且经包装器挂载；defineExpose 清单与 handle 类型、三调用点接线在位。

### T40 列固定 + 拖拽排序 ✅ 958f01b6

- **来源** improvement-plan-2026-09.md §6 E7 第 2 项（Track E）· **规模** M
- **内容** `useDataGridColumnResize` 只管 resize。增加列 pin/freeze 与拖拽重排。
- **验收**
  - [x] 列可固定与拖拽排序；横向大范围滚动下固定列不漂移（表头右键菜单与紧凑表头下拉均含"固定列/取消固定"（六 locale），表头指针拖拽换列序（4px 阈值 + 落点指示线，拖完吞掉尾随 click 不误选中）。**渲染模式支持范围：DOM 与 canvas 两种模式都支持**——canvas 是默认渲染路径，列头在 canvas 模式下本就是 DOM，pin/drag 入口天然两态共享；行区不漂移由几何保证：固定列 i 的视口 x = 行号宽 + 前 i 个固定列宽度之和，公式中无 scrollLeft 项——DOM 模式以 sticky left=该偏移实现，canvas 模式以两遍绘制实现（滚动列先画、固定列按固定 x 后画覆盖，命中测试在视口空间先判固定区域再查 scrollLeft）。手工滚动验证在本环境不可行，以几何单测佐证：drop-target 在固定区域的命中于 scrollLeft 0/500/5000 完全一致、canvas 渲染器录制 fillText 断言固定列文本 x 在 scrollLeft 0 与 1000 下逐值相等而非固定列随滚动平移、`pinnedColumnViewportX` 断言固定偏移不含滚动项）
  - [x] 布局随标签页持久化；测试通过（列宽 + 顺序 + 固定集合合成单一布局对象，按 DataGrid cacheKey（`<tabId>-<resultIndex>`，与待存快照/滚动位置同一键体系）随标签页持久化：切换标签页/重执行后恢复，作用域变更（换表/换 SQL，与隐藏列重置同生命周期）重置，关闭标签页随 `clearDataGridPendingSnapshotsForTab` 同点清理；旧布局数据兼容——无 order/pinned 字段（或字段畸形）按"原顺序、无固定"解析。`pnpm check` 全绿（format + lint + typecheck + vitest 182 文件 / 1380 用例，含新增 24 例）+ `pnpm build` 通过）
- **实现说明**：新增 `lib/dataGridColumnLayout.ts` 纯函数（渲染顺序合成 = 固定列稳定前置 + 手动顺序按列名排名、排名缺失者按原序尾随；reorder slot 移位；排列置换 `permutationFromOrders`；drop-target 命中；布局对象容错解析）。列名作持久化标识（actual index 跨查询不稳）；同名重复列（JOIN 场景）按首次未消费出现位置映射，语义确定。新增 `useDataGridColumnLayout` composable 持有顺序/固定/持久化宽度状态与 per-tab 缓存，DataGrid 的 `visibleColumnIndexes` 改为布局合成结果——排序/筛选/搜索/选中/导出等全部下游继续走同一数组，行为自动一致；固定集合按列名标识不随顺序失效（拖固定列到非固定区仍是固定，按排名落在固定前缀内）。宽度持久化并入 `useDataGridColumnResize`：init 应用按名列宽覆盖、resize 结束/autoFit 落盘，重排/固定经排列置换让宽度跟随列。DOM sticky 单元格的半透明色调（选中/脏/搜索/新删行/激活行）以"不透明底色 + background-image 叠加 tint"合成，避免滚动内容透出。已知取舍：固定列拖出固定区不解固定（任务只要求集合按名稳定）；拖拽重排不改排序/筛选语义。

### T41 侧栏拖表/列入编辑器 ✅ 8cf4f39f

- **来源** improvement-plan-2026-09.md §6 E7 第 3 项（Track E）· **规模** M
- **内容** `sidebar/` 无任何 `dragstart`。实现拖表名/列名入编辑器插入（按方言引号规则，与 T06 一致）。
- **验收**
  - [x] 拖表/列到编辑器光标处插入，引号规则与补全一致（表/视图拖拽系既有能力（e324f35f 起以指针拖拽实现，8e048897 弃 HTML5 dragstart 换窗口 CustomEvent——dataTransfer 在 webview 不可靠，故本任务不再引入 dragstart），本次补齐**列节点**：复用同一指针拖拽管线，drop 点 `posAtCoords` 插入（退化为当前选区并替换）；列插入裸列名，经 `sqlDialectForDatabaseType` 走 T06 `quoteSqlIdentifier`（本次从 sqlCompletion.ts 导出为唯一引号源）：MySQL 反引号（含双写转义）、SQL Server 方括号（含 `]]` 转义）、PG 双引号（保留字/大写），保留字与特殊字符加引号、普通标识符与 generic 族方言裸插入；载荷自带 source databaseType 优先于 tab 的。测试以各方言引号矩阵（含保留字 `order`/`select`/`user`、特殊字符、转义、回退与优先级）佐证与补全同规）
  - [x] 不破坏现有拖放与编辑行为；测试通过（表/视图载荷形状与插入文本零改动（既有 queryEditorTableDrop 测试原样全过）；无关拖放仍回落编辑器默认 drop（`insertDroppedSidebarReference` 无.payload 返回 false）；树重排拖拽（connection 节点）、选中/click 吞噬互不干扰；只读编辑器拒绝插入；dragover 仅按 types 列表过滤自有 MIME。`pnpm check` 全绿（format + lint + typecheck + vitest 182 文件 1398 用例，其中 queryEditorTableDrop.test.ts 18→35 例：载荷 create/parse/round-trip、双 kind 解析、各方言引号矩阵、TreeItem/QueryEditor 源码契约））
- **实现说明**：列载荷新增 `dbx-column-reference`（`{connectionId, database, schema?, tableName?, columnName, databaseType?}`）与表载荷共用同一 MIME（dragover 阶段 dataTransfer 不可读，types 列表只判"是否自有拖拽"，kind 在插入时分派）；列名取 `tableChildDropObjectName` 同源清洗（`meta.name`，回退 label 去 `" (type)"` 后缀）。`canDragTableReference` 扩为 table/view/column（列要求 `tableName` 在位，loadColumns 恒有）；TreeItem 指针拖拽与 QueryEditor 双通道插入（窗口 CustomEvent + DragEvent dataTransfer 回退）类型放宽为 union，表路径行为逐字节不变。

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
