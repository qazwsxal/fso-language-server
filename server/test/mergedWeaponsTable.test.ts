import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEffectiveWeaponsTable } from "../src/tableAnalysis/mergedWeaponsTable";

function makeSearchDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-weapon-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tablesDir, name), content);
  }
  return dir;
}

const BASE_WEAPONS_TBL = [
  "#Primary Weapons",
  "$Name: Mekhu HL-7",
  "$Damage Type: Terran",
  "$LaunchSnd: 92",
  "$ImpactSnd: 85",
  "$Icon: mekhuicon",
  "#End",
].join("\n");

test("promotes damageType/soundRefs/textureRefs from the base table into the effective entry", () => {
  const table = buildEffectiveWeaponsTable([makeSearchDir({ "weapons.tbl": BASE_WEAPONS_TBL })]);
  const entry = table.get("mekhu hl-7");

  assert.equal(entry?.damageType, "Terran");
  assert.equal(entry?.soundsByField.get("launchsnd")?.value, "92");
  assert.equal(entry?.soundsByField.get("impactsnd")?.value, "85");
  assert.equal(entry?.texturesByField.get("icon")?.value, "mekhuicon");
});

test("a .tbm layer overriding one sound field leaves the base table's other sound fields untouched", () => {
  const modTbm = ["#Primary Weapons", "$Name: Mekhu HL-7", "$ImpactSnd: MV_Missile", "#End"].join("\n");
  const table = buildEffectiveWeaponsTable([makeSearchDir({ "weapons.tbl": BASE_WEAPONS_TBL, "mymod-wep.tbm": modTbm })]);
  const entry = table.get("mekhu hl-7");

  assert.equal(entry?.soundsByField.get("impactsnd")?.value, "MV_Missile");
  assert.ok(entry?.soundsByField.get("impactsnd")?.source.endsWith("mymod-wep.tbm"));
  assert.equal(entry?.soundsByField.get("launchsnd")?.value, "92");
});

test("a .tbm layer overriding $Tech Model: leaves $Model file: untouched", () => {
  const baseTbl = ["#Primary Weapons", "$Name: Mekhu HL-7", "$Model file: mekhu.pof", "$Tech Model: mekhu_tech.pof", "#End"].join("\n");
  const modTbm = ["#Primary Weapons", "$Name: Mekhu HL-7", "$Tech Model: mekhu_tech_hd.pof", "#End"].join("\n");
  const table = buildEffectiveWeaponsTable([makeSearchDir({ "weapons.tbl": baseTbl, "mymod-wep.tbm": modTbm })]);
  const entry = table.get("mekhu hl-7");

  assert.equal(entry?.modelFile, "mekhu.pof");
  assert.equal(entry?.techModel, "mekhu_tech_hd.pof");
  assert.ok(entry?.techModelSource?.endsWith("mymod-wep.tbm"));
});

test("a .tbm layer overriding $External Model File: leaves $Model file:/$Tech Model: untouched", () => {
  const baseTbl = [
    "#Primary Weapons",
    "$Name: Mekhu HL-7",
    "$Model file: mekhu.pof",
    "$Tech Model: mekhu_tech.pof",
    "$External Model File: mekhu_ext.pof",
    "#End",
  ].join("\n");
  const modTbm = ["#Primary Weapons", "$Name: Mekhu HL-7", "$External Model File: mekhu_ext_hd.pof", "#End"].join("\n");
  const table = buildEffectiveWeaponsTable([makeSearchDir({ "weapons.tbl": baseTbl, "mymod-wep.tbm": modTbm })]);
  const entry = table.get("mekhu hl-7");

  assert.equal(entry?.modelFile, "mekhu.pof");
  assert.equal(entry?.techModel, "mekhu_tech.pof");
  assert.equal(entry?.externalModelFile, "mekhu_ext_hd.pof");
  assert.ok(entry?.externalModelFileSource?.endsWith("mymod-wep.tbm"));
});
