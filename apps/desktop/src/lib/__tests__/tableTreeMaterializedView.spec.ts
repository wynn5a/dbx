import { describe, expect, it } from "vitest";
import {
  buildGroupedObjectTreeNodes,
  buildSimpleObjectTreeNodes,
  isMaterializedViewType,
  mergeTableInfosIntoObjects,
} from "@/lib/tableTree";
import type { ObjectInfo, TableInfo } from "@/types/database";

function findNodeByLabel(nodes: { label: string; children?: unknown[] }[], label: string): any {
  for (const node of nodes as any[]) {
    if (node.label === label) return node;
    if (node.children) {
      const found = findNodeByLabel(node.children, label);
      if (found) return found;
    }
  }
  return undefined;
}

describe("isMaterializedViewType", () => {
  it("detects materialized views regardless of separator/case", () => {
    expect(isMaterializedViewType("MATERIALIZED VIEW")).toBe(true);
    expect(isMaterializedViewType("MATERIALIZED_VIEW")).toBe(true);
    expect(isMaterializedViewType("materialized view")).toBe(true);
  });

  it("does not flag plain views, tables, or empty values", () => {
    expect(isMaterializedViewType("VIEW")).toBe(false);
    expect(isMaterializedViewType("BASE TABLE")).toBe(false);
    expect(isMaterializedViewType(null)).toBe(false);
    expect(isMaterializedViewType(undefined)).toBe(false);
  });
});

const objects: ObjectInfo[] = [
  { name: "active_users", object_type: "MATERIALIZED VIEW", schema: "public" },
  { name: "user_list", object_type: "VIEW", schema: "public" },
];

describe("tree builders mark materialized view nodes", () => {
  it("flags materialized views in the simple (flat) tree", () => {
    const nodes = buildSimpleObjectTreeNodes({
      nodeId: "conn:db",
      connectionId: "conn",
      database: "db",
      schema: "public",
      objects,
    });
    const matview = findNodeByLabel(nodes, "active_users");
    const view = findNodeByLabel(nodes, "user_list");
    expect(matview?.type).toBe("view");
    expect(matview?.materialized).toBe(true);
    expect(view?.type).toBe("view");
    expect(view?.materialized).toBeUndefined();
  });

  it("flags materialized views in the grouped tree", () => {
    const nodes = buildGroupedObjectTreeNodes({
      nodeId: "conn:db",
      connectionId: "conn",
      database: "db",
      schema: "public",
      objects,
    });
    const matview = findNodeByLabel(nodes, "active_users");
    const view = findNodeByLabel(nodes, "user_list");
    expect(matview?.materialized).toBe(true);
    expect(view?.materialized).toBeUndefined();
  });

  // Mirrors the real grouped "Views" path: listTables → mergeTableInfosIntoObjects([], tables) → grouped tree.
  it("preserves materialization through mergeTableInfosIntoObjects (table-list path)", () => {
    const tables: TableInfo[] = [
      { name: "customers_mv", table_type: "MATERIALIZED VIEW", comment: null },
      { name: "orders_v", table_type: "VIEW", comment: null },
    ];
    const mergedObjects = mergeTableInfosIntoObjects([], tables, "public");
    expect(mergedObjects.find((o) => o.name === "customers_mv")?.object_type).toBe("MATERIALIZED VIEW");

    const nodes = buildGroupedObjectTreeNodes({
      nodeId: "conn:db",
      connectionId: "conn",
      database: "db",
      schema: "public",
      objects: mergedObjects,
    });
    expect(findNodeByLabel(nodes, "customers_mv")?.materialized).toBe(true);
    expect(findNodeByLabel(nodes, "orders_v")?.materialized).toBeUndefined();
  });
});
