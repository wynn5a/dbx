import { strict as assert } from "node:assert";
import { test } from "vitest";
import { formatDataGridSavePreview } from "../../apps/desktop/src/lib/dataGridSql.ts";

test("save preview lists statements and rollback statements as labeled sections", () => {
  const preview = formatDataGridSavePreview(
    [`DELETE FROM "people" WHERE "id" = 1;`, `UPDATE "people" SET "name" = 'New' WHERE "id" = 2;`],
    [`INSERT INTO "people" ("id", "name") VALUES (1, 'Ada');`, `UPDATE "people" SET "name" = 'Old' WHERE "id" = 2;`],
    { statements: "Statements to execute", rollbacks: "Rollback statements" },
  );

  assert.equal(
    preview,
    [
      "-- Statements to execute",
      `1. DELETE FROM "people" WHERE "id" = 1;`,
      `2. UPDATE "people" SET "name" = 'New' WHERE "id" = 2;`,
      "",
      "-- Rollback statements",
      `1. INSERT INTO "people" ("id", "name") VALUES (1, 'Ada');`,
      `2. UPDATE "people" SET "name" = 'Old' WHERE "id" = 2;`,
    ].join("\n"),
  );
});

test("save preview omits the rollback section when the backend returns no rollback statements", () => {
  const preview = formatDataGridSavePreview([`UPDATE "people" SET "name" = 'New' WHERE "id" = 1;`], [], {
    statements: "Statements to execute",
    rollbacks: "Rollback statements",
  });

  assert.equal(preview, `-- Statements to execute\n1. UPDATE "people" SET "name" = 'New' WHERE "id" = 1;`);
});
