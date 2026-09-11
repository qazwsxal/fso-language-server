import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEffectiveIffTable } from "../src/tableAnalysis/mergedIffTable";

function makeSearchDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-iff-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tablesDir, name), content);
  }
  return dir;
}

test("falls back to FSO's compiled-in Friendly/Hostile/Neutral/Unknown/Traitor default when no real iff_defs.tbl exists anywhere on the search path", () => {
  const table = buildEffectiveIffTable([makeSearchDir({})]);
  assert.deepEqual(
    [...table.keys()].sort(),
    ["friendly", "hostile", "neutral", "traitor", "unknown"],
  );
});

test("a real base iff_defs.tbl takes priority over the compiled-in default", () => {
  const baseTbl = ["#IFFs", "$IFF Name: CustomIff", "#End"].join("\n");
  const table = buildEffectiveIffTable([makeSearchDir({ "iff_defs.tbl": baseTbl })]);
  assert.deepEqual([...table.keys()], ["customiff"]);
});
