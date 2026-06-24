import type { TreeNodeType } from "@/types/database";

const leafTypes: Set<TreeNodeType> = new Set([
  "column",
  "index",
  "fkey",
  "trigger",
  "procedure",
  "function",
  "package",
  "package-body",
  "object-browser",
  "redis-db",
  "mongo-collection",
  "user-admin",
  "saved-sql-file",
]);

const fullWidthLabelTypes: Set<TreeNodeType> = new Set(["table", "view", "mongo-collection"]);

const TREE_INDENT_STEP = 16;
const TREE_BASE_PAD = 8;

export function treeItemPaddingLeft(depth: number): string {
  return `${depth * TREE_INDENT_STEP + TREE_BASE_PAD}px`;
}

// Left offset for the connection-hue guide rail at a given connection depth.
// Sits 6px past the base content pad so it lines up under the connection's
// icon column. Shares the indent step with treeItemPaddingLeft so the rail
// can never drift out from under its column if the indent is retuned.
export function treeItemRailLeft(depth: number): string {
  return `${Math.max(0, depth) * TREE_INDENT_STEP + TREE_BASE_PAD + 6}px`;
}

export function usesFullWidthTreeLabel(type: TreeNodeType, allowHorizontalScroll: boolean): boolean {
  return allowHorizontalScroll && fullWidthLabelTypes.has(type);
}

export function canTreeNodeExpand(type: TreeNodeType): boolean {
  return !leafTypes.has(type);
}

export function canTreeNodeShowExpander({ type, childCount }: { type: TreeNodeType; childCount?: number }): boolean {
  if (!canTreeNodeExpand(type)) return false;
  if (type === "saved-sql-root" || type === "saved-sql-folder") {
    return (childCount ?? 0) > 0;
  }
  return true;
}
