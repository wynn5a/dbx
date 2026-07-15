# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What DBX is

A ~15 MB cross-platform database manager (40+ engines) built as a Tauri 2 desktop app, with the *same* Vue frontend also shipping as a self-hosted Docker/web service. Rust backend, Vue 3 + TypeScript frontend. Includes a built-in AI SQL assistant and an MCP server.

## Repository layout

Dual monorepo: a **pnpm workspace** (Node) overlaid on a **cargo workspace** (Rust; members: `src-tauri`, `crates/dbx-core`, `crates/dbx-web`).

- `apps/desktop/` — the single Vue frontend used by *both* the Tauri desktop shell and the Docker/web build.
- `src-tauri/` — Tauri native shell; `src/commands/*.rs` are the desktop-side IPC commands. (Kept at repo root, not under `apps/`, by Tauri convention.)
- `crates/dbx-core/` — shared Rust database core (drivers, schema/query logic, import/export, transfer, plugins). Depended on by both `src-tauri` and `dbx-web`.
- `crates/dbx-web/` — the `dbx-web` axum binary for the Docker/web backend; `src/routes/*.rs` are the HTTP endpoints.
- `packages/` — Node packages: `node-core` (shared), `cli` (`@dbx-app/cli`), `mcp-server` (`@dbx-app/mcp-server`), `app-tests` (the frontend test suite — see Testing).
- `plugins/jdbc/` — optional JDBC plugin (needs Java 17 to build).
- `docs/` — Next.js documentation site (separate pnpm project with its own lockfile).
- `deploy/` — Docker / compose assets.

## Commands

Run from the repo root.

```bash
pnpm install
pnpm dev:tauri        # desktop dev (frontend + Rust shell)
pnpm dev:web          # web-mode frontend only (port 5173, --mode web)
pnpm dev:backend      # dbx-web Rust backend (cargo watch); DBX_PASSWORD defaults to "test"

pnpm check            # format-check + lint + typecheck + vitest, run in parallel (scripts/run-check.mjs)
pnpm lint             # oxlint
pnpm fmt              # oxfmt (writes); CI uses oxfmt --check
pnpm typecheck        # vue-tsc against apps/desktop/tsconfig.json
pnpm test             # vitest run (whole suite)
pnpm test -- <path>   # single test file, e.g. pnpm test -- packages/app-tests/dataGridSort.test.ts

pnpm build            # build frontend (web/dist)
pnpm tauri build      # build desktop installer -> src-tauri/target/release/bundle/
```

Rust checks (run before a PR — frontend `pnpm check` does **not** cover Rust):

```bash
cargo fmt --check
cargo check --workspace --locked
cargo test -p dbx-core
```

Node package changes:

```bash
pnpm build:packages   # node-core, cli, mcp-server
pnpm test:packages
pnpm publish:dry-run  # build + pack-check before publishing
```

## Architecture — the parts that span files

### One frontend, two backends (dual transport)

The frontend never calls Tauri or HTTP directly. `apps/desktop/src/lib/api.ts` is the single entry point: at runtime it detects the environment (`isTauriRuntime` in `tauriRuntime.ts`, via `__TAURI_INTERNALS__`) and lazily forwards every call to either:

- `lib/tauri.ts` — `invoke(...)` into Tauri commands (desktop), or
- `lib/http.ts` — `fetch(...)` to the `dbx-web` service (Docker/web).

### One core, two Rust frontends

`src-tauri/src/commands/*.rs` (desktop IPC) and `crates/dbx-web/src/routes/*.rs` are thin adapters over `crates/dbx-core`. They largely mirror each other file-for-file (e.g. `commands/query.rs` ↔ `routes/query.rs`); a few files are platform-specific (`system_fonts.rs`, `deep_link.rs` desktop-only). Put real logic in `dbx-core`; keep the command/route layers thin. Tauri commands are registered in `src-tauri/src/lib.rs` via `generate_handler!`.

**Checklist — adding a backend capability** (desktop and web must stay at feature parity):

1. Real logic in `crates/dbx-core`.
2. Tauri command in `src-tauri/src/commands/`, registered in `src-tauri/src/lib.rs`.
3. HTTP route in `crates/dbx-web/src/routes/`.
4. Frontend: add to `api.ts`, implement in **both** `tauri.ts` and `http.ts` (same function signature by design).

### Database drivers

