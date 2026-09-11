import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractMflashEntries } from "../src/tableAnalysis/mflashEntries";

test("extracts +name: as the real identity of a $Mflash: entry", () => {
  const text = [
    "#Muzzle flash types",
    "$Mflash:",
    "+name: laser_flash",
    "+blob_name: flash1",
    "+blob_offset: 0.0",
    "+blob_radius: 1.0",
    "$Mflash:",
    "+name: mass_driver_flash",
    "#end",
  ].join("\n");
  const entries = extractMflashEntries(parseTable(text).sections);
  assert.deepEqual(
    entries.map((e) => `${e.name}@${e.nameLine}`),
    ["laser_flash@2", "mass_driver_flash@7"],
  );
});
