import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEffectiveObjectTypesTable, collectDisplayNamesForKind } from "../src/tableAnalysis/mergedObjectTypesTable";

function makeSearchDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-objecttypes-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tablesDir, name), content);
  }
  return dir;
}

test("falls back to FSO's compiled-in #Ship types default when no real objecttypes.tbl exists anywhere on the search path", () => {
  const table = buildEffectiveObjectTypesTable([makeSearchDir({})]);
  const names = collectDisplayNamesForKind(table, "ship-types");
  assert.deepEqual(names, [
    "Navbuoy",
    "Sentry Gun",
    "Escape Pod",
    "Cargo",
    "Support",
    "Fighter",
    "Bomber",
    "Transport",
    "Freighter",
    "AWACS",
    "Gas Miner",
    "Cruiser",
    "Corvette",
    "Capital",
    "Super Cap",
    "Drydock",
    "Knossos Device",
  ]);
});

test("a real base objecttypes.tbl takes priority over the compiled-in default", () => {
  const baseTbl = ["#Ship Types", "$Name: CustomType", "#End"].join("\n");
  const table = buildEffectiveObjectTypesTable([makeSearchDir({ "objecttypes.tbl": baseTbl })]);
  assert.deepEqual(collectDisplayNamesForKind(table, "ship-types"), ["CustomType"]);
});
