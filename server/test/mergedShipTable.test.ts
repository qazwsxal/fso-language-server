import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEffectiveShipTable } from "../src/tableAnalysis/mergedShipTable";

function makeSearchDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-ship-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tablesDir, name), content);
  }
  return dir;
}

const BASE_SHIPS_TBL = [
  "#Ship Classes",
  "$Name: GTF Ulysses",
  "$POF file: fighter3.pof",
  "$Species: Terran",
  "$AI Class: Fighter",
  "$Armor Type: TerranFighter",
  "$EngineSnd: 4",
  "$GlideStartSnd: 17",
  "$ship_icon: 2_iconulysses",
  "#End",
].join("\n");

test("promotes species/aiClass/soundRefs/textureRefs from the base table into the effective entry", () => {
  const table = buildEffectiveShipTable([makeSearchDir({ "ships.tbl": BASE_SHIPS_TBL })]);
  const entry = table.get("gtf ulysses");

  assert.equal(entry?.species, "Terran");
  assert.equal(entry?.aiClass, "Fighter");
  assert.equal(entry?.soundsByField.get("enginesnd")?.value, "4");
  assert.equal(entry?.soundsByField.get("glidestartsnd")?.value, "17");
  assert.equal(entry?.texturesByField.get("ship_icon")?.value, "2_iconulysses");
});

test("a .tbm layer overriding one sound field leaves other base sound fields untouched", () => {
  const modTbm = ["#Ship Classes", "$Name: GTF Ulysses", "$EngineSnd: 99", "#End"].join("\n");
  const table = buildEffectiveShipTable([makeSearchDir({ "ships.tbl": BASE_SHIPS_TBL, "mymod-shp.tbm": modTbm })]);
  const entry = table.get("gtf ulysses");

  assert.equal(entry?.soundsByField.get("enginesnd")?.value, "99");
  assert.ok(entry?.soundsByField.get("enginesnd")?.source.endsWith("mymod-shp.tbm"));
  // Untouched by the .tbm layer - still the base table's value.
  assert.equal(entry?.soundsByField.get("glidestartsnd")?.value, "17");
});

test("a .tbm layer setting species also carries a provenance source distinct from the base table's", () => {
  const modTbm = ["#Ship Classes", "$Name: GTF Ulysses", "$Species: Vasudan", "#End"].join("\n");
  const table = buildEffectiveShipTable([makeSearchDir({ "ships.tbl": BASE_SHIPS_TBL, "mymod-shp.tbm": modTbm })]);
  const entry = table.get("gtf ulysses");

  assert.equal(entry?.species, "Vasudan");
  assert.ok(entry?.speciesSource?.endsWith("mymod-shp.tbm"));
  assert.notEqual(entry?.speciesSource, entry?.aiClassSource);
});
