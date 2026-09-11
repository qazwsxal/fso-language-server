import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEffectiveShipTemplateTable } from "../src/tableAnalysis/mergedShipTemplateTable";

function makeSearchDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-ship-template-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tablesDir, name), content);
  }
  return dir;
}

const BASE_SHIPS_TBL = [
  "#Ship Templates",
  "$Template: FighterBaseTemplate",
  "#End",
  "#Ship Classes",
  "$Name: GTF Ulysses",
  "+Use Template: FighterBaseTemplate",
  "#End",
].join("\n");

test("reads a #Ship Templates entry from the same ships.tbl a ship class's +Use Template: comes from", () => {
  const table = buildEffectiveShipTemplateTable([makeSearchDir({ "ships.tbl": BASE_SHIPS_TBL })]);
  const entry = table.get("fighterbasetemplate");

  assert.equal(entry?.name, "FighterBaseTemplate");
  assert.ok(entry?.nameLocation);
});

test("a .tbm layer can add its own template, on top of the base file's", () => {
  const modTbm = ["#Ship Templates", "$Template: BomberBaseTemplate", "#End"].join("\n");
  const table = buildEffectiveShipTemplateTable([makeSearchDir({ "ships.tbl": BASE_SHIPS_TBL, "mymod-shp.tbm": modTbm })]);

  assert.ok(table.has("fighterbasetemplate"));
  const entry = table.get("bomberbasetemplate");
  assert.equal(entry?.name, "BomberBaseTemplate");
  assert.ok(entry?.layerSources[0].endsWith("mymod-shp.tbm"));
});

test("+Use Template: (template hierarchy chaining) is promoted into the effective entry", () => {
  const baseTbl = [
    "#Ship Templates",
    "$Template: FighterBaseTemplate",
    "$Template: InterceptorTemplate",
    "+Use Template: FighterBaseTemplate",
    "#End",
  ].join("\n");
  const table = buildEffectiveShipTemplateTable([makeSearchDir({ "ships.tbl": baseTbl })]);
  const entry = table.get("interceptortemplate");

  assert.equal(entry?.useTemplate, "FighterBaseTemplate");
});
