# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What DBX is

A ~15 MB cross-platform database manager (40+ engines) built as a Tauri 2 desktop app, with the *same* Vue frontend also shipping as a self-hosted Docker/web service. Rust backend, Vue 3 + TypeScript frontend. Includes a built-in AI SQL assistant and an MCP server.

## Repository layout

Dual monorepo: a **pnpm workspace** (Node) overlaid on a **cargo workspace** (Rust).

- `apps/desktop/` — the single Vue frontend used by *both* the Tauri desktop shell and the Docker/web build.
- `src-tauri/` — Tauri native shell; `src/commands/*.rs` are the desktop-side IPC commands. (Kept at repo root, not under `apps/`, by Tauri convention.)
- `crates/dbx-core/` — shared Rust database core (drivers, schema/query logic, import/export, transfer, plugins). Depended on by both `src-tauri` and `dbx-web`.
- `crates/dbx-web/` — the `dbx-web` axum binary for the Docker/web backend; `src/routes/*.rs` are the HTTP endpoints.
- `packages/` — Node packages: `node-core` (shared), `cli` (`@dbx-app/cli`), `mcp-server` (`@dbx-app/mcp-server`), `app-tests`.
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
pnpm test -- <path>   # single test file, e.g. pnpm test -- apps/desktop/src/lib/__tests__/foo.spec.ts

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

## Frontend tooling — not the usual suspects

Formatting and linting use the **oxc** toolchain, not Prettier/ESLint:

- **oxfmt** (config `.oxfmtrc.json`): printWidth 120, 2-space, **double quotes**, trailing-comma `all`, always-parens arrows.
- **oxlint** with `--vue-plugin`.
- Pre-commit (husky + lint-staged) runs `oxfmt` on staged `apps/desktop/src/**/*.{ts,vue}` and `cargo fmt` on staged Rust under `src-tauri`, `crates/dbx-core`, `crates/dbx-web`.

Path alias `@/` → `apps/desktop/src`. UI is shadcn-vue + reka-ui on Tailwind v4; SQL editor is CodeMirror 6; i18n covers `en`, `zh-CN`, `es`.

## Architecture — the parts that span files

### One frontend, two backends (dual transport)

The frontend never calls Tauri or HTTP directly. `apps/desktop/src/lib/api.ts` is the single entry point: at runtime it detects the environment (`isTauriRuntime` in `tauriRuntime.ts`, via `__TAURI_INTERNALS__`) and lazily forwards every call to either:

- `lib/tauri.ts` — `invoke(...)` into Tauri commands (desktop), or
- `lib/http.ts` — `fetch(...)` to the `dbx-web` service (Docker/web).

**Always add new backend calls to `api.ts` and implement them in both `tauri.ts` and `http.ts`** so desktop and web stay at feature parity. The two transports expose the same function signatures by design.

### One core, two Rust frontends

`src-tauri/src/commands/*.rs` (desktop IPC) and `crates/dbx-web/src/routes/*.rs` (HTTP) are thin adapters over `crates/dbx-core`. They mirror each other file-for-file (e.g. `commands/query.rs` ↔ `routes/query.rs`). Put real logic in `dbx-core`; keep the command/route layers thin. Tauri commands are registered in `src-tauri/src/lib.rs` via `generate_handler!`.

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

## Conventions

- **Conventional Commits**, scoped: `fix(grid): clamp fill-to-width columns`, `feat(structure): ...`.
- `dbx-core` numeric JSON helpers (`safe_i64_to_json`, `safe_u64_to_json`) stringify values outside JS's safe-integer range — use them when returning large integers to the frontend.
