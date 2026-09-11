import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractColorsEntries } from "../src/tableAnalysis/colorsEntries";

test("extracts $Team Name: entries from #Team Colors, ignoring other colors.tbl sections", () => {
  const text = [
    "#Start Colors",
    "$Text Normal: ( 255 255 255 )",
    "#End",
    "#Team Colors",
    "$Team Name: Hostile",
    "$Team Stripe Color: ( 255 0 0 )",
    "$Team Base Color: ( 128 0 0 )",
    "$Team Name: Friendly",
    "$Team Stripe Color: ( 0 0 255 )",
    "$Team Base Color: ( 0 0 128 )",
    "#End",
  ].join("\n");
  const entries = extractColorsEntries(parseTable(text).sections);
  assert.deepEqual(
    entries.map((e) => `${e.name}@${e.nameLine}`),
    ["Hostile@4", "Friendly@7"],
  );
});
