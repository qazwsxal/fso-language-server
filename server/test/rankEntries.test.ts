import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractRankEntries } from "../src/tableAnalysis/rankEntries";

test("extracts rank entries from a headerless rank.tbl (no #Ranks section at all)", () => {
  const text = ["$Name: Cadet", "$Points: 0", "$Name: Ensign", "$Points: 500", "#End"].join("\n");
  const entries = extractRankEntries(parseTable(text).sections);
  assert.deepEqual(entries.map((e) => e.name), ["Cadet", "Ensign"]);
});

test("extracts rank entries from a rank.tbl using the legacy [RANK NAMES] bracket header", () => {
  const text = ["[RANK NAMES]", "$Name: Cadet", "#End"].join("\n");
  const entries = extractRankEntries(parseTable(text).sections);
  assert.deepEqual(entries.map((e) => e.name), ["Cadet"]);
});

test("extracts rank entries from a rank.tbl using the explicit #Ranks header", () => {
  const text = ["#Ranks", "$Name: Cadet", "#End"].join("\n");
  const entries = extractRankEntries(parseTable(text).sections);
  assert.deepEqual(entries.map((e) => e.name), ["Cadet"]);
});
