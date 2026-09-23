import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import {
  DBX_TABLE_REFERENCE_DROP_EVENT,
  DBX_TABLE_REFERENCE_MIME,
  activeTableReferencePayloadValue,
  clearActiveTableReferencePayload,
  createColumnReferencePayload,
  createTableReferenceDropEvent,
  createTableReferencePayload,
  hasTableReferencePayloadType,
  parseColumnReferencePayload,
  parseSidebarReferencePayload,
  parseTableReferencePayload,
  serializeTableReferencePayload,
  setActiveTableReferencePayload,
  sidebarReferenceInsertText,
  tableReferenceInsertText,
  type QueryEditorColumnReferencePayload,
  type QueryEditorTableReferencePayload,
} from "../../apps/desktop/src/lib/queryEditorTableDrop";

const treeItemSource = readFileSync(
  new URL("../../apps/desktop/src/components/sidebar/TreeItem.vue", import.meta.url),
  "utf8",
);
const queryEditorSource = readFileSync(
  new URL("../../apps/desktop/src/components/editor/QueryEditor.vue", import.meta.url),
  "utf8",
);

function samplePayload(overrides: Partial<QueryEditorTableReferencePayload> = {}): QueryEditorTableReferencePayload {
  return {
    kind: "dbx-table-reference",
    connectionId: "conn-1",
    database: "shop",
    tableName: "users",
    ...overrides,
  };
}

