import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractSsmEntries } from "../src/tableAnalysis/ssmEntries";

test("extracts $SSM: entries from a headerless ssm.tbl, honoring +nocreate", () => {
  const text = [
    "$SSM: GTVA Artillery Strike",
    "+Weapon: SSM Bomb",
    "+Count: 4",
    "$SSM: Shivan Artillery Strike",
    "+nocreate",
    "+Weapon: SSM Bomb Shivan",
    "#end",
  ].join("\n");
  const entries = extractSsmEntries(parseTable(text).sections);
  assert.deepEqual(
    entries.map((e) => `${e.name}@${e.nameLine}:${e.noCreate}`),
    ["GTVA Artillery Strike@0:false", "Shivan Artillery Strike@3:true"],
  );
});