Per-engine modules live in `crates/dbx-core/src/db/*.rs` (`mysql.rs`, `postgres.rs`, `sqlite.rs`, `sqlserver.rs`, `mongo_driver.rs`, `redis_driver.rs`, `clickhouse_driver.rs`, `duckdb_driver.rs`, etc.). These expose free functions (e.g. `execute_query`, `execute_query_with_max_rows`) rather than a single shared trait.

**Agent drivers** (`db/agent_driver.rs`) are out-of-process drivers (the JDBC plugin and other engines) spoken to over a stdio JSON-RPC protocol (`AGENT_PROTOCOL_VERSION`, schema in `crates/dbx-core/assets/agent-protocol-v1.json`). This is how DBX reaches H2, Snowflake, Trino, Hive, DB2, etc. without bundling their runtimes.

### Driver metadata manifest — edit this first

`crates/dbx-core/assets/database-drivers.manifest.json` is the **single source of truth** for each database's runtime mode (`native`/`file`/agent), MCP/CLI routing, capabilities, default port, and pool behavior. When adding or changing a database type, update the manifest first, then run:

```bash
cargo test -p dbx-core --test database_capabilities
pnpm --filter @dbx-app/node-core exec tsx --test tests/driver-manifest.test.ts
pnpm --filter @dbx-app/mcp-server exec tsx --test tests/driver-manifest.test.ts
```

## Frontend code organization

Path alias `@/` → `apps/desktop/src`.

- `lib/` — the bulk of frontend logic lives here as **framework-free TypeScript modules** (one concern per file: `dataGridSort.ts`, `sqlCompletion.ts`, …). Prefer adding logic here over burying it in components — this is what makes it testable from `packages/app-tests`.
- `components/` — Vue components grouped by feature (`grid/`, `sidebar/`, `editor/`, `structure/`, `connection/`, …); `components/ui/` is shadcn-vue.
- `stores/` — Pinia stores (`connectionStore`, `queryStore`, `settingsStore`, `historyStore`, `savedSqlStore`).
- `composables/` — Vue composables (`useSqlExecution`, `useDataGridSelection`, …).
- `i18n/locales/` — six locales: `en`, `es`, `it`, `pt-BR`, `zh-CN`, `zh-TW`. `zh-CN` is the default and eagerly loaded; the rest are lazy-loaded. New UI strings must be added to **all six** locale files.
- `styles/globals.css` — the design system: `--ds-*` CSS variables (colors, text tiers, surfaces, per-type accents) and `.ds-*` recipe classes (`.ds-popover`, `.ds-tooltip`, `.ds-toast`, …). Style new UI with these tokens/recipes, not ad-hoc values.

UI stack: shadcn-vue + reka-ui on Tailwind v4; SQL editor is CodeMirror 6; charts are ECharts.

## Testing

Frontend tests do **not** sit next to the code. `vitest.config.ts` includes:

- `packages/app-tests/*.test.ts` — the main suite: one `<module>.test.ts` per `apps/desktop/src/lib/` module (140+ files). **New `lib/` logic gets its test here.**
- `apps/desktop/src/**/*.spec.ts` — a small number of colocated specs (mostly `lib/__tests__/`).
- `packages/node-core/tests/*.test.ts` and `docs/lib/*.test.ts`.

Rust tests: `cargo test -p dbx-core`.

## Frontend tooling — not the usual suspects

Formatting and linting use the **oxc** toolchain, not Prettier/ESLint:

- **oxfmt** (config `.oxfmtrc.json`): printWidth 120, 2-space, **double quotes**, trailing-comma `all`, always-parens arrows.
- **oxlint** with `--vue-plugin`.
- Pre-commit (husky + lint-staged) runs `oxfmt` on staged `apps/desktop/src/**/*.{ts,vue}` and `cargo fmt` on staged Rust under `src-tauri`, `crates/dbx-core`, `crates/dbx-web`.

## Conventions & gotchas

- **Conventional Commits**, scoped: `fix(grid): clamp fill-to-width columns`, `feat(structure): ...`.
- `dbx-core` numeric JSON helpers (`safe_i64_to_json`, `safe_u64_to_json`) stringify values outside JS's safe-integer range — use them when returning large integers to the frontend.
- Root `Cargo.toml` patches `tokio-postgres`/`postgres-types`/`postgres-protocol` and `mysql_async` to forks (GaussDB support; deprecated `sha256_password` auth). Don't bump these deps without checking the patch section.
- The `pnpm dev:tauri` webview does not reliably hot-reload frontend changes — restart it to see them (or verify UI work in `pnpm dev:web`).
