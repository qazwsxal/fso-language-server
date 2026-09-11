import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEffectiveMflashTable } from "../src/tableAnalysis/mergedMflashTable";

function makeSearchDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-mflash-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tablesDir, name), content);
  }
  return dir;
}

const BASE_MFLASH_TBL = ["#Muzzle flash types", "$Mflash:", "+name: laser_flash", "#end"].join("\n");

test("reads an mflash.tbl entry keyed by +name:", () => {
  const table = buildEffectiveMflashTable([makeSearchDir({ "mflash.tbl": BASE_MFLASH_TBL })]);
  const entry = table.get("laser_flash");

  assert.equal(entry?.name, "laser_flash");
  assert.ok(entry?.nameLocation);
});

test("a .tbm layer can add its own mflash entry on top of the base file's", () => {
  const modTbm = ["#Muzzle flash types", "$Mflash:", "+name: mass_driver_flash", "#end"].join("\n");
  const table = buildEffectiveMflashTable([makeSearchDir({ "mflash.tbl": BASE_MFLASH_TBL, "mymod-mfl.tbm": modTbm })]);

  assert.ok(table.has("laser_flash"));
  const entry = table.get("mass_driver_flash");
  assert.equal(entry?.name, "mass_driver_flash");
  assert.ok(entry?.layerSources[0].endsWith("mymod-mfl.tbm"));
});
