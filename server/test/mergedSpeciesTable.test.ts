import { test } from "node:test";
import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { buildEffectiveSpeciesTable } from "../src/tableAnalysis/mergedSpeciesTable";

function makeSearchDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fso-lsp-species-"));
  const tablesDir = path.join(dir, "data", "tables");
  fs.mkdirSync(tablesDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(tablesDir, name), content);
  }
  return dir;
}

test("falls back to FSO's compiled-in Terran/Vasudan/Shivan default when no real species_defs.tbl exists anywhere on the search path", () => {
  // Confirmed a real scenario against a real Blue Planet Complete install: its
  // dependency chain (including retail) never ships a real species_defs.tbl file at
  // all, loose or in a VP - species_defs.tbl is one of FSO's defaults_get_file()
  // tables, predating retail FS2's own VPs.
  const table = buildEffectiveSpeciesTable([makeSearchDir({})]);
  assert.deepEqual(
    [...table.keys()].sort(),
    ["shivan", "terran", "vasudan"],
  );
  assert.equal(table.get("terran")?.name, "Terran");
});

test("a real base species_defs.tbl takes priority over the compiled-in default (no double-counting)", () => {
  const baseTbl = ["#SPECIES DEFS", "$Species_Name: CustomSpecies", "#END"].join("\n");
  const table = buildEffectiveSpeciesTable([makeSearchDir({ "species_defs.tbl": baseTbl })]);
  assert.deepEqual([...table.keys()], ["customspecies"]);
  assert.equal(table.has("terran"), false);
});

test("a .tbm layer can still add a species on top of the compiled-in default", () => {
  const modTbm = ["#SPECIES DEFS", "$Species_Name: GTVA-TEI", "#END"].join("\n");
  const table = buildEffectiveSpeciesTable([makeSearchDir({ "mymod-sdf.tbm": modTbm })]);
  assert.ok(table.has("terran"));
  assert.ok(table.has("gtva-tei"));
});
