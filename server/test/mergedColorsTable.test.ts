import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEffectiveTeamColorTable } from "../src/tableAnalysis/mergedColorsTable";

function makeSearchDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-colors-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tablesDir, name), content);
  }
  return dir;
}

const BASE_COLORS_TBL = [
  "#Team Colors",
  "$Team Name: Hostile",
  "$Team Stripe Color: ( 255 0 0 )",
  "$Team Base Color: ( 128 0 0 )",
  "#End",
].join("\n");

test("reads a #Team Colors entry from the base colors.tbl", () => {
  const table = buildEffectiveTeamColorTable([makeSearchDir({ "colors.tbl": BASE_COLORS_TBL })]);
  const entry = table.get("hostile");

  assert.equal(entry?.name, "Hostile");
  assert.ok(entry?.nameLocation);
});

test("a .tbm layer can add its own team color on top of the base file's", () => {
  const modTbm = ["#Team Colors", "$Team Name: Neutral", "#End"].join("\n");
  const table = buildEffectiveTeamColorTable([makeSearchDir({ "colors.tbl": BASE_COLORS_TBL, "mymod-clr.tbm": modTbm })]);

  assert.ok(table.has("hostile"));
  const entry = table.get("neutral");
  assert.equal(entry?.name, "Neutral");
  assert.ok(entry?.layerSources[0].endsWith("mymod-clr.tbm"));
});
