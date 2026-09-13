import { describe, expect, it } from "vitest";
import { sqlMetadataRefreshScope, sqlMetadataRefreshTarget } from "../../apps/desktop/src/lib/sqlMetadataRefresh";

describe("sqlMetadataRefreshScope", () => {
  it("returns 'none' for non-DDL statements", () => {
    expect(sqlMetadataRefreshScope("SELECT * FROM users")).toBe("none");
    expect(sqlMetadataRefreshScope("UPDATE users SET name = 'x'")).toBe("none");
    expect(sqlMetadataRefreshScope("")).toBe("none");
  });

  it("returns 'connection' for database-level DDL", () => {
    expect(sqlMetadataRefreshScope("CREATE DATABASE shop")).toBe("connection");
    expect(sqlMetadataRefreshScope("DROP DATABASE shop")).toBe("connection");
  });

  it("returns 'database' for schema and object DDL", () => {
    expect(sqlMetadataRefreshScope("CREATE SCHEMA reporting")).toBe("database");
    expect(sqlMetadataRefreshScope("CREATE TABLE users (id int)")).toBe("database");
  });
});

describe("sqlMetadataRefreshTarget", () => {
  it("treats database DDL as a connection-wide refresh, even mixed with object DDL", () => {
    expect(sqlMetadataRefreshTarget("CREATE DATABASE shop; CREATE TABLE app.users (id int)")).toEqual({
      scope: "connection",
    });
  });

  it("returns a schema-less database refresh for schema DDL", () => {
    expect(sqlMetadataRefreshTarget("CREATE SCHEMA reporting")).toEqual({ scope: "database" });
  });

  it("extracts the schema from a qualified object name", () => {
    expect(sqlMetadataRefreshTarget("CREATE TABLE reporting.metrics (id int)")).toEqual({
      scope: "database",
      schema: "reporting",
    });
    expect(sqlMetadataRefreshTarget("ALTER TABLE reporting.metrics ADD COLUMN n int")).toEqual({
      scope: "database",
      schema: "reporting",
    });
  });

  it("unquotes quoted schema identifiers", () => {
    expect(sqlMetadataRefreshTarget('CREATE TABLE "My Schema"."t" (id int)')).toEqual({
      scope: "database",
      schema: "My Schema",
    });
    expect(sqlMetadataRefreshTarget("CREATE TABLE `rep`.`t` (id int)")).toEqual({
      scope: "database",
      schema: "rep",
    });
    expect(sqlMetadataRefreshTarget("CREATE TABLE [rep].[t] (id int)")).toEqual({
      scope: "database",
      schema: "rep",
    });
  });

  it("handles IF NOT EXISTS and CREATE INDEX ... ON forms", () => {
    expect(sqlMetadataRefreshTarget("CREATE TABLE IF NOT EXISTS reporting.metrics (id int)")).toEqual({
      scope: "database",
      schema: "reporting",
    });
    expect(sqlMetadataRefreshTarget("CREATE INDEX idx_name ON reporting.metrics (id)")).toEqual({
      scope: "database",
      schema: "reporting",
    });
  });

  it("falls back to the active schema for unqualified object DDL", () => {
    expect(sqlMetadataRefreshTarget("CREATE TABLE metrics (id int)", "app")).toEqual({
      scope: "database",
      schema: "app",
    });
    expect(sqlMetadataRefreshTarget("CREATE TABLE metrics (id int)")).toEqual({ scope: "database" });
  });

  it("collapses to a schema-less database refresh when statements target different schemas", () => {
    expect(sqlMetadataRefreshTarget("CREATE TABLE a.t1 (id int); CREATE TABLE b.t2 (id int)")).toEqual({
      scope: "database",
    });
  });

  it("keeps a single schema when all statements target it", () => {
    expect(sqlMetadataRefreshTarget("CREATE TABLE a.t1 (id int); ALTER TABLE a.t2 ADD COLUMN n int")).toEqual({
      scope: "database",
      schema: "a",
    });
  });

  it("ignores DDL hidden inside comments", () => {
    expect(sqlMetadataRefreshTarget("/* CREATE DATABASE shop */ SELECT 1")).toEqual({ scope: "none" });
    expect(sqlMetadataRefreshTarget("-- CREATE TABLE a.t (id int)\nSELECT 1")).toEqual({ scope: "none" });
    expect(sqlMetadataRefreshTarget("# DROP DATABASE shop\nSELECT 1")).toEqual({ scope: "none" });
  });
});

describe("sqlMetadataRefreshScope", () => {
  it("treats temp tables, materialized views, views, functions and ALTER/DROP as object DDL", () => {
    expect(sqlMetadataRefreshScope("CREATE TEMP TABLE scratch (id int);")).toBe("database");
    expect(sqlMetadataRefreshScope("CREATE MATERIALIZED VIEW daily_users AS SELECT 1;")).toBe("database");
    expect(sqlMetadataRefreshScope("ALTER TABLE users ADD COLUMN name text;")).toBe("database");
    expect(sqlMetadataRefreshScope("DROP VIEW active_users;")).toBe("database");
    expect(sqlMetadataRefreshScope("CREATE OR REPLACE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE SQL;")).toBe(
      "database",
    );
  });

  it("treats TRUNCATE and INSERT as data-only SQL", () => {
    expect(sqlMetadataRefreshScope("INSERT INTO users VALUES (1);")).toBe("none");
    expect(sqlMetadataRefreshScope("TRUNCATE TABLE users;")).toBe("none");
  });
});
