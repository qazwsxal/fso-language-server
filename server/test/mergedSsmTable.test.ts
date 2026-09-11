import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEffectiveSsmTable, resolveSsmReference } from "../src/tableAnalysis/mergedSsmTable";

function makeSearchDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-ssm-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tablesDir, name), content);
  }
  return dir;
}

const BASE_SSM_TBL = ["$SSM: GTVA Artillery Strike", "+Weapon: SSM Bomb", "$SSM: Shivan Artillery Strike", "#end"].join("\n");

test("assigns 0-based effective indices in file order for a headerless ssm.tbl", () => {
  const table = buildEffectiveSsmTable([makeSearchDir({ "ssm.tbl": BASE_SSM_TBL })]);

  assert.equal(table.get("gtva artillery strike")?.index, 0);
  assert.equal(table.get("shivan artillery strike")?.index, 1);
});

test("resolveSsmReference: resolves both a bare numeric index and a name", () => {
  const table = buildEffectiveSsmTable([makeSearchDir({ "ssm.tbl": BASE_SSM_TBL })]);

  assert.equal(resolveSsmReference(table, "1")?.name, "Shivan Artillery Strike");
  assert.equal(resolveSsmReference(table, "GTVA Artillery Strike")?.name, "GTVA Artillery Strike");
  assert.equal(resolveSsmReference(table, "99"), null);
  assert.equal(resolveSsmReference(table, "Nonexistent"), null);
});

test("a .tbm layer's new entry appends at the next free index; +nocreate without an existing match is skipped", () => {
  const modTbm = ["$SSM: New Strike", "$SSM: Ghost Strike", "+nocreate", "#end"].join("\n");
  const table = buildEffectiveSsmTable([makeSearchDir({ "ssm.tbl": BASE_SSM_TBL, "mymod-ssm.tbm": modTbm })]);

  assert.equal(table.get("new strike")?.index, 2);
  assert.equal(table.has("ghost strike"), false);
});