function sampleColumnPayload(
  overrides: Partial<QueryEditorColumnReferencePayload> = {},
): QueryEditorColumnReferencePayload {
  return {
    kind: "dbx-column-reference",
    connectionId: "conn-1",
    database: "shop",
    tableName: "users",
    columnName: "user_id",
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

describe("tableReferenceInsertText", () => {
  it("quotes schema-qualified table names for the source database type", () => {
    expect(
      tableReferenceInsertText(
        samplePayload({ schema: "sales", tableName: "customer order", databaseType: "postgres" }),
      ),
    ).toBe('"sales"."customer order"');
    expect(
      tableReferenceInsertText(samplePayload({ schema: "dbo", tableName: "Order Detail", databaseType: "sqlserver" })),
    ).toBe("[dbo].[Order Detail]");
    expect(
      tableReferenceInsertText(samplePayload({ schema: "ignored", tableName: "order-detail", databaseType: "mysql" })),
    ).toBe("`order-detail`");
  });
});

describe("createColumnReferencePayload", () => {
  it("returns null when required fields are missing", () => {
    expect(createColumnReferencePayload({ database: "shop", columnName: "user_id" })).toBeNull();
    expect(createColumnReferencePayload({ connectionId: "c", columnName: "user_id" })).toBeNull();
    expect(createColumnReferencePayload({ connectionId: "c", database: "shop" })).toBeNull();
    expect(createColumnReferencePayload({ connectionId: "c", database: "shop", columnName: "" })).toBeNull();
  });

  it("builds a payload and only includes optional fields when provided", () => {
    expect(createColumnReferencePayload({ connectionId: "c", database: "shop", columnName: "user_id" })).toEqual({
      kind: "dbx-column-reference",
      connectionId: "c",
      database: "shop",
      columnName: "user_id",
    });

    expect(
      createColumnReferencePayload({
        connectionId: "c",
        database: "shop",
        schema: "public",
        tableName: "users",
        columnName: "user_id",
        databaseType: "postgres",
      }),
    ).toEqual({
      kind: "dbx-column-reference",
      connectionId: "c",
      database: "shop",
      schema: "public",
      tableName: "users",
      columnName: "user_id",
      databaseType: "postgres",
    });
  });
});

describe("column payload parse", () => {
  it("round-trips a column payload", () => {
    const payload = sampleColumnPayload({ schema: "sales", databaseType: "mysql" });
    expect(parseColumnReferencePayload(serializeTableReferencePayload(payload))).toEqual(payload);
  });

  it("rejects empty, malformed, or wrong-kind input", () => {
    expect(parseColumnReferencePayload(null)).toBeNull();
    expect(parseColumnReferencePayload("")).toBeNull();
    expect(parseColumnReferencePayload("not json")).toBeNull();
    expect(parseColumnReferencePayload(JSON.stringify(samplePayload()))).toBeNull();
    expect(
      parseColumnReferencePayload(JSON.stringify({ kind: "dbx-column-reference", connectionId: "c", database: "d" })),
    ).toBeNull();
  });

  it("drops blank optional fields but keeps databaseType", () => {
    const parsed = parseColumnReferencePayload(
      JSON.stringify({ ...sampleColumnPayload({ databaseType: "sqlserver" }), schema: "", tableName: "" }),
    );
    expect(parsed).toEqual({ ...sampleColumnPayload({ databaseType: "sqlserver" }), tableName: undefined });
    expect(parsed?.schema).toBeUndefined();
    expect(parsed?.tableName).toBeUndefined();
  });
});

describe("parseSidebarReferencePayload", () => {
  it("accepts both sidebar reference kinds", () => {
    expect(parseSidebarReferencePayload(serializeTableReferencePayload(samplePayload()))).toEqual(samplePayload());
    expect(parseSidebarReferencePayload(serializeTableReferencePayload(sampleColumnPayload()))).toEqual(
      sampleColumnPayload(),
    );
  });

  it("rejects payloads that are neither kind", () => {
    expect(parseSidebarReferencePayload(JSON.stringify({ kind: "other", connectionId: "c" }))).toBeNull();
    expect(parseSidebarReferencePayload(undefined)).toBeNull();
  });
});

describe("sidebarReferenceInsertText for columns", () => {
  it("quotes with the T06 dialect rules: MySQL backticks", () => {
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "user_id", databaseType: "mysql" }))).toBe(
      "user_id",
    );
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "order", databaseType: "mysql" }))).toBe(
      "`order`",
    );
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "user-name", databaseType: "mysql" }))).toBe(
      "`user-name`",
    );
    expect(
      sidebarReferenceInsertText(sampleColumnPayload({ columnName: "col`name", databaseType: "mysql" })),
    ).toBe("`col``name`");
  });

  it("quotes with the T06 dialect rules: SQL Server brackets", () => {
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "user_id", databaseType: "sqlserver" }))).toBe(
      "user_id",
    );
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "order", databaseType: "sqlserver" }))).toBe(
      "[order]",
    );
    expect(
      sidebarReferenceInsertText(sampleColumnPayload({ columnName: "col]name", databaseType: "sqlserver" })),
    ).toBe("[col]]name]");
  });

  it("quotes with the T06 dialect rules: Postgres double quotes", () => {
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "user_id", databaseType: "postgres" }))).toBe(
      "user_id",
    );
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "select", databaseType: "postgres" }))).toBe(
      '"select"',
    );
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "user", databaseType: "postgres" }))).toBe(
      '"user"',
    );
    expect(
      sidebarReferenceInsertText(sampleColumnPayload({ columnName: "UserProfile", databaseType: "postgres" })),
    ).toBe('"UserProfile"');
  });

  it("leaves generic-family dialects unquoted (same as completion)", () => {
    for (const databaseType of ["duckdb", "clickhouse", "sqlite", "generic", undefined] as const) {
      expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "order", databaseType }))).toBe("order");
    }
  });

  it("ANSI-quotes generic-family column drops that cannot be bare, and Oracle non-upper-case names", () => {
    for (const databaseType of ["duckdb", "clickhouse", "sqlite", "generic"] as const) {
      expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "Order Date", databaseType }))).toBe(
        '"Order Date"',
      );
      expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "my-col", databaseType }))).toBe('"my-col"');
    }
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "myCol", databaseType: "oracle" }))).toBe(
      '"myCol"',
    );
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "ORDER_ID", databaseType: "oracle" }))).toBe(
      "ORDER_ID",
    );
  });

  it("falls back to the provided database type when the payload has none", () => {
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "order", databaseType: undefined }), "mysql")).toBe(
      "`order`",
    );
  });

  it("payload database type takes precedence over the fallback", () => {
    expect(sidebarReferenceInsertText(sampleColumnPayload({ columnName: "order", databaseType: "sqlserver" }), "mysql")).toBe(
      "[order]",
    );
  });
});

