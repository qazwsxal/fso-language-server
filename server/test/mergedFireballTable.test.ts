import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  buildEffectiveFireballTable,
  resolveFireballReference,
  collectFireballUniqueIds,
} from "../src/tableAnalysis/mergedFireballTable";

function makeSearchDir(fireballTbl: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-fireball-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  fs.writeFileSync(path.join(tablesDir, "fireball.tbl"), fireballTbl);
  return dir;
}

// Retail fireball.tbl has exactly the 6 default entries, in this order (ground-truthed
// against fireballs.h's FIREBALL_* index constants).
const RETAIL_FIREBALL_TBL = [
  "#Start",
  "$Name: exp02.ani",
  "$Name: warpmap2.ani",
  "$Name: warpmap.ani",
  "$Name: asteroidexp01.ani",
  "$Name: boom.ani",
  "$Name: boom2.ani",
  "#End",
].join("\n");

test("assigns sequential 0-based indices to $Name:-only entries, matching real FSO's Fireball_info vector order", () => {
  const table = buildEffectiveFireballTable([makeSearchDir(RETAIL_FIREBALL_TBL)]);
  const byIndex = Array.from(table.values()).sort((a, b) => a.index - b.index);
  assert.deepEqual(
    byIndex.map((e) => e.index),
    [0, 1, 2, 3, 4, 5],
  );
});

test("resolves a numeric $Explosion Animations: reference like MediaVPs' (0,4,5) against the effective index", () => {
  const table = buildEffectiveFireballTable([makeSearchDir(RETAIL_FIREBALL_TBL)]);

  const zero = resolveFireballReference(table, "0");
  const four = resolveFireballReference(table, "4");
  const five = resolveFireballReference(table, "5");

  assert.equal(zero?.name, "exp02.ani");
  assert.equal(four?.name, "boom.ani");
  assert.equal(five?.name, "boom2.ani");
});

test("auto-generates the same unique_id fireball_generate_unique_id() would for the 6 default slots, and a Custom Fireball N id past that", () => {
  const withExtra = RETAIL_FIREBALL_TBL.replace("#End", "$Name: extra.ani\n#End");
  const table = buildEffectiveFireballTable([makeSearchDir(withExtra)]);
  const ids = collectFireballUniqueIds(table).sort();
  assert.deepEqual(ids, [
    "Asteroid Explosion",
    "Custom Fireball 1",
    "Knossos Effect",
    "Large Explosion 1",
    "Large Explosion 2",
    "Medium Explosion",
    "Warp Effect",
  ]);
});

test("an out-of-range numeric reference does not resolve", () => {
  const table = buildEffectiveFireballTable([makeSearchDir(RETAIL_FIREBALL_TBL)]);
  assert.equal(resolveFireballReference(table, "99"), null);
});

test("resolves a quoted-string reference against an entry's explicit $Unique ID:", () => {
  const withUniqueId = [
    "#Start",
    "$Unique ID: my_custom_fx",
    "$Name: custom.ani",
    "#End",
  ].join("\n");
  const table = buildEffectiveFireballTable([makeSearchDir(withUniqueId)]);
  const entry = resolveFireballReference(table, "my_custom_fx");
  assert.equal(entry?.name, "custom.ani");
  assert.equal(entry?.index, 0);
});
