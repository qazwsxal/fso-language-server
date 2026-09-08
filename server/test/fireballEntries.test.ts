import { test } from "node:test";
import * as assert from "node:assert/strict";
import { parseTable } from "../src/parser";
import { extractFireballEntries } from "../src/tableAnalysis/fireballEntries";

test("extracts $Name:-only fireball entries", () => {
  const text = ["#Start", "$Name: fireball01.ani", "$Name: fireball02.ani", "#End"].join("\n");
  const entries = extractFireballEntries(parseTable(text).sections);
  assert.deepEqual(
    entries.map((e) => ({ name: e.name, uniqueId: e.uniqueId, keyedByUniqueId: e.keyedByUniqueId })),
    [
      { name: "fireball01.ani", uniqueId: null, keyedByUniqueId: false },
      { name: "fireball02.ani", uniqueId: null, keyedByUniqueId: false },
    ],
  );
});

test("pairs an optional $Unique ID: with the $Name: that follows it, instead of treating them as two entries", () => {
  const text = [
    "#Start",
    "$Unique ID: Custom Fireball 1",
    "$Name: customfb.ani",
    "$Name: plainfb.ani",
    "#End",
  ].join("\n");
  const entries = extractFireballEntries(parseTable(text).sections);
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    name: "customfb.ani",
    uniqueId: "Custom Fireball 1",
    nameLine: 2,
    keyedByUniqueId: true,
    noCreate: false,
    remove: false,
  });
  assert.equal(entries[1].name, "plainfb.ani");
  assert.equal(entries[1].uniqueId, null);
});

test("captures +nocreate/+remove sentinels on the current entry", () => {
  const text = ["#Start", "$Name: fireball01.ani", "+nocreate", "$Name: fireball02.ani", "+remove", "#End"].join("\n");
  const entries = extractFireballEntries(parseTable(text).sections);
  assert.equal(entries[0].noCreate, true);
  assert.equal(entries[1].remove, true);
});