describe("sidebar drag-to-editor wiring contracts (T41)", () => {
  it("TreeItem drags table, view, and column nodes via the pointer-based reference drag", () => {
    expect(treeItemSource).toMatch(
      /props\.node\.type === "table" \|\| props\.node\.type === "view" \|\| props\.node\.type === "column"/,
    );
    expect(treeItemSource).toMatch(/props\.node\.type !== "column" \|\| !!props\.node\.tableName/);
    // The pointer-drag entry point stays wired on row mousedown.
    expect(treeItemSource).toMatch(/else if \(canDragTableReference\.value\) \{\s*startTableReferenceMouseDrag\(event\);/);
  });

  it("TreeItem builds a column payload from the clean column name and keeps the table payload for tables", () => {
    expect(treeItemSource).toMatch(/if \(props\.node\.type === "column"\) \{/);
    expect(treeItemSource).toMatch(/createColumnReferencePayload\(\{/);
    expect(treeItemSource).toMatch(/columnName: tableChildDropObjectName\(props\.node\)/);
    expect(treeItemSource).toMatch(/tableName: props\.node\.tableName/);
    expect(treeItemSource).toMatch(/createTableReferencePayload\(\{/);
    // Drops only land when released over the editor root.
    expect(treeItemSource).toMatch(/target\.closest\("\[data-query-editor-root\]"\)/);
  });

  it("QueryEditor parses both payload kinds and inserts with the shared quoting rules", () => {
    expect(queryEditorSource).toMatch(/parseSidebarReferencePayload\(event\.dataTransfer\?\.getData\(DBX_TABLE_REFERENCE_MIME\)\)/);
    expect(queryEditorSource).toMatch(/activeTableReferencePayloadValue\(\) \?\?\s*parseSidebarReferencePayload\(/);
    expect(queryEditorSource).toMatch(/sidebarReferenceInsertText\(payload, props\.databaseType\)/);
    expect(queryEditorSource).toMatch(/const dropPos = coords \? currentView\.posAtCoords\(\{ x: coords\.clientX, y: coords\.clientY \}\) : null;/);
    expect(queryEditorSource).toMatch(/if \(props\.readOnly\) return false;/);
  });

  it("QueryEditor keeps the dragover type filter and drop entry points wired", () => {
    expect(queryEditorSource).toMatch(/if \(props\.readOnly \|\| !hasDroppedTableReference\(event\)\) return false;/);
    expect(queryEditorSource).toMatch(/return insertDroppedSidebarReference\(currentView, event\);/);
    expect(queryEditorSource).toMatch(/window\.addEventListener\(DBX_TABLE_REFERENCE_DROP_EVENT, onTableReferenceDropEvent\)/);
    expect(queryEditorSource).toMatch(/window\.removeEventListener\(DBX_TABLE_REFERENCE_DROP_EVENT, onTableReferenceDropEvent\)/);
    expect(queryEditorSource).toMatch(/insertSidebarReferencePayload\(currentView, detail\.payload, detail\)/);
  });

  it("quoteSqlIdentifier stays the single quoting source for dropped identifiers", () => {
    const dropModuleSource = readFileSync(
      new URL("../../apps/desktop/src/lib/queryEditorTableDrop.ts", import.meta.url),
      "utf8",
    );
    expect(dropModuleSource).toMatch(/import \{ quoteSqlIdentifier \} from "@\/lib\/sqlCompletion";/);
    expect(dropModuleSource).toMatch(/quoteSqlIdentifier\(payload\.columnName, dialect\)/);
  });
});
