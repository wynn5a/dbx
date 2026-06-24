import { afterEach, describe, expect, it } from "vitest";
import {
  DBX_TABLE_REFERENCE_DROP_EVENT,
  DBX_TABLE_REFERENCE_MIME,
  activeTableReferencePayloadValue,
  clearActiveTableReferencePayload,
  createTableReferenceDropEvent,
  createTableReferencePayload,
  hasTableReferencePayloadType,
  parseTableReferencePayload,
  serializeTableReferencePayload,
  setActiveTableReferencePayload,
  tableReferenceInsertText,
  type QueryEditorTableReferencePayload,
} from "@/lib/queryEditorTableDrop";

function samplePayload(overrides: Partial<QueryEditorTableReferencePayload> = {}): QueryEditorTableReferencePayload {
  return {
    kind: "dbx-table-reference",
    connectionId: "conn-1",
    database: "shop",
    tableName: "users",
    ...overrides,
  };
}

afterEach(() => {
  clearActiveTableReferencePayload();
});

describe("createTableReferencePayload", () => {
  it("returns null when required fields are missing", () => {
    expect(createTableReferencePayload({ database: "shop", tableName: "users" })).toBeNull();
    expect(createTableReferencePayload({ connectionId: "c", tableName: "users" })).toBeNull();
    expect(createTableReferencePayload({ connectionId: "c", database: "shop" })).toBeNull();
  });

  it("builds a payload and only includes optional fields when provided", () => {
    expect(createTableReferencePayload({ connectionId: "c", database: "shop", tableName: "users" })).toEqual({
      kind: "dbx-table-reference",
      connectionId: "c",
      database: "shop",
      tableName: "users",
    });

    expect(
      createTableReferencePayload({
        connectionId: "c",
        database: "shop",
        tableName: "users",
        schema: "public",
        databaseType: "postgres",
      }),
    ).toEqual({
      kind: "dbx-table-reference",
      connectionId: "c",
      database: "shop",
      tableName: "users",
      schema: "public",
      databaseType: "postgres",
    });
  });
});

describe("serialize/parse round-trip", () => {
  it("round-trips a full payload", () => {
    const payload = samplePayload({ schema: "public", databaseType: "postgres" });
    expect(parseTableReferencePayload(serializeTableReferencePayload(payload))).toEqual(payload);
  });
});

describe("parseTableReferencePayload", () => {
  it("returns null for empty or invalid input", () => {
    expect(parseTableReferencePayload(null)).toBeNull();
    expect(parseTableReferencePayload(undefined)).toBeNull();
    expect(parseTableReferencePayload("")).toBeNull();
    expect(parseTableReferencePayload("not json")).toBeNull();
  });

  it("rejects payloads with the wrong kind or missing required fields", () => {
    expect(
      parseTableReferencePayload(JSON.stringify({ kind: "other", connectionId: "c", database: "d", tableName: "t" })),
    ).toBeNull();
    expect(
      parseTableReferencePayload(JSON.stringify({ kind: "dbx-table-reference", database: "d", tableName: "t" })),
    ).toBeNull();
    expect(
      parseTableReferencePayload(JSON.stringify({ kind: "dbx-table-reference", connectionId: "c", database: "d" })),
    ).toBeNull();
  });

  it("drops blank optional schema but keeps databaseType", () => {
    const parsed = parseTableReferencePayload(
      JSON.stringify({ ...samplePayload({ databaseType: "mysql" }), schema: "" }),
    );
    expect(parsed).toEqual(samplePayload({ databaseType: "mysql" }));
    expect(parsed?.schema).toBeUndefined();
  });
});

describe("hasTableReferencePayloadType", () => {
  it("detects the DBX MIME type among the drag types", () => {
    expect(hasTableReferencePayloadType([DBX_TABLE_REFERENCE_MIME])).toBe(true);
    expect(hasTableReferencePayloadType(["text/plain", DBX_TABLE_REFERENCE_MIME])).toBe(true);
  });

  it("returns false when the type is absent or missing", () => {
    expect(hasTableReferencePayloadType(["text/plain"])).toBe(false);
    expect(hasTableReferencePayloadType(undefined)).toBe(false);
    expect(hasTableReferencePayloadType(null)).toBe(false);
  });
});

describe("active payload lifecycle", () => {
  it("stores and reads the active payload", () => {
    const payload = samplePayload();
    setActiveTableReferencePayload(payload);
    expect(activeTableReferencePayloadValue()).toBe(payload);
  });

  it("clears unconditionally when called with no argument", () => {
    setActiveTableReferencePayload(samplePayload());
    clearActiveTableReferencePayload();
    expect(activeTableReferencePayloadValue()).toBeNull();
  });

  it("only clears when the supplied payload matches the active one", () => {
    const payload = samplePayload();
    setActiveTableReferencePayload(payload);

    clearActiveTableReferencePayload(samplePayload({ tableName: "orders" }));
    expect(activeTableReferencePayloadValue()).toBe(payload);

    clearActiveTableReferencePayload(payload);
    expect(activeTableReferencePayloadValue()).toBeNull();
  });
});

describe("createTableReferenceDropEvent", () => {
  it("wraps the detail in a typed CustomEvent", () => {
    const detail = { payload: samplePayload(), clientX: 10, clientY: 20 };
    const event = createTableReferenceDropEvent(detail);
    expect(event.type).toBe(DBX_TABLE_REFERENCE_DROP_EVENT);
    expect(event.detail).toEqual(detail);
  });
});

describe("tableReferenceInsertText", () => {
  it("quotes using the payload's own database type", () => {
    expect(tableReferenceInsertText(samplePayload({ databaseType: "mysql" }))).toBe("`users`");
    expect(tableReferenceInsertText(samplePayload({ databaseType: "sqlserver" }))).toBe("[users]");
  });

  it("falls back to the provided database type when the payload has none", () => {
    expect(tableReferenceInsertText(samplePayload(), "mysql")).toBe("`users`");
  });

  it("payload database type takes precedence over the fallback", () => {
    expect(tableReferenceInsertText(samplePayload({ databaseType: "sqlserver" }), "mysql")).toBe("[users]");
  });

  it("defaults to double-quote identifiers when no database type is known", () => {
    expect(tableReferenceInsertText(samplePayload())).toBe('"users"');
  });
});
